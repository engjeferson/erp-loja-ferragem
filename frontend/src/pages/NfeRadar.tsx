import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, getApiErrorMessage } from "../services/api";
import { CompanySettings, NfeImport } from "../types";
import { formatCurrency, formatDate } from "../utils/format";

const STATUS_LABEL: Record<string, string> = {
  IMPORTADA: "Importada",
  ERRO: "Erro",
  IGNORADA: "Ja processada",
};

const STATUS_CLASS: Record<string, string> = {
  IMPORTADA: "text-emerald-600",
  ERRO: "text-red-600",
  IGNORADA: "text-slate-400",
};

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

  useEffect(() => {
    load();
  }, []);

  async function handleCheck() {
    setError(null);
    setSummary(null);
    setChecking(true);
    try {
      const response = await api.post("/nfe/radar/check");
      const { notasEncontradas, resultados } = response.data;
      const importadas = resultados.filter((r: { status: string }) => r.status === "IMPORTADA").length;
      const erros = resultados.filter((r: { status: string }) => r.status === "ERRO").length;
      setSummary(
        `${notasEncontradas} nota(s) encontrada(s) - ${importadas} importada(s), ${erros} com erro.`,
      );
      await load();
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setChecking(false);
    }
  }

  if (!settings) {
    return <p className="text-slate-500">Carregando...</p>;
  }

  const radarReady = settings.hasCertificate && settings.cnpj && settings.uf;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-800">Radar de NF-e</h1>
        <button
          type="button"
          onClick={handleCheck}
          disabled={!radarReady || checking}
          className="bg-brand-600 hover:bg-brand-700 text-white text-sm px-4 py-2 rounded disabled:opacity-50"
        >
          {checking ? "Consultando SEFAZ..." : "Buscar novas notas"}
        </button>
      </div>

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

      <div className="bg-white rounded-lg shadow-sm overflow-x-auto">
        <h2 className="font-semibold text-slate-800 px-4 pt-4">Historico de notas detectadas</h2>
        <table className="w-full text-sm mt-2">
          <thead className="bg-slate-50 text-slate-500 text-left">
            <tr>
              <th className="px-4 py-2">Chave de acesso</th>
              <th className="px-4 py-2">Fornecedor</th>
              <th className="px-4 py-2">Valor</th>
              <th className="px-4 py-2">Emissao</th>
              <th className="px-4 py-2">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {imports.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-slate-400">
                  Nenhuma nota detectada ainda
                </td>
              </tr>
            )}
            {imports.map((item) => (
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
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-sm text-slate-500">
        Produtos criados automaticamente pelo radar entram com preco de venda igual ao de custo -
        confira a lista de{" "}
        <Link to="/produtos" className="underline">
          produtos
        </Link>{" "}
        para revisar precos e categorias.
      </p>
    </div>
  );
}
