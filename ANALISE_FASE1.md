# FASE 1 — Análise: Evolução do ERP (Orçamento/Venda, Caderno, Unidades, NF-e, Entregas)

Análise do código atual antes de qualquer alteração, conforme pedido. Nada foi implementado ainda.

---

## 1. Arquitetura encontrada

- Monorepo (`backend/`, `frontend/`), npm workspaces.
- Backend: Express + Prisma + PostgreSQL, um router por domínio em `backend/src/modules/<dominio>/<dominio>.routes.ts`, tudo montado em `backend/src/routes/index.ts`.
- Todo router usa `router.use(authenticate)` e filtra manualmente por `companyId: req.user!.companyId` em cada query — não existe middleware que injete isso automaticamente, é uma convenção repetida rota a rota (ponto de atenção para todo código novo).
- Operações que tocam estoque + financeiro juntos (confirmar venda, receber compra, autorizar NF-e) usam `prisma.$transaction` — padrão a manter.
- Frontend: uma página por domínio em `frontend/src/pages/`, sem gerenciador de estado global (cada página busca os próprios dados via `api` do axios), roteamento simples em `App.tsx`, menu fixo em `AppLayout.tsx`.
- Não existe geração de PDF nem upload de imagem/logo em lugar nenhum do código hoje.

## 2. Models atuais relacionados (schema.prisma)

| Model | Campos relevantes hoje | Falta para o novo escopo |
|---|---|---|
| `Company` | cnpj, razaoSocial, uf, certificado (fiscal) | logo, nome fantasia, telefone, endereço estruturado p/ documentos |
| `Customer` | name, document, phone, email, address (string única) | nomeFantasia, whatsapp, CEP/número/complemento/bairro/cidade/UF estruturados, observações |
| `Product` | sku, barcode, name, categoryId, unitId (1 só), costPrice, salePrice, averageCost, stockQuantity, minStockQuantity, needsReview | marca, unidade de **compra** separada, fator de conversão, margem (calculada, não persistida) |
| `Sale` + `SaleItem` | number, status (ORCAMENTO/CONFIRMADA/CANCELADA), paymentMethod, subtotal, discount (soma dos itens), total, notes | desconto agregado em %, frete, campos de entrega, referência orçamento→venda |
| `PurchaseOrder` + `PurchaseOrderItem` | fluxo criar→receber, custo médio recalculado no recebimento | nada estrutural — só precisa considerar fator de conversão no cálculo |
| `FinancialTransaction` | type (PAGAR/RECEBER), status (PENDENTE/PAGO/CANCELADO), parcelamento (installmentGroupId/Number/Total) | **pagamento parcial** (hoje é tudo-ou-nada via `/settle`), status PARCIALMENTE_PAGO, histórico de recebimentos individuais |
| `NfeImport` | rawData (JSON com itens/duplicatas), status PENDENTE/IMPORTADA/REJEITADA/ERRO | itens **persistidos e editáveis** (associar produto existente / criar novo, escolher unidade e fator) antes de autorizar — hoje é tudo-ou-nada num único botão "Autorizar" |
| `User` | role (ADMIN/GERENTE/VENDEDOR/FINANCEIRO), isPlatformAdmin | nada estrutural — falta só regra de app para esconder custo/margem do VENDEDOR |
| `PaymentMethod` (enum) | DINHEIRO, PIX, CARTAO_DEBITO, CARTAO_CREDITO, BOLETO, FIADO | renomear/mapear FIADO→"Caderno" na UI (ver risco no item 6) |

## 3. Telas atuais que serão alteradas

