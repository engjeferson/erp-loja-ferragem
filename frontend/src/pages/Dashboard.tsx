import { useEffect, useState } from "react";
import { api } from "../services/api";
import { DashboardData } from "../types";
import { formatCurrency, formatDate } from "../utils/format";

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-lg shadow-sm p-4">
      <p className="text-xs text-slate-500 uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-semibold text-slate-800 mt-1">{value}</p>
    </div>
  );
}

export function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);

  useEffect(() => {
    api.get<DashboardData>("/dashboard").then((response) => setData(response.data));
  }, []);

  if (!data) {
    return <p className="text-slate-500">Carregando...</p>;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-slate-800">Dashboard</h1>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Vendas hoje" value={formatCurrency(data.salesToday.total)} />
        <StatCard label="Vendas no mes" value={formatCurrency(data.salesThisMonth.total)} />
        <StatCard label="A receber" value={formatCurrency(data.pendingReceivable)} />
        <StatCard label="A pagar" value={formatCurrency(data.pendingPayable)} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg shadow-sm p-4">
          <h2 className="font-semibold text-slate-800 mb-3">Estoque baixo</h2>
          {data.lowStockProducts.length === 0 ? (
            <p className="text-sm text-slate-500">Nenhum produto com estoque baixo.</p>
          ) : (
            <ul className="text-sm divide-y divide-slate-100">
              {data.lowStockProducts.map((product) => (
                <li key={product.id} className="py-2 flex justify-between">
                  <span>{product.name}</span>
                  <span className="text-red-600 font-medium">
                    {product.stockQuantity} / min {product.minStockQuantity}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="bg-white rounded-lg shadow-sm p-4">
          <h2 className="font-semibold text-slate-800 mb-3">Vendas recentes</h2>
          {data.recentSales.length === 0 ? (
            <p className="text-sm text-slate-500">Nenhuma venda confirmada ainda.</p>
          ) : (
            <ul className="text-sm divide-y divide-slate-100">
              {data.recentSales.map((sale) => (
                <li key={sale.id} className="py-2 flex justify-between">
                  <span>
                    #{sale.number} - {sale.customer?.name ?? "Consumidor final"}
                  </span>
                  <span className="text-slate-600">
                    {formatCurrency(sale.total)} - {formatDate(sale.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
