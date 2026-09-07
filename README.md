# ERP Loja Ferragem

Sistema de gestão para lojas de material de construção, tintas e ferragens: estoque, PDV/vendas, compras e financeiro (contas a pagar/receber). **Multi-tenant**: uma única instalação atende vários clientes (lojas), cada um com seu próprio catálogo, vendas, financeiro e certificado digital — sem nenhum dado visível entre empresas diferentes.

## Stack

- **Backend**: Node.js + TypeScript + Express + Prisma ORM + PostgreSQL + JWT
- **Frontend**: React + TypeScript + Vite + Tailwind CSS + React Router
- Monorepo com npm workspaces (`backend/` e `frontend/`)

## Módulos implementados

- **Cadastros**: usuários (com papéis ADMIN/GERENTE/VENDEDOR/FINANCEIRO), categorias, unidades de medida, produtos, clientes, fornecedores.
- **Estoque**: ledger de movimentações (`StockMovement`) para toda entrada/saída/ajuste, com **custo médio ponderado** recalculado a cada compra recebida.
- **Vendas / PDV**: carrinho → orçamento → confirmação (baixa de estoque + geração de lançamento financeiro a receber, com suporte a parcelamento) → cancelamento (estorna estoque e lançamentos pendentes).
- **Compras**: pedido de compra → recebimento (entrada de estoque + atualização de custo médio + lançamento financeiro a pagar, com parcelamento).
- **Financeiro**: lançamentos unificados de contas a pagar/receber (`FinancialTransaction`), com categorias, parcelamento e status "vencido" sempre calculado a partir da data de vencimento (nunca fica dessincronizado).
- **Dashboard**: vendas do dia/mês, produtos com estoque baixo, resumo financeiro, vendas recentes.
- **Configurações**: cadastro do CNPJ/UF/ambiente fiscal da empresa e upload do certificado digital A1 (`.pfx`/`.p12`) usado pelo radar de NF-e — o cliente consegue trocar o certificado sozinho, sem depender do desenvolvedor.
- **Radar de NF-e**: busca manual (botão "Buscar novas notas") das notas fiscais de compra emitidas contra o CNPJ da empresa junto à SEFAZ (webservice nacional de Distribuição DFe). O radar só **detecta e lista** — nenhuma nota entra em estoque ou financeiro sozinha. Cada nota nova fica pendente até alguém revisar os itens e clicar em **Autorizar** (aí sim: fornecedor e produtos são localizados ou criados, o estoque é dado como entrada com atualização de custo médio, e o financeiro a pagar é lançado — parcelado conforme as duplicatas da nota) ou **Rejeitar** (não lança nada).

### Sobre o Radar de NF-e (certificado digital)

