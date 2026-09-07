/**
 * Concede (ou revoga) acesso ao painel de super-admin (/platform/*) para um
 * usuario existente, por e-mail. Nao existe UI para isso de proposito -
 * quem pode virar super-admin e uma decisao do desenvolvedor/operador, feita
 * direto no banco.
 *
 *   npx ts-node prisma/grant-platform-admin.ts --email admin@loja.com
 *   npx ts-node prisma/grant-platform-admin.ts --email admin@loja.com --revoke
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function parseArgs(argv: string[]): { email?: string; revoke: boolean } {
  const args: Record<string, string> = {};
  let revoke = false;
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--revoke") {
      revoke = true;
      continue;
    }
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Faltou o valor de --${key}`);
    }
    args[key] = value;
    i += 1;
  }
  return { email: args.email, revoke };
}

async function main() {
  const { email, revoke } = parseArgs(process.argv.slice(2));
  if (!email) {
    console.error("Uso: npx ts-node prisma/grant-platform-admin.ts --email usuario@exemplo.com [--revoke]");
    process.exit(1);
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`Nenhum usuario encontrado com o e-mail ${email}`);
    process.exit(1);
  }

  await prisma.user.update({ where: { id: user.id }, data: { isPlatformAdmin: !revoke } });
  console.log(`${email} agora ${revoke ? "NAO tem" : "tem"} acesso ao painel de super-admin.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
