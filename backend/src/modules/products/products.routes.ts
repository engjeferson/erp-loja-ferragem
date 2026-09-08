import { Router } from "express";
import { z } from "zod";
import { Role, StockMovementType } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { authenticate, authorize } from "../../middlewares/auth";
import { AppError } from "../../utils/AppError";
import { marginFromPrice } from "../../utils/pricing";

const router = Router();
router.use(authenticate);

const productSchema = z.object({
  sku: z.string().min(1),
  barcode: z.string().optional(),
  name: z.string().min(2),
  description: z.string().optional(),
  categoryId: z.string().uuid().optional(),
  brand: z.string().optional(),
  unitId: z.string().uuid(),
  purchaseUnitId: z.string().uuid().optional(),
  conversionFactor: z.number().positive().default(1),
  costPrice: z.number().nonnegative().default(0),
  salePrice: z.number().nonnegative().default(0),
  minStockQuantity: z.number().nonnegative().default(0),
  needsReview: z.boolean().optional(),
});

/** VENDEDOR nao deve ver custo/margem (dado estrategico da loja) - so
 * ADMIN/GERENTE/FINANCEIRO enxergam esses campos na resposta da API. */
function stripCostFieldsForVendedor<T extends Record<string, unknown>>(role: Role, product: T): T {
  if (role !== Role.VENDEDOR) return product;
  const { costPrice: _costPrice, averageCost: _averageCost, margin: _margin, ...rest } = product;
  return rest as T;
}

function withMargin<T extends { salePrice: unknown; averageCost: unknown }>(product: T) {
  return { ...product, margin: marginFromPrice(Number(product.averageCost), Number(product.salePrice)) };
}

const stockAdjustmentSchema = z.object({
  quantity: z.number().refine((value) => value !== 0, "Quantidade nao pode ser zero"),
  reason: z.string().optional(),
});

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { search, lowStock } = req.query;
    const companyId = req.user!.companyId;

    const products = await prisma.product.findMany({
      where: {
        companyId,
        active: true,
        ...(search
          ? {
              OR: [
                { name: { contains: String(search), mode: "insensitive" } },
                { sku: { contains: String(search), mode: "insensitive" } },
                { barcode: { contains: String(search), mode: "insensitive" } },
              ],
            }
          : {}),
      },
      include: { category: true, unit: true, purchaseUnit: true },
      orderBy: { name: "asc" },
    });

    const filtered =
      lowStock === "true"
        ? products.filter((p) => Number(p.stockQuantity) <= Number(p.minStockQuantity))
        : products;

    res.json(filtered.map((p) => stripCostFieldsForVendedor(req.user!.role, withMargin(p))));
  }),
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const product = await prisma.product.findFirst({
      where: { id: req.params.id, companyId: req.user!.companyId },
      include: { category: true, unit: true, purchaseUnit: true },
    });
    if (!product) throw new AppError("Produto nao encontrado", 404);
    res.json(stripCostFieldsForVendedor(req.user!.role, withMargin(product)));
  }),
);

/**
 * Historico de compras do produto - derivado inteiramente de dados que ja
 * existem (PurchaseOrderItem + fornecedor + NF-e de origem, se houver), sem
 * precisar de nenhuma tabela nova.
 */
router.get(
  "/:id/purchase-history",
  asyncHandler(async (req, res) => {
    const product = await prisma.product.findFirst({
      where: { id: req.params.id, companyId: req.user!.companyId },
    });
    if (!product) throw new AppError("Produto nao encontrado", 404);

    const items = await prisma.purchaseOrderItem.findMany({
      where: { productId: product.id, purchaseOrder: { companyId: req.user!.companyId } },
      include: {
        purchaseOrder: {
          select: {
            number: true,
            createdAt: true,
            supplier: { select: { name: true } },
            nfeImport: { select: { chaveAcesso: true } },
          },
        },
      },
      orderBy: { purchaseOrder: { createdAt: "desc" } },
    });

    res.json(
      items.map((item) => ({
        date: item.purchaseOrder.createdAt,
        supplierName: item.purchaseOrder.supplier.name,
        purchaseOrderNumber: item.purchaseOrder.number,
        nfeChaveAcesso: item.purchaseOrder.nfeImport?.chaveAcesso ?? null,
        quantity: item.quantity,
        unitCost: item.unitCost,
        total: item.total,
      })),
    );
  }),
);

router.post(
  "/",
  authorize(Role.ADMIN, Role.GERENTE),
  asyncHandler(async (req, res) => {
    const data = productSchema.parse(req.body);
    const product = await prisma.product.create({
      data: { ...data, companyId: req.user!.companyId },
    });
    res.status(201).json(withMargin(product));
  }),
);

router.patch(
  "/:id",
  authorize(Role.ADMIN, Role.GERENTE),
  asyncHandler(async (req, res) => {
    const data = productSchema.partial().parse(req.body);
    const existing = await prisma.product.findFirst({
      where: { id: req.params.id, companyId: req.user!.companyId },
    });
    if (!existing) throw new AppError("Produto nao encontrado", 404);

    const product = await prisma.product.update({ where: { id: existing.id }, data });
    res.json(withMargin(product));
  }),
);

router.delete(
  "/:id",
  authorize(Role.ADMIN, Role.GERENTE),
  asyncHandler(async (req, res) => {
    const existing = await prisma.product.findFirst({
      where: { id: req.params.id, companyId: req.user!.companyId },
    });
    if (!existing) throw new AppError("Produto nao encontrado", 404);

    await prisma.product.update({ where: { id: existing.id }, data: { active: false } });
    res.status(204).send();
  }),
);

router.post(
  "/:id/stock-adjustments",
  authorize(Role.ADMIN, Role.GERENTE),
  asyncHandler(async (req, res) => {
    const { quantity, reason } = stockAdjustmentSchema.parse(req.body);
    const productId = req.params.id;
    const companyId = req.user!.companyId;

    const product = await prisma.$transaction(async (tx) => {
      const current = await tx.product.findFirst({ where: { id: productId, companyId } });
      if (!current) throw new AppError("Produto nao encontrado", 404);

      const newQuantity = Number(current.stockQuantity) + quantity;
      if (newQuantity < 0) {
        throw new AppError("Ajuste resultaria em estoque negativo", 422);
      }

      await tx.stockMovement.create({
        data: {
          productId,
          userId: req.user!.sub,
          type: StockMovementType.AJUSTE,
          quantity,
          reason,
        },
      });

      return tx.product.update({
        where: { id: productId },
        data: { stockQuantity: newQuantity },
      });
    });

    res.json(product);
  }),
);

router.get(
  "/:id/movements",
  asyncHandler(async (req, res) => {
    const product = await prisma.product.findFirst({
      where: { id: req.params.id, companyId: req.user!.companyId },
    });
    if (!product) throw new AppError("Produto nao encontrado", 404);

    const movements = await prisma.stockMovement.findMany({
      where: { productId: product.id },
      include: { user: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    });
    res.json(movements);
  }),
);

export default router;
