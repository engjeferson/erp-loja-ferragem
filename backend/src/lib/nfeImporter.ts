import { randomUUID } from "crypto";
import {
  FinancialStatus,
  FinancialType,
  NfeImportStatus,
  Prisma,
  PurchaseOrderStatus,
  StockMovementType,
} from "@prisma/client";
import { prisma } from "../config/prisma";
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
 * Turns one fully-fetched NFe into stock + financial records, atomically,
 * mirroring the manual "receive purchase order" flow but triggered by the
 * radar instead of a person. Every access key is recorded in NfeImport so
 * a re-run of the radar (or overlapping NSU ranges) never double-launches
 * the same invoice into stock.
 */
export async function importNfe(nfe: NfeCompleta, nsu: string, userId: string): Promise<ImportOutcome> {
  const already = await prisma.nfeImport.findUnique({ where: { chaveAcesso: nfe.chaveAcesso } });
  if (already) {
    return { status: NfeImportStatus.IGNORADA };
  }

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
          notes: `Importado automaticamente pelo radar de NF-e (chave ${nfe.chaveAcesso})`,
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

      const installmentsSource =
        nfe.duplicatas.length > 0
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

      await tx.nfeImport.create({
        data: {
          chaveAcesso: nfe.chaveAcesso,
          nsu,
          supplierId: supplier.id,
          purchaseOrderId: purchaseOrder.id,
          emitenteCnpj: nfe.emitenteCnpj,
          emitenteNome: nfe.emitenteNome,
          valorTotal: nfe.valorTotal,
          dataEmissao: nfe.dataEmissao,
          status: NfeImportStatus.IMPORTADA,
        },
      });
    });

    return { status: NfeImportStatus.IMPORTADA };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro desconhecido ao importar a NF-e";

    try {
      await prisma.nfeImport.create({
        data: {
          chaveAcesso: nfe.chaveAcesso,
          nsu,
          emitenteCnpj: nfe.emitenteCnpj,
          emitenteNome: nfe.emitenteNome,
          valorTotal: nfe.valorTotal,
          dataEmissao: nfe.dataEmissao,
          status: NfeImportStatus.ERRO,
          errorMessage: message,
        },
      });
    } catch {
      // A chave provavelmente ja foi registrada por uma checagem concorrente
      // (unique constraint) - o resultado ERRO abaixo ainda e reportado ao
      // chamador, so o log de auditoria duplicado e que nao e gravado.
    }

    return { status: NfeImportStatus.ERRO, errorMessage: message };
  }
}
