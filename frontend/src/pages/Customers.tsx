import { FormEvent, useEffect, useState } from "react";
import { api, getApiErrorMessage } from "../services/api";
import { useAuth } from "../contexts/AuthContext";
import { CadernoSummary, Customer, PaymentMethod } from "../types";
import { formatCurrency, formatDate } from "../utils/format";

const emptyForm = {
  name: "",
  nomeFantasia: "",
  document: "",
  phone: "",
  whatsapp: "",
  email: "",
  cep: "",
  address: "",
  numero: "",
  complemento: "",
  bairro: "",
  cidade: "",
  uf: "",
  observacoes: "",
};

interface Allocation {
  transactionId: string;
  amount: number;
  description: string;
}

function CadernoModal({ customer, onClose }: { customer: Customer; onClose: () => void }) {
  const [summary, setSummary] = useState<CadernoSummary | null>(null);
  const [amount, setAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("DINHEIRO");
  const [allocations, setAllocations] = useState<Allocation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const response = await api.get<CadernoSummary>(`/customers/${customer.id}/caderno`);
    setSummary(response.data);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSimulate() {
    setError(null);
    setMessage(null);
    if (!amount || Number(amount) <= 0) return;
    try {
      const response = await api.get(`/customers/${customer.id}/caderno/receive-preview`, {
        params: { amount: Number(amount) },
      });
      const withDescriptions: Allocation[] = response.data.allocations.map(
        (a: { transactionId: string; amount: number }) => {
          const transaction = summary?.transactions.find((t) => t.id === a.transactionId);
          return {
            transactionId: a.transactionId,
            amount: a.amount,
            description: transaction ? `Venda #${transaction.sale?.number ?? "-"}` : a.transactionId,
          };
        },
      );
      setAllocations(withDescriptions);
    } catch (err) {
      setError(getApiErrorMessage(err));
    }
  }

  function updateAllocation(transactionId: string, value: number) {
    setAllocations((prev) => (prev ? prev.map((a) => (a.transactionId === transactionId ? { ...a, amount: value } : a)) : prev));
  }

  async function handleConfirm() {
    if (!allocations || allocations.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/customers/${customer.id}/caderno/receive`, {
        amount: Number(amount),
        paymentMethod,
        allocations: allocations.filter((a) => a.amount > 0).map((a) => ({ transactionId: a.transactionId, amount: a.amount })),
      });
      setMessage("Recebimento registrado.");
      setAmount("");
      setAllocations(null);
      await load();
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-lg p-6 w-full max-w-2xl space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-slate-800">Caderno - {customer.name}</h2>
          <button type="button" onClick={onClose} className="text-slate-500 hover:text-slate-700">
            Fechar
          </button>
        </div>

        {!summary ? (
          <p className="text-sm text-slate-500">Carregando...</p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-slate-50 rounded p-3">
                <p className="text-xs text-slate-500">Total comprado</p>
                <p className="font-semibold text-slate-800">{formatCurrency(summary.totalComprado)}</p>
              </div>
              <div className="bg-slate-50 rounded p-3">
                <p className="text-xs text-slate-500">Total recebido</p>
                <p className="font-semibold text-emerald-600">{formatCurrency(summary.totalRecebido)}</p>
              </div>
              <div className="bg-slate-50 rounded p-3">
                <p className="text-xs text-slate-500">Saldo em aberto</p>
                <p className="font-semibold text-red-600">{formatCurrency(summary.saldo)}</p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-slate-500 text-left border-b">
                  <tr>
                    <th className="py-1">Venda</th>
                    <th className="py-1">Vencimento</th>
                    <th className="py-1">Valor</th>
                    <th className="py-1">Recebido</th>
                    <th className="py-1">Saldo</th>
                    <th className="py-1">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {summary.transactions.map((t) => (
                    <tr key={t.id}>
                      <td className="py-1">#{t.sale?.number ?? "-"}</td>
                      <td className="py-1">{formatDate(t.dueDate)}</td>
                      <td className="py-1">{formatCurrency(t.amount)}</td>
                      <td className="py-1">{formatCurrency(t.paidAmount)}</td>
                      <td className="py-1">{formatCurrency(t.saldo)}</td>
                      <td className="py-1">{t.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {summary.saldo > 0 && (
              <div className="border-t pt-4 space-y-3">
                <h3 className="font-medium text-slate-800">Receber</h3>
                {error && <div className="bg-red-50 text-red-700 text-sm px-3 py-2 rounded">{error}</div>}
                {message && <div className="bg-emerald-50 text-emerald-700 text-sm px-3 py-2 rounded">{message}</div>}
                <div className="flex gap-2">
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    placeholder="Valor recebido"
                    value={amount}
                    onChange={(e) => {
                      setAmount(e.target.value);
                      setAllocations(null);
                    }}
                    className="border border-slate-300 rounded px-3 py-2 text-sm flex-1"
                  />
                  <select
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                    className="border border-slate-300 rounded px-3 py-2 text-sm"
                  >
                    <option value="DINHEIRO">Dinheiro</option>
                    <option value="PIX">Pix</option>
                    <option value="CARTAO_DEBITO">Cartao de debito</option>
                  </select>
                  <button
                    type="button"
                    onClick={handleSimulate}
                    className="bg-slate-800 hover:bg-slate-900 text-white text-sm px-4 py-2 rounded"
                  >
                    Simular
                  </button>
                </div>

                {allocations && (
                  <div className="bg-slate-50 rounded p-3 space-y-2">
                    <p className="text-xs text-slate-500">Como este valor sera aplicado (ajuste se quiser):</p>
                    {allocations.map((a) => (
                      <div key={a.transactionId} className="flex items-center justify-between gap-2 text-sm">
                        <span>{a.description}</span>
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          value={a.amount}
                          onChange={(e) => updateAllocation(a.transactionId, Number(e.target.value))}
                          className="border border-slate-300 rounded px-2 py-1 text-sm w-28"
                        />
                      </div>
                    ))}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={handleConfirm}
                      className="w-full bg-brand-600 hover:bg-brand-700 text-white text-sm px-4 py-2 rounded disabled:opacity-50"
                    >
                      {busy ? "Confirmando..." : "Confirmar recebimento"}
                    </button>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export function Customers() {
  const { user } = useAuth();
  const canReceive = user && ["ADMIN", "GERENTE", "FINANCEIRO"].includes(user.role);

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cadernoCustomer, setCadernoCustomer] = useState<Customer | null>(null);

  async function load() {
    const response = await api.get<Customer[]>("/customers", { params: search ? { search } : undefined });
    setCustomers(response.data);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSearch(event: FormEvent) {
    event.preventDefault();
    await load();
  }

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await api.post("/customers", {
        ...form,
        nomeFantasia: form.nomeFantasia || undefined,
        document: form.document || undefined,
        phone: form.phone || undefined,
        whatsapp: form.whatsapp || undefined,
        email: form.email || undefined,
        cep: form.cep || undefined,
        address: form.address || undefined,
        numero: form.numero || undefined,
        complemento: form.complemento || undefined,
        bairro: form.bairro || undefined,
        cidade: form.cidade || undefined,
        uf: form.uf || undefined,
        observacoes: form.observacoes || undefined,
      });
      setForm(emptyForm);
      setShowForm(false);
      await load();
    } catch (err) {
      setError(getApiErrorMessage(err));
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-800">Clientes</h1>
        <button
          type="button"
          onClick={() => setShowForm((prev) => !prev)}
          className="bg-brand-600 hover:bg-brand-700 text-white text-sm px-4 py-2 rounded"
        >
          {showForm ? "Cancelar" : "Novo cliente"}
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={handleCreate}
          className="bg-white rounded-lg shadow-sm p-4 grid grid-cols-2 md:grid-cols-4 gap-3"
        >
          {error && (
            <div className="col-span-full bg-red-50 text-red-700 text-sm px-3 py-2 rounded">
              {error}
            </div>
          )}
          <input
            required
            placeholder="Nome / Razao social"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="border border-slate-300 rounded px-3 py-2 text-sm col-span-2"
          />
          <input
            placeholder="Nome fantasia"
            value={form.nomeFantasia}
            onChange={(e) => setForm({ ...form, nomeFantasia: e.target.value })}
            className="border border-slate-300 rounded px-3 py-2 text-sm col-span-2"
          />
          <input
            placeholder="CPF/CNPJ"
            value={form.document}
            onChange={(e) => setForm({ ...form, document: e.target.value })}
            className="border border-slate-300 rounded px-3 py-2 text-sm"
          />
          <input
            placeholder="Telefone"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            className="border border-slate-300 rounded px-3 py-2 text-sm"
          />
          <input
            placeholder="WhatsApp"
            value={form.whatsapp}
            onChange={(e) => setForm({ ...form, whatsapp: e.target.value })}
            className="border border-slate-300 rounded px-3 py-2 text-sm"
          />
          <input
            placeholder="E-mail"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            className="border border-slate-300 rounded px-3 py-2 text-sm"
          />
          <input
            placeholder="CEP"
            value={form.cep}
            onChange={(e) => setForm({ ...form, cep: e.target.value })}
            className="border border-slate-300 rounded px-3 py-2 text-sm"
          />
          <input
            placeholder="Endereco"
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
            className="border border-slate-300 rounded px-3 py-2 text-sm col-span-2"
          />
          <input
            placeholder="Numero"
            value={form.numero}
            onChange={(e) => setForm({ ...form, numero: e.target.value })}
            className="border border-slate-300 rounded px-3 py-2 text-sm"
          />
          <input
            placeholder="Complemento"
            value={form.complemento}
            onChange={(e) => setForm({ ...form, complemento: e.target.value })}
            className="border border-slate-300 rounded px-3 py-2 text-sm"
          />
          <input
            placeholder="Bairro"
            value={form.bairro}
            onChange={(e) => setForm({ ...form, bairro: e.target.value })}
            className="border border-slate-300 rounded px-3 py-2 text-sm"
          />
          <input
            placeholder="Cidade"
            value={form.cidade}
            onChange={(e) => setForm({ ...form, cidade: e.target.value })}
            className="border border-slate-300 rounded px-3 py-2 text-sm"
          />
          <input
            placeholder="UF"
            maxLength={2}
            value={form.uf}
            onChange={(e) => setForm({ ...form, uf: e.target.value.toUpperCase() })}
            className="border border-slate-300 rounded px-3 py-2 text-sm"
          />
          <input
            placeholder="Observacoes"
            value={form.observacoes}
            onChange={(e) => setForm({ ...form, observacoes: e.target.value })}
            className="border border-slate-300 rounded px-3 py-2 text-sm col-span-2"
          />
          <button
            type="submit"
            className="bg-brand-600 hover:bg-brand-700 text-white text-sm px-4 py-2 rounded"
          >
            Salvar
          </button>
        </form>
      )}

      <form onSubmit={handleSearch} className="flex gap-2">
        <input
          placeholder="Buscar por nome ou documento"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="border border-slate-300 rounded px-3 py-2 text-sm flex-1"
        />
        <button type="submit" className="bg-slate-800 text-white text-sm px-4 py-2 rounded">
          Buscar
        </button>
      </form>

      <div className="bg-white rounded-lg shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-left">
            <tr>
              <th className="px-4 py-2">Nome</th>
              <th className="px-4 py-2">Documento</th>
              <th className="px-4 py-2">Telefone</th>
              <th className="px-4 py-2">E-mail</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {customers.map((customer) => (
              <tr key={customer.id}>
                <td className="px-4 py-2">{customer.name}</td>
                <td className="px-4 py-2">{customer.document ?? "-"}</td>
                <td className="px-4 py-2">{customer.phone ?? "-"}</td>
                <td className="px-4 py-2">{customer.email ?? "-"}</td>
                <td className="px-4 py-2 text-right">
                  {canReceive && (
                    <button
                      type="button"
                      onClick={() => setCadernoCustomer(customer)}
                      className="text-brand-600 hover:underline"
                    >
                      Caderno
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {cadernoCustomer && <CadernoModal customer={cadernoCustomer} onClose={() => setCadernoCustomer(null)} />}
    </div>
  );
}
