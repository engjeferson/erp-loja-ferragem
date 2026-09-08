import { Router } from "express";
import { z } from "zod";
import { FinancialStatus, FinancialType, PaymentMethod, Prisma, Role } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { authenticate, authorize } from "../../middlewares/auth";
import { AppError } from "../../utils/AppError";

type Tx = Prisma.TransactionClient;

const router = Router();
/// Financeiro (contas a pagar/receber, custos) e restrito a
/// ADMIN/GERENTE/FINANCEIRO - VENDEDOR nao enxerga esse modulo.
router.use(authenticate, authorize(Role.ADMIN, Role.GERENTE, Role.FINANCEIRO));

const paymentSchema = z.object({
  amount: z.number().positive(),
  paymentMethod: z.nativeEnum(PaymentMethod).optional(),
  notes: z.string().optional(),
});

/**
 * Aplica um recebimento/pagamento parcial ou total a uma FinancialTransaction:
 * grava o FinancialPayment (nunca apagado, mesmo apos quitar) e atualiza
 * paidAmount/status na mesma transacao. E a base do "Caderno" - uma venda de
 * R$1000 pode passar por aqui duas vezes (R$300, depois R$500) antes de
 * virar PAGO.
 */
export async function applyPayment(
  tx: Tx,
  transactionId: string,
  companyId: string,
  amount: number,
  paymentMethod: PaymentMethod | undefined,
  userId: string | undefined,
  notes: string | undefined,
) {
  const transaction = await tx.financialTransaction.findFirst({ where: { id: transactionId, companyId } });
  if (!transaction) throw new AppError("Lancamento nao encontrado", 404);
  if (transaction.status === FinancialStatus.PAGO || transaction.status === FinancialStatus.CANCELADO) {
    throw new AppError("Este lancamento ja esta quitado ou cancelado", 422);
  }

  const saldo = Number(transaction.amount) - Number(transaction.paidAmount);
  if (amount > saldo + 0.005) {
    throw new AppError(`O valor informado (${amount}) e maior que o saldo devido (${saldo.toFixed(2)})`, 422);
  }

  await tx.financialPayment.create({
    data: { companyId, transactionId, amount, paymentMethod, userId, notes },
  });

  const newPaidAmount = Number(transaction.paidAmount) + amount;
  const isFullyPaid = newPaidAmount >= Number(transaction.amount) - 0.005;

  return tx.financialTransaction.update({
    where: { id: transaction.id },
    data: {
      paidAmount: newPaidAmount,
      status: isFullyPaid ? FinancialStatus.PAGO : FinancialStatus.PARCIALMENTE_PAGO,
      paidAt: isFullyPaid ? new Date() : transaction.paidAt,
    },
  });
}

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

/** Adds a computed `overdue` flag (without persisting a VENCIDO status, so
 * it never drifts out of sync with the current date) and `saldo` (quanto
 * ainda falta pagar/receber, considerando pagamentos parciais ja aplicados). */
function withOverdueFlag<T extends { status: FinancialStatus; dueDate: Date; amount: unknown; paidAmount: unknown }>(
  transaction: T,
) {
  const stillOpen =
    transaction.status === FinancialStatus.PENDENTE || transaction.status === FinancialStatus.PARCIALMENTE_PAGO;
  return {
    ...transaction,
    saldo: Number(transaction.amount) - Number(transaction.paidAmount),
    overdue: stillOpen && transaction.dueDate < new Date(),
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
      include: { category: true, supplier: true, customer: true, payments: true },
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

const settleSchema = z.object({ paymentMethod: z.nativeEnum(PaymentMethod).optional() });

/** Baixa rapida: quita o saldo inteiro de uma vez (equivalente a um
 * pagamento cujo valor e o saldo devido). */
router.post(
  "/transactions/:id/settle",
  asyncHandler(async (req, res) => {
    const { paymentMethod } = settleSchema.parse(req.body ?? {});
    const companyId = req.user!.companyId;

    const updated = await prisma.$transaction(async (tx) => {
      const transaction = await tx.financialTransaction.findFirst({
        where: { id: req.params.id, companyId },
      });
      if (!transaction) throw new AppError("Lancamento nao encontrado", 404);

      const saldo = Number(transaction.amount) - Number(transaction.paidAmount);
      return applyPayment(tx, transaction.id, companyId, saldo, paymentMethod, req.user!.sub, undefined);
    });

    res.json(withOverdueFlag(updated));
  }),
);

/** Recebimento/pagamento parcial - grava o historico em FinancialPayment e
 * atualiza o saldo, sem exigir quitar tudo de uma vez (base do Caderno). */
router.post(
  "/transactions/:id/payments",
  asyncHandler(async (req, res) => {
    const { amount, paymentMethod, notes } = paymentSchema.parse(req.body);
    const companyId = req.user!.companyId;

    const updated = await prisma.$transaction((tx) =>
      applyPayment(tx, req.params.id, companyId, amount, paymentMethod, req.user!.sub, notes),
    );

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

    const openStatuses: FinancialStatus[] = [FinancialStatus.PENDENTE, FinancialStatus.PARCIALMENTE_PAGO];

    /** Soma o saldo (amount - paidAmount) das transacoes em aberto que
     * casam com o filtro extra informado (ex: vencidas). */
    async function sumOpenBalance(type: FinancialType, extraWhere: Prisma.FinancialTransactionWhereInput = {}) {
      const rows = await prisma.financialTransaction.findMany({
        where: { companyId, type, status: { in: openStatuses }, ...extraWhere },
        select: { amount: true, paidAmount: true },
      });
      return rows.reduce((sum, row) => sum + (Number(row.amount) - Number(row.paidAmount)), 0);
    }

    const [pendingReceivable, pendingPayable, overdueReceivable, overduePayable] = await Promise.all([
      sumOpenBalance(FinancialType.RECEBER),
      sumOpenBalance(FinancialType.PAGAR),
      sumOpenBalance(FinancialType.RECEBER, { dueDate: { lt: now } }),
      sumOpenBalance(FinancialType.PAGAR, { dueDate: { lt: now } }),
    ]);

    res.json({ pendingReceivable, pendingPayable, overdueReceivable, overduePayable });
  }),
);

export default router;
