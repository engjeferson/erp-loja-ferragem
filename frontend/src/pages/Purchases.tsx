import { FormEvent, useEffect, useState } from "react";
import { api, getApiErrorMessage } from "../services/api";
import { Product, PurchaseOrder, Supplier } from "../types";
import { formatCurrency, formatDate } from "../utils/format";

interface CartItem {
  product: Product;
  quantity: number;
  unitCost: number;
}

export function Purchases() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [productSearch, setProductSearch] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [installments, setInstallments] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function loadOrders() {
    const response = await api.get<PurchaseOrder[]>("/purchases");
    setOrders(response.data.slice(0, 10));
  }

  useEffect(() => {
    api.get<Supplier[]>("/suppliers").then((r) => setSuppliers(r.data));
    loadOrders();
  }, []);

  async function handleProductSearch(event: FormEvent) {
    event.preventDefault();
    if (!productSearch) return;
    const response = await api.get<Product[]>("/products", { params: { search: productSearch } });
    setProducts(response.data);
  }

  function addToCart(product: Product) {
    setCart((prev) => {
      const existing = prev.find((item) => item.product.id === product.id);
      if (existing) {
        return prev.map((item) =>
          item.product.id === product.id ? { ...item, quantity: item.quantity + 1 } : item,
        );
      }
      return [...prev, { product, quantity: 1, unitCost: Number(product.averageCost ?? 0) || Number(product.costPrice ?? 0) }];
    });
  }

  function updateCartItem(productId: string, changes: Partial<CartItem>) {
    setCart((prev) =>
      prev.map((item) => (item.product.id === productId ? { ...item, ...changes } : item)),
    );
  }

  function removeFromCart(productId: string) {
    setCart((prev) => prev.filter((item) => item.product.id !== productId));
  }

  const total = cart.reduce((sum, item) => sum + item.quantity * item.unitCost, 0);

  async function handleCreateOrder() {
    if (!supplierId || cart.length === 0) return;
    setError(null);
    setSubmitting(true);
    try {
      const response = await api.post("/purchases", {
        supplierId,
        items: cart.map((item) => ({
          productId: item.product.id,
          quantity: item.quantity,
          unitCost: item.unitCost,
        })),
      });

      await api.post(`/purchases/${response.data.id}/receive`, { installments });

      setCart([]);
      setSupplierId("");
      setInstallments(1);
      setProducts([]);
      setProductSearch("");
      await loadOrders();
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-slate-800">Compras</h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <form onSubmit={handleProductSearch} className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">🔍</span>
            <input
              placeholder="Buscar produto por nome ou SKU"
              value={productSearch}
              onChange={(e) => setProductSearch(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white pl-11 pr-28 py-3.5 text-base shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
            />
            <button
              type="submit"
              className="absolute right-1.5 top-1.5 bottom-1.5 bg-slate-800 hover:bg-slate-900 text-white text-sm font-semibold px-4 rounded-lg"
            >
              Buscar
            </button>
          </form>

          {products.length > 0 && (
            <div className="grid gap-2 sm:grid-cols-2">
              {products.map((product) => (
                <div
                  key={product.id}
                  className="bg-white rounded-xl border border-slate-200 p-4 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-800 truncate">{product.name}</p>
                    <p className="text-xs text-slate-500 font-mono mt-0.5">
                      {product.sku} · custo medio {formatCurrency(product.averageCost ?? "0")}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => addToCart(product)}
                    className="shrink-0 bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold px-4 py-2.5 rounded-lg"
                  >
                    + Adicionar
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="space-y-2">
            {cart.length === 0 ? (
              <div className="bg-white rounded-xl border border-dashed border-slate-300 py-10 text-center text-slate-400 text-sm">
                Nenhum item adicionado ainda - busque um produto acima
              </div>
            ) : (
              cart.map((item) => (
                <div
                  key={item.product.id}
                  className="bg-white rounded-xl border border-slate-200 p-4 flex flex-wrap items-center gap-4"
                >
                  <div className="min-w-[160px] flex-1">
                    <p className="text-sm font-semibold text-slate-800">{item.product.name}</p>
                    <p className="text-xs text-slate-500 font-mono">{item.product.sku}</p>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <label className="text-xs text-slate-500">Qtd.</label>
                    <input
                      type="number"
                      min={0.001}
                      step="0.001"
                      value={item.quantity}
                      onChange={(e) => updateCartItem(item.product.id, { quantity: Number(e.target.value) })}
                      className="w-20 border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono"
                    />
                  </div>

                  <div className="flex items-center gap-1.5">
                    <label className="text-xs text-slate-500">Custo unit.</label>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={item.unitCost}
                      onChange={(e) => updateCartItem(item.product.id, { unitCost: Number(e.target.value) })}
                      className="w-24 border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono"
                    />
                  </div>

                  <div className="text-sm font-mono font-semibold text-slate-800 min-w-[90px] text-right">
                    {formatCurrency(item.quantity * item.unitCost)}
                  </div>

                  <button
                    type="button"
                    onClick={() => removeFromCart(item.product.id)}
                    className="shrink-0 w-9 h-9 rounded-lg border border-slate-200 text-red-600 hover:bg-red-50"
                    aria-label="Remover item"
                  >
                    ✕
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4 h-fit">
          <h2 className="font-semibold text-slate-800 text-lg">Fechamento</h2>

          {error && <div className="bg-red-50 text-red-700 text-sm px-3 py-2 rounded-lg">{error}</div>}

          <div>
            <label className="block text-sm text-slate-600 mb-1.5">Fornecedor</label>
            <select
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
              className="w-full border border-slate-200 rounded-xl px-4 py-3 text-base"
            >
              <option value="">Selecione</option>
              {suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm text-slate-600 mb-1.5">Parcelas</label>
            <input
              type="number"
              min={1}
              max={24}
              value={installments}
              onChange={(e) => setInstallments(Number(e.target.value))}
              className="w-full border border-slate-200 rounded-xl px-4 py-3 text-base"
            />
          </div>

          <div className="flex justify-between items-baseline text-lg font-semibold text-slate-800 border-t border-slate-100 pt-4">
            <span className="text-sm font-normal text-slate-500">Total</span>
            <span className="font-mono">{formatCurrency(total)}</span>
          </div>

          <button
            type="button"
            disabled={!supplierId || cart.length === 0 || submitting}
            onClick={handleCreateOrder}
            className="w-full bg-brand-600 hover:bg-brand-700 text-white rounded-xl py-3.5 text-base font-semibold disabled:opacity-50"
          >
            {submitting ? "Registrando..." : "Registrar e receber compra"}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
        <h2 className="font-semibold text-slate-800 px-4 pt-4">Ultimos pedidos</h2>
        <table className="w-full text-sm mt-2">
          <thead className="bg-slate-50 text-slate-500 text-left">
            <tr>
              <th className="px-4 py-2">Numero</th>
              <th className="px-4 py-2">Fornecedor</th>
              <th className="px-4 py-2">Total</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Data</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {orders.map((order) => (
              <tr key={order.id}>
                <td className="px-4 py-2">#{order.number}</td>
                <td className="px-4 py-2">{order.supplier?.name}</td>
                <td className="px-4 py-2 font-mono">{formatCurrency(order.total)}</td>
                <td className="px-4 py-2">{order.status}</td>
                <td className="px-4 py-2">{formatDate(order.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
