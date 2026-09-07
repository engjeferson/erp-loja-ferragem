import { Router } from "express";
import { z } from "zod";
import { FinancialStatus, FinancialType } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { authenticate } from "../../middlewares/auth";
import { AppError } from "../../utils/AppError";

const router = Router();
router.use(authenticate);

const categorySchema = z.object({
  name: z.string().min(2),
  type: z.nativeEnum(FinancialType),
});

const createTransactionSchema = z.object({
  type: z.nativeEnum(FinancialType),
  categoryId: z.string().uuid().optional(),
  description: z.string().min(2),
  amount: z.number().positive(),
  dueDate: z.coerce.date(),
  counterpartyName: z.string().optional(),
  supplierId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
  notes: z.string().optional(),
});

/** Adds a computed `overdue` flag without persisting a VENCIDO status,
 * so it can never drift out of sync with the current date. */
function withOverdueFlag<T extends { status: FinancialStatus; dueDate: Date }>(transaction: T) {
  return {
    ...transaction,
    overdue: transaction.status === FinancialStatus.PENDENTE && transaction.dueDate < new Date(),
  };
}

router.get(
  "/categories",
  asyncHandler(async (req, res) => {
    const categories = await prisma.financialCategory.findMany({
      where: { companyId: req.user!.companyId },
      orderBy: { name: "asc" },
    });
    res.json(categories);
  }),
);

router.post(
  "/categories",
  asyncHandler(async (req, res) => {
    const data = categorySchema.parse(req.body);
    const category = await prisma.financialCategory.create({
      data: { ...data, companyId: req.user!.companyId },
    });
    res.status(201).json(category);
  }),
);

router.get(
  "/transactions",
  asyncHandler(async (req, res) => {
    const { type, status, from, to } = req.query;

    const transactions = await prisma.financialTransaction.findMany({
      where: {
        companyId: req.user!.companyId,
        type: type ? (type as FinancialType) : undefined,
        status: status ? (status as FinancialStatus) : undefined,
        dueDate: {
          gte: from ? new Date(String(from)) : undefined,
          lte: to ? new Date(String(to)) : undefined,
        },
      },
      include: { category: true, supplier: true, customer: true },
      orderBy: { dueDate: "asc" },
    });

    res.json(transactions.map(withOverdueFlag));
  }),
);

router.post(
  "/transactions",
  asyncHandler(async (req, res) => {
    const data = createTransactionSchema.parse(req.body);
    const companyId = req.user!.companyId;

    if (data.categoryId) {
      const category = await prisma.financialCategory.findFirst({
        where: { id: data.categoryId, companyId },
      });
      if (!category) throw new AppError("Categoria informada nao pertence a esta empresa", 422);
    }
    if (data.supplierId) {
      const supplier = await prisma.supplier.findFirst({ where: { id: data.supplierId, companyId } });
      if (!supplier) throw new AppError("Fornecedor informado nao pertence a esta empresa", 422);
    }
    if (data.customerId) {
      const customer = await prisma.customer.findFirst({ where: { id: data.customerId, companyId } });
      if (!customer) throw new AppError("Cliente informado nao pertence a esta empresa", 422);
    }

    const transaction = await prisma.financialTransaction.create({ data: { ...data, companyId } });
    res.status(201).json(withOverdueFlag(transaction));
  }),
);

router.post(
  "/transactions/:id/settle",
  asyncHandler(async (req, res) => {
    const transaction = await prisma.financialTransaction.findFirst({
      where: { id: req.params.id, companyId: req.user!.companyId },
    });
    if (!transaction) throw new AppError("Lancamento nao encontrado", 404);
    if (transaction.status !== FinancialStatus.PENDENTE) {
      throw new AppError("Apenas lancamentos pendentes podem ser baixados", 422);
    }

    const updated = await prisma.financialTransaction.update({
      where: { id: transaction.id },
      data: { status: FinancialStatus.PAGO, paidAt: new Date() },
    });

    res.json(withOverdueFlag(updated));
  }),
);

router.post(
  "/transactions/:id/cancel",
  asyncHandler(async (req, res) => {
    const transaction = await prisma.financialTransaction.findFirst({
      where: { id: req.params.id, companyId: req.user!.companyId },
    });
    if (!transaction) throw new AppError("Lancamento nao encontrado", 404);
    if (transaction.status !== FinancialStatus.PENDENTE) {
      throw new AppError("Apenas lancamentos pendentes podem ser cancelados", 422);
    }

    const updated = await prisma.financialTransaction.update({
      where: { id: transaction.id },
      data: { status: FinancialStatus.CANCELADO },
    });

    res.json(withOverdueFlag(updated));
  }),
);

router.get(
  "/summary",
  asyncHandler(async (req, res) => {
    const companyId = req.user!.companyId;
    const now = new Date();

    const [pendingReceivable, pendingPayable, overdueReceivable, overduePayable] =
      await Promise.all([
        prisma.financialTransaction.aggregate({
          where: { companyId, type: FinancialType.RECEBER, status: FinancialStatus.PENDENTE },
          _sum: { amount: true },
        }),
        prisma.financialTransaction.aggregate({
          where: { companyId, type: FinancialType.PAGAR, status: FinancialStatus.PENDENTE },
          _sum: { amount: true },
        }),
        prisma.financialTransaction.aggregate({
          where: {
            companyId,
            type: FinancialType.RECEBER,
            status: FinancialStatus.PENDENTE,
            dueDate: { lt: now },
          },
          _sum: { amount: true },
        }),
        prisma.financialTransaction.aggregate({
          where: {
            companyId,
            type: FinancialType.PAGAR,
            status: FinancialStatus.PENDENTE,
            dueDate: { lt: now },
          },
          _sum: { amount: true },
        }),
      ]);

    res.json({
      pendingReceivable: pendingReceivable._sum.amount ?? 0,
      pendingPayable: pendingPayable._sum.amount ?? 0,
      overdueReceivable: overdueReceivable._sum.amount ?? 0,
      overduePayable: overduePayable._sum.amount ?? 0,
    });
  }),
);

export default router;
