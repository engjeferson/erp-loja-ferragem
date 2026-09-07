import { FormEvent, useEffect, useState } from "react";
import { api, getApiErrorMessage } from "../services/api";
import { PlatformCompany } from "../types";
import { formatDate } from "../utils/format";

const emptyForm = {
  companyName: "",
  cnpj: "",
  uf: "",
  adminName: "",
  adminEmail: "",
  adminPassword: "",
};

export function PlatformAdmin() {
  const [companies, setCompanies] = useState<PlatformCompany[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [showForm, setShowForm] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createdInfo, setCreatedInfo] = useState<string | null>(null);
  const [resetTarget, setResetTarget] = useState<PlatformCompany | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetInfo, setResetInfo] = useState<string | null>(null);

  async function load() {
    const response = await api.get<PlatformCompany[]>("/platform/companies");
    setCompanies(response.data);
  }

  useEffect(() => {
    load();
  }, []);

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setCreateError(null);
    setCreatedInfo(null);
    setCreating(true);
    try {
      await api.post("/platform/companies", {
        companyName: form.companyName,
        cnpj: form.cnpj || undefined,
        uf: form.uf || undefined,
        adminName: form.adminName,
        adminEmail: form.adminEmail,
        adminPassword: form.adminPassword,
      });
      setCreatedInfo(`Empresa "${form.companyName}" criada. Login do admin: ${form.adminEmail}`);
      setForm(emptyForm);
      setShowForm(false);
      await load();
    } catch (err) {
      setCreateError(getApiErrorMessage(err));
    } finally {
      setCreating(false);
    }
  }

  async function handleToggleActive(company: PlatformCompany) {
    const action = company.active ? "desativar" : "reativar";
    if (!window.confirm(`Confirma ${action} a empresa "${company.name}"?`)) return;
    await api.patch(`/platform/companies/${company.id}`, { active: !company.active });
    await load();
  }

  async function handleResetPassword(event: FormEvent) {
    event.preventDefault();
    if (!resetTarget) return;
    setResetError(null);
    setResetInfo(null);
    try {
      const response = await api.post<{ email: string }>(
        `/platform/companies/${resetTarget.id}/reset-admin-password`,
        { newPassword: resetPassword },
      );
      setResetInfo(`Senha redefinida para o admin ${response.data.email}.`);
      setResetPassword("");
    } catch (err) {
      setResetError(getApiErrorMessage(err));
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-800">Super Admin</h1>
          <p className="text-sm text-slate-500">Gerencie todas as empresas (clientes) desta instalacao.</p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm((prev) => !prev)}
          className="bg-brand-600 hover:bg-brand-700 text-white text-sm px-4 py-2 rounded"
        >
          {showForm ? "Cancelar" : "Nova empresa"}
        </button>
      </div>

      {createdInfo && (
        <div className="bg-emerald-50 text-emerald-700 text-sm px-3 py-2 rounded">{createdInfo}</div>
      )}

      {showForm && (
        <form
          onSubmit={handleCreate}
          className="bg-white rounded-lg shadow-sm p-4 grid grid-cols-2 md:grid-cols-3 gap-3"
        >
          {createError && (
            <div className="col-span-full bg-red-50 text-red-700 text-sm px-3 py-2 rounded">
              {createError}
            </div>
          )}
          <input
            required
            placeholder="Nome da empresa"
            value={form.companyName}
            onChange={(e) => setForm({ ...form, companyName: e.target.value })}
            className="border border-slate-300 rounded px-3 py-2 text-sm col-span-2"
          />
          <input
            placeholder="CNPJ (opcional)"
            value={form.cnpj}
            onChange={(e) => setForm({ ...form, cnpj: e.target.value })}
            className="border border-slate-300 rounded px-3 py-2 text-sm"
          />
          <input
            placeholder="UF (opcional)"
            maxLength={2}
            value={form.uf}
            onChange={(e) => setForm({ ...form, uf: e.target.value.toUpperCase() })}
            className="border border-slate-300 rounded px-3 py-2 text-sm"
          />
          <input
            required
            placeholder="Nome do admin"
            value={form.adminName}
            onChange={(e) => setForm({ ...form, adminName: e.target.value })}
            className="border border-slate-300 rounded px-3 py-2 text-sm"
          />
          <input
            required
            type="email"
            placeholder="E-mail do admin"
            value={form.adminEmail}
            onChange={(e) => setForm({ ...form, adminEmail: e.target.value })}
            className="border border-slate-300 rounded px-3 py-2 text-sm"
          />
          <input
            required
            type="password"
            placeholder="Senha do admin (min. 6 caracteres)"
            value={form.adminPassword}
            onChange={(e) => setForm({ ...form, adminPassword: e.target.value })}
            className="border border-slate-300 rounded px-3 py-2 text-sm"
          />
          <button
            type="submit"
            disabled={creating}
            className="bg-brand-600 hover:bg-brand-700 text-white text-sm px-4 py-2 rounded disabled:opacity-50"
          >
            {creating ? "Criando..." : "Criar empresa"}
          </button>
        </form>
      )}

      <div className="bg-white rounded-lg shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-left">
            <tr>
              <th className="px-4 py-2">Empresa</th>
              <th className="px-4 py-2">CNPJ / UF</th>
              <th className="px-4 py-2">Certificado</th>
              <th className="px-4 py-2">Usuarios</th>
              <th className="px-4 py-2">Produtos</th>
              <th className="px-4 py-2">Vendas</th>
              <th className="px-4 py-2">Criada em</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Acoes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {companies.map((company) => (
              <tr key={company.id}>
                <td className="px-4 py-2 font-medium text-slate-800">{company.name}</td>
                <td className="px-4 py-2">
                  {company.cnpj ?? "-"} {company.uf ? `/ ${company.uf}` : ""}
                </td>
                <td className="px-4 py-2">{company.hasCertificate ? "Sim" : "Nao"}</td>
                <td className="px-4 py-2">{company.usersCount}</td>
                <td className="px-4 py-2">{company.productsCount}</td>
                <td className="px-4 py-2">{company.salesCount}</td>
                <td className="px-4 py-2">{formatDate(company.createdAt)}</td>
                <td className="px-4 py-2">
                  <span
                    className={`px-2 py-0.5 rounded text-xs ${
                      company.active ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
                    }`}
                  >
                    {company.active ? "Ativa" : "Desativada"}
                  </span>
                </td>
                <td className="px-4 py-2 space-x-3 whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => handleToggleActive(company)}
                    className="text-brand-600 hover:underline text-xs"
                  >
                    {company.active ? "Desativar" : "Reativar"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setResetTarget(company);
                      setResetPassword("");
                      setResetError(null);
                      setResetInfo(null);
                    }}
                    className="text-brand-600 hover:underline text-xs"
                  >
                    Resetar senha admin
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {resetTarget && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-lg p-6 w-full max-w-sm space-y-3">
            <h2 className="font-semibold text-slate-800">
              Resetar senha do admin - {resetTarget.name}
            </h2>
            <p className="text-xs text-slate-500">
              Isso redefine a senha do primeiro usuario ADMIN cadastrado nessa empresa.
            </p>
            <form onSubmit={handleResetPassword} className="space-y-3">
              {resetError && (
                <div className="bg-red-50 text-red-700 text-sm px-3 py-2 rounded">{resetError}</div>
              )}
              {resetInfo && (
                <div className="bg-emerald-50 text-emerald-700 text-sm px-3 py-2 rounded">{resetInfo}</div>
              )}
              <input
                required
                type="password"
                placeholder="Nova senha (min. 6 caracteres)"
                value={resetPassword}
                onChange={(e) => setResetPassword(e.target.value)}
                className="border border-slate-300 rounded px-3 py-2 text-sm w-full"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setResetTarget(null)}
                  className="text-sm px-4 py-2 rounded text-slate-600 hover:bg-slate-100"
                >
                  Fechar
                </button>
                <button
                  type="submit"
                  className="bg-brand-600 hover:bg-brand-700 text-white text-sm px-4 py-2 rounded"
                >
                  Redefinir
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