- O certificado (.pfx/.p12) e a senha são criptografados com AES-256-GCM antes de ir para o banco (`backend/src/lib/encryption.ts`); a chave de criptografia (`ENCRYPTION_KEY`) vive só em variável de ambiente, nunca no banco.
- No upload, o certificado é validado (senha + leitura do PKCS#12) e o titular/validade são exibidos na tela de Configurações antes de qualquer chamada à SEFAZ.
- A consulta em si (`backend/src/lib/nfeSefaz.ts`) autentica por mTLS direto com a SEFAZ (webservice `NFeDistribuicaoDFe`, Ambiente Nacional) — não depende de nenhum serviço terceirizado.
- Produtos criados na autorização de uma nota entram com `needsReview = true` e preço de venda igual ao de custo (0% de margem) — a tela de Produtos tem um filtro "Somente precisam revisão" e um botão "Marcar revisado" para o lojista ajustar preço/categoria depois.
- **Importante**: esta integração foi escrita a partir da documentação/XSD pública da SEFAZ, mas não pôde ser testada contra o webservice real durante o desenvolvimento (sem acesso de rede a domínios `gov.br` no ambiente de build). Valide o fluxo ponta a ponta em produção com um certificado real antes de confiar 100% nela — em especial o ambiente de Homologação primeiro, se possível.
- Hoje a busca é manual (botão). Rodar isso automaticamente em intervalo (ex: a cada X horas) exigiria um job agendado (cron) — não implementado ainda.

## Multi-tenant (multiplas lojas/clientes)

Uma única instalação (um Render + uma Vercel + um Neon) atende vários clientes. Cada cliente é uma linha em `Company` (o "tenant"), e praticamente toda tabela do banco (produtos, categorias, unidades, clientes, fornecedores, vendas, compras, financeiro, radar de NF-e) tem uma coluna `companyId` — toda rota da API filtra automaticamente pelo `companyId` que vem do token JWT de quem está logado, então um cliente nunca vê nem edita dado de outro.

**Não existe cadastro público** (self-service) de novas empresas — é proposital, para não abrir a porta pra qualquer um criar conta sozinho. Você (desenvolvedor) cria cada cliente novo manualmente:

```bash
cd backend
npx ts-node prisma/create-company.ts \
  --name "Loja do Joao" \
  --admin-name "Joao Silva" \
  --admin-email joao@lojadojoao.com.br \
  --admin-password "uma-senha-forte" \
  --cnpj 12345678000199 \
  --uf SP
```

Isso cria a empresa, o primeiro usuário (ADMIN) dela, e um catálogo inicial de unidades/categorias — o cliente não começa com o sistema vazio. `--cnpj` e `--uf` são opcionais (dá pra preencher depois em Configurações). Rode isso com o `DATABASE_URL` de produção configurado no ambiente (ou via `npx render` shell / conexão direta ao Neon).

**Coisas para saber ao dar suporte a um cliente**:
- Cada empresa tem sua própria numeração de vendas/pedidos de compra (`#1, #2, ...`) — não é uma sequência global, então duas empresas podem ter uma "Venda #1" ao mesmo tempo sem conflito.
- SKU de produto, e-mail de usuário (esse sim é único no sistema todo, não só por empresa) e CNPJ de cliente/fornecedor são únicos **por empresa**, não globalmente — duas empresas podem cadastrar o mesmo SKU ou CNPJ de fornecedor sem colidir.
- Hoje não existe painel de "super-admin" para você enxergar todas as empresas de uma tela só — para dar suporte, acesse o banco (Neon) diretamente.
- Se precisar suspender um cliente sem apagar os dados, marque `Company.active = false` direto no banco — o login dele passa a ser recusado (mensagem "Esta empresa esta desativada").

## Rodando localmente

### 1. Banco de dados

```bash
docker compose up -d
```

Isso sobe um PostgreSQL local (usuário `erp`, senha `erp`, banco `erp_loja_ferragem`).

### 2. Backend

```bash
cd backend
cp .env.example .env
npm install
npm run prisma:migrate   # cria as tabelas
npm run prisma:seed      # cria a empresa "Loja Demo" + usuário admin + cadastros básicos
npm run dev               # http://localhost:3333
```

Usuário criado pelo seed: `admin@loja.com` / `admin123` — **troque a senha em produção**.

Antes de rodar, gere a `ENCRYPTION_KEY` do `.env` (usada para cifrar o certificado digital):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 3. Frontend

```bash
cd frontend
cp .env.example .env
npm install
npm run dev               # http://localhost:5173
```

## Build de produção

```bash
npm run build:backend
npm run build:frontend
```

## Decisões de modelagem

- **Estoque como ledger**: o saldo (`Product.stockQuantity`) é sempre atualizado dentro da mesma transação que cria o `StockMovement` correspondente — nunca é setado diretamente por fora desse fluxo. Isso mantém um histórico auditável de toda movimentação.
- **Custo médio ponderado**: a cada recebimento de compra, `averageCost` é recalculado como `(estoqueAtual * custoMedioAtual + qtdEntrada * custoEntrada) / novoEstoque`. É a base para saber quanto vale o estoque e qual a margem real de venda.
- **Financeiro unificado**: uma única tabela `FinancialTransaction` (tipo `PAGAR`/`RECEBER`) em vez de duas tabelas separadas — permite parcelamento (`installmentGroupId`/`installmentNumber`/`installmentTotal`) e relatórios consistentes. O status "vencido" nunca é armazenado: é sempre `status == PENDENTE && dueDate < hoje`, computado sob demanda.
- **Certificado nunca em texto plano**: `Company` guarda o `.pfx` e a senha como bytes cifrados (AES-256-GCM) + IV + auth tag; a chave de cifra é uma env var (`ENCRYPTION_KEY`) que nunca é versionada nem persistida no banco.
- **NfeImport como trava de idempotência**: cada chave de acesso de NF-e só é processada uma vez (`chaveAcesso` é `@unique`) — rodar o radar de novo sobre o mesmo intervalo de NSU nunca duplica estoque ou financeiro.
- **Multi-tenant por `companyId`, não por schema/banco separado**: todas as empresas compartilham o mesmo banco/tabelas; o isolamento é feito em toda query da API (`where: { companyId }`) e reforçado por constraints únicas compostas (`@@unique([companyId, sku])` etc.) e checagens explícitas de posse antes de update/delete por id. Mais simples de operar (um banco só) do que multi-schema, ao custo de exigir disciplina: toda rota nova precisa lembrar de filtrar por `companyId`.

## Próximos passos sugeridos

- Painel de super-admin para listar/gerenciar todas as empresas de uma tela só (hoje é tudo manual via `create-company.ts` + acesso direto ao Neon).
- Validar o Radar de NF-e ponta a ponta com certificado real em produção (não pôde ser testado no ambiente de desenvolvimento — ver seção acima).
- Agendar o radar (cron) em vez de depender do clique manual em "Buscar novas notas".
- Emissão de nota fiscal (NFC-e para venda ao consumidor final).
- Comissão de vendedor e tabelas de preço por cliente.
- Permissões granulares por módulo (hoje simplificado em papéis fixos).
- Testes automatizados (unitários nas regras de estoque/financeiro e e2e nas rotas principais).

## Vulnerabilidades conhecidas (dependências)

`npm audit` na raiz aponta vulnerabilidades moderadas em `express`/`body-parser`/`qs` (backend), `vite`/`esbuild` (dev-only) e `react-router` (frontend) — todas exigem upgrade de major version das respectivas libs, fora do escopo das mudanças atuais. Vale planejar essas atualizações (com teste de regressão) em um momento dedicado.
