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
          <form onSubmit={handleProductSearch} className="flex gap-2">
            <input
              placeholder="Buscar produto"
              value={productSearch}
              onChange={(e) => setProductSearch(e.target.value)}
              className="border border-slate-300 rounded px-3 py-2 text-sm flex-1"
            />
            <button type="submit" className="bg-slate-800 text-white text-sm px-4 py-2 rounded">
              Buscar
            </button>
          </form>

          {products.length > 0 && (
            <div className="bg-white rounded-lg shadow-sm divide-y divide-slate-100">
              {products.map((product) => (
                <div key={product.id} className="flex items-center justify-between px-4 py-2">
                  <div>
                    <p className="text-sm font-medium text-slate-800">{product.name}</p>
                    <p className="text-xs text-slate-500">
                      {product.sku} - custo medio: {formatCurrency(product.averageCost ?? "0")}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => addToCart(product)}
                    className="text-brand-600 text-sm hover:underline"
                  >
                    Adicionar
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="bg-white rounded-lg shadow-sm overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-left">
                <tr>
                  <th className="px-4 py-2">Produto</th>
                  <th className="px-4 py-2">Qtd</th>
                  <th className="px-4 py-2">Custo unit.</th>
                  <th className="px-4 py-2">Total</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {cart.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-slate-400">
                      Nenhum item adicionado
                    </td>
                  </tr>
                )}
                {cart.map((item) => (
                  <tr key={item.product.id}>
                    <td className="px-4 py-2">{item.product.name}</td>
                    <td className="px-4 py-2">
                      <input
                        type="number"
                        min={0.001}
                        step="0.001"
                        value={item.quantity}
                        onChange={(e) =>
                          updateCartItem(item.product.id, { quantity: Number(e.target.value) })
                        }
                        className="w-20 border border-slate-300 rounded px-2 py-1"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={item.unitCost}
                        onChange={(e) =>
                          updateCartItem(item.product.id, { unitCost: Number(e.target.value) })
                        }
                        className="w-24 border border-slate-300 rounded px-2 py-1"
                      />
                    </td>
                    <td className="px-4 py-2">{formatCurrency(item.quantity * item.unitCost)}</td>
                    <td className="px-4 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => removeFromCart(item.product.id)}
                        className="text-red-600 hover:underline"
                      >
                        Remover
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm p-4 space-y-4 h-fit">
          <h2 className="font-semibold text-slate-800">Fechamento</h2>

          {error && <div className="bg-red-50 text-red-700 text-sm px-3 py-2 rounded">{error}</div>}

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Fornecedor</label>
            <select
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
              className="w-full border border-slate-300 rounded px-3 py-2 text-sm"
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
            <label className="block text-sm font-medium text-slate-700 mb-1">Parcelas</label>
            <input
              type="number"
              min={1}
              max={24}
              value={installments}
              onChange={(e) => setInstallments(Number(e.target.value))}
              className="w-full border border-slate-300 rounded px-3 py-2 text-sm"
            />
          </div>

          <div className="flex justify-between text-lg font-semibold text-slate-800 border-t pt-3">
            <span>Total</span>
            <span>{formatCurrency(total)}</span>
          </div>

          <button
            type="button"
            disabled={!supplierId || cart.length === 0 || submitting}
            onClick={handleCreateOrder}
            className="w-full bg-brand-600 hover:bg-brand-700 text-white rounded py-2 text-sm font-medium disabled:opacity-50"
          >
            {submitting ? "Registrando..." : "Registrar e receber compra"}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm overflow-x-auto">
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
                <td className="px-4 py-2">{formatCurrency(order.total)}</td>
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
