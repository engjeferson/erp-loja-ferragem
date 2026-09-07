import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import { prisma } from "../../config/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { authenticate, requirePlatformAdmin } from "../../middlewares/auth";
import { AppError } from "../../utils/AppError";
import { provisionCompany } from "../../lib/provisionCompany";

const router = Router();
router.use(authenticate, requirePlatformAdmin);

const createCompanySchema = z.object({
  companyName: z.string().min(2),
  cnpj: z.string().min(1).optional(),
  uf: z.string().length(2).optional(),
  adminName: z.string().min(2),
  adminEmail: z.string().email(),
  adminPassword: z.string().min(6),
});

const updateCompanySchema = z.object({
  name: z.string().min(2).optional(),
  cnpj: z.string().min(1).nullable().optional(),
  razaoSocial: z.string().nullable().optional(),
  uf: z.string().length(2).nullable().optional(),
  active: z.boolean().optional(),
});

const resetPasswordSchema = z.object({
  newPassword: z.string().min(6),
});

router.get(
  "/companies",
  asyncHandler(async (_req, res) => {
    const companies = await prisma.company.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        active: true,
        cnpj: true,
        razaoSocial: true,
        uf: true,
        ambiente: true,
        createdAt: true,
        certificateFileName: true,
        _count: {
          select: {
            users: true,
            products: true,
            sales: true,
            purchaseOrders: true,
          },
        },
      },
    });

    res.json(
      companies.map((company) => ({
        id: company.id,
        name: company.name,
        active: company.active,
        cnpj: company.cnpj,
        razaoSocial: company.razaoSocial,
        uf: company.uf,
        ambiente: company.ambiente,
        createdAt: company.createdAt,
        hasCertificate: !!company.certificateFileName,
        usersCount: company._count.users,
        productsCount: company._count.products,
        salesCount: company._count.sales,
        purchaseOrdersCount: company._count.purchaseOrders,
      })),
    );
  }),
);

router.post(
  "/companies",
  asyncHandler(async (req, res) => {
    const data = createCompanySchema.parse(req.body);

    try {
      const result = await provisionCompany(prisma, data);
      res.status(201).json(result);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new AppError("Ja existe uma empresa ou usuario com esses dados (e-mail ou CNPJ em uso)", 409);
      }
      throw error;
    }
  }),
);

router.patch(
  "/companies/:id",
  asyncHandler(async (req, res) => {
    const data = updateCompanySchema.parse(req.body);

    const existing = await prisma.company.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new AppError("Empresa nao encontrada", 404);

    try {
      const company = await prisma.company.update({
        where: { id: existing.id },
        data,
        select: {
          id: true,
          name: true,
          active: true,
          cnpj: true,
          razaoSocial: true,
          uf: true,
        },
      });
      res.json(company);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new AppError("Ja existe outra empresa com esse CNPJ", 409);
      }
      throw error;
    }
  }),
);

router.post(
  "/companies/:id/reset-admin-password",
  asyncHandler(async (req, res) => {
    const { newPassword } = resetPasswordSchema.parse(req.body);

    const company = await prisma.company.findUnique({ where: { id: req.params.id } });
    if (!company) throw new AppError("Empresa nao encontrada", 404);

    const adminUser = await prisma.user.findFirst({
      where: { companyId: company.id, role: "ADMIN" },
      orderBy: { createdAt: "asc" },
    });
    if (!adminUser) throw new AppError("Esta empresa nao tem nenhum usuario ADMIN", 404);

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({ where: { id: adminUser.id }, data: { passwordHash } });

    res.json({ email: adminUser.email });
  }),
);

export default router;
