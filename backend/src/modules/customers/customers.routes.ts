import { Router } from "express";
import { z } from "zod";
import { FinancialStatus, FinancialTransaction, PaymentMethod, Role } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { authenticate, authorize } from "../../middlewares/auth";
import { AppError } from "../../utils/AppError";
import { applyPayment } from "../financial/financial.routes";

const router = Router();
router.use(authenticate);

const receiveSchema = z.object({
  amount: z.number().positive(),
  paymentMethod: z.nativeEnum(PaymentMethod).optional(),
  notes: z.string().optional(),
  /** Distribuicao manual (sobrescreve o rateio automatico por mais antigo
   * primeiro) - cada entrada precisa ser <= saldo daquela transacao. */
  allocations: z.array(z.object({ transactionId: z.string().uuid(), amount: z.number().positive() })).optional(),
});

/** Rateia um valor entre transacoes em aberto, das mais antigas (por
 * vencimento) para as mais novas, sem estourar o saldo de nenhuma. */
function distributeAmount(
  transactions: Pick<FinancialTransaction, "id" | "amount" | "paidAmount" | "dueDate">[],
  amount: number,
) {
  const sorted = [...transactions].sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
  const allocations: { transactionId: string; amount: number }[] = [];
  let remaining = amount;

  for (const transaction of sorted) {
    if (remaining <= 0) break;
    const saldo = Number(transaction.amount) - Number(transaction.paidAmount);
    if (saldo <= 0) continue;
    const applied = Math.min(saldo, remaining);
    allocations.push({ transactionId: transaction.id, amount: Math.round(applied * 100) / 100 });
    remaining -= applied;
  }

  return { allocations, remaining: Math.round(remaining * 100) / 100 };
}

const customerSchema = z.object({
  name: z.string().min(2),
  nomeFantasia: z.string().optional(),
  document: z.string().optional(),
  phone: z.string().optional(),
  whatsapp: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  address: z.string().optional(),
  cep: z.string().optional(),
  numero: z.string().optional(),
  complemento: z.string().optional(),
  bairro: z.string().optional(),
  cidade: z.string().optional(),
  uf: z.string().optional(),
  observacoes: z.string().optional(),
});

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { search } = req.query;
    const companyId = req.user!.companyId;
    const customers = await prisma.customer.findMany({
      where: {
        companyId,
        ...(search
          ? {
              OR: [
                { name: { contains: String(search), mode: "insensitive" } },
                { document: { contains: String(search), mode: "insensitive" } },
              ],
            }
          : {}),
      },
      orderBy: { name: "asc" },
    });
    res.json(customers);
  }),
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const customer = await prisma.customer.findFirst({
      where: { id: req.params.id, companyId: req.user!.companyId },
    });
    if (!customer) throw new AppError("Cliente nao encontrado", 404);
    res.json(customer);
  }),
);

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const data = customerSchema.parse(req.body);
    const customer = await prisma.customer.create({
      data: { ...data, companyId: req.user!.companyId },
    });
    res.status(201).json(customer);
  }),
);

router.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const data = customerSchema.partial().parse(req.body);
    const existing = await prisma.customer.findFirst({
      where: { id: req.params.id, companyId: req.user!.companyId },
    });
    if (!existing) throw new AppError("Cliente nao encontrado", 404);

    const customer = await prisma.customer.update({ where: { id: existing.id }, data });
    res.json(customer);
  }),
);

/**
 * "Caderno" do cliente: todas as contas a receber ligadas a ele (nao so as
 * originadas como CADERNO - qualquer receber do cliente entra aqui), com
 * quanto ja foi recebido de cada uma (FinancialPayment) e o saldo total em
 * aberto. E a base da tela pedida na ficha do cliente.
 */
