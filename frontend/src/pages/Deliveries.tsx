import { useEffect, useState } from "react";
import { api, getApiErrorMessage } from "../services/api";
import { Delivery } from "../types";
import { formatCurrency, formatDate } from "../utils/format";

export function Deliveries() {
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [onlyPending, setOnlyPending] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const response = await api.get<Delivery[]>("/deliveries", {
      params: onlyPending ? { status: "PENDENTE" } : undefined,
    });
    setDeliveries(response.data);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onlyPending]);

  async function handleDeliver(id: string) {
    if (!window.confirm("Marcar esta entrega como entregue?")) return;
    try {
      await api.post(`/deliveries/${id}/deliver`);
      await load();
    } catch (err) {
      window.alert(getApiErrorMessage(err));
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-800">Entregas</h1>
          <p className="text-sm text-slate-500">O que precisa ser entregue e o que ja foi.</p>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={onlyPending} onChange={(e) => setOnlyPending(e.target.checked)} />
          Somente pendentes
        </label>
      </div>

      {error && <div className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded">{error}</div>}

      <div className="bg-white rounded-lg shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-left">
            <tr>
              <th className="px-4 py-2">Venda</th>
              <th className="px-4 py-2">Cliente</th>
              <th className="px-4 py-2">Data prevista</th>
              <th className="px-4 py-2">Endereco</th>
              <th className="px-4 py-2">Telefone</th>
              <th className="px-4 py-2">Situacao</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {deliveries.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-slate-400">
                  Nenhuma entrega encontrada
                </td>
              </tr>
            )}
            {deliveries.map((delivery) => (
              <tr key={delivery.id}>
                <td className="px-4 py-2">
                  #{delivery.sale?.number} - {delivery.sale && formatCurrency(delivery.sale.total)}
                </td>
                <td className="px-4 py-2">{delivery.customer?.name ?? "-"}</td>
                <td className="px-4 py-2">{delivery.scheduledDate ? formatDate(delivery.scheduledDate) : "-"}</td>
                <td className="px-4 py-2">
                  {[delivery.endereco, delivery.numero, delivery.bairro, delivery.cidade, delivery.uf]
                    .filter(Boolean)
                    .join(", ") || "-"}
                </td>
                <td className="px-4 py-2">{delivery.customer?.whatsapp ?? delivery.customer?.phone ?? "-"}</td>
                <td className="px-4 py-2">
                  <span
                    className={`px-2 py-0.5 rounded text-xs ${
                      delivery.status === "ENTREGUE" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
                    }`}
                  >
                    {delivery.status === "ENTREGUE" ? "Entregue" : "Pendente"}
                  </span>
                </td>
                <td className="px-4 py-2 text-right">
                  {delivery.status === "PENDENTE" && (
                    <button
                      type="button"
                      onClick={() => handleDeliver(delivery.id)}
                      className="text-emerald-600 hover:underline"
                    >
                      Marcar como entregue
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
