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

const uploadLogo = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.mimetype)) {
      cb(new AppError("Envie uma imagem PNG, JPEG ou WEBP", 422));
      return;
    }
    cb(null, true);
  },
});

const companySchema = z.object({
  name: z.string().min(2).optional(),
  cnpj: z
    .string()
    .transform((value) => value.replace(/\D/g, ""))
    .refine((value) => value.length === 14, "CNPJ deve ter 14 digitos")
    .optional(),
  razaoSocial: z.string().min(2).optional(),
  nomeFantasia: z.string().optional(),
  telefone: z.string().optional(),
  cep: z.string().optional(),
  endereco: z.string().optional(),
  numero: z.string().optional(),
  complemento: z.string().optional(),
  bairro: z.string().optional(),
  cidade: z.string().optional(),
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

router.get(
  "/company",
  asyncHandler(async (req, res) => {
    const company = await prisma.company.findUniqueOrThrow({ where: { id: req.user!.companyId } });

    res.json({
      name: company.name,
      cnpj: company.cnpj,
      razaoSocial: company.razaoSocial,
      nomeFantasia: company.nomeFantasia,
      telefone: company.telefone,
      cep: company.cep,
      endereco: company.endereco,
      numero: company.numero,
      complemento: company.complemento,
      bairro: company.bairro,
      cidade: company.cidade,
      uf: company.uf,
      ambiente: company.ambiente,
      logoDataUri: company.logoData ? `data:${company.logoMimeType};base64,${company.logoData.toString("base64")}` : null,
      hasCertificate: Boolean(company.certificateData),
      certificateFileName: company.certificateFileName,
      certificateSubjectCn: company.certificateSubjectCn,
      certificateValidTo: company.certificateValidTo,
      certificateUploadedAt: company.certificateUploadedAt,
      nfeUltNsu: company.nfeUltNsu,
      lastRadarCheckAt: company.lastRadarCheckAt,
      lastRadarStatus: company.lastRadarStatus,
      lastRadarError: company.lastRadarError,
    });
  }),
);

router.put(
  "/company",
  asyncHandler(async (req, res) => {
    const data = companySchema.parse(req.body);

    const company = await prisma.company.update({
      where: { id: req.user!.companyId },
      data,
    });

    res.json({
      name: company.name,
      cnpj: company.cnpj,
      razaoSocial: company.razaoSocial,
      nomeFantasia: company.nomeFantasia,
      telefone: company.telefone,
      cep: company.cep,
      endereco: company.endereco,
      numero: company.numero,
      complemento: company.complemento,
      bairro: company.bairro,
      cidade: company.cidade,
      uf: company.uf,
      ambiente: company.ambiente,
    });
  }),
);

router.post(
  "/company/logo",
  uploadLogo.single("logo"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new AppError("Envie o arquivo do logo", 422);

    const company = await prisma.company.update({
      where: { id: req.user!.companyId },
      data: { logoData: req.file.buffer, logoMimeType: req.file.mimetype },
    });

    res.status(201).json({
      logoDataUri: `data:${company.logoMimeType};base64,${company.logoData!.toString("base64")}`,
    });
  }),
);

router.delete(
  "/company/logo",
  asyncHandler(async (req, res) => {
    await prisma.company.update({
      where: { id: req.user!.companyId },
      data: { logoData: null, logoMimeType: null },
    });
    res.status(204).send();
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

    await prisma.company.update({
      where: { id: req.user!.companyId },
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
  asyncHandler(async (req, res) => {
    await prisma.company.update({
      where: { id: req.user!.companyId },
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
