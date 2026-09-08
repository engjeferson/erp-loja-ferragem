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
import { NfeCompleta } from "./nfeSefaz";

type Tx = Prisma.TransactionClient;

async function findOrCreateSupplier(tx: Tx, companyId: string, cnpj: string, nome: string) {
  const existing = await tx.supplier.findFirst({ where: { companyId, document: cnpj } });
  if (existing) return existing;
  return tx.supplier.create({ data: { companyId, name: nome, document: cnpj } });
}

async function findOrCreateUnit(tx: Tx, companyId: string, rawAbbreviation: string) {
  const abbreviation = rawAbbreviation.trim().toUpperCase().slice(0, 10) || "UN";
  const existing = await tx.unit.findFirst({
    where: { companyId, abbreviation: { equals: abbreviation, mode: "insensitive" } },
  });
  if (existing) return existing;
  return tx.unit.create({ data: { companyId, name: abbreviation, abbreviation } });
}

async function generateUniqueSku(tx: Tx, companyId: string, productCode: string): Promise<string> {
  const cleaned = productCode.replace(/\s+/g, "").slice(0, 30) || "ITEM";
  let candidate = `NFE-${cleaned}`;
  let suffix = 0;

  while (await tx.product.findFirst({ where: { companyId, sku: candidate } })) {
    suffix += 1;
    candidate = `NFE-${cleaned}-${suffix}`;
  }

  return candidate;
}

