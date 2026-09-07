/**
 * Manual provisioning of a new client (Company + first ADMIN user). There is
 * no self-service signup - this is how you, the developer, onboard a new
 * store. Run from the backend/ folder with the production DATABASE_URL set:
 *
 *   npx ts-node prisma/create-company.ts \
 *     --name "Loja do Joao" \
 *     --admin-name "Joao Silva" \
 *     --admin-email joao@lojadojoao.com.br \
 *     --admin-password "uma-senha-forte" \
 *     --cnpj 12345678000199 \
 *     --uf SP
 *
 * --cnpj and --uf are optional (the client can fill them later in
 * Configuracoes before using the radar de NF-e).
 */
import { PrismaClient } from "@prisma/client";
import { provisionCompany } from "./lib/provisionCompany";

const prisma = new PrismaClient();

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Faltou o valor de --${key}`);
    }
    args[key] = value;
    i += 1;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const required = ["name", "admin-name", "admin-email", "admin-password"];
  const missing = required.filter((key) => !args[key]);
  if (missing.length > 0) {
    console.error(`Argumentos obrigatorios faltando: ${missing.map((k) => `--${k}`).join(", ")}`);
    process.exit(1);
  }

  if (args["admin-password"].length < 6) {
    console.error("A senha do admin precisa ter pelo menos 6 caracteres.");
    process.exit(1);
  }

  const result = await provisionCompany(prisma, {
    companyName: args.name,
    cnpj: args.cnpj,
    uf: args.uf,
    adminName: args["admin-name"],
    adminEmail: args["admin-email"],
    adminPassword: args["admin-password"],
  });

  console.log("Empresa criada com sucesso.");
  console.log(`  companyId: ${result.companyId}`);
  console.log(`  Login do admin: ${args["admin-email"]}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
