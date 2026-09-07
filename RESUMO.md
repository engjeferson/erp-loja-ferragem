# Resumo — ERP Loja Ferragem

## 1. Sistema completo
ERP para loja de material de construção/tintas/ferragens — estoque (custo médio ponderado), PDV/vendas, compras, financeiro unificado (contas a pagar/receber com parcelamento), dashboard.
Stack: Node.js + Express + Prisma + PostgreSQL (backend) / React + Vite + Tailwind (frontend), monorepo com npm workspaces.

## 2. Deploy em nuvem
- **Neon** — banco de dados PostgreSQL
- **Render** — backend (API)
- **Vercel** — frontend

Tudo já em produção, com deploy automático a cada push.

## 3. Radar de NF-e
Integração real com a SEFAZ via certificado digital A1 do cliente (criptografado no banco, AES-256-GCM). O radar **detecta** notas fiscais de compra emitidas contra o CNPJ da empresa, mas **nunca lança nada sozinho** — cada nota fica pendente até alguém revisar e clicar em Autorizar (aí entra estoque + financeiro) ou Rejeitar.

## 4. Multi-tenant (SaaS)
O sistema evoluiu de single-tenant para multi-tenant: uma única instalação atende vários clientes (lojas), cada um isolado por `companyId` em todas as tabelas — catálogo, vendas, financeiro e certificado digital próprios, sem nenhum dado visível entre empresas diferentes. Não existe cadastro público; novas empresas são provisionadas manualmente.

## 5. Painel Super Admin
Tela `/admin` (menu "Super Admin", visível só para quem tem a permissão) para gerenciar todas as empresas sem precisar mexer direto no banco: listar com estatísticas, criar empresa nova pela interface, ativar/desativar cliente, resetar senha do admin de uma empresa.

## 6. Correção recente
Sessões com login antigo (token emitido antes das mudanças de multi-tenant) agora recebem um aviso limpo de "sessão expirada, faça login novamente" em vez de dar erro interno.

---

**Link do sistema**: https://erp-loja-ferragem.vercel.app
**Repositório**: https://github.com/engjeferson/erp-loja-ferragem
