import { randomUUID } from "crypto";
import {
  FinancialStatus,
  FinancialType,
  NfeImport,
  NfeImportStatus,
  Prisma,
  PurchaseOrderStatus,
  StockMovementType,
} from "@prisma/client";
import { prisma } from "../config/prisma";
import { AppError } from "../utils/AppError";
import { NfeCompleta, ItemNfe } from "./nfeSefaz";

type Tx = Prisma.TransactionClient;

async function findOrCreateSupplier(tx: Tx, cnpj: string, nome: string) {
  const existing = await tx.supplier.findUnique({ where: { document: cnpj } });
  if (existing) return existing;
  return tx.supplier.create({ data: { name: nome, document: cnpj } });
}

async function findOrCreateUnit(tx: Tx, rawAbbreviation: string) {
  const abbreviation = rawAbbreviation.trim().toUpperCase().slice(0, 10) || "UN";
  const existing = await tx.unit.findFirst({
    where: { abbreviation: { equals: abbreviation, mode: "insensitive" } },
  });
  if (existing) return existing;
  return tx.unit.create({ data: { name: abbreviation, abbreviation } });
}

async function generateUniqueSku(tx: Tx, productCode: string): Promise<string> {
  const cleaned = productCode.replace(/\s+/g, "").slice(0, 30) || "ITEM";
  let candidate = `NFE-${cleaned}`;
  let suffix = 0;

  while (await tx.product.findUnique({ where: { sku: candidate } })) {
    suffix += 1;
    candidate = `NFE-${cleaned}-${suffix}`;
  }

  return candidate;
}

async function findOrCreateProduct(tx: Tx, item: ItemNfe, unitId: string) {
  const name = item.descricao.trim();
  const existing = await tx.product.findFirst({
    where: { name: { equals: name, mode: "insensitive" } },
  });
  if (existing) return existing;

  const sku = await generateUniqueSku(tx, item.codigoProduto);
  return tx.product.create({
    data: {
      sku,
      name,
      unitId,
      costPrice: item.valorUnitarioComercial,
      salePrice: item.valorUnitarioComercial,
      needsReview: true,
    },
  });
}

export interface ImportOutcome {
  status: NfeImportStatus;
  errorMessage?: string;
}

/**
 * Step 1 of the radar: just records that a NF-e exists, with everything
 * needed to launch it into stock later (rawData), but touches nothing else.
 * Nothing is committed to stock/financial until a person authorizes it
 * (see authorizeImport) - the radar only discovers and lists, it never
 * decides on its own.
 */
export async function recordPendingImport(nfe: NfeCompleta, nsu: string): Promise<NfeImport> {
  const existing = await prisma.nfeImport.findUnique({ where: { chaveAcesso: nfe.chaveAcesso } });
  if (existing) return existing;

  return prisma.nfeImport.create({
    data: {
      chaveAcesso: nfe.chaveAcesso,
      nsu,
      emitenteCnpj: nfe.emitenteCnpj,
      emitenteNome: nfe.emitenteNome,
      valorTotal: nfe.valorTotal,
      dataEmissao: nfe.dataEmissao,
      status: NfeImportStatus.PENDENTE,
      rawData: nfe as unknown as Prisma.InputJsonValue,
    },
  });
}

/**
 * Records that the radar found a key but could not download the full
 * document (network hiccup, SEFAZ error, unexpected schema). Kept as an
 * audit trail entry with no rawData - there is nothing to authorize.
 */
export async function recordFetchFailure(
  chaveAcesso: string,
  nsu: string,
  errorMessage: string,
): Promise<NfeImport | null> {
  const existing = await prisma.nfeImport.findUnique({ where: { chaveAcesso } });
  if (existing) return existing;

  try {
    return await prisma.nfeImport.create({
      data: {
        chaveAcesso,
        nsu,
        emitenteCnpj: "",
        emitenteNome: "(nao foi possivel obter os dados da nota)",
        valorTotal: 0,
        dataEmissao: new Date(),
        status: NfeImportStatus.ERRO,
        errorMessage,
      },
    });
  } catch {
    return null;
  }
}

function applyInstallments(nfe: NfeCompleta) {
  return nfe.duplicatas.length > 0
    ? nfe.duplicatas.map((duplicata, index) => ({
        amount: duplicata.valor,
        dueDate: new Date(duplicata.vencimento),
        installmentNumber: index + 1,
        installmentTotal: nfe.duplicatas.length,
      }))
    : [
        {
          amount: nfe.valorTotal,
          dueDate: nfe.dataEmissao,
          installmentNumber: 1,
          installmentTotal: 1,
        },
      ];
}

/**
 * Step 2 of the radar: a person reviewed the pending NfeImport and decided
 * to authorize it. Only now do stock, purchase order and financial records
 * get created - atomically, and atomically with the NfeImport row flipping
 * to IMPORTADA, so a crash mid-way never leaves it re-authorizable.
 */
