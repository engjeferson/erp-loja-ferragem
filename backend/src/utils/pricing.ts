/**
 * Formula unica de margem/preco usada em todo o backend (produtos, radar de
 * NF-e) para nunca ter contas divergentes em telas diferentes. Margem e
 * sempre "sobre o preco de venda" (padrao de varejo no Brasil): um produto
 * com custo 10 e margem 20% vende a 12,50 (10 / (1 - 0.20)), nao a 12.
 */
export function marginFromPrice(cost: number, price: number): number {
  if (price <= 0) return 0;
  return ((price - cost) / price) * 100;
}

export function priceFromMargin(cost: number, marginPercent: number): number {
  if (marginPercent >= 100) return cost;
  return cost / (1 - marginPercent / 100);
}
