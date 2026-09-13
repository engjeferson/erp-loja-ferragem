import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, getApiErrorMessage } from "../services/api";
import { CompanySettings, NfeImport, NfeImportItem, Product, ProductPurchaseHistoryEntry, Unit } from "../types";
import { formatCurrency, formatDate } from "../utils/format";

const STATUS_LABEL: Record<string, string> = {
  PENDENTE: "Pendente de autorizacao",
  IMPORTADA: "Autorizada e lancada",
  REJEITADA: "Rejeitada",
  ERRO: "Erro",
};

const STATUS_CLASS: Record<string, string> = {
  PENDENTE: "text-amber-600",
  IMPORTADA: "text-emerald-600",
  REJEITADA: "text-slate-400",
  ERRO: "text-red-600",
};

/**
 * Combobox de busca de produto: com centenas de produtos cadastrados, um
 * <select> comum vira impraticavel. Digita parte do nome ou do SKU e filtra
 * na hora, como a busca de item nos ERPs de balcao mais usados no ramo.
 */
function ProductCombobox({
  products,
  value,
  onChange,
  placeholder,
}: {
  products: Product[];
  value: string;
  onChange: (productId: string) => void;
  placeholder?: string;
}) {
  const selected = products.find((p) => p.id === value) ?? null;
  const [query, setQuery] = useState(selected ? `${selected.name} (${selected.sku})` : "");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const current = products.find((p) => p.id === value) ?? null;
    setQuery(current ? `${current.name} (${current.sku})` : "");
  }, [value, products]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const matches = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term || (selected && query === `${selected.name} (${selected.sku})`)) {
      return products.slice(0, 30);
    }
    return products
      .filter((p) => p.name.toLowerCase().includes(term) || p.sku.toLowerCase().includes(term))
      .slice(0, 30);
  }, [query, products, selected]);

  return (
    <div ref={containerRef} className="relative">
      <input
        type="text"
        value={query}
        placeholder={placeholder ?? "Buscar produto por nome ou SKU..."}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          if (value) onChange("");
        }}
        className="border border-slate-300 rounded px-2 py-1 text-xs w-full"
      />
      {open && (
        <div className="absolute z-10 mt-0.5 w-full max-h-48 overflow-y-auto bg-white border border-slate-300 rounded shadow-lg">
          {matches.length === 0 ? (
            <p className="px-2 py-1.5 text-xs text-slate-400">Nenhum produto encontrado</p>
          ) : (
            matches.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  onChange(p.id);
                  setQuery(`${p.name} (${p.sku})`);
                  setOpen(false);
                }}
                className="block w-full text-left px-2 py-1.5 text-xs hover:bg-brand-50 border-b border-slate-50 last:border-0"
              >
                <span className="font-medium">{p.name}</span>{" "}
                <span className="text-slate-400">({p.sku})</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function ItemReviewRow({
  nfeImportId,
  item,
  products,
  units,
  onReviewed,
}: {
  nfeImportId: string;
  item: NfeImportItem;
  products: Product[];
  units: Unit[];
  onReviewed: (item: NfeImportItem) => void;
}) {
  const [mode, setMode] = useState<"existing" | "new">(item.productId ? "existing" : "new");
  const [productId, setProductId] = useState(item.productId ?? "");
  const [unitId, setUnitId] = useState(item.unitId ?? "");
  const [conversionFactor, setConversionFactor] = useState(item.conversionFactor ?? "1");
  const [salePrice, setSalePrice] = useState(item.salePrice ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastPurchase, setLastPurchase] = useState<ProductPurchaseHistoryEntry | null>(null);

  useEffect(() => {
    if (mode !== "existing" || !productId) {
      setLastPurchase(null);
      return;
    }
    let cancelled = false;
    api
      .get<ProductPurchaseHistoryEntry[]>(`/products/${productId}/purchase-history`)
      .then((response) => {
        if (!cancelled) setLastPurchase(response.data[0] ?? null);
      })
      .catch(() => {
        if (!cancelled) setLastPurchase(null);
      });
    return () => {
      cancelled = true;
    };
  }, [mode, productId]);

  async function save(overridePayload?: { productId: string }) {
    setError(null);
    setSaving(true);
    try {
      const payload = overridePayload
        ? overridePayload
        : mode === "existing"
          ? { productId }
          : {
              createNewProduct: true,
              unitId,
              conversionFactor: Number(conversionFactor) || 1,
              salePrice: salePrice ? Number(salePrice) : undefined,
            };
      const response = await api.patch<NfeImportItem>(`/nfe/imports/${nfeImportId}/items/${item.id}`, payload);
      onReviewed(response.data);
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const hasSuggestion = Boolean(item.suggestedProductId) && !item.reviewed && productId !== item.suggestedProductId;
  const currentUnitPrice = Number(item.valorUnitarioComercial);
  const lastUnitPrice = lastPurchase ? Number(lastPurchase.unitCost) : null;
  const priceChanged = lastUnitPrice !== null && Math.abs(lastUnitPrice - currentUnitPrice) > 0.009;

  return (
    <tr className="border-t border-amber-100 align-top">
      <td className="py-2 pr-2">
        <p>{item.descricao}</p>
        <p className="text-slate-400 text-[11px]">cod. {item.codigoProduto}</p>
        {item.reviewed && <span className="text-emerald-600 text-xs">revisado</span>}
      </td>
      <td className="py-2 pr-2">
        {item.quantidadeComercial} {item.unidadeComercial}
      </td>
      <td className="py-2 pr-2">
        {formatCurrency(currentUnitPrice)}
        {mode === "existing" && lastUnitPrice !== null && (
          <p className={`text-[11px] ${priceChanged ? "text-amber-600 font-medium" : "text-slate-400"}`}>
            ultima compra: {formatCurrency(lastUnitPrice)}
            {priceChanged && " (mudou)"}
          </p>
        )}
      </td>
      <td className="py-2 pr-2 space-y-1 min-w-[260px]">
        {hasSuggestion && (
          <div className="flex items-center justify-between gap-2 bg-brand-50 border border-brand-200 rounded px-2 py-1 text-[11px] text-brand-800">
            <span>
              Sugestao (ja comprado deste fornecedor): <strong>{item.suggestedProduct?.name}</strong> (
              {item.suggestedProduct?.sku})
            </span>
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                setMode("existing");
                setProductId(item.suggestedProductId!);
                save({ productId: item.suggestedProductId! });
              }}
              className="shrink-0 bg-brand-600 hover:bg-brand-700 text-white px-2 py-0.5 rounded"
            >
              Usar sugestao
            </button>
          </div>
        )}

        <div className="flex gap-3 text-xs">
          <label className="flex items-center gap-1">
            <input type="radio" checked={mode === "existing"} onChange={() => setMode("existing")} />
            Associar existente
          </label>
          <label className="flex items-center gap-1">
            <input type="radio" checked={mode === "new"} onChange={() => setMode("new")} />
            Criar novo
          </label>
        </div>

        {mode === "existing" ? (
          <ProductCombobox products={products} value={productId} onChange={setProductId} />
        ) : (
          <div className="flex gap-1">
            <select
              value={unitId}
              onChange={(e) => setUnitId(e.target.value)}
              className="border border-slate-300 rounded px-2 py-1 text-xs flex-1"
            >
              <option value="">Unidade de estoque</option>
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.abbreviation}
                </option>
              ))}
            </select>
            <input
              type="number"
              min={0.0001}
              step="0.0001"
              title="Fator de conversao (1 unidade da nota = X unidades de estoque)"
              placeholder="Fator"
              value={conversionFactor}
              onChange={(e) => setConversionFactor(e.target.value)}
              className="border border-slate-300 rounded px-2 py-1 text-xs w-16"
            />
            <input
              type="number"
              min={0}
              step="0.01"
              placeholder="Preco venda"
              value={salePrice}
              onChange={(e) => setSalePrice(e.target.value)}
              className="border border-slate-300 rounded px-2 py-1 text-xs w-24"
            />
          </div>
        )}
        {error && <p className="text-red-600 text-xs">{error}</p>}
      </td>
      <td className="py-2 text-right">
        <button
          type="button"
          disabled={saving || (mode === "existing" ? !productId : !unitId)}
          onClick={() => save()}
          className="bg-slate-800 hover:bg-slate-900 text-white text-xs px-3 py-1.5 rounded disabled:opacity-50"
        >
          {saving ? "Salvando..." : "Salvar revisao"}
        </button>
      </td>
    </tr>
  );
}