async function nextPurchaseOrderNumber(tx: Tx, companyId: string): Promise<number> {
  const result = await tx.purchaseOrder.aggregate({ where: { companyId }, _max: { number: true } });
  return (result._max.number ?? 0) + 1;
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
export async function recordPendingImport(
  companyId: string,
  nfe: NfeCompleta,
  nsu: string,
): Promise<NfeImport> {
  const existing = await prisma.nfeImport.findUnique({ where: { chaveAcesso: nfe.chaveAcesso } });
  if (existing) return existing;

  return prisma.nfeImport.create({
    data: {
      companyId,
      chaveAcesso: nfe.chaveAcesso,
      nsu,
      emitenteCnpj: nfe.emitenteCnpj,
      emitenteNome: nfe.emitenteNome,
      valorTotal: nfe.valorTotal,
      dataEmissao: nfe.dataEmissao,
      status: NfeImportStatus.PENDENTE,
      rawData: nfe as unknown as Prisma.InputJsonValue,
      /// Cada item vira uma linha propria, persistida a parte do rawData, pra
      /// permitir a etapa de revisao (associar produto / criar novo, escolher
      /// unidade e fator de conversao) antes de autorizar - ver ImportItems.
      items: {
        create: nfe.itens.map((item) => ({
          companyId,
          codigoProduto: item.codigoProduto,
          descricao: item.descricao,
          unidadeComercial: item.unidadeComercial,
          quantidadeComercial: item.quantidadeComercial,
          valorUnitarioComercial: item.valorUnitarioComercial,
          valorTotal: item.valorTotal,
        })),
      },
    },
  });
}

/**
 * Records that the radar found a key but could not download the full
 * document (network hiccup, SEFAZ error, unexpected schema). Kept as an
 * audit trail entry with no rawData - there is nothing to authorize.
 */
export async function recordFetchFailure(
  companyId: string,
  chaveAcesso: string,
  nsu: string,
  errorMessage: string,
): Promise<NfeImport | null> {
  const existing = await prisma.nfeImport.findUnique({ where: { chaveAcesso } });
  if (existing) return existing;

  try {
    return await prisma.nfeImport.create({
      data: {
        companyId,
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
 * to IMPORTADA, so a crash mid-way never leaves it re-authorizable. Every
 * find-or-create below is scoped to companyId, so authorizing a note never
 * matches (or leaks) another tenant's supplier/product catalog.
 */
export async function authorizeImport(
  nfeImportId: string,
  companyId: string,
  userId: string,
): Promise<ImportOutcome> {
  const pending = await prisma.nfeImport.findFirst({
    where: { id: nfeImportId, companyId },
    include: { items: true },
  });
  if (!pending) throw new AppError("Nota nao encontrada", 404);
  if (pending.status !== NfeImportStatus.PENDENTE) {
    throw new AppError("Esta nota ja foi autorizada, rejeitada ou nao pode ser processada", 422);
  }
  if (!pending.rawData) {
    throw new AppError("Esta nota nao tem os dados completos - nao e possivel autorizar", 422);
  }
  if (pending.items.length === 0 || pending.items.some((item) => !item.reviewed)) {
    throw new AppError("Revise todos os itens (associe a um produto ou crie um novo) antes de autorizar", 422);
  }

  const nfe = pending.rawData as unknown as NfeCompleta;
  nfe.dataEmissao = new Date(nfe.dataEmissao);

  try {
    await prisma.$transaction(async (tx) => {
      const supplier = await findOrCreateSupplier(tx, companyId, nfe.emitenteCnpj, nfe.emitenteNome);

      const purchaseOrder = await tx.purchaseOrder.create({
        data: {
          companyId,
          number: await nextPurchaseOrderNumber(tx, companyId),
          supplierId: supplier.id,
          userId,
          status: PurchaseOrderStatus.RECEBIDA,
          subtotal: nfe.valorTotal,
          total: nfe.valorTotal,
          notes: `Importado via radar de NF-e, autorizado manualmente (chave ${nfe.chaveAcesso})`,
        },
      });

      for (const reviewedItem of pending.items) {
        let product;
        if (reviewedItem.createNewProduct) {
          if (!reviewedItem.unitId) {
            throw new AppError(`Item "${reviewedItem.descricao}" nao tem unidade de estoque escolhida`, 422);
          }
          const purchaseUnit = await findOrCreateUnit(tx, companyId, reviewedItem.unidadeComercial);
          const conversionFactor = Number(reviewedItem.conversionFactor) || 1;
          const costPrice = Number(reviewedItem.valorUnitarioComercial) / conversionFactor;
          const sku = await generateUniqueSku(tx, companyId, reviewedItem.codigoProduto);

          product = await tx.product.create({
            data: {
              companyId,
              sku,
              name: reviewedItem.descricao.trim(),
              unitId: reviewedItem.unitId,
              purchaseUnitId: purchaseUnit.id,
              conversionFactor,
              costPrice,
              salePrice: reviewedItem.salePrice ? Number(reviewedItem.salePrice) : costPrice,
              needsReview: true,
            },
          });
        } else {
          if (!reviewedItem.productId) {
            throw new AppError(`Item "${reviewedItem.descricao}" nao foi associado a nenhum produto`, 422);
          }
          product = await tx.product.findFirst({ where: { id: reviewedItem.productId, companyId } });
          if (!product) {
            throw new AppError(`Produto associado ao item "${reviewedItem.descricao}" nao pertence a esta empresa`, 422);
          }
        }

        // Converte a quantidade/custo da unidade fiscal da nota (ex: ROLO)
        // para a unidade de estoque do produto (ex: M), usando o fator
        // configurado na revisao (ou o do proprio produto, se nao veio um
        // valor especifico para este item).
        const conversionFactor = Number(reviewedItem.conversionFactor) || Number(product.conversionFactor) || 1;
        const quantity = Number(reviewedItem.quantidadeComercial) * conversionFactor;
        const unitCost = Number(reviewedItem.valorUnitarioComercial) / conversionFactor;

        await tx.nfeImportItem.update({ where: { id: reviewedItem.id }, data: { productId: product.id } });

        await tx.purchaseOrderItem.create({
          data: {
            purchaseOrderId: purchaseOrder.id,
            productId: product.id,
            quantity,
            unitCost,
            total: Number(reviewedItem.valorTotal),
          },
        });

        const currentQty = Number(product.stockQuantity);
        const currentAvgCost = Number(product.averageCost);
        const newQty = currentQty + quantity;
        const newAverageCost = newQty > 0 ? (currentQty * currentAvgCost + quantity * unitCost) / newQty : currentAvgCost;

        await tx.stockMovement.create({
          data: {
            productId: product.id,
            userId,
            type: StockMovementType.ENTRADA,
            quantity,
            referenceType: "NFE_RADAR",
            referenceId: purchaseOrder.id,
          },
        });

        await tx.product.update({
          where: { id: product.id },
          data: {
            stockQuantity: newQty,
            averageCost: newAverageCost,
            costPrice: unitCost,
          },
        });
      }

      const installmentsSource = applyInstallments(nfe);
      const installmentGroupId = installmentsSource.length > 1 ? randomUUID() : null;

      await tx.financialTransaction.createMany({
        data: installmentsSource.map((installment) => ({
          companyId,
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
export async function rejectImport(nfeImportId: string, companyId: string, userId: string): Promise<void> {
  const pending = await prisma.nfeImport.findFirst({ where: { id: nfeImportId, companyId } });
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
