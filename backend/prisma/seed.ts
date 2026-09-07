import { PrismaClient } from "@prisma/client";
import { provisionCompany } from "../src/lib/provisionCompany";

const prisma = new PrismaClient();

async function main() {
  const existing = await prisma.user.findUnique({ where: { email: "admin@loja.com" } });
  if (existing) {
    console.log("Seed ja aplicado anteriormente (admin@loja.com ja existe). Nada a fazer.");
    return;
  }

  await provisionCompany(prisma, {
    companyName: "Loja Demo",
    adminName: "Administrador",
    adminEmail: "admin@loja.com",
    adminPassword: "admin123",
  });

  console.log("Seed concluido. Empresa 'Loja Demo' criada. Usuario admin: admin@loja.com / admin123");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
