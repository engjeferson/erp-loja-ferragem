import { FormEvent, useEffect, useState } from "react";
import { api, getApiErrorMessage } from "../services/api";
import { CompanySettings, NfeAmbiente } from "../types";
import { formatDate } from "../utils/format";

const UFS = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO",
  "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI",
  "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
];

export function Settings() {
  const [settings, setSettings] = useState<CompanySettings | null>(null);
  const [companyForm, setCompanyForm] = useState({ name: "", cnpj: "", razaoSocial: "", uf: "", ambiente: "PRODUCAO" as NfeAmbiente });
  const [certPassword, setCertPassword] = useState("");
  const [certFile, setCertFile] = useState<File | null>(null);
  const [savingCompany, setSavingCompany] = useState(false);
  const [uploadingCert, setUploadingCert] = useState(false);
  const [companyMessage, setCompanyMessage] = useState<string | null>(null);
  const [certMessage, setCertMessage] = useState<string | null>(null);
  const [companyError, setCompanyError] = useState<string | null>(null);
  const [certError, setCertError] = useState<string | null>(null);

  async function load() {
    const response = await api.get<CompanySettings>("/settings/company");
    setSettings(response.data);
    setCompanyForm({
      name: response.data.name ?? "",
      cnpj: response.data.cnpj ?? "",
      razaoSocial: response.data.razaoSocial ?? "",
      uf: response.data.uf ?? "",
      ambiente: response.data.ambiente,
    });
  }

  useEffect(() => {
    load();
  }, []);

  async function handleSaveCompany(event: FormEvent) {
    event.preventDefault();
    setCompanyError(null);
    setCompanyMessage(null);
    setSavingCompany(true);
    try {
      await api.put("/settings/company", companyForm);
      setCompanyMessage("Dados da empresa salvos.");
      await load();
    } catch (err) {
      setCompanyError(getApiErrorMessage(err));
    } finally {
      setSavingCompany(false);
    }
  }

  async function handleUploadCertificate(event: FormEvent) {
    event.preventDefault();
    if (!certFile) return;
    setCertError(null);
    setCertMessage(null);
    setUploadingCert(true);
    try {
      const formData = new FormData();
      formData.append("certificate", certFile);
      formData.append("password", certPassword);
      await api.post("/settings/company/certificate", formData);
      setCertMessage("Certificado enviado e validado com sucesso.");
      setCertFile(null);
      setCertPassword("");
      await load();
    } catch (err) {
      setCertError(getApiErrorMessage(err));
    } finally {
      setUploadingCert(false);
    }
  }

  async function handleRemoveCertificate() {
    if (!window.confirm("Remover o certificado digital cadastrado?")) return;
    await api.delete("/settings/company/certificate");
    await load();
  }

  if (!settings) {
    return <p className="text-slate-500">Carregando...</p>;
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <h1 className="text-2xl font-semibold text-slate-800">Configuracoes</h1>

      <div className="bg-white rounded-lg shadow-sm p-6 space-y-4">
        <h2 className="font-semibold text-slate-800">Dados fiscais da empresa</h2>
        <form onSubmit={handleSaveCompany} className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {companyError && (
            <div className="col-span-full bg-red-50 text-red-700 text-sm px-3 py-2 rounded">
              {companyError}
            </div>
          )}
          {companyMessage && (
            <div className="col-span-full bg-emerald-50 text-emerald-700 text-sm px-3 py-2 rounded">
              {companyMessage}
            </div>
          )}
          <input
            placeholder="Nome da empresa (exibido no menu)"
            value={companyForm.name}
            onChange={(e) => setCompanyForm({ ...companyForm, name: e.target.value })}
            className="border border-slate-300 rounded px-3 py-2 text-sm col-span-2"
          />
          <input
            placeholder="CNPJ (apenas numeros)"
            value={companyForm.cnpj}
            onChange={(e) => setCompanyForm({ ...companyForm, cnpj: e.target.value })}
            className="border border-slate-300 rounded px-3 py-2 text-sm col-span-2"
          />
          <input
            placeholder="Razao social"
            value={companyForm.razaoSocial}
            onChange={(e) => setCompanyForm({ ...companyForm, razaoSocial: e.target.value })}
            className="border border-slate-300 rounded px-3 py-2 text-sm col-span-2"
          />
          <select
            value={companyForm.uf}
            onChange={(e) => setCompanyForm({ ...companyForm, uf: e.target.value })}
            className="border border-slate-300 rounded px-3 py-2 text-sm"
          >
            <option value="">UF</option>
            {UFS.map((uf) => (
              <option key={uf} value={uf}>
                {uf}
              </option>
            ))}
          </select>
          <select
            value={companyForm.ambiente}
            onChange={(e) => setCompanyForm({ ...companyForm, ambiente: e.target.value as NfeAmbiente })}
            className="border border-slate-300 rounded px-3 py-2 text-sm"
          >
            <option value="PRODUCAO">Producao</option>
            <option value="HOMOLOGACAO">Homologacao (testes)</option>
          </select>
          <button
            type="submit"
            disabled={savingCompany}
            className="bg-brand-600 hover:bg-brand-700 text-white text-sm px-4 py-2 rounded disabled:opacity-50"
          >
            {savingCompany ? "Salvando..." : "Salvar"}
          </button>
        </form>
      </div>

      <div className="bg-white rounded-lg shadow-sm p-6 space-y-4">
        <h2 className="font-semibold text-slate-800">Certificado digital A1 (radar de NF-e)</h2>
        <p className="text-sm text-slate-500">
          Usado para autenticar com a SEFAZ e buscar automaticamente as notas fiscais de compra
          emitidas contra o CNPJ da empresa. O arquivo e a senha ficam criptografados no banco -
          ninguem alem do sistema consegue le-los.
        </p>

        {settings.hasCertificate ? (
          <div className="bg-slate-50 rounded p-4 text-sm space-y-1">
            <p>
              <span className="text-slate-500">Arquivo: </span>
              {settings.certificateFileName}
            </p>
            <p>
              <span className="text-slate-500">Titular: </span>
              {settings.certificateSubjectCn}
            </p>
            <p>
              <span className="text-slate-500">Valido ate: </span>
              {settings.certificateValidTo ? formatDate(settings.certificateValidTo) : "-"}
            </p>
            <p>
              <span className="text-slate-500">Enviado em: </span>
              {settings.certificateUploadedAt ? formatDate(settings.certificateUploadedAt) : "-"}
            </p>
            <button
              type="button"
              onClick={handleRemoveCertificate}
              className="text-red-600 hover:underline mt-2"
            >
              Remover certificado
            </button>
          </div>
        ) : (
          <p className="text-sm text-amber-600">Nenhum certificado cadastrado ainda.</p>
        )}

        <form onSubmit={handleUploadCertificate} className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-100">
          {certError && (
            <div className="col-span-full bg-red-50 text-red-700 text-sm px-3 py-2 rounded">
              {certError}
            </div>
          )}
          {certMessage && (
            <div className="col-span-full bg-emerald-50 text-emerald-700 text-sm px-3 py-2 rounded">
              {certMessage}
            </div>
          )}
          <input
            type="file"
            accept=".pfx,.p12"
            onChange={(e) => setCertFile(e.target.files?.[0] ?? null)}
            className="col-span-2 text-sm"
          />
          <input
            type="password"
            placeholder="Senha do certificado"
            value={certPassword}
            onChange={(e) => setCertPassword(e.target.value)}
            className="border border-slate-300 rounded px-3 py-2 text-sm col-span-2"
          />
          <button
            type="submit"
            disabled={!certFile || !certPassword || uploadingCert}
            className="bg-brand-600 hover:bg-brand-700 text-white text-sm px-4 py-2 rounded disabled:opacity-50 col-span-2"
          >
            {uploadingCert ? "Enviando..." : settings.hasCertificate ? "Substituir certificado" : "Enviar certificado"}
          </button>
        </form>
      </div>
    </div>
  );
}
