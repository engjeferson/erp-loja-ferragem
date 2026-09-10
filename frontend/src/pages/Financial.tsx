import { FormEvent, useEffect, useState } from "react";
import { api, getApiErrorMessage } from "../services/api";
import { FinancialTransaction, FinancialType } from "../types";
import { formatCurrency, formatDate } from "../utils/format";

const emptyForm = {
  type: "PAGAR" as FinancialType,
  description: "",
  amount: "",
  dueDate: "",
  counterpartyName: "",
};

export function Financial() {
  const [transactions, setTransactions] = useState<FinancialTransaction[]>([]);
  const [typeFilter, setTypeFilter] = useState<FinancialType | "">("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<{
    pendingReceivable: number;
    pendingPayable: number;
    overdueReceivable: number;
    overduePayable: number;
  } | null>(null);

  async function load() {
    const [transactionsResponse, summaryResponse] = await Promise.all([
      api.get<FinancialTransaction[]>("/financial/transactions", {
        params: typeFilter ? { type: typeFilter } : undefined,
      }),
      api.get("/financial/summary"),
    ]);
    setTransactions(transactionsResponse.data);
    setSummary(summaryResponse.data);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeFilter]);

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await api.post("/financial/transactions", {
        type: form.type,
        description: form.description,
        amount: Number(form.amount),
        dueDate: form.dueDate,
        counterpartyName: form.counterpartyName || undefined,
      });
      setForm(emptyForm);
      setShowForm(false);
      await load();
    } catch (err) {
      setError(getApiErrorMessage(err));
    }
  }

  async function handleSettle(id: string) {
    if (!window.confirm("Baixar (quitar) o saldo inteiro deste lancamento?")) return;
    try {
      await api.post(`/financial/transactions/${id}/settle`);
      await load();
    } catch (err) {
      window.alert(getApiErrorMessage(err));
    }
  }

  async function handlePartialPayment(id: string, saldo: number) {
    const raw = window.prompt(`Valor recebido/pago agora (saldo: ${formatCurrency(saldo)}):`);
    if (!raw) return;
    const amount = Number(raw);
    if (Number.isNaN(amount) || amount <= 0) return;

    try {
      await api.post(`/financial/transactions/${id}/payments`, { amount });
      await load();
    } catch (err) {
      window.alert(getApiErrorMessage(err));
    }
  }

  async function handleCancel(id: string) {
    if (!window.confirm("Cancelar este lancamento?")) return;
    await api.post(`/financial/transactions/${id}/cancel`);
    await load();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-800">Financeiro</h1>
        <button
          type="button"
          onClick={() => setShowForm((prev) => !prev)}
          className="bg-brand-600 hover:bg-brand-700 text-white text-sm px-4 py-2 rounded"
        >
          {showForm ? "Cancelar" : "Novo lancamento"}
        </button>
      </div>

      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white rounded-lg shadow-sm p-4">
            <p className="text-xs text-slate-500 uppercase">A receber</p>
            <p className="text-xl font-semibold text-emerald-600">
              {formatCurrency(summary.pendingReceivable)}
            </p>
          </div>
          <div className="bg-white rounded-lg shadow-sm p-4">
            <p className="text-xs text-slate-500 uppercase">A pagar</p>
            <p className="text-xl font-semibold text-red-600">
              {formatCurrency(summary.pendingPayable)}
            </p>
          </div>
          <div className="bg-white rounded-lg shadow-sm p-4">
            <p className="text-xs text-slate-500 uppercase">Receber vencido</p>
            <p className="text-xl font-semibold text-amber-600">
              {formatCurrency(summary.overdueReceivable)}
            </p>
          </div>
          <div className="bg-white rounded-lg shadow-sm p-4">
            <p className="text-xs text-slate-500 uppercase">Pagar vencido</p>
            <p className="text-xl font-semibold text-amber-600">
              {formatCurrency(summary.overduePayable)}
            </p>
          </div>
        </div>
      )}

      {showForm && (
        <form
          onSubmit={handleCreate}
          className="bg-white rounded-lg shadow-sm p-4 grid grid-cols-2 md:grid-cols-3 gap-3"
        >
          {error && (
            <div className="col-span-full bg-red-50 text-red-700 text-sm px-3 py-2 rounded">
              {error}
            </div>
          )}
          <select
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value as FinancialType })}
            className="border border-slate-300 rounded px-3 py-2 text-sm"
          >
            <option value="PAGAR">A pagar</option>
            <option value="RECEBER">A receber</option>
          </select>
          <input
            required
            placeholder="Descricao"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="border border-slate-300 rounded px-3 py-2 text-sm col-span-2"
          />
          <input
            placeholder="Favorecido / pagador"
            value={form.counterpartyName}
            onChange={(e) => setForm({ ...form, counterpartyName: e.target.value })}
            className="border border-slate-300 rounded px-3 py-2 text-sm"
          />
          <input
            required
            type="number"
            step="0.01"
            placeholder="Valor"
            value={form.amount}
            onChange={(e) => setForm({ ...form, amount: e.target.value })}
            className="border border-slate-300 rounded px-3 py-2 text-sm"
          />
          <input
            required
            type="date"
            value={form.dueDate}
            onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
            className="border border-slate-300 rounded px-3 py-2 text-sm"
          />
          <button
            type="submit"
            className="bg-brand-600 hover:bg-brand-700 text-white text-sm px-4 py-2 rounded"
          >
            Salvar
          </button>
        </form>
      )}

      <div className="flex gap-2">
        {(["", "PAGAR", "RECEBER"] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setTypeFilter(option as FinancialType | "")}
            className={`text-sm px-3 py-1 rounded ${
              typeFilter === option ? "bg-slate-800 text-white" : "bg-white text-slate-600"
            }`}
          >
            {option === "" ? "Todos" : option === "PAGAR" ? "A pagar" : "A receber"}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-lg shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-left">
            <tr>
              <th className="px-4 py-2">Tipo</th>
              <th className="px-4 py-2">Descricao</th>
              <th className="px-4 py-2">Favorecido</th>
              <th className="px-4 py-2">Vencimento</th>
              <th className="px-4 py-2">Valor</th>
              <th className="px-4 py-2">Saldo</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {transactions.map((transaction) => {
              const isOpen = transaction.status === "PENDENTE" || transaction.status === "PARCIALMENTE_PAGO";
              return (
                <tr key={transaction.id}>
                  <td className="px-4 py-2">{transaction.type === "PAGAR" ? "Pagar" : "Receber"}</td>
                  <td className="px-4 py-2">{transaction.description}</td>
                  <td className="px-4 py-2">
                    {transaction.customer?.name ?? transaction.supplier?.name ?? transaction.counterpartyName ?? "-"}
                  </td>
                  <td className="px-4 py-2">{formatDate(transaction.dueDate)}</td>
                  <td className="px-4 py-2">{formatCurrency(transaction.amount)}</td>
                  <td className="px-4 py-2">{formatCurrency(transaction.saldo)}</td>
                  <td className="px-4 py-2">
                    {isOpen && transaction.overdue ? (
                      <span className="text-red-600 font-medium">Vencido</span>
                    ) : transaction.status === "PARCIALMENTE_PAGO" ? (
                      <span className="text-amber-600 font-medium">Parcial</span>
                    ) : (
                      transaction.status
                    )}
                  </td>
                  <td className="px-4 py-2 text-right space-x-2 whitespace-nowrap">
                    {isOpen && (
                      <>
                        <button
                          type="button"
                          onClick={() => handlePartialPayment(transaction.id, transaction.saldo)}
                          className="text-brand-600 hover:underline"
                        >
                          Receber/pagar parcial
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSettle(transaction.id)}
                          className="text-emerald-600 hover:underline"
                        >
                          Baixar tudo
                        </button>
                      </>
                    )}
                    {transaction.status === "PENDENTE" && (
                      <button
                        type="button"
                        onClick={() => handleCancel(transaction.id)}
                        className="text-red-600 hover:underline"
                      >
                        Cancelar
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
