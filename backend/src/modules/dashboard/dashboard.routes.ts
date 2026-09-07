import { Router } from "express";
import { FinancialStatus, FinancialType, SaleStatus } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { authenticate } from "../../middlewares/auth";

const router = Router();
router.use(authenticate);

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const companyId = req.user!.companyId;
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const [
      salesToday,
      salesThisMonth,
      lowStockProducts,
      pendingReceivable,
      pendingPayable,
      recentSales,
    ] = await Promise.all([
      prisma.sale.aggregate({
        where: { companyId, status: SaleStatus.CONFIRMADA, createdAt: { gte: startOfDay } },
        _sum: { total: true },
        _count: true,
      }),
      prisma.sale.aggregate({
        where: { companyId, status: SaleStatus.CONFIRMADA, createdAt: { gte: startOfMonth } },
        _sum: { total: true },
        _count: true,
      }),
      prisma.$queryRaw<
        { id: string; name: string; stockQuantity: number; minStockQuantity: number }[]
      >`SELECT id, name, "stockQuantity", "minStockQuantity" FROM products
        WHERE active = true AND "stockQuantity" <= "minStockQuantity" AND "companyId" = ${companyId}
        ORDER BY name ASC LIMIT 10`,
      prisma.financialTransaction.aggregate({
        where: { companyId, type: FinancialType.RECEBER, status: FinancialStatus.PENDENTE },
        _sum: { amount: true },
      }),
      prisma.financialTransaction.aggregate({
        where: { companyId, type: FinancialType.PAGAR, status: FinancialStatus.PENDENTE },
        _sum: { amount: true },
      }),
      prisma.sale.findMany({
        where: { companyId, status: SaleStatus.CONFIRMADA },
        include: { customer: true },
        orderBy: { createdAt: "desc" },
        take: 5,
      }),
    ]);

    res.json({
      salesToday: { total: salesToday._sum.total ?? 0, count: salesToday._count },
      salesThisMonth: { total: salesThisMonth._sum.total ?? 0, count: salesThisMonth._count },
      lowStockProducts,
      pendingReceivable: pendingReceivable._sum.amount ?? 0,
      pendingPayable: pendingPayable._sum.amount ?? 0,
      recentSales,
    });
  }),
);

export default router;
