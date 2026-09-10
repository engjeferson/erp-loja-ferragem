# Fase 5 — Relatório de testes (cenários A-L)

Todos os 12 cenários pedidos no prompt de evolução foram testados manualmente contra o backend local (dados reais criados via API), com resultado **PASSOU** em todos.

| # | Cenário | Resultado |
|---|---|---|
| A | Orçamento comum → converter em venda | ✅ Status `ORCAMENTO` → `CONFIRMADA` corretamente |
| B | Venda direta via Pix | ✅ Confirmada direto, lançamento já nasce `PAGO` (pagamento instantâneo) |
| C | Venda com desconto (%) e frete | ✅ Subtotal 800, desconto 80 (10%), frete 30 → total 750 |
| D | Venda com entrega → marcar entregue | ✅ Delivery criada `PENDENTE`, endpoint marca `ENTREGUE` |
| E | Cliente inexistente → cadastro rápido → continuar venda | ✅ Cliente criado só com nome+telefone, venda associada normalmente |
| F | Compra de fio, 1 rolo = 100m | ✅ Estoque 100m, custo R$1,50/m (150/100) |
| G | Venda de 25m do fio | ✅ Estoque cai para 75m |
| H | Venda de R$1000 no Caderno, recebe R$300 | ✅ Saldo 700, status `PARCIALMENTE_PAGO` |
| I | Recebe mais R$500 | ✅ Saldo 200 |
| J | Recebe R$200 | ✅ Saldo 0, status `PAGO` |
| K | Cliente com várias vendas, recebimento único distribuído | ✅ R$500 aplicados automaticamente: R$400 quita a venda mais antiga, R$100 aplicado na mais nova (saldo final R$100) |
| L | Multi-tenant: empresa B tenta acessar dados da empresa A | ✅ 404 em GET direto por ID, 422 explícito ao usar produto de outra empresa numa venda |

Nenhum bug foi encontrado nesta rodada — os dois bugs reais descobertos durante o desenvolvimento (token JWT antigo sem `companyId` quebrando rotas; margem de produto novo calculada com `averageCost` zerado) já foram corrigidos e estão em produção desde as Fases 2 e 3.

**Conclusão**: as 5 fases do prompt de evolução (análise, backend, frontend, PDF, testes) estão completas e em produção.
