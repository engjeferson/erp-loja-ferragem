import { Router } from "express";
import { Role } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { authenticate, authorize } from "../../middlewares/auth";
import { AppError } from "../../utils/AppError";
import { decryptBuffer, decryptText } from "../../lib/encryption";
import { checkForNewInvoices, fetchFullInvoice, SefazCredentials } from "../../lib/nfeSefaz";
import { importNfe } from "../../lib/nfeImporter";

const router = Router();
router.use(authenticate);

const SETTINGS_ID = "default";

async function loadCredentials(): Promise<{
  credentials: SefazCredentials;
  cnpj: string;
  uf: string;
  ambiente: "PRODUCAO" | "HOMOLOGACAO";
  ultNsu: string;
}> {
  const settings = await prisma.companySettings.findUnique({ where: { id: SETTINGS_ID } });

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

router.post(
  "/radar/check",
  authorize(Role.ADMIN, Role.GERENTE),
  asyncHandler(async (req, res) => {
    const { credentials, cnpj, uf, ambiente, ultNsu } = await loadCredentials();

    try {
      const discovery = await checkForNewInvoices(credentials, cnpj, uf, ambiente, ultNsu);

      const results: { chaveAcesso: string; status: string; errorMessage?: string }[] = [];

      for (const chaveAcesso of discovery.chavesEncontradas) {
        const alreadyImported = await prisma.nfeImport.findUnique({ where: { chaveAcesso } });
        if (alreadyImported) {
          results.push({ chaveAcesso, status: "IGNORADA" });
          continue;
        }

        const fullInvoice = await fetchFullInvoice(credentials, cnpj, uf, ambiente, chaveAcesso);
        if (!fullInvoice) {
          results.push({ chaveAcesso, status: "ERRO", errorMessage: "Nao foi possivel obter o documento completo" });
          continue;
        }

        const outcome = await importNfe(fullInvoice, discovery.maxNSU, req.user!.sub);
        results.push({ chaveAcesso, status: outcome.status, errorMessage: outcome.errorMessage });
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
  asyncHandler(async (_req, res) => {
    const imports = await prisma.nfeImport.findMany({
      include: { supplier: true, purchaseOrder: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    res.json(imports);
  }),
);

export default router;
