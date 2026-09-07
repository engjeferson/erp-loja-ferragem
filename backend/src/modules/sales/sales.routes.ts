import { Router } from "express";
import { z } from "zod";
import {
  FinancialStatus,
  FinancialType,
  Prisma,
  PaymentMethod,
  SaleStatus,
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

const saleItemSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().positive(),
  unitPrice: z.number().nonnegative(),
  discount: z.number().nonnegative().default(0),
});

const createSaleSchema = z.object({
  customerId: z.string().uuid().optional(),
  notes: z.string().optional(),
  items: z.array(saleItemSchema).min(1),
});

const confirmSaleSchema = z.object({
  paymentMethod: z.nativeEnum(PaymentMethod),
  installments: z.number().int().min(1).max(24).default(1),
  firstDueDate: z.coerce.date().optional(),
});

function calculateTotals(items: z.infer<typeof saleItemSchema>[]) {
  const subtotal = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  const discount = items.reduce((sum, item) => sum + item.discount, 0);
  return { subtotal, discount, total: subtotal - discount };
}

/** Guards against a request smuggling in a productId/customerId that
 * belongs to a different company - ids are opaque UUIDs, so without this
 * check one tenant could reference (and leak data about) another's rows. */
async function assertBelongToCompany(
  tx: Tx,
  companyId: string,
  productIds: string[],
  customerId?: string,
) {
  const uniqueProductIds = [...new Set(productIds)];
  const ownedProducts = await tx.product.count({
    where: { id: { in: uniqueProductIds }, companyId },
  });
  if (ownedProducts !== uniqueProductIds.length) {
    throw new AppError("Um ou mais produtos informados nao pertencem a esta empresa", 422);
  }

  if (customerId) {
    const customer = await tx.customer.findFirst({ where: { id: customerId, companyId } });
    if (!customer) throw new AppError("Cliente informado nao pertence a esta empresa", 422);
  }
}

async function nextSaleNumber(tx: Tx, companyId: string): Promise<number> {
  const result = await tx.sale.aggregate({ where: { companyId }, _max: { number: true } });
  return (result._max.number ?? 0) + 1;
}

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { status } = req.query;
    const sales = await prisma.sale.findMany({
      where: {
        companyId: req.user!.companyId,
        ...(status ? { status: status as SaleStatus } : {}),
      },
      include: { customer: true, user: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    });
    res.json(sales);
  }),
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const sale = await prisma.sale.findFirst({
      where: { id: req.params.id, companyId: req.user!.companyId },
      include: {
        customer: true,
        user: { select: { name: true } },
        items: { include: { product: true } },
        financialTransactions: true,
      },
    });
    if (!sale) throw new AppError("Venda nao encontrada", 404);
    res.json(sale);
  }),
);

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const data = createSaleSchema.parse(req.body);
    const totals = calculateTotals(data.items);
    const companyId = req.user!.companyId;

    const sale = await prisma.$transaction(async (tx) => {
      await assertBelongToCompany(
        tx,
        companyId,
        data.items.map((item) => item.productId),
        data.customerId,
      );

      return tx.sale.create({
        data: {
          companyId,
          number: await nextSaleNumber(tx, companyId),
          customerId: data.customerId,
          userId: req.user!.sub,
          notes: data.notes,
          subtotal: totals.subtotal,
          discount: totals.discount,
          total: totals.total,
          items: {
            create: data.items.map((item) => ({
              productId: item.productId,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              discount: item.discount,
              total: item.quantity * item.unitPrice - item.discount,
            })),
          },
        },
        include: { items: true },
      });
    });

    res.status(201).json(sale);
  }),
);

router.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const data = createSaleSchema.partial().parse(req.body);
    const companyId = req.user!.companyId;

    const sale = await prisma.$transaction(async (tx) => {
      const existing = await tx.sale.findFirst({ where: { id: req.params.id, companyId } });
      if (!existing) throw new AppError("Venda nao encontrada", 404);
      if (existing.status !== SaleStatus.ORCAMENTO) {
        throw new AppError("Apenas orcamentos podem ser editados", 422);
      }

      if (data.items) {
        await assertBelongToCompany(
          tx,
          companyId,
          data.items.map((item) => item.productId),
          data.customerId,
        );

        const totals = calculateTotals(data.items);
        await tx.saleItem.deleteMany({ where: { saleId: existing.id } });
        return tx.sale.update({
          where: { id: existing.id },
          data: {
            customerId: data.customerId,
            notes: data.notes,
            subtotal: totals.subtotal,
            discount: totals.discount,
            total: totals.total,
            items: {
              create: data.items.map((item) => ({
                productId: item.productId,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                discount: item.discount,
                total: item.quantity * item.unitPrice - item.discount,
              })),
            },
          },
          include: { items: true },
        });
      }

      if (data.customerId) {
        await assertBelongToCompany(tx, companyId, [], data.customerId);
      }

      return tx.sale.update({
        where: { id: existing.id },
        data: { customerId: data.customerId, notes: data.notes },
        include: { items: true },
      });
    });

    res.json(sale);
  }),
);

