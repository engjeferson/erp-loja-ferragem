import { FormEvent, useEffect, useState } from "react";
import { api, getApiErrorMessage } from "../services/api";
import { Customer, PaymentMethod, Product, Sale } from "../types";
import { formatCurrency, formatDate } from "../utils/format";

interface CartItem {
  product: Product;
  quantity: number;
  unitPrice: number;
  discount: number;
}

const paymentMethods: { value: PaymentMethod; label: string }[] = [
  { value: "DINHEIRO", label: "Dinheiro" },
  { value: "PIX", label: "Pix" },
  { value: "CARTAO_DEBITO", label: "Cartao de debito" },
  { value: "CARTAO_CREDITO", label: "Cartao de credito" },
  { value: "BOLETO", label: "Boleto" },
  { value: "FIADO", label: "Fiado (crediario)" },
];

export function Pdv() {
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [productSearch, setProductSearch] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("DINHEIRO");
  const [installments, setInstallments] = useState(1);
  const [sales, setSales] = useState<Sale[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function loadSales() {
    const response = await api.get<Sale[]>("/sales", { params: { status: "CONFIRMADA" } });
    setSales(response.data.slice(0, 10));
  }

  useEffect(() => {
    api.get<Customer[]>("/customers").then((r) => setCustomers(r.data));
    loadSales();
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
      return [...prev, { product, quantity: 1, unitPrice: Number(product.salePrice), discount: 0 }];
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

  const total = cart.reduce(
    (sum, item) => sum + item.quantity * item.unitPrice - item.discount,
    0,
  );

  async function handleFinalize() {
    if (cart.length === 0) return;
    setError(null);
    setSubmitting(true);
    try {
      const createResponse = await api.post("/sales", {
        customerId: customerId || undefined,
        items: cart.map((item) => ({
          productId: item.product.id,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          discount: item.discount,
        })),
      });

      const saleId = createResponse.data.id;

      await api.post(`/sales/${saleId}/confirm`, {
        paymentMethod,
        installments: paymentMethod === "BOLETO" || paymentMethod === "FIADO" ? installments : 1,
      });

      setCart([]);
      setCustomerId("");
      setPaymentMethod("DINHEIRO");
      setInstallments(1);
      await loadSales();
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCancelSale(saleId: string) {
    if (!window.confirm("Cancelar esta venda? O estoque sera estornado.")) return;
    try {
      await api.post(`/sales/${saleId}/cancel`);
      await loadSales();
    } catch (err) {
      window.alert(getApiErrorMessage(err));
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-slate-800">PDV / Vendas</h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <form onSubmit={handleProductSearch} className="flex gap-2">
            <input
              placeholder="Buscar produto por nome, SKU ou codigo de barras"
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
                      {product.sku} - estoque: {product.stockQuantity} - {formatCurrency(product.salePrice)}
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
                  <th className="px-4 py-2">Preco unit.</th>
                  <th className="px-4 py-2">Desconto</th>
                  <th className="px-4 py-2">Total</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {cart.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
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
                        value={item.unitPrice}
                        onChange={(e) =>
                          updateCartItem(item.product.id, { unitPrice: Number(e.target.value) })
                        }
                        className="w-24 border border-slate-300 rounded px-2 py-1"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={item.discount}
                        onChange={(e) =>
                          updateCartItem(item.product.id, { discount: Number(e.target.value) })
                        }
                        className="w-20 border border-slate-300 rounded px-2 py-1"
                      />
                    </td>
                    <td className="px-4 py-2">
                      {formatCurrency(item.quantity * item.unitPrice - item.discount)}
                    </td>
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
            <label className="block text-sm font-medium text-slate-700 mb-1">Cliente</label>
            <select
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              className="w-full border border-slate-300 rounded px-3 py-2 text-sm"
            >
              <option value="">Consumidor final</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Forma de pagamento
            </label>
            <select
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
              className="w-full border border-slate-300 rounded px-3 py-2 text-sm"
            >
              {paymentMethods.map((method) => (
                <option key={method.value} value={method.value}>
                  {method.label}
                </option>
              ))}
            </select>
          </div>

          {(paymentMethod === "BOLETO" || paymentMethod === "FIADO") && (
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
          )}

          <div className="flex justify-between text-lg font-semibold text-slate-800 border-t pt-3">
            <span>Total</span>
            <span>{formatCurrency(total)}</span>
          </div>

          <button
            type="button"
            disabled={cart.length === 0 || submitting}
            onClick={handleFinalize}
            className="w-full bg-brand-600 hover:bg-brand-700 text-white rounded py-2 text-sm font-medium disabled:opacity-50"
          >
            {submitting ? "Finalizando..." : "Finalizar venda"}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm overflow-x-auto">
        <h2 className="font-semibold text-slate-800 px-4 pt-4">Ultimas vendas confirmadas</h2>
        <table className="w-full text-sm mt-2">
          <thead className="bg-slate-50 text-slate-500 text-left">
            <tr>
              <th className="px-4 py-2">Numero</th>
              <th className="px-4 py-2">Cliente</th>
              <th className="px-4 py-2">Total</th>
              <th className="px-4 py-2">Data</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sales.map((sale) => (
              <tr key={sale.id}>
                <td className="px-4 py-2">#{sale.number}</td>
                <td className="px-4 py-2">{sale.customer?.name ?? "Consumidor final"}</td>
                <td className="px-4 py-2">{formatCurrency(sale.total)}</td>
                <td className="px-4 py-2">{formatDate(sale.createdAt)}</td>
                <td className="px-4 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => handleCancelSale(sale.id)}
                    className="text-red-600 hover:underline"
                  >
                    Cancelar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
