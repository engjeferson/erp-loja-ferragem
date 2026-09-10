import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { Role } from "../types";

interface NavItem {
  to: string;
  label: string;
  roles?: Role[];
}

interface NavGroup {
  label?: string;
  items: NavItem[];
}

const navGroups: NavGroup[] = [
  { items: [{ to: "/", label: "Inicio" }] },
  {
    label: "Comercial",
    items: [
      { to: "/pdv", label: "Orcamentos / Vendas" },
      { to: "/entregas", label: "Entregas" },
    ],
  },
  {
    label: "Cadastros",
    items: [
      { to: "/clientes", label: "Clientes" },
      { to: "/produtos", label: "Produtos" },
      { to: "/fornecedores", label: "Fornecedores" },
    ],
  },
  {
    label: "Compras",
    items: [
      { to: "/nfe-radar", label: "Radar de NF-e", roles: ["ADMIN", "GERENTE"] },
      { to: "/compras", label: "Compras", roles: ["ADMIN", "GERENTE"] },
    ],
  },
  {
    label: "Financeiro",
    items: [{ to: "/financeiro", label: "Financeiro", roles: ["ADMIN", "GERENTE", "FINANCEIRO"] }],
  },
  {
    label: "Configuracoes",
    items: [{ to: "/configuracoes", label: "Configuracoes", roles: ["ADMIN", "GERENTE"] }],
  },
];

export function AppLayout() {
  const { user, logout } = useAuth();

  const visibleGroups = navGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => !item.roles || (user && item.roles.includes(user.role))),
    }))
    .filter((group) => group.items.length > 0);

  if (user?.isPlatformAdmin) {
    visibleGroups.push({ items: [{ to: "/admin", label: "Super Admin" }] });
  }

  return (
    <div className="flex min-h-screen">
      <aside className="w-60 shrink-0 bg-slate-900 text-slate-100 flex flex-col">
        <div className="px-4 py-5 border-b border-slate-800">
          <p className="text-lg font-semibold">ERP Loja Ferragem</p>
          {user?.companyName && <p className="text-xs text-slate-400 truncate">{user.companyName}</p>}
        </div>
        <nav className="flex-1 py-4 overflow-y-auto">
          {visibleGroups.map((group, index) => (
            <div key={group.label ?? `group-${index}`} className="mb-3">
              {group.label && (
                <p className="px-4 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  {group.label}
                </p>
              )}
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === "/"}
                  className={({ isActive }) =>
                    `block px-4 py-2 text-sm ${
                      isActive ? "bg-brand-600 text-white" : "text-slate-300 hover:bg-slate-800"
                    }`
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="p-4 border-t border-slate-800 text-sm">
          <p className="text-slate-300">{user?.name}</p>
          <p className="text-slate-500 text-xs mb-2">{user?.role}</p>
          <button
            onClick={logout}
            className="text-xs text-red-400 hover:text-red-300"
            type="button"
          >
            Sair
          </button>
        </div>
      </aside>
      <main className="flex-1 p-6 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
