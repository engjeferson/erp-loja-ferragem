import { Fragment, FormEvent, useEffect, useState } from "react";
import { api, getApiErrorMessage } from "../services/api";
import { useAuth } from "../contexts/AuthContext";
import { Category, Product, ProductPurchaseHistoryEntry, Unit } from "../types";
import { formatCurrency, formatDate } from "../utils/format";
import { marginFromPrice, priceFromMargin } from "../utils/pricing";

const emptyForm = {
  sku: "",
  name: "",
  barcode: "",
  categoryId: "",
  brand: "",
  unitId: "",
  purchaseUnitId: "",
  conversionFactor: "1",
  costPrice: "0",
  salePrice: "0",
  minStockQuantity: "0",
};

export function Products() {
  const { user } = useAuth();
  const canSeeCost = user?.role !== "VENDEDOR";

  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [onlyNeedsReview, setOnlyNeedsReview] = useState(false);
  const [historyProductId, setHistoryProductId] = useState<string | null>(null);
  const [history, setHistory] = useState<ProductPurchaseHistoryEntry[]>([]);

  const visibleProducts = onlyNeedsReview ? products.filter((p) => p.needsReview) : products;

  async function loadProducts() {
    const response = await api.get<Product[]>("/products", { params: { search } });
    setProducts(response.data);
  }

  useEffect(() => {
    loadProducts();
    api.get<Category[]>("/categories").then((r) => setCategories(r.data));
    api.get<Unit[]>("/units").then((r) => setUnits(r.data));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSearch(event: FormEvent) {
    event.preventDefault();
    await loadProducts();
  }

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await api.post("/products", {
        sku: form.sku,
        name: form.name,
        barcode: form.barcode || undefined,
        categoryId: form.categoryId || undefined,
        brand: form.brand || undefined,
        unitId: form.unitId,
        purchaseUnitId: form.purchaseUnitId || undefined,
        conversionFactor: Number(form.conversionFactor) || 1,
        costPrice: Number(form.costPrice),
        salePrice: Number(form.salePrice),
        minStockQuantity: Number(form.minStockQuantity),
      });
      setForm(emptyForm);
      setShowForm(false);
      await loadProducts();
    } catch (err) {
      setError(getApiErrorMessage(err));
    }
  }

  function handleMarginChange(marginPercent: string) {
    const newSalePrice = priceFromMargin(Number(form.costPrice) || 0, Number(marginPercent) || 0);
    setForm({ ...form, salePrice: newSalePrice.toFixed(2) });
  }

  const currentMargin = marginFromPrice(Number(form.costPrice) || 0, Number(form.salePrice) || 0);

  async function handleStockAdjustment(productId: string) {
    const raw = window.prompt(
      "Ajuste de estoque (use numero negativo para saida, positivo para entrada):",
    );
    if (!raw) return;
    const quantity = Number(raw);
    if (Number.isNaN(quantity) || quantity === 0) return;

    try {
      await api.post(`/products/${productId}/stock-adjustments`, {
        quantity,
        reason: "Ajuste manual via sistema",
      });
      await loadProducts();
    } catch (err) {
      window.alert(getApiErrorMessage(err));
    }
  }

  async function handleMarkReviewed(productId: string) {
    try {
      await api.patch(`/products/${productId}`, { needsReview: false });
      await loadProducts();
    } catch (err) {
      window.alert(getApiErrorMessage(err));
    }
  }

  async function toggleHistory(productId: string) {
    if (historyProductId === productId) {
      setHistoryProductId(null);
      return;
    }
    const response = await api.get<ProductPurchaseHistoryEntry[]>(`/products/${productId}/purchase-history`);
    setHistory(response.data);
    setHistoryProductId(productId);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-800">Produtos</h1>
        {canSeeCost && (
          <button
            type="button"
            onClick={() => setShowForm((prev) => !prev)}
            className="bg-brand-600 hover:bg-brand-700 text-white text-sm px-4 py-2 rounded"
          >
            {showForm ? "Cancelar" : "Novo produto"}
          </button>
        )}
      </div>

      {showForm && canSeeCost && (
        <form
          onSubmit={handleCreate}
          className="bg-white rounded-lg shadow-sm p-4 grid grid-cols-2 md:grid-cols-3 gap-3"
        >
          {error && (
            <div className="col-span-full bg-red-50 text-red-700 text-sm px-3 py-2 rounded">
              {error}
            </div>
          )}
          <input
            required
            placeholder="SKU"
            value={form.sku}
            onChange={(e) => setForm({ ...form, sku: e.target.value })}
            className="border border-slate-300 rounded px-3 py-2 text-sm"
          />
          <input
            required
            placeholder="Nome"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="border border-slate-300 rounded px-3 py-2 text-sm col-span-2"
          />
          <input
            placeholder="Marca"
            value={form.brand}
            onChange={(e) => setForm({ ...form, brand: e.target.value })}
            className="border border-slate-300 rounded px-3 py-2 text-sm"
          />
          <input
            placeholder="Codigo de barras"
            value={form.barcode}
            onChange={(e) => setForm({ ...form, barcode: e.target.value })}
            className="border border-slate-300 rounded px-3 py-2 text-sm"
          />
          <select
            value={form.categoryId}
            onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
            className="border border-slate-300 rounded px-3 py-2 text-sm"
          >
            <option value="">Sem categoria</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select
            required
            value={form.unitId}
            onChange={(e) => setForm({ ...form, unitId: e.target.value })}
            className="border border-slate-300 rounded px-3 py-2 text-sm"
          >
            <option value="">Unidade de estoque/venda</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} ({u.abbreviation})
              </option>
            ))}
          </select>
          <select
            value={form.purchaseUnitId}
            onChange={(e) => setForm({ ...form, purchaseUnitId: e.target.value })}
            className="border border-slate-300 rounded px-3 py-2 text-sm"
          >
            <option value="">Unidade de compra (se diferente)</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} ({u.abbreviation})
              </option>
            ))}
          </select>
          <input
            type="number"
            min={0.0001}
            step="0.0001"
            placeholder="Fator de conversao (ex: 1 rolo = 100)"
            value={form.conversionFactor}
            onChange={(e) => setForm({ ...form, conversionFactor: e.target.value })}
            className="border border-slate-300 rounded px-3 py-2 text-sm"
          />
          <input
            type="number"
            step="0.01"
            placeholder="Custo"
            value={form.costPrice}
            onChange={(e) => setForm({ ...form, costPrice: e.target.value })}
            className="border border-slate-300 rounded px-3 py-2 text-sm"
          />
          <input
            type="number"
            step="0.01"
            placeholder="Preco de venda"
            value={form.salePrice}
            onChange={(e) => setForm({ ...form, salePrice: e.target.value })}
            className="border border-slate-300 rounded px-3 py-2 text-sm"
          />
          <div className="flex items-center gap-1">
            <input
              type="number"
              step="0.1"
              title="Margem sobre o preco de venda - altere aqui pra recalcular o preco"
              placeholder="Margem %"
              value={currentMargin.toFixed(1)}
              onChange={(e) => handleMarginChange(e.target.value)}
              className="border border-slate-300 rounded px-3 py-2 text-sm w-full"
            />
            <span className="text-xs text-slate-400">%</span>
          </div>
          <input
            type="number"
            step="0.01"
            placeholder="Estoque minimo"
            value={form.minStockQuantity}
            onChange={(e) => setForm({ ...form, minStockQuantity: e.target.value })}
            className="border border-slate-300 rounded px-3 py-2 text-sm"
          />
          <button
            type="submit"
            className="bg-brand-600 hover:bg-brand-700 text-white text-sm px-4 py-2 rounded col-span-full md:col-span-1"
          >
            Salvar produto
          </button>
        </form>
      )}

      <form onSubmit={handleSearch} className="flex gap-2">
        <input
          placeholder="Buscar por nome, SKU ou codigo de barras"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="border border-slate-300 rounded px-3 py-2 text-sm flex-1"
        />
        <button type="submit" className="bg-slate-800 text-white text-sm px-4 py-2 rounded">
          Buscar
        </button>
        <label className="flex items-center gap-2 text-sm text-slate-600 whitespace-nowrap">
          <input
            type="checkbox"
            checked={onlyNeedsReview}
            onChange={(e) => setOnlyNeedsReview(e.target.checked)}
          />
          Somente precisam revisao
        </label>
      </form>

      <div className="bg-white rounded-lg shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-left">
            <tr>
              <th className="px-4 py-2">SKU</th>
              <th className="px-4 py-2">Nome</th>
              <th className="px-4 py-2">Categoria</th>
              <th className="px-4 py-2">Estoque</th>
              {canSeeCost && <th className="px-4 py-2">Custo medio</th>}
              {canSeeCost && <th className="px-4 py-2">Margem</th>}
              <th className="px-4 py-2">Preco venda</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {visibleProducts.map((product) => (
              <Fragment key={product.id}>
                <tr>
                  <td className="px-4 py-2">{product.sku}</td>
                  <td className="px-4 py-2">
                    {product.name}
                    {product.brand && <span className="text-slate-400"> - {product.brand}</span>}
                    {product.needsReview && (
                      <span className="ml-2 inline-block text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded">
                        Revisar
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2">{product.category?.name ?? "-"}</td>
                  <td className="px-4 py-2">
                    {product.stockQuantity} {product.unit?.abbreviation}
                  </td>
                  {canSeeCost && (
                    <td className="px-4 py-2">
                      {product.averageCost !== undefined ? formatCurrency(product.averageCost) : "-"}
                    </td>
                  )}
                  {canSeeCost && (
                    <td className="px-4 py-2">{product.margin !== undefined ? `${product.margin.toFixed(0)}%` : "-"}</td>
                  )}
                  <td className="px-4 py-2">{formatCurrency(product.salePrice)}</td>
                  <td className="px-4 py-2 text-right space-x-3 whitespace-nowrap">
                    {product.needsReview && canSeeCost && (
                      <button
                        type="button"
                        onClick={() => handleMarkReviewed(product.id)}
                        className="text-emerald-600 hover:underline"
                      >
                        Marcar revisado
                      </button>
                    )}
                    {canSeeCost && (
                      <button
                        type="button"
                        onClick={() => handleStockAdjustment(product.id)}
                        className="text-brand-600 hover:underline"
                      >
                        Ajustar estoque
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => toggleHistory(product.id)}
                      className="text-slate-600 hover:underline"
                    >
                      Historico
                    </button>
                  </td>
                </tr>
                {historyProductId === product.id && (
                  <tr>
                    <td colSpan={canSeeCost ? 8 : 6} className="px-4 py-3 bg-slate-50">
                      {history.length === 0 ? (
                        <p className="text-xs text-slate-400">Nenhuma compra registrada ainda.</p>
                      ) : (
                        <table className="w-full text-xs">
                          <thead className="text-slate-500 text-left">
                            <tr>
                              <th className="py-1">Data</th>
                              <th className="py-1">Fornecedor</th>
                              <th className="py-1">NF-e</th>
                              <th className="py-1">Qtd</th>
                              <th className="py-1">Custo unit.</th>
                            </tr>
                          </thead>
                          <tbody>
                            {history.map((entry, index) => (
                              <tr key={index} className="border-t border-slate-200">
                                <td className="py-1">{formatDate(entry.date)}</td>
                                <td className="py-1">{entry.supplierName}</td>
                                <td className="py-1 font-mono">{entry.nfeChaveAcesso ?? "-"}</td>
                                <td className="py-1">
                                  {entry.quantity} {product.unit?.abbreviation}
                                </td>
                                <td className="py-1">{formatCurrency(entry.unitCost)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
