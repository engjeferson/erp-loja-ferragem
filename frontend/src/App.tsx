import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./contexts/AuthContext";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { AppLayout } from "./layouts/AppLayout";
import { Login } from "./pages/Login";
import { Dashboard } from "./pages/Dashboard";
import { Products } from "./pages/Products";
import { Pdv } from "./pages/Pdv";
import { Purchases } from "./pages/Purchases";
import { Customers } from "./pages/Customers";
import { Suppliers } from "./pages/Suppliers";
import { Financial } from "./pages/Financial";
import { Settings } from "./pages/Settings";
import { NfeRadar } from "./pages/NfeRadar";

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<ProtectedRoute />}>
            <Route element={<AppLayout />}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/produtos" element={<Products />} />
              <Route path="/pdv" element={<Pdv />} />
              <Route path="/compras" element={<Purchases />} />
              <Route path="/clientes" element={<Customers />} />
              <Route path="/fornecedores" element={<Suppliers />} />
              <Route path="/financeiro" element={<Financial />} />
              <Route path="/nfe-radar" element={<NfeRadar />} />
              <Route path="/configuracoes" element={<Settings />} />
            </Route>
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
