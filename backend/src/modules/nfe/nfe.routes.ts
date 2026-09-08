import { Router } from "express";
import { z } from "zod";
import { Company, Role } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { authenticate, authorize } from "../../middlewares/auth";
import { AppError } from "../../utils/AppError";
import { decryptBuffer, decryptText } from "../../lib/encryption";
import { checkForNewInvoices, fetchFullInvoice, SefazCredentials } from "../../lib/nfeSefaz";
import { authorizeImport, recordFetchFailure, recordPendingImport, rejectImport } from "../../lib/nfeImporter";

const router = Router();
router.use(authenticate);

/**
 * The SEFAZ Distribuicao DFe webservice enforces its own server-side
 * throttle: querying it more than once an hour (cStat 656, "Rejeicao:
 * Consumo Indevido") gets the certificate's IP/session penalized. We
 * can't lift that limit from our side, so the only real fix is to never
 * call it more often than that ourselves - this mirrors what makes other
 * NFe integrations "just work": they respect the cadence, not some
 * different request shape.
 */
const RADAR_MIN_INTERVAL_MS = 60 * 60 * 1000;

function assertRadarCooldownElapsed(company: Company | null) {
  if (!company?.lastRadarCheckAt) return;

  const elapsedMs = Date.now() - company.lastRadarCheckAt.getTime();
  if (elapsedMs >= RADAR_MIN_INTERVAL_MS) return;

  const waitMinutes = Math.ceil((RADAR_MIN_INTERVAL_MS - elapsedMs) / 60_000);
  throw new AppError(
    `A SEFAZ permite no maximo 1 consulta por hora ao radar de NF-e. Aguarde mais ${waitMinutes} minuto(s) antes de tentar de novo (isso evita o erro "656 - Consumo Indevido").`,
    429,
  );
}

function loadCredentials(company: Company | null): {
  credentials: SefazCredentials;
  cnpj: string;
  uf: string;
  ambiente: "PRODUCAO" | "HOMOLOGACAO";
  ultNsu: string;
} {
  if (!company?.cnpj || !company.uf) {
    throw new AppError("Cadastre o CNPJ e a UF da empresa em Configuracoes antes de usar o radar", 422);
  }

  if (!company.certificateData || !company.certificateIv || !company.certificateAuthTag) {
    throw new AppError("Nenhum certificado digital cadastrado em Configuracoes", 422);
  }
  if (!company.certificatePassword || !company.certificatePasswordIv || !company.certificatePasswordTag) {
    throw new AppError("Certificado cadastrado sem senha associada - reenvie o certificado", 422);
  }

  const pfx = decryptBuffer({
    data: company.certificateData,
    iv: company.certificateIv,
    authTag: company.certificateAuthTag,
  });
  const passphrase = decryptText({
    data: company.certificatePassword,
    iv: company.certificatePasswordIv,
    authTag: company.certificatePasswordTag,
  });

  return {
    credentials: { pfx, passphrase },
    cnpj: company.cnpj,
    uf: company.uf,
    ambiente: company.ambiente,
    ultNsu: company.nfeUltNsu,
  };
}

/**
 * The radar only discovers and lists - it never launches anything into
 * stock or financial by itself. Every key found either becomes a PENDENTE
 * NfeImport (waiting for a person to authorize or reject) or, if the full
 * document could not be downloaded, an ERRO entry with nothing to act on.
 */
router.post(
  "/radar/check",
  authorize(Role.ADMIN, Role.GERENTE),
  asyncHandler(async (req, res) => {
    const companyId = req.user!.companyId;
    const company = await prisma.company.findUnique({ where: { id: companyId } });
    assertRadarCooldownElapsed(company);

    const { credentials, cnpj, uf, ambiente, ultNsu } = loadCredentials(company);

    try {
      const discovery = await checkForNewInvoices(credentials, cnpj, uf, ambiente, ultNsu);

      const results: { chaveAcesso: string; status: string; errorMessage?: string }[] = [];

      for (const chaveAcesso of discovery.chavesEncontradas) {
        const alreadyKnown = await prisma.nfeImport.findUnique({ where: { chaveAcesso } });
        if (alreadyKnown) {
          results.push({ chaveAcesso, status: "IGNORADA" });
          continue;
        }

        const fullInvoice = await fetchFullInvoice(credentials, cnpj, uf, ambiente, chaveAcesso);
        if (!fullInvoice) {
          await recordFetchFailure(
            companyId,
            chaveAcesso,
            discovery.maxNSU,
            "Nao foi possivel obter o documento completo junto a SEFAZ",
          );
          results.push({ chaveAcesso, status: "ERRO", errorMessage: "Nao foi possivel obter o documento completo" });
          continue;
        }

        await recordPendingImport(companyId, fullInvoice, discovery.maxNSU);
        results.push({ chaveAcesso, status: "PENDENTE" });
      }

      await prisma.company.update({
        where: { id: companyId },
        data: {
          nfeUltNsu: discovery.maxNSU,
          nfeMaxNsu: discovery.maxNSU,
          lastRadarCheckAt: new Date(),
          lastRadarStatus: `${discovery.chavesEncontradas.length} nota(s) encontrada(s)`,
          lastRadarError: null,
        },
      });

      res.json({
        notasEncontradas: discovery.chavesEncontradas.length,
        resultados: results,
      });
    } catch (error) {
      const message = error instanceof AppError ? error.message : "Falha ao consultar a SEFAZ";

      await prisma.company.update({
        where: { id: companyId },
        data: { lastRadarCheckAt: new Date(), lastRadarError: message },
      });

      throw error;
    }
  }),
);

