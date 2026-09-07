import { Router } from "express";
import { z } from "zod";
import {
  FinancialStatus,
  FinancialType,
  Prisma,
  PurchaseOrderStatus,
  StockMovementType,
} from "@prisma/client";
import { prisma } from "../../config/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { authenticate } from "../../middlewares/auth";
import { AppError } from "../../utils/AppError";
import { buildInstallments } from "../../utils/installments";

type Tx = Prisma.TransactionClient;

const router = Router();
router.use(authenticate);

const purchaseItemSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().positive(),
  unitCost: z.number().nonnegative(),
});

const createPurchaseSchema = z.object({
  supplierId: z.string().uuid(),
  notes: z.string().optional(),
  items: z.array(purchaseItemSchema).min(1),
});

const receivePurchaseSchema = z.object({
  installments: z.number().int().min(1).max(24).default(1),
  firstDueDate: z.coerce.date().optional(),
});

function calculateTotals(items: z.infer<typeof purchaseItemSchema>[]) {
  const total = items.reduce((sum, item) => sum + item.quantity * item.unitCost, 0);
  return { subtotal: total, total };
}

async function assertBelongToCompany(tx: Tx, companyId: string, supplierId: string, productIds: string[]) {
  const supplier = await tx.supplier.findFirst({ where: { id: supplierId, companyId } });
  if (!supplier) throw new AppError("Fornecedor informado nao pertence a esta empresa", 422);

  const uniqueProductIds = [...new Set(productIds)];
  const ownedProducts = await tx.product.count({
    where: { id: { in: uniqueProductIds }, companyId },
  });
  if (ownedProducts !== uniqueProductIds.length) {
    throw new AppError("Um ou mais produtos informados nao pertencem a esta empresa", 422);
  }
}

async function nextPurchaseOrderNumber(tx: Tx, companyId: string): Promise<number> {
  const result = await tx.purchaseOrder.aggregate({ where: { companyId }, _max: { number: true } });
  return (result._max.number ?? 0) + 1;
}

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { status } = req.query;
    const purchaseOrders = await prisma.purchaseOrder.findMany({
      where: {
        companyId: req.user!.companyId,
        ...(status ? { status: status as PurchaseOrderStatus } : {}),
      },
      include: { supplier: true, user: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    });
    res.json(purchaseOrders);
  }),
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const purchaseOrder = await prisma.purchaseOrder.findFirst({
      where: { id: req.params.id, companyId: req.user!.companyId },
      include: {
        supplier: true,
        user: { select: { name: true } },
        items: { include: { product: true } },
        financialTransactions: true,
      },
    });
    if (!purchaseOrder) throw new AppError("Pedido de compra nao encontrado", 404);
    res.json(purchaseOrder);
  }),
);

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const data = createPurchaseSchema.parse(req.body);
    const totals = calculateTotals(data.items);
    const companyId = req.user!.companyId;

    const purchaseOrder = await prisma.$transaction(async (tx) => {
      await assertBelongToCompany(
        tx,
        companyId,
        data.supplierId,
        data.items.map((item) => item.productId),
      );

      return tx.purchaseOrder.create({
        data: {
          companyId,
          number: await nextPurchaseOrderNumber(tx, companyId),
          supplierId: data.supplierId,
          userId: req.user!.sub,
          notes: data.notes,
          subtotal: totals.subtotal,
          total: totals.total,
          items: {
            create: data.items.map((item) => ({
              productId: item.productId,
              quantity: item.quantity,
              unitCost: item.unitCost,
              total: item.quantity * item.unitCost,
            })),
          },
        },
        include: { items: true },
      });
    });

    res.status(201).json(purchaseOrder);
  }),
);

router.post(
  "/:id/receive",
  asyncHandler(async (req, res) => {
    const { installments, firstDueDate } = receivePurchaseSchema.parse(req.body);
    const companyId = req.user!.companyId;

    const purchaseOrder = await prisma.$transaction(async (tx) => {
      const existing = await tx.purchaseOrder.findFirst({
        where: { id: req.params.id, companyId },
        include: { items: true },
      });
      if (!existing) throw new AppError("Pedido de compra nao encontrado", 404);
      if (existing.status !== PurchaseOrderStatus.PENDENTE) {
        throw new AppError("Este pedido ja foi recebido ou cancelado", 422);
      }

      for (const item of existing.items) {
        const product = await tx.product.findFirstOrThrow({
          where: { id: item.productId, companyId },
        });
        const currentQty = Number(product.stockQuantity);
        const currentAvgCost = Number(product.averageCost);
        const incomingQty = Number(item.quantity);
        const incomingCost = Number(item.unitCost);

        const newQty = currentQty + incomingQty;
        const newAverageCost =
          newQty > 0
            ? (currentQty * currentAvgCost + incomingQty * incomingCost) / newQty
            : currentAvgCost;

        await tx.stockMovement.create({
          data: {
            productId: item.productId,
            userId: req.user!.sub,
            type: StockMovementType.ENTRADA,
            quantity: incomingQty,
            referenceType: "PURCHASE_ORDER",
            referenceId: existing.id,
          },
        });

        await tx.product.update({
          where: { id: item.productId },
          data: {
            stockQuantity: newQty,
            averageCost: newAverageCost,
            costPrice: incomingCost,
          },
        });
      }

      const installmentPlans = buildInstallments(
        Number(existing.total),
        installments,
        firstDueDate ?? new Date(),
      );

      await tx.financialTransaction.createMany({
        data: installmentPlans.map((plan) => ({
          companyId,
          type: FinancialType.PAGAR,
          status: FinancialStatus.PENDENTE,
          description: `Compra #${existing.number}${plan.installmentTotal > 1 ? ` (parcela ${plan.installmentNumber}/${plan.installmentTotal})` : ""}`,
          amount: plan.amount,
          dueDate: plan.dueDate,
          supplierId: existing.supplierId,
          purchaseOrderId: existing.id,
          installmentGroupId: plan.installmentGroupId,
          installmentNumber: plan.installmentNumber,
          installmentTotal: plan.installmentTotal,
        })),
      });

      return tx.purchaseOrder.update({
        where: { id: existing.id },
        data: { status: PurchaseOrderStatus.RECEBIDA },
        include: { items: true },
      });
    });

    res.json(purchaseOrder);
  }),
);

router.post(
  "/:id/cancel",
  asyncHandler(async (req, res) => {
    const companyId = req.user!.companyId;

    const purchaseOrder = await prisma.$transaction(async (tx) => {
      const existing = await tx.purchaseOrder.findFirst({ where: { id: req.params.id, companyId } });
      if (!existing) throw new AppError("Pedido de compra nao encontrado", 404);
      if (existing.status !== PurchaseOrderStatus.PENDENTE) {
        throw new AppError("Apenas pedidos pendentes podem ser cancelados", 422);
      }

      return tx.purchaseOrder.update({
        where: { id: existing.id },
        data: { status: PurchaseOrderStatus.CANCELADA },
      });
    });

    res.json(purchaseOrder);
  }),
);

export default router;
