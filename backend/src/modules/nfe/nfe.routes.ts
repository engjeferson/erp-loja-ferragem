import { Router } from "express";
import { CompanySettings, Role } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { authenticate, authorize } from "../../middlewares/auth";
import { AppError } from "../../utils/AppError";
import { decryptBuffer, decryptText } from "../../lib/encryption";
import { checkForNewInvoices, fetchFullInvoice, SefazCredentials } from "../../lib/nfeSefaz";
import { authorizeImport, recordFetchFailure, recordPendingImport, rejectImport } from "../../lib/nfeImporter";

const router = Router();
router.use(authenticate);

const SETTINGS_ID = "default";

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

function assertRadarCooldownElapsed(settings: CompanySettings | null) {
  if (!settings?.lastRadarCheckAt) return;

  const elapsedMs = Date.now() - settings.lastRadarCheckAt.getTime();
  if (elapsedMs >= RADAR_MIN_INTERVAL_MS) return;

  const waitMinutes = Math.ceil((RADAR_MIN_INTERVAL_MS - elapsedMs) / 60_000);
  throw new AppError(
    `A SEFAZ permite no maximo 1 consulta por hora ao radar de NF-e. Aguarde mais ${waitMinutes} minuto(s) antes de tentar de novo (isso evita o erro "656 - Consumo Indevido").`,
    429,
  );
}

async function loadCredentials(settings: CompanySettings | null): Promise<{
  credentials: SefazCredentials;
  cnpj: string;
  uf: string;
  ambiente: "PRODUCAO" | "HOMOLOGACAO";
  ultNsu: string;
}> {
  if (!settings?.cnpj || !settings.uf) {
    throw new AppError("Cadastre o CNPJ e a UF da empresa em Configuracoes antes de usar o radar", 422);
  }

  if (!settings.certificateData || !settings.certificateIv || !settings.certificateAuthTag) {
    throw new AppError("Nenhum certificado digital cadastrado em Configuracoes", 422);
  }
  if (!settings.certificatePassword || !settings.certificatePasswordIv || !settings.certificatePasswordTag) {
    throw new AppError("Certificado cadastrado sem senha associada - reenvie o certificado", 422);
  }

  const pfx = decryptBuffer({
    data: settings.certificateData,
    iv: settings.certificateIv,
    authTag: settings.certificateAuthTag,
  });
  const passphrase = decryptText({
    data: settings.certificatePassword,
    iv: settings.certificatePasswordIv,
    authTag: settings.certificatePasswordTag,
  });

  return {
    credentials: { pfx, passphrase },
    cnpj: settings.cnpj,
    uf: settings.uf,
    ambiente: settings.ambiente,
    ultNsu: settings.nfeUltNsu,
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
    const settings = await prisma.companySettings.findUnique({ where: { id: SETTINGS_ID } });
    assertRadarCooldownElapsed(settings);

    const { credentials, cnpj, uf, ambiente, ultNsu } = await loadCredentials(settings);

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
            chaveAcesso,
            discovery.maxNSU,
            "Nao foi possivel obter o documento completo junto a SEFAZ",
          );
          results.push({ chaveAcesso, status: "ERRO", errorMessage: "Nao foi possivel obter o documento completo" });
          continue;
        }

        await recordPendingImport(fullInvoice, discovery.maxNSU);
        results.push({ chaveAcesso, status: "PENDENTE" });
      }

      await prisma.companySettings.update({
        where: { id: SETTINGS_ID },
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

      await prisma.companySettings.update({
        where: { id: SETTINGS_ID },
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
      where: status ? { status: status as never } : undefined,
      include: { supplier: true, purchaseOrder: true, reviewedBy: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    res.json(imports);
  }),
);

router.post(
  "/imports/:id/authorize",
  authorize(Role.ADMIN, Role.GERENTE),
  asyncHandler(async (req, res) => {
    const outcome = await authorizeImport(req.params.id, req.user!.sub);
    res.json(outcome);
  }),
);

router.post(
  "/imports/:id/reject",
  authorize(Role.ADMIN, Role.GERENTE),
  asyncHandler(async (req, res) => {
    await rejectImport(req.params.id, req.user!.sub);
    res.status(204).send();
  }),
);

export default router;
