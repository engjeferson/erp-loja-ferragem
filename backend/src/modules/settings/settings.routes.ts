import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { NfeAmbiente, Role } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { authenticate, authorize } from "../../middlewares/auth";
import { AppError } from "../../utils/AppError";
import { encryptBuffer, encryptText } from "../../lib/encryption";
import { readCertificateInfo } from "../../lib/certificate";

const router = Router();
router.use(authenticate, authorize(Role.ADMIN, Role.GERENTE));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const SETTINGS_ID = "default";

const companySchema = z.object({
  cnpj: z
    .string()
    .transform((value) => value.replace(/\D/g, ""))
    .refine((value) => value.length === 14, "CNPJ deve ter 14 digitos")
    .optional(),
  razaoSocial: z.string().min(2).optional(),
  uf: z
    .string()
    .length(2)
    .transform((value) => value.toUpperCase())
    .optional(),
  ambiente: z.nativeEnum(NfeAmbiente).optional(),
});

const certificateUploadSchema = z.object({
  password: z.string().min(1, "Informe a senha do certificado"),
});

async function getOrCreateSettings() {
  return prisma.companySettings.upsert({
    where: { id: SETTINGS_ID },
    update: {},
    create: { id: SETTINGS_ID },
  });
}

router.get(
  "/company",
  asyncHandler(async (_req, res) => {
    const settings = await getOrCreateSettings();

    res.json({
      cnpj: settings.cnpj,
      razaoSocial: settings.razaoSocial,
      uf: settings.uf,
      ambiente: settings.ambiente,
      hasCertificate: Boolean(settings.certificateData),
      certificateFileName: settings.certificateFileName,
      certificateSubjectCn: settings.certificateSubjectCn,
      certificateValidTo: settings.certificateValidTo,
      certificateUploadedAt: settings.certificateUploadedAt,
      nfeUltNsu: settings.nfeUltNsu,
      lastRadarCheckAt: settings.lastRadarCheckAt,
      lastRadarStatus: settings.lastRadarStatus,
      lastRadarError: settings.lastRadarError,
    });
  }),
);

router.put(
  "/company",
  asyncHandler(async (req, res) => {
    const data = companySchema.parse(req.body);
    await getOrCreateSettings();

    const settings = await prisma.companySettings.update({
      where: { id: SETTINGS_ID },
      data,
    });

    res.json({
      cnpj: settings.cnpj,
      razaoSocial: settings.razaoSocial,
      uf: settings.uf,
      ambiente: settings.ambiente,
    });
  }),
);

router.post(
  "/company/certificate",
  upload.single("certificate"),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw new AppError("Envie o arquivo do certificado (.pfx ou .p12)", 422);
    }

    const { password } = certificateUploadSchema.parse(req.body);
    const info = readCertificateInfo(req.file.buffer, password);

    const encryptedCert = encryptBuffer(req.file.buffer);
    const encryptedPassword = encryptText(password);

    await getOrCreateSettings();

    await prisma.companySettings.update({
      where: { id: SETTINGS_ID },
      data: {
        certificateData: encryptedCert.data,
        certificateIv: encryptedCert.iv,
        certificateAuthTag: encryptedCert.authTag,
        certificatePassword: encryptedPassword.data,
        certificatePasswordIv: encryptedPassword.iv,
        certificatePasswordTag: encryptedPassword.authTag,
        certificateFileName: req.file.originalname,
        certificateSubjectCn: info.subjectCommonName,
        certificateValidTo: info.validTo,
        certificateUploadedAt: new Date(),
      },
    });

    res.status(201).json({
      certificateFileName: req.file.originalname,
      certificateSubjectCn: info.subjectCommonName,
      certificateValidTo: info.validTo,
    });
  }),
);

router.delete(
  "/company/certificate",
  asyncHandler(async (_req, res) => {
    await getOrCreateSettings();

    await prisma.companySettings.update({
      where: { id: SETTINGS_ID },
      data: {
        certificateData: null,
        certificateIv: null,
        certificateAuthTag: null,
        certificatePassword: null,
        certificatePasswordIv: null,
        certificatePasswordTag: null,
        certificateFileName: null,
        certificateSubjectCn: null,
        certificateValidTo: null,
        certificateUploadedAt: null,
      },
    });

    res.status(204).send();
  }),
);

export default router;