export async function authorizeImport(nfeImportId: string, userId: string): Promise<ImportOutcome> {
  const pending = await prisma.nfeImport.findUnique({ where: { id: nfeImportId } });
  if (!pending) throw new AppError("Nota nao encontrada", 404);
  if (pending.status !== NfeImportStatus.PENDENTE) {
    throw new AppError("Esta nota ja foi autorizada, rejeitada ou nao pode ser processada", 422);
  }
  if (!pending.rawData) {
    throw new AppError("Esta nota nao tem os dados completos - nao e possivel autorizar", 422);
  }

  const nfe = pending.rawData as unknown as NfeCompleta;
  nfe.dataEmissao = new Date(nfe.dataEmissao);

  try {
    await prisma.$transaction(async (tx) => {
      const supplier = await findOrCreateSupplier(tx, nfe.emitenteCnpj, nfe.emitenteNome);

      const purchaseOrder = await tx.purchaseOrder.create({
        data: {
          supplierId: supplier.id,
          userId,
          status: PurchaseOrderStatus.RECEBIDA,
          subtotal: nfe.valorTotal,
          total: nfe.valorTotal,
          notes: `Importado via radar de NF-e, autorizado manualmente (chave ${nfe.chaveAcesso})`,
        },
      });

      for (const item of nfe.itens) {
        const unit = await findOrCreateUnit(tx, item.unidadeComercial);
        const product = await findOrCreateProduct(tx, item, unit.id);

        await tx.purchaseOrderItem.create({
          data: {
            purchaseOrderId: purchaseOrder.id,
            productId: product.id,
            quantity: item.quantidadeComercial,
            unitCost: item.valorUnitarioComercial,
            total: item.valorTotal,
          },
        });

        const currentQty = Number(product.stockQuantity);
        const currentAvgCost = Number(product.averageCost);
        const newQty = currentQty + item.quantidadeComercial;
        const newAverageCost =
          newQty > 0
            ? (currentQty * currentAvgCost + item.quantidadeComercial * item.valorUnitarioComercial) / newQty
            : currentAvgCost;

        await tx.stockMovement.create({
          data: {
            productId: product.id,
            userId,
            type: StockMovementType.ENTRADA,
            quantity: item.quantidadeComercial,
            referenceType: "NFE_RADAR",
            referenceId: purchaseOrder.id,
          },
        });

        await tx.product.update({
          where: { id: product.id },
          data: {
            stockQuantity: newQty,
            averageCost: newAverageCost,
            costPrice: item.valorUnitarioComercial,
          },
        });
      }

      const installmentsSource = applyInstallments(nfe);
      const installmentGroupId = installmentsSource.length > 1 ? randomUUID() : null;

      await tx.financialTransaction.createMany({
        data: installmentsSource.map((installment) => ({
          type: FinancialType.PAGAR,
          status: FinancialStatus.PENDENTE,
          description: `NF-e ${nfe.numero} - ${nfe.emitenteNome}${
            installment.installmentTotal > 1
              ? ` (parcela ${installment.installmentNumber}/${installment.installmentTotal})`
              : ""
          }`,
          amount: installment.amount,
          dueDate: installment.dueDate,
          supplierId: supplier.id,
          purchaseOrderId: purchaseOrder.id,
          installmentGroupId,
          installmentNumber: installment.installmentNumber,
          installmentTotal: installment.installmentTotal,
        })),
      });

      await tx.nfeImport.update({
        where: { id: pending.id },
        data: {
          status: NfeImportStatus.IMPORTADA,
          supplierId: supplier.id,
          purchaseOrderId: purchaseOrder.id,
          errorMessage: null,
          reviewedByUserId: userId,
          reviewedAt: new Date(),
        },
      });
    });

    return { status: NfeImportStatus.IMPORTADA };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro desconhecido ao importar a NF-e";

    await prisma.nfeImport.update({
      where: { id: pending.id },
      data: {
        status: NfeImportStatus.ERRO,
        errorMessage: message,
        reviewedByUserId: userId,
        reviewedAt: new Date(),
      },
    });

    return { status: NfeImportStatus.ERRO, errorMessage: message };
  }
}

/** A person reviewed the pending NfeImport and decided not to launch it. */
export async function rejectImport(nfeImportId: string, userId: string): Promise<void> {
  const pending = await prisma.nfeImport.findUnique({ where: { id: nfeImportId } });
  if (!pending) throw new AppError("Nota nao encontrada", 404);
  if (pending.status !== NfeImportStatus.PENDENTE) {
    throw new AppError("Esta nota ja foi autorizada, rejeitada ou nao pode ser processada", 422);
  }

  await prisma.nfeImport.update({
    where: { id: pending.id },
    data: {
      status: NfeImportStatus.REJEITADA,
      reviewedByUserId: userId,
      reviewedAt: new Date(),
    },
  });
}
