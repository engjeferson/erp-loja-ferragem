# ERP Loja Ferragem

Sistema de gestão para lojas de material de construção, tintas e ferragens: estoque, PDV/vendas, compras e financeiro (contas a pagar/receber).

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
npm run prisma:seed      # cria usuário admin e cadastros básicos
npm run dev               # http://localhost:3333
```

Usuário criado pelo seed: `admin@loja.com` / `admin123` — **troque a senha em produção**.

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

## Próximos passos sugeridos

- Emissão de nota fiscal (NFC-e para venda ao consumidor final).
- Comissão de vendedor e tabelas de preço por cliente.
- Permissões granulares por módulo (hoje simplificado em papéis fixos).
- Testes automatizados (unitários nas regras de estoque/financeiro e e2e nas rotas principais).
