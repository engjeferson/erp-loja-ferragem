import { Router } from "express";
import { z } from "zod";
import {
  DiscountType,
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

const deliverySchema = z
  .object({
    scheduledDate: z.coerce.date().optional(),
    cep: z.string().optional(),
    endereco: z.string().optional(),
    numero: z.string().optional(),
    complemento: z.string().optional(),
    bairro: z.string().optional(),
    cidade: z.string().optional(),
    uf: z.string().optional(),
    notes: z.string().optional(),
  })
  .nullable()
  .optional();

const createSaleSchema = z.object({
  customerId: z.string().uuid().optional(),
  notes: z.string().optional(),
  freight: z.number().nonnegative().default(0),
  additionalDiscountType: z.nativeEnum(DiscountType).default(DiscountType.VALOR),
  additionalDiscountValue: z.number().nonnegative().default(0),
  delivery: deliverySchema,
  items: z.array(saleItemSchema).min(1),
});

const confirmSaleSchema = z.object({
  paymentMethod: z.nativeEnum(PaymentMethod),
  installments: z.number().int().min(1).max(24).default(1),
  firstDueDate: z.coerce.date().optional(),
});

/**
 * TOTAL = SUBTOTAL - (desconto dos itens + desconto adicional) + FRETE.
 * O desconto adicional (campo "Desconto" do fechamento) pode ser em R$ ou %
 * sobre o subtotal - unica formula usada tanto na criacao quanto na edicao
 * do orcamento/venda, pra nunca divergir entre as duas rotas.
 */
function calculateTotals(
  items: z.infer<typeof saleItemSchema>[],
  freight: number,
  additionalDiscountType: DiscountType,
  additionalDiscountValue: number,
) {
  const subtotal = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  const itemsDiscount = items.reduce((sum, item) => sum + item.discount, 0);
  const additionalDiscountAmount =
    additionalDiscountType === DiscountType.PERCENTUAL
      ? subtotal * (additionalDiscountValue / 100)
      : additionalDiscountValue;
  const discount = itemsDiscount + additionalDiscountAmount;

  if (discount > subtotal) {
    throw new AppError("O desconto nao pode ser maior que o subtotal", 422);
  }

  const total = subtotal - discount + freight;
  return { subtotal, discount, total };
}

/** Cria, atualiza ou remove a Delivery de uma venda/orcamento conforme o
 * campo `delivery` enviado (null = "desmarcar entrega"). */
async function upsertDelivery(
  tx: Tx,
  companyId: string,
  saleId: string,
  customerId: string | undefined,
  delivery: z.infer<typeof deliverySchema>,
) {
  if (delivery === undefined) return;

  if (delivery === null) {
    await tx.delivery.deleteMany({ where: { saleId } });
    return;
  }

  await tx.delivery.upsert({
    where: { saleId },
    create: { companyId, saleId, customerId, ...delivery },
    update: { customerId, ...delivery },
  });
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
      include: { customer: true, user: { select: { name: true } }, delivery: true },
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
        delivery: true,
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
    const totals = calculateTotals(
      data.items,
      data.freight,
      data.additionalDiscountType,
      data.additionalDiscountValue,
    );
    const companyId = req.user!.companyId;

    const sale = await prisma.$transaction(async (tx) => {
      await assertBelongToCompany(
        tx,
        companyId,
        data.items.map((item) => item.productId),
        data.customerId,
      );

      const created = await tx.sale.create({
        data: {
          companyId,
          number: await nextSaleNumber(tx, companyId),
          customerId: data.customerId,
          userId: req.user!.sub,
          notes: data.notes,
          freight: data.freight,
          additionalDiscountType: data.additionalDiscountType,
          additionalDiscountValue: data.additionalDiscountValue,
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

      await upsertDelivery(tx, companyId, created.id, data.customerId, data.delivery);
      return created;
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
      const existing = await tx.sale.findFirst({
        where: { id: req.params.id, companyId },
        include: { items: true },
      });
      if (!existing) throw new AppError("Venda nao encontrada", 404);
      if (existing.status !== SaleStatus.ORCAMENTO) {
        throw new AppError("Apenas orcamentos podem ser editados", 422);
      }

      const customerId = data.customerId ?? existing.customerId ?? undefined;
      const freight = data.freight ?? Number(existing.freight);
      const additionalDiscountType = data.additionalDiscountType ?? existing.additionalDiscountType;
      const additionalDiscountValue = data.additionalDiscountValue ?? Number(existing.additionalDiscountValue);

      let updated;
      if (data.items) {
        await assertBelongToCompany(
          tx,
          companyId,
          data.items.map((item) => item.productId),
          data.customerId,
        );

        const totals = calculateTotals(data.items, freight, additionalDiscountType, additionalDiscountValue);
        await tx.saleItem.deleteMany({ where: { saleId: existing.id } });
        updated = await tx.sale.update({
          where: { id: existing.id },
          data: {
            customerId: data.customerId,
            notes: data.notes,
            freight,
            additionalDiscountType,
            additionalDiscountValue,
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
      } else {
        if (data.customerId) {
          await assertBelongToCompany(tx, companyId, [], data.customerId);
        }

        const existingItems = existing.items.map((item) => ({
          productId: item.productId,
          quantity: Number(item.quantity),
          unitPrice: Number(item.unitPrice),
          discount: Number(item.discount),
        }));
        const totals = calculateTotals(existingItems, freight, additionalDiscountType, additionalDiscountValue);

        updated = await tx.sale.update({
          where: { id: existing.id },
          data: {
            customerId: data.customerId,
            notes: data.notes,
            freight,
            additionalDiscountType,
            additionalDiscountValue,
            discount: totals.discount,
            total: totals.total,
          },
          include: { items: true },
        });
      }

      await upsertDelivery(tx, companyId, existing.id, customerId, data.delivery);
      return updated;
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

      if (paymentMethod === PaymentMethod.CADERNO && !existing.customerId) {
        throw new AppError("Venda no Caderno exige um cliente identificado", 422);
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