router.get(
  "/:id/caderno",
  asyncHandler(async (req, res) => {
    const companyId = req.user!.companyId;
    const customer = await prisma.customer.findFirst({ where: { id: req.params.id, companyId } });
    if (!customer) throw new AppError("Cliente nao encontrado", 404);

    const transactions = await prisma.financialTransaction.findMany({
      where: { companyId, customerId: customer.id, type: "RECEBER" },
      include: { sale: { select: { number: true } }, payments: { orderBy: { paidAt: "desc" } } },
      orderBy: { dueDate: "desc" },
    });

    const totalComprado = transactions.reduce((sum, t) => sum + Number(t.amount), 0);
    const totalRecebido = transactions.reduce((sum, t) => sum + Number(t.paidAmount), 0);

    res.json({
      totalComprado,
      totalRecebido,
      saldo: totalComprado - totalRecebido,
      transactions: transactions.map((t) => ({
        ...t,
        saldo: Number(t.amount) - Number(t.paidAmount),
      })),
    });
  }),
);

/**
 * Preview de como um recebimento seria distribuido entre as vendas em
 * aberto do cliente (mais antiga primeiro) - usado pra mostrar ao lojista
 * antes de confirmar (ele pode ajustar manualmente e so' entao chamar
 * POST /:id/caderno/receive com allocations).
 */
router.get(
  "/:id/caderno/receive-preview",
  asyncHandler(async (req, res) => {
    const companyId = req.user!.companyId;
    const amount = Number(req.query.amount);
    if (!amount || amount <= 0) throw new AppError("Informe um valor valido para simular", 422);

    const customer = await prisma.customer.findFirst({ where: { id: req.params.id, companyId } });
    if (!customer) throw new AppError("Cliente nao encontrado", 404);

    const openTransactions = await prisma.financialTransaction.findMany({
      where: {
        companyId,
        customerId: customer.id,
        type: "RECEBER",
        status: { in: [FinancialStatus.PENDENTE, FinancialStatus.PARCIALMENTE_PAGO] },
      },
    });

    res.json(distributeAmount(openTransactions, amount));
  }),
);

/**
 * Aplica um recebimento unico do cliente, distribuido entre as vendas em
 * aberto (mais antiga primeiro) ou conforme `allocations` informado
 * manualmente. Sobra (se o valor for maior que o saldo total) e reportada,
 * nao e aplicada em lugar nenhum.
 */
router.post(
  "/:id/caderno/receive",
  authorize(Role.ADMIN, Role.GERENTE, Role.FINANCEIRO),
  asyncHandler(async (req, res) => {
    const data = receiveSchema.parse(req.body);
    const companyId = req.user!.companyId;

    const result = await prisma.$transaction(async (tx) => {
      const customer = await tx.customer.findFirst({ where: { id: req.params.id, companyId } });
      if (!customer) throw new AppError("Cliente nao encontrado", 404);

      let allocations = data.allocations;
      if (!allocations) {
        const openTransactions = await tx.financialTransaction.findMany({
          where: {
            companyId,
            customerId: customer.id,
            type: "RECEBER",
            status: { in: [FinancialStatus.PENDENTE, FinancialStatus.PARCIALMENTE_PAGO] },
          },
        });
        allocations = distributeAmount(openTransactions, data.amount).allocations;
      } else {
        const totalManual = allocations.reduce((sum, a) => sum + a.amount, 0);
        if (totalManual > data.amount + 0.005) {
          throw new AppError("A soma das alocacoes e maior que o valor recebido", 422);
        }
        for (const allocation of allocations) {
          const transaction = await tx.financialTransaction.findFirst({
            where: { id: allocation.transactionId, companyId, customerId: customer.id },
          });
          if (!transaction) throw new AppError("Uma das vendas informadas nao pertence a este cliente", 422);
        }
      }

      for (const allocation of allocations) {
        await applyPayment(tx, allocation.transactionId, companyId, allocation.amount, data.paymentMethod, req.user!.sub, data.notes);
      }

      const appliedTotal = allocations.reduce((sum, a) => sum + a.amount, 0);
      return { allocations, appliedTotal, remaining: Math.round((data.amount - appliedTotal) * 100) / 100 };
    });

    res.json(result);
  }),
);

router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const existing = await prisma.customer.findFirst({
      where: { id: req.params.id, companyId: req.user!.companyId },
    });
    if (!existing) throw new AppError("Cliente nao encontrado", 404);

    await prisma.customer.delete({ where: { id: existing.id } });
    res.status(204).send();
  }),
);

export default router;
