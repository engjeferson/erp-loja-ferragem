import { Router } from "express";
import authRoutes from "../modules/auth/auth.routes";
import usersRoutes from "../modules/users/users.routes";
import categoriesRoutes from "../modules/categories/categories.routes";
import unitsRoutes from "../modules/units/units.routes";
import productsRoutes from "../modules/products/products.routes";
import customersRoutes from "../modules/customers/customers.routes";
import suppliersRoutes from "../modules/suppliers/suppliers.routes";
import salesRoutes from "../modules/sales/sales.routes";
import purchasesRoutes from "../modules/purchases/purchases.routes";
import financialRoutes from "../modules/financial/financial.routes";
import dashboardRoutes from "../modules/dashboard/dashboard.routes";
import settingsRoutes from "../modules/settings/settings.routes";
import nfeRoutes from "../modules/nfe/nfe.routes";
import platformRoutes from "../modules/platform/platform.routes";
import deliveriesRoutes from "../modules/deliveries/deliveries.routes";

const router = Router();

router.use("/auth", authRoutes);
router.use("/users", usersRoutes);
router.use("/categories", categoriesRoutes);
router.use("/units", unitsRoutes);
router.use("/products", productsRoutes);
router.use("/customers", customersRoutes);
router.use("/suppliers", suppliersRoutes);
router.use("/sales", salesRoutes);
router.use("/purchases", purchasesRoutes);
router.use("/financial", financialRoutes);
router.use("/dashboard", dashboardRoutes);
router.use("/settings", settingsRoutes);
router.use("/nfe", nfeRoutes);
router.use("/platform", platformRoutes);
router.use("/deliveries", deliveriesRoutes);

export default router;
