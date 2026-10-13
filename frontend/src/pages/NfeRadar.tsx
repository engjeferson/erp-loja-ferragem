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

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .replace(/(^|\s)\S/g, (c) => c.toUpperCase());
}

/**
 * Combobox de busca de produto: com centenas de produtos cadastrados, um
 * <select> comum vira impraticavel. Digita parte do nome ou do SKU e filtra
 * na hora, como a busca de item nos ERPs de balcao mais usados no ramo.
 */
function ProductCombobox({
  products,
  value,
  onChange,
  autoFocus,
}: {
  products: Product[];
  value: string;
  onChange: (productId: string) => void;
  autoFocus?: boolean;
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
      <div className="relative">
        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">🔍</span>
        <input
          type="text"
          value={query}
          placeholder="Buscar produto por nome ou SKU"
          autoFocus={autoFocus}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            if (value) onChange("");
          }}
          className="w-full rounded-xl border border-slate-200 bg-white pl-11 pr-4 py-3.5 text-base shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
        />
      </div>
      {open && (
        <div className="absolute z-20 mt-1.5 w-full max-h-64 overflow-y-auto bg-white border border-slate-200 rounded-xl shadow-lg">
          {matches.length === 0 ? (
            <p className="px-4 py-3 text-sm text-slate-400">Nenhum produto encontrado</p>
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
                className="block w-full text-left px-4 py-3 text-sm hover:bg-brand-50 border-b border-slate-50 last:border-0"
              >
                <span className="font-medium text-slate-800">{p.name}</span>{" "}
                <span className="text-slate-400">({p.sku})</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

type StepMode = "suggestion" | "search" | "new";

function initialModeFor(item: NfeImportItem): StepMode {
  if (item.suggestedProductId && (!item.reviewed || item.productId === item.suggestedProductId)) {
    return "suggestion";
  }
  if (item.createNewProduct) return "new";
  return "search";
}

/**
 * Uma etapa do assistente de conferencia: um item da nota por vez, em tela
 * cheia, com os botoes de acao sempre visiveis embaixo - pensado pra ser
 * operado rapido no balcao (inclusive em tablet/celular), em vez da tabela
 * densa que existia antes.
 */
function ItemStep({
  nfeImportId,
  item,
  products,
  units,
  stepIndex,
  totalSteps,
  onReviewed,
  onPrev,
  onNext,
}: {
  nfeImportId: string;
  item: NfeImportItem;
  products: Product[];
  units: Unit[];
  stepIndex: number;
  totalSteps: number;
  onReviewed: (item: NfeImportItem) => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  const [mode, setMode] = useState<StepMode>(() => initialModeFor(item));
  const [productId, setProductId] = useState(item.productId ?? "");
  const [unitId, setUnitId] = useState(item.unitId ?? "");
  const [conversionFactor, setConversionFactor] = useState(item.conversionFactor ?? "1");
  const [salePrice, setSalePrice] = useState(item.salePrice ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastPurchase, setLastPurchase] = useState<ProductPurchaseHistoryEntry | null>(null);

  useEffect(() => {
    setMode(initialModeFor(item));
    setProductId(item.productId ?? "");
    setUnitId(item.unitId ?? "");
    setConversionFactor(item.conversionFactor ?? "1");
    setSalePrice(item.salePrice ?? "");
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  const lookupProductId = mode === "suggestion" ? item.suggestedProductId ?? "" : productId;

  useEffect(() => {
    if (!lookupProductId) {
      setLastPurchase(null);
      return;
    }
    let cancelled = false;
    api
      .get<ProductPurchaseHistoryEntry[]>(`/products/${lookupProductId}/purchase-history`)
      .then((response) => {
        if (!cancelled) setLastPurchase(response.data[0] ?? null);
      })
      .catch(() => {
        if (!cancelled) setLastPurchase(null);
      });
    return () => {
      cancelled = true;
    };
  }, [lookupProductId]);

  async function save(payload: Record<string, unknown>) {
    setError(null);
    setSaving(true);
    try {
      const response = await api.patch<NfeImportItem>(`/nfe/imports/${nfeImportId}/items/${item.id}`, payload);
      onReviewed(response.data);
      onNext();
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  function confirm() {
    if (mode === "suggestion") {
      if (!item.suggestedProductId) return;
      save({ productId: item.suggestedProductId });
    } else if (mode === "search") {
      if (!productId) return;
      save({ productId });
    } else {
      if (!unitId) return;
      save({
        createNewProduct: true,
        unitId,
        conversionFactor: Number(conversionFactor) || 1,
        salePrice: salePrice ? Number(salePrice) : undefined,
      });
    }
  }

  const canConfirm =
    (mode === "suggestion" && Boolean(item.suggestedProductId)) ||
    (mode === "search" && Boolean(productId)) ||
    (mode === "new" && Boolean(unitId));

  const currentUnitPrice = Number(item.valorUnitarioComercial);
  const lastUnitPrice = lastPurchase ? Number(lastPurchase.unitCost) : null;
  const priceChanged = lastUnitPrice !== null && Math.abs(lastUnitPrice - currentUnitPrice) > 0.009;

  const segments = Array.from({ length: totalSteps }, (_, i) => (i < stepIndex ? "done" : i === stepIndex ? "current" : "upcoming"));

  return (
    <div className="pb-28">
      <div className="mb-5">
        <div className="flex items-baseline justify-between mb-2">
          <span className="text-xs font-semibold text-slate-500">
            Item {stepIndex + 1} de {totalSteps}
          </span>
          <span className="text-xs font-semibold text-slate-400">
            {Math.round((stepIndex / totalSteps) * 100)}%
          </span>
        </div>
        <div className="flex gap-1">
          {segments.map((s, i) => (
            <div
              key={i}
              className={`h-1.5 flex-1 rounded-full ${
                s === "done" ? "bg-brand-600" : s === "current" ? "bg-brand-300" : "bg-slate-200"
              }`}
            />
          ))}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm mb-4">
        <h2 className="text-xl font-semibold text-slate-800 leading-tight">{titleCase(item.descricao)}</h2>
        <p className="text-xs text-slate-400 font-mono mt-1 mb-4">cod. {item.codigoProduto}</p>
        <div className="flex gap-6 pt-4 border-t border-dashed border-slate-200">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-slate-400">Qtd. na nota</p>
            <p className="font-mono font-semibold text-slate-800">
              {item.quantidadeComercial} {item.unidadeComercial}
            </p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wide text-slate-400">Valor unit.</p>
            <p className="font-mono font-semibold text-slate-800">{formatCurrency(currentUnitPrice)}</p>
            {lastUnitPrice !== null && (
              <p className={`text-[11px] ${priceChanged ? "text-amber-600 font-medium" : "text-slate-400"}`}>
                ultima: {formatCurrency(lastUnitPrice)}
                {priceChanged && " (mudou)"}
              </p>
            )}
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wide text-slate-400">Total</p>
            <p className="font-mono font-semibold text-slate-800">{formatCurrency(item.valorTotal)}</p>
          </div>
        </div>
      </div>

      {mode === "suggestion" && item.suggestedProduct && (
        <div className="bg-brand-50 border border-brand-200 rounded-2xl p-4 mb-3">
          <p className="text-[11px] font-bold uppercase tracking-wide text-brand-700 mb-1">Sugestao</p>
          <p className="text-base font-semibold text-slate-800">
            {item.suggestedProduct.name}{" "}
            <span className="font-mono font-normal text-sm text-slate-500">· {item.suggestedProduct.sku}</span>
          </p>
          <p className="text-sm text-slate-500 mt-0.5 mb-3">Ja comprado deste fornecedor antes, mesmo codigo de item.</p>
          <button
            type="button"
            disabled={saving}
            onClick={confirm}
            className="w-full bg-brand-600 hover:bg-brand-700 text-white font-semibold rounded-xl py-3.5 text-base disabled:opacity-50"
          >
            {saving ? "Salvando..." : "Usar sugestao e confirmar"}
          </button>
        </div>
      )}
      {mode === "suggestion" && (
        <button
          type="button"
          onClick={() => setMode("search")}
          className="w-full text-center text-sm text-slate-500 underline py-2 mb-2"
        >
          Nao e esse produto, buscar outro
        </button>
      )}

      {mode === "search" && (
        <div className="space-y-3 mb-3">
          <ProductCombobox products={products} value={productId} onChange={setProductId} autoFocus />
          <div className="flex items-center gap-3 text-xs text-slate-400">
            <div className="flex-1 h-px bg-slate-200" />
            ou
            <div className="flex-1 h-px bg-slate-200" />
          </div>
          <button
            type="button"
            onClick={() => setMode("new")}
            className="w-full border border-dashed border-slate-300 bg-slate-50 rounded-xl py-3.5 text-sm font-semibold text-slate-700"
          >
            + Cadastrar como produto novo
          </button>
          {item.suggestedProductId && (
            <button type="button" onClick={() => setMode("suggestion")} className="w-full text-center text-sm text-slate-500 underline py-1">
              Voltar pra sugestao
            </button>
          )}
        </div>
      )}

      {mode === "new" && (
        <div className="space-y-4 mb-3 bg-white rounded-2xl border border-slate-200 p-4">
          <div>
            <label className="block text-sm text-slate-600 mb-1.5">Unidade de estoque</label>
            <select
              value={unitId}
              onChange={(e) => setUnitId(e.target.value)}
              className="w-full border border-slate-200 rounded-xl px-4 py-3 text-base"
            >
              <option value="">Selecione a unidade</option>
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.abbreviation})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm text-slate-600 mb-1.5">
              Quantas unidades de venda tem em 1 {item.unidadeComercial} desta compra?
            </label>
            <input
              type="number"
              min={0.0001}
              step="0.0001"
              value={conversionFactor}
              onChange={(e) => setConversionFactor(e.target.value)}
              className="w-full border border-slate-200 rounded-xl px-4 py-3 text-base"
            />
            <p className="text-xs text-slate-400 mt-1">
              Ex: comprou em ROLO e vende em metro, 1 rolo = 100m, digite 100. Se vende do jeito que comprou, deixe 1.
            </p>
          </div>
          <div>
            <label className="block text-sm text-slate-600 mb-1.5">Preco de venda (opcional)</label>
            <input
              type="number"
              min={0}
              step="0.01"
              placeholder="R$ 0,00"
              value={salePrice}
              onChange={(e) => setSalePrice(e.target.value)}
              className="w-full border border-slate-200 rounded-xl px-4 py-3 text-base"
            />
          </div>
          <button type="button" onClick={() => setMode("search")} className="w-full text-center text-sm text-slate-500 underline py-1">
            Ja tenho esse produto cadastrado, buscar
          </button>
        </div>
      )}

      {error && <p className="text-red-600 text-sm mb-3">{error}</p>}

      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 px-4 py-3 flex gap-3 max-w-3xl mx-auto">
        {stepIndex > 0 && (
          <button
            type="button"
            onClick={onPrev}
            className="shrink-0 w-14 rounded-xl border border-slate-200 text-slate-600 text-xl"
          >
            ←
          </button>
        )}
        {mode !== "suggestion" && (
          <button
            type="button"
            disabled={!canConfirm || saving}
            onClick={confirm}
            className="flex-1 bg-brand-600 hover:bg-brand-700 text-white font-semibold rounded-xl py-3.5 text-base disabled:opacity-40"
          >
            {saving ? "Salvando..." : stepIndex === totalSteps - 1 ? "Confirmar e ver resumo" : "Confirmar e proximo item"}
          </button>
        )}
      </div>
    </div>
  );
}

/** Resumo final da conferencia: tudo revisado, confere de uma vez antes de autorizar. */
function ReviewSummary({
  item,
  onAuthorize,
  onReject,
  busy,
}: {
  item: NfeImport;
  onAuthorize: () => void;
  onReject: () => void;
  busy: boolean;
}) {
  const itemsTotal = item.items.reduce((sum, i) => sum + Number(i.valorTotal), 0);
  const totalMismatch = Math.abs(itemsTotal - Number(item.valorTotal)) > 0.5;

  return (
    <div className="pb-6">
      <div className="bg-white rounded-2xl border border-slate-200 p-5 mb-4">
        <p className="text-lg font-semibold text-slate-800">{item.emitenteNome}</p>
        <p className="text-sm text-slate-500">
          NF-e {item.numero ?? "-"} · emitida {formatDate(item.dataEmissao)} · {formatCurrency(item.valorTotal)}
        </p>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100 mb-4">
        {item.items.map((nfeItem) => (
          <div key={nfeItem.id} className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-800 truncate">{titleCase(nfeItem.descricao)}</p>
              <p className="text-xs text-slate-500 truncate">
                → {nfeItem.product?.name ?? (nfeItem.createNewProduct ? "Novo produto" : "-")}
                {nfeItem.product ? "" : nfeItem.createNewProduct && nfeItem.unit ? ` · ${nfeItem.unit.abbreviation}` : ""}
              </p>
            </div>
            <span className="shrink-0 w-6 h-6 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center text-xs font-bold">
              ✓
            </span>
          </div>
        ))}
      </div>

      {totalMismatch && (
        <div className="flex gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-slate-700 mb-4">
          <span>⚠</span>
          <span>
            A soma dos itens ({formatCurrency(itemsTotal)}) e diferente do valor total da nota (
            {formatCurrency(item.valorTotal)}) - pode haver frete/desconto/outras despesas nao detalhados por item.
            Pode autorizar normalmente.
          </span>
        </div>
      )}

      <button
        type="button"
        disabled={busy}
        onClick={onAuthorize}
        className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-xl py-3.5 text-base disabled:opacity-50"
      >
        {busy ? "Autorizando..." : "Autorizar entrada no estoque"}
      </button>
      <p className="text-xs text-slate-400 text-center mt-2">Atualiza o estoque e lanca a conta a pagar automaticamente</p>

      <button type="button" disabled={busy} onClick={onReject} className="w-full text-center text-sm text-red-600 underline py-3">
        Rejeitar esta nota
      </button>
    </div>
  );
}

/** Assistente completo de conferencia de uma nota: passo a passo + resumo final. */
function ReviewWizard({
  item,
  products,
  units,
  onBack,
  onItemReviewed,
  onAuthorize,
  onReject,
}: {
  item: NfeImport;
  products: Product[];
  units: Unit[];
  onBack: () => void;
  onItemReviewed: (updatedItem: NfeImportItem) => void;
  onAuthorize: () => Promise<void>;
  onReject: () => Promise<void>;
}) {
  const [view, setView] = useState<"steps" | "summary">("steps");
  const [stepIndex, setStepIndex] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const firstUnreviewed = item.items.findIndex((i) => !i.reviewed);
    if (firstUnreviewed === -1) {
      setView("summary");
    } else {
      setView("steps");
      setStepIndex(firstUnreviewed);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  async function handleAuthorize() {
    if (!window.confirm("Autorizar esta nota? Isso vai lancar entrada de estoque e conta a pagar.")) return;
    setBusy(true);
    try {
      await onAuthorize();
    } finally {
      setBusy(false);
    }
  }

  async function handleReject() {
    if (!window.confirm("Rejeitar esta nota? Ela nao entrara em estoque nem financeiro.")) return;
    setBusy(true);
    try {
      await onReject();
    } finally {
      setBusy(false);
    }
  }

  const currentItem = item.items[stepIndex];

  return (
    <div className="max-w-xl mx-auto">
      <div className="flex items-center gap-3 mb-5">
        <button
          type="button"
          onClick={onBack}
          aria-label="Voltar para a lista"
          className="w-9 h-9 rounded-lg border border-slate-200 flex items-center justify-center text-slate-600 shrink-0"
        >
          ←
        </button>
        <div className="min-w-0">
          <p className="text-lg font-semibold text-slate-800 truncate">{item.emitenteNome}</p>
          <p className="text-xs text-slate-500">NF-e {item.numero ?? "-"}</p>
        </div>
      </div>

      {view === "steps" && currentItem && (
        <ItemStep
          key={currentItem.id}
          nfeImportId={item.id}
          item={currentItem}
          products={products}
          units={units}
          stepIndex={stepIndex}
          totalSteps={item.items.length}
          onReviewed={onItemReviewed}
          onPrev={() => setStepIndex((i) => Math.max(0, i - 1))}
          onNext={() => {
            if (stepIndex === item.items.length - 1) {
              setView("summary");
            } else {
              setStepIndex((i) => i + 1);
            }
          }}
        />
      )}

      {view === "summary" && <ReviewSummary item={item} onAuthorize={handleAuthorize} onReject={handleReject} busy={busy} />}
    </div>
  );
}

function PendingCard({ item, onOpen }: { item: NfeImport; onOpen: () => void }) {
  const allReviewed = item.items.length > 0 && item.items.every((i) => i.reviewed);
  const allSuggested = item.items.length > 0 && item.items.every((i) => i.suggestedProductId);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full text-left bg-white rounded-2xl border border-slate-200 p-4 hover:border-brand-400 transition-colors"
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-slate-800 truncate">{item.emitenteNome}</h3>
          <p className="text-xs text-slate-500">
            NF-e {item.numero ?? "-"} · {formatDate(item.dataEmissao)}
          </p>
        </div>
        <p className="font-mono font-semibold text-slate-800 whitespace-nowrap">{formatCurrency(item.valorTotal)}</p>
      </div>
      {allReviewed ? (
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700">
          <span className="w-1.5 h-1.5 rounded-full bg-current" /> Pronta para autorizar
        </span>
      ) : allSuggested ? (
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700">
          <span className="w-1.5 h-1.5 rounded-full bg-current" /> Sugestao pronta - confirmacao rapida
        </span>
      ) : (
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-50 text-amber-700">
          <span className="w-1.5 h-1.5 rounded-full bg-current" /> {item.items.length} item(ns) para conferir
        </span>
      )}
    </button>
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
  const [activeImportId, setActiveImportId] = useState<string | null>(null);

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
    await api.post(`/nfe/imports/${id}/authorize`);
    await load();
    setActiveImportId(null);
  }

  async function handleReject(id: string) {
    await api.post(`/nfe/imports/${id}/reject`);
    await load();
    setActiveImportId(null);
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
  const activeImport = activeImportId ? imports.find((i) => i.id === activeImportId) ?? null : null;

  const RADAR_MIN_INTERVAL_MS = 60 * 60 * 1000;
  const lastCheckMs = settings.lastRadarCheckAt ? new Date(settings.lastRadarCheckAt).getTime() : null;
  const cooldownRemainingMs = lastCheckMs ? RADAR_MIN_INTERVAL_MS - (now - lastCheckMs) : 0;
  const inCooldown = cooldownRemainingMs > 0;
  const cooldownMinutes = Math.ceil(cooldownRemainingMs / 60_000);

  if (activeImport) {
    return (
      <ReviewWizard
        item={activeImport}
        products={products}
        units={units}
        onBack={() => setActiveImportId(null)}
        onItemReviewed={(updated) => handleItemReviewed(activeImport.id, updated)}
        onAuthorize={() => handleAuthorize(activeImport.id)}
        onReject={() => handleReject(activeImport.id)}
      />
    );
  }

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
          Materiais a conferir {pending.length > 0 && `(${pending.length})`}
        </h2>
        {pending.length === 0 ? (
          <p className="text-sm text-slate-400">Nenhuma nota pendente no momento.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {pending.map((item) => (
              <PendingCard key={item.id} item={item} onOpen={() => setActiveImportId(item.id)} />
            ))}
          </div>
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
