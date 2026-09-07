import { PrismaClient, Role } from "@prisma/client";
import bcrypt from "bcryptjs";

const DEFAULT_UNITS = [
  { name: "Unidade", abbreviation: "UN" },
  { name: "Quilograma", abbreviation: "KG" },
  { name: "Metro", abbreviation: "M" },
  { name: "Metro Quadrado", abbreviation: "M2" },
  { name: "Litro", abbreviation: "L" },
  { name: "Saco", abbreviation: "SC" },
  { name: "Caixa", abbreviation: "CX" },
  { name: "Peca", abbreviation: "PC" },
];

const DEFAULT_CATEGORIES = [
  "Tintas e Vernizes",
  "Ferragens",
  "Material Eletrico",
  "Material Hidraulico",
  "Cimento e Argamassa",
  "Ferramentas",
  "EPI",
  "Madeiras",
];

export interface ProvisionCompanyInput {
  companyName: string;
  cnpj?: string;
  uf?: string;
  adminName: string;
  adminEmail: string;
  adminPassword: string;
}

export interface ProvisionCompanyResult {
  companyId: string;
  adminUserId: string;
}

/**
 * Creates a brand-new tenant: the Company row plus its first ADMIN user
 * and a starter catalog of units/categories, so a new client isn't staring
 * at a completely empty system on day one. There is no self-service signup
 * (see README) - this is the one place a new company ever gets created,
 * used by both prisma/seed.ts (local dev) and prisma/create-company.ts
 * (real clients).
 */
export async function provisionCompany(
  prisma: PrismaClient,
  input: ProvisionCompanyInput,
): Promise<ProvisionCompanyResult> {
  const passwordHash = await bcrypt.hash(input.adminPassword, 10);

  const company = await prisma.company.create({
    data: {
      name: input.companyName,
      cnpj: input.cnpj,
      uf: input.uf,
    },
  });

  const admin = await prisma.user.create({
    data: {
      companyId: company.id,
      name: input.adminName,
      email: input.adminEmail,
      passwordHash,
      role: Role.ADMIN,
    },
  });

  await prisma.unit.createMany({
    data: DEFAULT_UNITS.map((unit) => ({ ...unit, companyId: company.id })),
  });

  await prisma.category.createMany({
    data: DEFAULT_CATEGORIES.map((name) => ({ name, companyId: company.id })),
  });

  return { companyId: company.id, adminUserId: admin.id };
}