router.post(
  "/:id/confirm",
  asyncHandler(async (req, res) => {
    const { paymentMethod, installments, firstDueDate } = confirmSaleSchema.parse(req.body);
    const companyId = req.user!.companyId;

    const sale = await prisma.$transaction(async (tx) => {
      const existing = await tx.sale.findFirst({
        where: { id: req.params.id, companyId },
        include: { items: true },
      });
      if (!existing) throw new AppError("Venda nao encontrada", 404);
      if (existing.status !== SaleStatus.ORCAMENTO) {
        throw new AppError("Esta venda ja foi confirmada ou cancelada", 422);
      }

      for (const item of existing.items) {
        const product = await tx.product.findFirstOrThrow({
          where: { id: item.productId, companyId },
        });
        const currentStock = Number(product.stockQuantity);
        const quantity = Number(item.quantity);

        if (currentStock < quantity) {
          throw new AppError(
            `Estoque insuficiente para o produto "${product.name}" (disponivel: ${currentStock})`,
            422,
          );
        }

        await tx.stockMovement.create({
          data: {
            productId: item.productId,
            userId: req.user!.sub,
            type: StockMovementType.SAIDA,
            quantity,
            referenceType: "SALE",
            referenceId: existing.id,
          },
        });

        await tx.product.update({
          where: { id: item.productId },
          data: { stockQuantity: currentStock - quantity },
        });
      }

      const isInstantPayment =
        paymentMethod === PaymentMethod.DINHEIRO ||
        paymentMethod === PaymentMethod.PIX ||
        paymentMethod === PaymentMethod.CARTAO_DEBITO;

      const installmentPlans = buildInstallments(
        Number(existing.total),
        isInstantPayment ? 1 : installments,
        firstDueDate ?? new Date(),
      );

      await tx.financialTransaction.createMany({
        data: installmentPlans.map((plan) => ({
          companyId,
          type: FinancialType.RECEBER,
          status: isInstantPayment ? FinancialStatus.PAGO : FinancialStatus.PENDENTE,
          description: `Venda #${existing.number}${plan.installmentTotal > 1 ? ` (parcela ${plan.installmentNumber}/${plan.installmentTotal})` : ""}`,
          amount: plan.amount,
          dueDate: plan.dueDate,
          paidAt: isInstantPayment ? new Date() : null,
          customerId: existing.customerId,
          saleId: existing.id,
          installmentGroupId: plan.installmentGroupId,
          installmentNumber: plan.installmentNumber,
          installmentTotal: plan.installmentTotal,
        })),
      });

      return tx.sale.update({
        where: { id: existing.id },
        data: { status: SaleStatus.CONFIRMADA, paymentMethod },
        include: { items: true },
      });
    });

    res.json(sale);
  }),
);

router.post(
  "/:id/cancel",
  asyncHandler(async (req, res) => {
    const companyId = req.user!.companyId;

    const sale = await prisma.$transaction(async (tx) => {
      const existing = await tx.sale.findFirst({
        where: { id: req.params.id, companyId },
        include: { items: true },
      });
      if (!existing) throw new AppError("Venda nao encontrada", 404);
      if (existing.status === SaleStatus.CANCELADA) {
        throw new AppError("Venda ja esta cancelada", 422);
      }

      if (existing.status === SaleStatus.CONFIRMADA) {
        for (const item of existing.items) {
          await tx.stockMovement.create({
            data: {
              productId: item.productId,
              userId: req.user!.sub,
              type: StockMovementType.ENTRADA,
              quantity: item.quantity,
              reason: "Estorno por cancelamento de venda",
              referenceType: "SALE",
              referenceId: existing.id,
            },
          });

          await tx.product.update({
            where: { id: item.productId },
            data: { stockQuantity: { increment: item.quantity } },
          });
        }

        await tx.financialTransaction.updateMany({
          where: { saleId: existing.id, status: FinancialStatus.PENDENTE },
          data: { status: FinancialStatus.CANCELADO },
        });
      }

      return tx.sale.update({
        where: { id: existing.id },
        data: { status: SaleStatus.CANCELADA },
      });
    });

    res.json(sale);
  }),
);

export default router;