- **`Pdv.tsx`** — hoje cria e confirma a venda no mesmo clique (não existe de fato um fluxo de "salvar orçamento e voltar depois"); sem busca/cadastro rápido de cliente, sem frete, desconto agregado ou entrega.
- **`Products.tsx`** — sem marca, unidade de compra, fator de conversão, margem editável nos dois sentidos, histórico de compras.
- **`Customers.tsx`** — cadastro simples demais; falta aba "Caderno" com saldo e histórico de vendas.
- **`Financial.tsx`** — lista genérica; falta visão por cliente e recebimento parcial.
- **`Purchases.tsx`** — recebe pedido direto sem revisão de conversão de unidade.
- **`NfeRadar.tsx`** — mostra itens só para leitura; falta UI de associar/criar produto por item antes de autorizar.
- **`AppLayout.tsx`** — menu é uma lista plana; será reagrupado (Comercial/Cadastros/Estoque/Compras/Financeiro/Relatórios/Configurações) sem mudar nenhuma rota existente.
- **`Settings.tsx`** — falta upload de logo e dados completos da loja para os documentos.

Nenhuma tela precisa ser recriada do zero — todas evoluem incrementalmente.

## 4. Funcionalidades que já existem (reaproveitar)

- Orçamento/Venda como o **mesmo registro** (`Sale.status`), não dois módulos — só falta expor o fluxo "salvar sem confirmar" na UI.
- Custo médio ponderado (recebimento de compra e autorização de NF-e) — a lógica de cálculo é reaproveitável, só precisa entrar o fator de conversão na conta.
- Financeiro unificado com parcelamento (`buildInstallments`) — vira a base do Caderno; só falta permitir múltiplos recebimentos parciais por lançamento.
- Isolamento multi-tenant por `companyId` em toda rota — já cobre a regra crítica do item 27; só preciso manter a disciplina em cada tabela/rota nova.
- Radar de NF-e com autorização manual (nunca lança sozinho) — já é exatamente o pedido do item 11; falta é granularidade de revisão por item.
- Roles ADMIN/GERENTE/VENDEDOR/FINANCEIRO e Super Admin — já existem; falta só a regra de visibilidade de campos sensíveis.
- **Histórico de compras por produto**: não precisa de tabela nova — dá para derivar 100% de `PurchaseOrderItem` + `Supplier` + `NfeImport` já existentes (ótimo reaproveitamento, zero migration para isso).

## 5. Funcionalidades realmente novas

- Tela de Orçamento com salvar/listar/editar/imprimir/PDF e conversão explícita em venda.
- Desconto em % (hoje só valor fixo por item) e frete (não existe nenhum campo).
- Entrega: status PENDENTE/ENTREGUE, endereço próprio, tela "Entregas".
- Cadastro de cliente completo + cadastro rápido em modal dentro do PDV.
- Logo da empresa + assinatura "JR Sistemas" configurável centralmente.
- Unidade de compra × unidade de estoque com fator de conversão automático.
- Revisão item-a-item da NF-e antes de autorizar (associar produto existente / criar novo, configurar conversão).
- Caderno completo: saldo por cliente, recebimento parcial com histórico individual nunca apagado, aplicação de um recebimento entre várias vendas.
- Margem calculada nos dois sentidos (por margem → preço, por preço → margem) centralizada numa função só.
- Documentos PDF de orçamento e venda (não existe geração de PDF hoje em lugar nenhum do sistema).
- Visibilidade de custo/margem restrita por papel (VENDEDOR não vê).

## 6. Migrations necessárias (visão geral — sem código ainda)