router.get(
  "/imports",
  asyncHandler(async (req, res) => {
    const { status } = req.query;
    const imports = await prisma.nfeImport.findMany({
      where: {
        companyId: req.user!.companyId,
        ...(status ? { status: status as never } : {}),
      },
      include: {
        supplier: true,
        purchaseOrder: true,
        reviewedBy: { select: { name: true } },
        items: { include: { product: { select: { name: true } }, unit: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    res.json(imports);
  }),
);

const reviewItemSchema = z
  .object({
    productId: z.string().uuid().nullable().optional(),
    createNewProduct: z.boolean().optional(),
    unitId: z.string().uuid().optional(),
    conversionFactor: z.number().positive().optional(),
    salePrice: z.number().nonnegative().optional(),
  })
  .refine((data) => Boolean(data.productId) !== Boolean(data.createNewProduct), {
    message: "Escolha associar a um produto existente OU criar um novo, nao os dois",
  });

/**
 * Revisa um item da nota antes da autorizacao: associa a um produto ja
 * cadastrado, ou marca para criar um novo (exigindo a unidade de estoque e
 * o fator de conversao, ja que authorizeImport usa exatamente esses dados
 * pra converter a quantidade/custo da unidade fiscal da nota para a unidade
 * de estoque do produto).
 */
router.patch(
  "/imports/:id/items/:itemId",
  authorize(Role.ADMIN, Role.GERENTE),
  asyncHandler(async (req, res) => {
    const data = reviewItemSchema.parse(req.body);
    const companyId = req.user!.companyId;

    const nfeImport = await prisma.nfeImport.findFirst({ where: { id: req.params.id, companyId } });
    if (!nfeImport) throw new AppError("Nota nao encontrada", 404);
    if (nfeImport.status !== "PENDENTE") {
      throw new AppError("Esta nota ja foi autorizada, rejeitada ou nao pode ser processada", 422);
    }

    const item = await prisma.nfeImportItem.findFirst({
      where: { id: req.params.itemId, nfeImportId: nfeImport.id, companyId },
    });
    if (!item) throw new AppError("Item nao encontrado nesta nota", 404);

    let unitId = data.unitId;
    let conversionFactor = data.conversionFactor;

    if (data.productId) {
      const product = await prisma.product.findFirst({ where: { id: data.productId, companyId } });
      if (!product) throw new AppError("Produto informado nao pertence a esta empresa", 422);
      unitId = unitId ?? product.unitId;
      conversionFactor = conversionFactor ?? Number(product.conversionFactor);
    } else if (data.createNewProduct && !unitId) {
      throw new AppError("Escolha a unidade de estoque/venda do novo produto", 422);
    }

    const updated = await prisma.nfeImportItem.update({
      where: { id: item.id },
      data: {
        productId: data.productId ?? null,
        createNewProduct: Boolean(data.createNewProduct),
        unitId,
        conversionFactor: conversionFactor ?? 1,
        salePrice: data.salePrice,
        reviewed: true,
      },
    });

    res.json(updated);
  }),
);

router.post(
  "/imports/:id/authorize",
  authorize(Role.ADMIN, Role.GERENTE),
  asyncHandler(async (req, res) => {
    const outcome = await authorizeImport(req.params.id, req.user!.companyId, req.user!.sub);
    res.json(outcome);
  }),
);

router.post(
  "/imports/:id/reject",
  authorize(Role.ADMIN, Role.GERENTE),
  asyncHandler(async (req, res) => {
    await rejectImport(req.params.id, req.user!.companyId, req.user!.sub);
    res.status(204).send();
  }),
);

export default router;
