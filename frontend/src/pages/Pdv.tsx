import { FormEvent, useEffect, useState } from "react";
import { api, getApiErrorMessage } from "../services/api";
import { Customer, DiscountType, PaymentMethod, Product, Sale } from "../types";
import { formatCurrency, formatDate } from "../utils/format";

interface CartItem {
  product: Product;
  quantity: number;
  unitPrice: number;
}

interface DeliveryForm {
  scheduledDate: string;
  cep: string;
  endereco: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  uf: string;
  notes: string;
}

const emptyDelivery: DeliveryForm = {
  scheduledDate: "",
  cep: "",
  endereco: "",
  numero: "",
  complemento: "",
  bairro: "",
  cidade: "",
  uf: "",
  notes: "",
};

const paymentMethods: { value: PaymentMethod; label: string }[] = [
  { value: "DINHEIRO", label: "Dinheiro" },
  { value: "PIX", label: "Pix" },
  { value: "CARTAO_DEBITO", label: "Cartao de debito" },
  { value: "CARTAO_CREDITO", label: "Cartao de credito" },
  { value: "CADERNO", label: "Caderno" },
];

function ConvertBudgetModal({
  budget,
  onClose,
  onConverted,
}: {
  budget: Sale;
  onClose: () => void;
  onConverted: () => void;
}) {
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("DINHEIRO");
  const [installments, setInstallments] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleConfirm() {
    setError(null);
    setSubmitting(true);
    try {
      await api.post(`/sales/${budget.id}/confirm`, {
        paymentMethod,
        installments: paymentMethod === "CARTAO_CREDITO" || paymentMethod === "CADERNO" ? installments : 1,
      });
      onConverted();
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-lg p-6 w-full max-w-sm space-y-3">
        <h2 className="font-semibold text-slate-800">Converter orcamento #{budget.number} em venda</h2>
        <p className="text-sm text-slate-500">Total: {formatCurrency(budget.total)}</p>

        {error && <div className="bg-red-50 text-red-700 text-sm px-3 py-2 rounded">{error}</div>}

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Forma de pagamento</label>
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

        {(paymentMethod === "CARTAO_CREDITO" || paymentMethod === "CADERNO") && (
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

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="text-sm px-4 py-2 rounded text-slate-600 hover:bg-slate-100">
            Cancelar
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={handleConfirm}
            className="bg-brand-600 hover:bg-brand-700 text-white text-sm px-4 py-2 rounded disabled:opacity-50"
          >
            {submitting ? "Confirmando..." : "Confirmar venda"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function Pdv() {
  const [products, setProducts] = useState<Product[]>([]);
  const [productSearch, setProductSearch] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);

  const [customerSearch, setCustomerSearch] = useState("");
  const [customerResults, setCustomerResults] = useState<Customer[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [showQuickCustomer, setShowQuickCustomer] = useState(false);
  const [quickName, setQuickName] = useState("");
  const [quickPhone, setQuickPhone] = useState("");

  const [freight, setFreight] = useState("0");
  const [discountType, setDiscountType] = useState<DiscountType>("VALOR");
  const [discountValue, setDiscountValue] = useState("0");

  const [hasDelivery, setHasDelivery] = useState(false);
  const [delivery, setDelivery] = useState<DeliveryForm>(emptyDelivery);

  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("DINHEIRO");
  const [installments, setInstallments] = useState(1);

  const [budgets, setBudgets] = useState<Sale[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [convertingBudget, setConvertingBudget] = useState<Sale | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function loadBudgets() {
    const response = await api.get<Sale[]>("/sales", { params: { status: "ORCAMENTO" } });
    setBudgets(response.data);
  }

  async function loadSales() {
    const response = await api.get<Sale[]>("/sales", { params: { status: "CONFIRMADA" } });
    setSales(response.data.slice(0, 10));
  }

  useEffect(() => {
    loadBudgets();
    loadSales();
  }, []);

  async function handleProductSearch(event: FormEvent) {
    event.preventDefault();
    if (!productSearch) return;
    const response = await api.get<Product[]>("/products", { params: { search: productSearch } });
    setProducts(response.data);
  }

  async function handleCustomerSearch(event: FormEvent) {
    event.preventDefault();
    if (!customerSearch) return;
    const response = await api.get<Customer[]>("/customers", { params: { search: customerSearch } });
    setCustomerResults(response.data);
  }

  function selectCustomer(customer: Customer) {
    setSelectedCustomer(customer);
    setCustomerResults([]);
    setCustomerSearch("");
  }

  async function handleQuickCustomer(event: FormEvent) {
    event.preventDefault();
    try {
      const response = await api.post<Customer>("/customers", { name: quickName, phone: quickPhone || undefined });
      selectCustomer(response.data);
      setShowQuickCustomer(false);
      setQuickName("");
      setQuickPhone("");
    } catch (err) {
      window.alert(getApiErrorMessage(err));
    }
  }

  function useCustomerAddress() {
    if (!selectedCustomer) return;
    setDelivery((prev) => ({
      ...prev,
      cep: selectedCustomer.cep ?? "",
      endereco: selectedCustomer.address ?? "",
      numero: selectedCustomer.numero ?? "",
      complemento: selectedCustomer.complemento ?? "",
      bairro: selectedCustomer.bairro ?? "",
      cidade: selectedCustomer.cidade ?? "",
      uf: selectedCustomer.uf ?? "",
    }));
  }

  function addToCart(product: Product) {
    setCart((prev) => {
      const existing = prev.find((item) => item.product.id === product.id);
      if (existing) {
        return prev.map((item) =>
          item.product.id === product.id ? { ...item, quantity: item.quantity + 1 } : item,
        );
      }
      return [...prev, { product, quantity: 1, unitPrice: Number(product.salePrice) }];
    });
  }

  function updateCartItem(productId: string, changes: Partial<CartItem>) {
    setCart((prev) => prev.map((item) => (item.product.id === productId ? { ...item, ...changes } : item)));
  }

  function removeFromCart(productId: string) {
    setCart((prev) => prev.filter((item) => item.product.id !== productId));
  }

  const subtotal = cart.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  const discountAmount = discountType === "PERCENTUAL" ? subtotal * (Number(discountValue) / 100) : Number(discountValue);
  const total = Math.max(0, subtotal - discountAmount + Number(freight || 0));

  function resetForm() {
    setCart([]);
    setSelectedCustomer(null);
    setFreight("0");
    setDiscountType("VALOR");
    setDiscountValue("0");
    setHasDelivery(false);
    setDelivery(emptyDelivery);
    setPaymentMethod("DINHEIRO");
    setInstallments(1);
  }

  function buildPayload() {
    return {
      customerId: selectedCustomer?.id,
      freight: Number(freight || 0),
      additionalDiscountType: discountType,
      additionalDiscountValue: Number(discountValue || 0),
      items: cart.map((item) => ({
        productId: item.product.id,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        discount: 0,
      })),
      delivery: hasDelivery
        ? {
            scheduledDate: delivery.scheduledDate || undefined,
            cep: delivery.cep || undefined,
            endereco: delivery.endereco || undefined,
            numero: delivery.numero || undefined,
            complemento: delivery.complemento || undefined,
            bairro: delivery.bairro || undefined,
            cidade: delivery.cidade || undefined,
            uf: delivery.uf || undefined,
            notes: delivery.notes || undefined,
          }
        : null,
    };
  }

  async function handleSaveBudget() {
    if (cart.length === 0) return;
    setError(null);
    setSubmitting(true);
    try {
      await api.post("/sales", buildPayload());
      resetForm();
      await loadBudgets();
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleFinalizeSale() {
    if (cart.length === 0) return;
    setError(null);
    setSubmitting(true);
    try {
      const createResponse = await api.post("/sales", buildPayload());
      await api.post(`/sales/${createResponse.data.id}/confirm`, {
        paymentMethod,
        installments: paymentMethod === "CARTAO_CREDITO" || paymentMethod === "CADERNO" ? installments : 1,
      });
      resetForm();
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

  async function handleCancelBudget(saleId: string) {
    if (!window.confirm("Cancelar este orcamento?")) return;
    try {
      await api.post(`/sales/${saleId}/cancel`);
      await loadBudgets();
    } catch (err) {
      window.alert(getApiErrorMessage(err));
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-slate-800">Orcamentos / Vendas</h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-white rounded-lg shadow-sm p-4 space-y-2">
            <label className="block text-sm font-medium text-slate-700">Cliente</label>
            {selectedCustomer ? (
              <div className="flex items-center justify-between bg-slate-50 rounded px-3 py-2 text-sm">
                <span>
                  {selectedCustomer.name} {selectedCustomer.phone && `- ${selectedCustomer.phone}`}
                </span>
                <button type="button" onClick={() => setSelectedCustomer(null)} className="text-red-600 hover:underline">
                  Trocar
                </button>
              </div>
            ) : (
              <>
                <form onSubmit={handleCustomerSearch} className="flex gap-2">
                  <input
                    placeholder="Buscar cliente por nome, CPF/CNPJ ou telefone"
                    value={customerSearch}
                    onChange={(e) => setCustomerSearch(e.target.value)}
                    className="border border-slate-300 rounded px-3 py-2 text-sm flex-1"
                  />
                  <button type="submit" className="bg-slate-800 text-white text-sm px-4 py-2 rounded">
                    Buscar
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowQuickCustomer((v) => !v)}
                    className="text-brand-600 text-sm px-3 py-2 whitespace-nowrap hover:underline"
                  >
                    + Cadastrar cliente
                  </button>
                </form>

                {customerResults.length > 0 && (
                  <div className="divide-y divide-slate-100 border border-slate-100 rounded">
                    {customerResults.map((customer) => (
                      <button
                        key={customer.id}
                        type="button"
                        onClick={() => selectCustomer(customer)}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50"
                      >
                        {customer.name} {customer.document && `- ${customer.document}`} {customer.phone && `- ${customer.phone}`}
                      </button>
                    ))}
                  </div>
                )}

                {showQuickCustomer && (
                  <form onSubmit={handleQuickCustomer} className="flex gap-2 pt-2 border-t border-slate-100">
                    <input
                      required
                      placeholder="Nome do cliente"
                      value={quickName}
                      onChange={(e) => setQuickName(e.target.value)}
                      className="border border-slate-300 rounded px-3 py-2 text-sm flex-1"
                    />
                    <input
                      placeholder="Telefone"
                      value={quickPhone}
                      onChange={(e) => setQuickPhone(e.target.value)}
                      className="border border-slate-300 rounded px-3 py-2 text-sm w-40"
                    />
                    <button type="submit" className="bg-brand-600 hover:bg-brand-700 text-white text-sm px-4 py-2 rounded">
                      Salvar
                    </button>
                  </form>
                )}
              </>
            )}
          </div>

          <form onSubmit={handleProductSearch} className="flex gap-2">
            <input
              placeholder="Buscar produto por nome, codigo ou codigo de barras"
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
                      {formatCurrency(product.salePrice)} - estoque: {product.stockQuantity} {product.unit?.abbreviation}
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
                        onChange={(e) => updateCartItem(item.product.id, { quantity: Number(e.target.value) })}
                        className="w-20 border border-slate-300 rounded px-2 py-1"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={item.unitPrice}
                        onChange={(e) => updateCartItem(item.product.id, { unitPrice: Number(e.target.value) })}
                        className="w-24 border border-slate-300 rounded px-2 py-1"
                      />
                    </td>
                    <td className="px-4 py-2">{formatCurrency(item.quantity * item.unitPrice)}</td>
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

          <div className="bg-white rounded-lg shadow-sm p-4 space-y-2">
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
              <input type="checkbox" checked={hasDelivery} onChange={(e) => setHasDelivery(e.target.checked)} />
              Este orcamento/venda possui entrega
            </label>
            {hasDelivery && (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2 pt-2">
                <input
                  type="date"
                  value={delivery.scheduledDate}
                  onChange={(e) => setDelivery({ ...delivery, scheduledDate: e.target.value })}
                  className="border border-slate-300 rounded px-3 py-2 text-sm"
                />
                <button
                  type="button"
                  onClick={useCustomerAddress}
                  disabled={!selectedCustomer}
                  className="text-brand-600 text-sm hover:underline disabled:opacity-40 disabled:no-underline text-left"
                >
                  Usar endereco do cliente
                </button>
                <div />
                <input
                  placeholder="Endereco"
                  value={delivery.endereco}
                  onChange={(e) => setDelivery({ ...delivery, endereco: e.target.value })}
                  className="border border-slate-300 rounded px-3 py-2 text-sm col-span-2"
                />
                <input
                  placeholder="Numero"
                  value={delivery.numero}
                  onChange={(e) => setDelivery({ ...delivery, numero: e.target.value })}
                  className="border border-slate-300 rounded px-3 py-2 text-sm"
                />
                <input
                  placeholder="Bairro"
                  value={delivery.bairro}
                  onChange={(e) => setDelivery({ ...delivery, bairro: e.target.value })}
                  className="border border-slate-300 rounded px-3 py-2 text-sm"
                />
                <input
                  placeholder="Cidade"
                  value={delivery.cidade}
                  onChange={(e) => setDelivery({ ...delivery, cidade: e.target.value })}
                  className="border border-slate-300 rounded px-3 py-2 text-sm"
                />
                <input
                  placeholder="UF"
                  maxLength={2}
                  value={delivery.uf}
                  onChange={(e) => setDelivery({ ...delivery, uf: e.target.value.toUpperCase() })}
                  className="border border-slate-300 rounded px-3 py-2 text-sm"
                />
                <input
                  placeholder="Observacoes da entrega"
                  value={delivery.notes}
                  onChange={(e) => setDelivery({ ...delivery, notes: e.target.value })}
                  className="border border-slate-300 rounded px-3 py-2 text-sm col-span-2"
                />
              </div>
            )}
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm p-4 space-y-4 h-fit">
          <h2 className="font-semibold text-slate-800">Fechamento</h2>

          {error && <div className="bg-red-50 text-red-700 text-sm px-3 py-2 rounded">{error}</div>}

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Desconto</label>
              <div className="flex gap-1">
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={discountValue}
                  onChange={(e) => setDiscountValue(e.target.value)}
                  className="w-full border border-slate-300 rounded px-2 py-2 text-sm"
                />
                <select
                  value={discountType}
                  onChange={(e) => setDiscountType(e.target.value as DiscountType)}
                  className="border border-slate-300 rounded px-1 text-sm"
                >
                  <option value="VALOR">R$</option>
                  <option value="PERCENTUAL">%</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Frete</label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={freight}
                onChange={(e) => setFreight(e.target.value)}
                className="w-full border border-slate-300 rounded px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Forma de pagamento (venda direta)</label>
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

          {(paymentMethod === "CARTAO_CREDITO" || paymentMethod === "CADERNO") && (
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

          <div className="space-y-1 border-t pt-3 text-sm">
            <div className="flex justify-between text-slate-500">
              <span>Subtotal</span>
              <span>{formatCurrency(subtotal)}</span>
            </div>
            <div className="flex justify-between text-slate-500">
              <span>Desconto</span>
              <span>-{formatCurrency(discountAmount)}</span>
            </div>
            <div className="flex justify-between text-slate-500">
              <span>Frete</span>
              <span>{formatCurrency(Number(freight || 0))}</span>
            </div>
            <div className="flex justify-between text-lg font-semibold text-slate-800">
              <span>Total</span>
              <span>{formatCurrency(total)}</span>
            </div>
          </div>

          <div className="space-y-2">
            <button
              type="button"
              disabled={cart.length === 0 || submitting}
              onClick={handleFinalizeSale}
              className="w-full bg-brand-600 hover:bg-brand-700 text-white rounded py-2 text-sm font-medium disabled:opacity-50"
            >
              {submitting ? "Finalizando..." : "Finalizar venda"}
            </button>
            <button
              type="button"
              disabled={cart.length === 0 || submitting}
              onClick={handleSaveBudget}
              className="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 rounded py-2 text-sm font-medium disabled:opacity-50"
            >
              Salvar como orcamento
            </button>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm overflow-x-auto">
        <h2 className="font-semibold text-slate-800 px-4 pt-4">Orcamentos em aberto</h2>
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
            {budgets.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-slate-400">
                  Nenhum orcamento em aberto
                </td>
              </tr>
            )}
            {budgets.map((budget) => (
              <tr key={budget.id}>
                <td className="px-4 py-2">#{budget.number}</td>
                <td className="px-4 py-2">{budget.customer?.name ?? "Consumidor final"}</td>
                <td className="px-4 py-2">{formatCurrency(budget.total)}</td>
                <td className="px-4 py-2">{formatDate(budget.createdAt)}</td>
                <td className="px-4 py-2 text-right space-x-3">
                  <button
                    type="button"
                    onClick={() => setConvertingBudget(budget)}
                    className="text-brand-600 hover:underline"
                  >
                    Converter em venda
                  </button>
                  <button
                    type="button"
                    onClick={() => handleCancelBudget(budget.id)}
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

      {convertingBudget && (
        <ConvertBudgetModal
          budget={convertingBudget}
          onClose={() => setConvertingBudget(null)}
          onConverted={async () => {
            setConvertingBudget(null);
            await loadBudgets();
            await loadSales();
          }}
        />
      )}
    </div>
  );
}
