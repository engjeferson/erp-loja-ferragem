import { PrismaClient, Role } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const adminPassword = await bcrypt.hash("admin123", 10);
  await prisma.user.upsert({
    where: { email: "admin@loja.com" },
    update: {},
    create: {
      name: "Administrador",
      email: "admin@loja.com",
      passwordHash: adminPassword,
      role: Role.ADMIN,
    },
  });

  const units = [
    { name: "Unidade", abbreviation: "UN" },
    { name: "Quilograma", abbreviation: "KG" },
    { name: "Metro", abbreviation: "M" },
    { name: "Metro Quadrado", abbreviation: "M2" },
    { name: "Litro", abbreviation: "L" },
    { name: "Saco", abbreviation: "SC" },
    { name: "Caixa", abbreviation: "CX" },
    { name: "Peca", abbreviation: "PC" },
  ];

  for (const unit of units) {
    await prisma.unit.upsert({
      where: { name: unit.name },
      update: {},
      create: unit,
    });
  }

  const categories = [
    "Tintas e Vernizes",
    "Ferragens",
    "Material Eletrico",
    "Material Hidraulico",
    "Cimento e Argamassa",
    "Ferramentas",
    "EPI",
    "Madeiras",
  ];

  for (const name of categories) {
    await prisma.category.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }

  console.log("Seed concluido. Usuario admin: admin@loja.com / admin123");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
