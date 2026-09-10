/**
 * Mesma formula usada no backend (backend/src/utils/pricing.ts) - margem
 * sempre "sobre o preco de venda". Duplicada aqui de proposito: o backend
 * calcula margem para exibir, e o frontend precisa da mesma conta pra dar
 * feedback ao digitar (sem round-trip), entao os dois lados tem que
 * concordar. Se mudar a formula, mudar nos dois lugares.
 */
export function marginFromPrice(cost: number, price: number): number {
  if (price <= 0) return 0;
  return ((price - cost) / price) * 100;
}

export function priceFromMargin(cost: number, marginPercent: number): number {
  if (marginPercent >= 100) return cost;
  return cost / (1 - marginPercent / 100);
}