function PendingRow({
  item,
  products,
  units,
  onAuthorize,
  onReject,
  onItemReviewed,
}: {
  item: NfeImport;
  products: Product[];
  units: Unit[];
  onAuthorize: (id: string) => void;
  onReject: (id: string) => void;
  onItemReviewed: (nfeId: string, updatedItem: NfeImportItem) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [busy, setBusy] = useState(false);

  const allReviewed = item.items.length > 0 && item.items.every((i) => i.reviewed);
  const reviewedCount = item.items.filter((i) => i.reviewed).length;
  const suggestedCount = item.items.filter((i) => i.suggestedProductId && !i.reviewed).length;

  const itemsTotal = item.items.reduce((sum, i) => sum + Number(i.valorTotal), 0);
  const totalMismatch = Math.abs(itemsTotal - Number(item.valorTotal)) > 0.5;

  async function handleAuthorize() {
    if (!window.confirm("Autorizar esta nota? Isso vai lancar entrada de estoque e conta a pagar.")) return;
    setBusy(true);
    try {
      await onAuthorize(item.id);
    } finally {
      setBusy(false);
    }
  }

  async function handleReject() {
    if (!window.confirm("Rejeitar esta nota? Ela nao entrara em estoque nem financeiro.")) return;
    setBusy(true);
    try {
      await onReject(item.id);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border border-amber-200 bg-amber-50 rounded-lg">
      <div className="flex items-center justify-between px-4 py-3">
        <div>
          <p className="text-sm font-medium text-slate-800">
            {item.emitenteNome}
            {item.numero && <span className="text-slate-400 font-normal"> - NF-e no {item.numero}</span>}
          </p>
          <p className="text-xs text-slate-500">
            CNPJ {item.emitenteCnpj} - Emissao {formatDate(item.dataEmissao)} - {formatCurrency(item.valorTotal)} -{" "}
            {item.items.length} item(ns)
            {reviewedCount > 0 && ` - ${reviewedCount}/${item.items.length} revisado(s)`}
            {suggestedCount > 0 && ` - ${suggestedCount} com sugestao pronta`}
          </p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <button type="button" onClick={() => setExpanded((v) => !v)} className="text-slate-600 hover:underline">
            {expanded ? "Ocultar itens" : "Revisar itens"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={handleReject}
            className="text-red-600 hover:underline disabled:opacity-50"
          >
            Rejeitar
          </button>
          <button
            type="button"
            disabled={busy || !allReviewed}
            title={!allReviewed ? "Revise todos os itens antes de autorizar" : undefined}
            onClick={handleAuthorize}
            className="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded disabled:opacity-50"
          >
            Autorizar
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-amber-200 px-4 py-3 space-y-3">
          {!allReviewed && (
            <p className="text-xs text-amber-700">
              Revise cada item abaixo (associe a um produto existente ou crie um novo) antes de autorizar.
              {suggestedCount > 0 && " Itens com sugestao podem ser confirmados com um clique."}
            </p>
          )}
          {totalMismatch && (
            <p className="text-xs text-red-600">
              Atencao: a soma dos itens ({formatCurrency(itemsTotal)}) e diferente do valor total da nota (
              {formatCurrency(item.valorTotal)}) - pode haver frete/desconto/outras despesas nao detalhados por item.
            </p>
          )}
          <table className="w-full text-xs">
            <thead className="text-slate-500 text-left">
              <tr>
                <th className="py-1">Produto (na nota)</th>
                <th className="py-1">Qtd</th>
                <th className="py-1">Valor unit.</th>
                <th className="py-1">Revisao</th>
                <th className="py-1"></th>
              </tr>
            </thead>
            <tbody>
              {item.items.map((nfeItem) => (
                <ItemReviewRow
                  key={nfeItem.id}
                  nfeImportId={item.id}
                  item={nfeItem}
                  products={products}
                  units={units}
                  onReviewed={(updated) => onItemReviewed(item.id, updated)}
                />
              ))}
            </tbody>
          </table>

          {item.rawData && item.rawData.duplicatas.length > 0 && (
            <div>
              <p className="text-xs font-medium text-slate-600 mb-1">Parcelas (duplicatas da nota)</p>
              <ul className="text-xs text-slate-600 space-y-0.5">
                {item.rawData.duplicatas.map((dup, index) => (
                  <li key={index}>
                    Parcela {dup.numero || index + 1} - vencimento {formatDate(dup.vencimento)} -{" "}
                    {formatCurrency(dup.valor)}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function NfeRadar() {
  const [settings, setSettings] = useState<CompanySettings | null>(null);
  const [imports, setImports] = useState<NfeImport[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);

  async function load() {
    const [settingsResponse, importsResponse, productsResponse, unitsResponse] = await Promise.all([
      api.get<CompanySettings>("/settings/company"),
      api.get<NfeImport[]>("/nfe/imports"),
      api.get<Product[]>("/products"),
      api.get<Unit[]>("/units"),
    ]);
    setSettings(settingsResponse.data);
    setImports(importsResponse.data);
    setProducts(productsResponse.data);
    setUnits(unitsResponse.data);
  }

  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, []);

  async function handleCheck() {
    setError(null);
    setSummary(null);
    setChecking(true);
    try {
      const response = await api.post("/nfe/radar/check");
      const { notasEncontradas, resultados } = response.data;
      const pendentes = resultados.filter((r: { status: string }) => r.status === "PENDENTE").length;
      const erros = resultados.filter((r: { status: string }) => r.status === "ERRO").length;
      setSummary(
        `${notasEncontradas} nota(s) encontrada(s) - ${pendentes} aguardando autorizacao, ${erros} com erro.`,
      );
      await load();
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setChecking(false);
    }
  }

  async function handleAuthorize(id: string) {
    try {
      await api.post(`/nfe/imports/${id}/authorize`);
      await load();
    } catch (err) {
      window.alert(getApiErrorMessage(err));
    }
  }

  async function handleReject(id: string) {
    try {
      await api.post(`/nfe/imports/${id}/reject`);
      await load();
    } catch (err) {
      window.alert(getApiErrorMessage(err));
    }
  }

  function handleItemReviewed(nfeId: string, updatedItem: NfeImportItem) {
    setImports((prev) =>
      prev.map((imp) =>
        imp.id === nfeId
          ? { ...imp, items: imp.items.map((i) => (i.id === updatedItem.id ? updatedItem : i)) }
          : imp,
      ),
    );
  }

  if (!settings) {
    return <p className="text-slate-500">Carregando...</p>;
  }

  const radarReady = settings.hasCertificate && settings.cnpj && settings.uf;
  const pending = imports.filter((item) => item.status === "PENDENTE");
  const history = imports.filter((item) => item.status !== "PENDENTE");

  const RADAR_MIN_INTERVAL_MS = 60 * 60 * 1000;
  const lastCheckMs = settings.lastRadarCheckAt ? new Date(settings.lastRadarCheckAt).getTime() : null;
  const cooldownRemainingMs = lastCheckMs ? RADAR_MIN_INTERVAL_MS - (now - lastCheckMs) : 0;
  const inCooldown = cooldownRemainingMs > 0;
  const cooldownMinutes = Math.ceil(cooldownRemainingMs / 60_000);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-800">Radar de NF-e</h1>
        <button
          type="button"
          onClick={handleCheck}
          disabled={!radarReady || checking || inCooldown}
          title={inCooldown ? `A SEFAZ permite 1 consulta por hora - aguarde ${cooldownMinutes} min` : undefined}
          className="bg-brand-600 hover:bg-brand-700 text-white text-sm px-4 py-2 rounded disabled:opacity-50"
        >
          {checking
            ? "Consultando SEFAZ..."
            : inCooldown
              ? `Aguarde ${cooldownMinutes} min`
              : "Buscar novas notas"}
        </button>
      </div>

      {radarReady && inCooldown && (
        <div className="bg-amber-50 text-amber-700 text-sm px-4 py-3 rounded">
          A SEFAZ permite no maximo 1 consulta por hora ao radar de NF-e (para evitar o erro "656 -
          Consumo Indevido"). Faltam cerca de {cooldownMinutes} minuto(s) para a proxima consulta liberar.
        </div>
      )}

      {!radarReady && (
        <div className="bg-amber-50 text-amber-700 text-sm px-4 py-3 rounded">
          Cadastre o CNPJ, a UF e o certificado digital em{" "}
          <Link to="/configuracoes" className="underline font-medium">
            Configuracoes
          </Link>{" "}
          antes de usar o radar.
        </div>
      )}

      {error && <div className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded">{error}</div>}
      {summary && <div className="bg-emerald-50 text-emerald-700 text-sm px-4 py-3 rounded">{summary}</div>}

      <div className="bg-white rounded-lg shadow-sm p-4 text-sm text-slate-600 space-y-1">
        <p>
          Ultima checagem:{" "}
          {settings.lastRadarCheckAt ? formatDate(settings.lastRadarCheckAt) : "nunca"}
        </p>
        {settings.lastRadarStatus && <p>Resultado: {settings.lastRadarStatus}</p>}
        {settings.lastRadarError && <p className="text-red-600">Erro: {settings.lastRadarError}</p>}
      </div>

      <div className="space-y-3">
        <h2 className="font-semibold text-slate-800">
          Aguardando autorizacao {pending.length > 0 && `(${pending.length})`}
        </h2>
        {pending.length === 0 ? (
          <p className="text-sm text-slate-400">Nenhuma nota pendente no momento.</p>
        ) : (
          pending.map((item) => (
            <PendingRow
              key={item.id}
              item={item}
              products={products}
              units={units}
              onAuthorize={handleAuthorize}
              onReject={handleReject}
              onItemReviewed={handleItemReviewed}
            />
          ))
        )}
      </div>

      <div className="bg-white rounded-lg shadow-sm overflow-x-auto">
        <h2 className="font-semibold text-slate-800 px-4 pt-4">Historico</h2>
        <table className="w-full text-sm mt-2">
          <thead className="bg-slate-50 text-slate-500 text-left">
            <tr>
              <th className="px-4 py-2">NF-e</th>
              <th className="px-4 py-2">Chave de acesso</th>
              <th className="px-4 py-2">Fornecedor</th>
              <th className="px-4 py-2">Valor</th>
              <th className="px-4 py-2">Emissao</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Revisado por</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {history.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-slate-400">
                  Nenhuma nota no historico ainda
                </td>
              </tr>
            )}
            {history.map((item) => (
              <tr key={item.id}>
                <td className="px-4 py-2">{item.numero ?? "-"}</td>
                <td className="px-4 py-2 font-mono text-xs">{item.chaveAcesso}</td>
                <td className="px-4 py-2">{item.emitenteNome}</td>
                <td className="px-4 py-2">{formatCurrency(item.valorTotal)}</td>
                <td className="px-4 py-2">{formatDate(item.dataEmissao)}</td>
                <td className={`px-4 py-2 font-medium ${STATUS_CLASS[item.status]}`}>
                  {STATUS_LABEL[item.status]}
                  {item.errorMessage && (
                    <span className="block text-xs text-slate-400 font-normal">{item.errorMessage}</span>
                  )}
                </td>
                <td className="px-4 py-2 text-slate-500">{item.reviewedBy?.name ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-sm text-slate-500">
        Produtos criados na revisao de itens entram para revisao de preco/categoria em{" "}
        <Link to="/produtos" className="underline">
          produtos
        </Link>
        .
      </p>
    </div>
  );
}
