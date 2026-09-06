import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, getApiErrorMessage } from "../services/api";
import { CompanySettings, NfeImport } from "../types";
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

function PendingRow({
  item,
  onAuthorize,
  onReject,
}: {
  item: NfeImport;
  onAuthorize: (id: string) => void;
  onReject: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);

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
          <p className="text-sm font-medium text-slate-800">{item.emitenteNome}</p>
          <p className="text-xs text-slate-500">
            CNPJ {item.emitenteCnpj} - Emissao {formatDate(item.dataEmissao)} - {formatCurrency(item.valorTotal)}
          </p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <button type="button" onClick={() => setExpanded((v) => !v)} className="text-slate-600 hover:underline">
            {expanded ? "Ocultar itens" : "Ver itens"}
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
            disabled={busy}
            onClick={handleAuthorize}
            className="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded disabled:opacity-50"
          >
            Autorizar
          </button>
        </div>
      </div>

      {expanded && item.rawData && (
        <div className="border-t border-amber-200 px-4 py-3 space-y-3">
          <table className="w-full text-xs">
            <thead className="text-slate-500 text-left">
              <tr>
                <th className="py-1">Produto</th>
                <th className="py-1">Qtd</th>
                <th className="py-1">Unid.</th>
                <th className="py-1">Valor unit.</th>
                <th className="py-1">Total</th>
              </tr>
            </thead>
            <tbody>
              {item.rawData.itens.map((prod, index) => (
                <tr key={index} className="border-t border-amber-100">
                  <td className="py-1">{prod.descricao}</td>
                  <td className="py-1">{prod.quantidadeComercial}</td>
                  <td className="py-1">{prod.unidadeComercial}</td>
                  <td className="py-1">{formatCurrency(prod.valorUnitarioComercial)}</td>
                  <td className="py-1">{formatCurrency(prod.valorTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {item.rawData.duplicatas.length > 0 && (
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

          <p className="text-xs text-amber-700">
            Produtos novos criados na autorizacao entram com preco de venda igual ao de custo -
            revise depois em Produtos.
          </p>
        </div>
      )}
    </div>
  );
}

export function NfeRadar() {
  const [settings, setSettings] = useState<CompanySettings | null>(null);
  const [imports, setImports] = useState<NfeImport[]>([]);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);

  async function load() {
    const [settingsResponse, importsResponse] = await Promise.all([
      api.get<CompanySettings>("/settings/company"),
      api.get<NfeImport[]>("/nfe/imports"),
    ]);
    setSettings(settingsResponse.data);
    setImports(importsResponse.data);
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
            <PendingRow key={item.id} item={item} onAuthorize={handleAuthorize} onReject={handleReject} />
          ))
        )}
      </div>

      <div className="bg-white rounded-lg shadow-sm overflow-x-auto">
        <h2 className="font-semibold text-slate-800 px-4 pt-4">Historico</h2>
        <table className="w-full text-sm mt-2">
          <thead className="bg-slate-50 text-slate-500 text-left">
            <tr>
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
                <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
                  Nenhuma nota no historico ainda
                </td>
              </tr>
            )}
            {history.map((item) => (
              <tr key={item.id}>
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
        Produtos criados automaticamente na autorizacao entram com preco de venda igual ao de custo -
        confira a lista de{" "}
        <Link to="/produtos" className="underline">
          produtos
        </Link>{" "}
        para revisar precos e categorias.
      </p>
    </div>
  );
}
