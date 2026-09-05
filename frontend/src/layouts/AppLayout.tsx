import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { Role } from "../types";

const navItems: { to: string; label: string; roles?: Role[] }[] = [
  { to: "/", label: "Dashboard" },
  { to: "/produtos", label: "Produtos" },
  { to: "/pdv", label: "PDV / Vendas" },
  { to: "/compras", label: "Compras" },
  { to: "/clientes", label: "Clientes" },
  { to: "/fornecedores", label: "Fornecedores" },
  { to: "/financeiro", label: "Financeiro" },
  { to: "/nfe-radar", label: "Radar de NF-e", roles: ["ADMIN", "GERENTE"] },
  { to: "/configuracoes", label: "Configuracoes", roles: ["ADMIN", "GERENTE"] },
];

export function AppLayout() {
  const { user, logout } = useAuth();
  const visibleItems = navItems.filter((item) => !item.roles || (user && item.roles.includes(user.role)));

  return (
    <div className="flex min-h-screen">
      <aside className="w-60 shrink-0 bg-slate-900 text-slate-100 flex flex-col">
        <div className="px-4 py-5 text-lg font-semibold border-b border-slate-800">
          ERP Loja Ferragem
        </div>
        <nav className="flex-1 py-4">
          {visibleItems.map((item) => (
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