- `Company`: + logo (arquivo ou URL), nomeFantasia, telefone, endereço estruturado.
- `Customer`: + nomeFantasia, whatsapp, cep, numero, complemento, bairro, cidade, observações (mantendo `address` por compatibilidade ou migrando).
- `Product`: + brand, purchaseUnitId (FK opcional para `Unit`), conversionFactor (decimal, default 1).
- `Sale`: + freight, campo de desconto agregado (R$/%), hasDelivery + campos de entrega (data, endereço, observações) — ou um model `Delivery` 1:1, a decidir (ver decisão #3 abaixo).
- Novo model `FinancialPayment` (transactionId, amount, paidAt, paymentMethod, userId, notes) para recebimentos parciais nunca apagados; `FinancialTransaction` ganha status `PARCIALMENTE_PAGO`.
- Novo model `NfeImportItem` (persistir cada item da nota com productId nullável, unidade escolhida, fator) para permitir revisão antes da autorização.
- `PaymentMethod`: adicionar `CADERNO` ao enum (sem quebrar dados antigos com `FIADO` — ver risco abaixo).
- Todo model novo entra com `companyId` desde o primeiro dia (regra já conhecida do projeto).

Todas seguem o padrão já usado neste projeto: coluna nullable → backfill → NOT NULL quando aplicável, testado em branch temporária do Neon antes de ir para produção.

## 7. Riscos de regressão (e como mitigar)

| Risco | Mitigação |
|---|---|
| Renomear `FIADO`→`CADERNO` no enum quebraria vendas antigas já gravadas como FIADO (dado real em produção) | Adicionar `CADERNO` como novo valor, migrar dados antigos com `UPDATE`, só então (se quiser) remover `FIADO` numa migration futura separada |
| Mudar `Sale.discount` de "soma dos itens" para "campo agregado editável" pode alterar totais já calculados em vendas existentes | Migration só adiciona campo novo (`freight`, desconto agregado) sem tocar em `discount` legado; recalcular total com fórmula nova só para vendas novas |
| Autorizar NF-e hoje é 1 clique sem payload; se exigir revisão por item antes, muda o contrato da rota `/imports/:id/authorize` | Criar endpoint novo de revisão (ex: `/imports/:id/items`) mantendo `/authorize` compatível, ou versionar claramente |
| Qualquer tabela/rota nova esquecer o filtro `companyId` | Repetir o padrão já usado (`findFirst({ where: { id, companyId } })`) e re-rodar o cenário L (empresa A vs B) como teste de regressão obrigatório |
| Conversão de unidade aplicada errado no custo médio (ex.: multiplicar quantidade mas não custo) | Testes unitários dedicados nos cenários F/G do próprio prompt antes de tocar em produção |
| Reorganizar o menu quebrar rotas existentes | Reagrupar só visualmente em `AppLayout.tsx`, sem alterar nenhum `path` do `App.tsx` |

---

## Decisões que preciso que você confirme antes da FASE 2

1. **Orçamento vs Venda continuam sendo o mesmo registro** (`Sale` muda de status ORCAMENTO→CONFIRMADA, como já é hoje) **ou você quer dois registros separados** com um novo status `CONVERTIDO_EM_VENDA` no orçamento original e uma referência para a venda gerada? A primeira opção é bem mais simples e já reaproveita 100% do que existe; a segunda dá um histórico mais "formal" mas exige model novo e duplicação de dados no confirm. Minha recomendação é a primeira.
2. **Caderno**: confirmo criar o model novo `FinancialPayment` para permitir recebimento parcial com histórico? É a peça que mais falta hoje (o financeiro atual só sabe "pago" ou "pendente", nunca "parcialmente pago").
3. **Entrega**: prefere campos dentro do próprio `Sale` (mais simples, já que é 1:1) ou um model `Delivery` separado (mais fácil de listar/filtrar como uma tela dedicada "Entregas")? Recomendo model separado, já que o pedido explicitamente quer uma tela "Entregas" própria.
4. **NF-e — revisão por item**: confirmo criar o model `NfeImportItem` (persistindo cada item com produto/unidade/conversão escolhidos) como uma etapa nova antes de "Autorizar", em vez do fluxo atual de 1 clique?
5. **Enum de pagamento**: adiciono `CADERNO` mantendo `FIADO` nos dados antigos (mais seguro), ou prefere que eu já esconda "Fiado" da interface assim que `CADERNO` existir?

Assim que confirmar essas 5 decisões eu sigo para a FASE 2 (dados e backend), na ordem sugerida no seu próprio prompt.
