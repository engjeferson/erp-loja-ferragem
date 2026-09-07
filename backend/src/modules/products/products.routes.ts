import { Router } from "express";
import { z } from "zod";
import { StockMovementType } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { authenticate } from "../../middlewares/auth";
import { AppError } from "../../utils/AppError";

const router = Router();
router.use(authenticate);

const productSchema = z.object({
  sku: z.string().min(1),
  barcode: z.string().optional(),
  name: z.string().min(2),
  description: z.string().optional(),
  categoryId: z.string().uuid().optional(),
  unitId: z.string().uuid(),
  costPrice: z.number().nonnegative().default(0),
  salePrice: z.number().nonnegative().default(0),
  minStockQuantity: z.number().nonnegative().default(0),
  needsReview: z.boolean().optional(),
});

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
      include: { category: true, unit: true },
      orderBy: { name: "asc" },
    });

    const filtered =
      lowStock === "true"
        ? products.filter((p) => Number(p.stockQuantity) <= Number(p.minStockQuantity))
        : products;

    res.json(filtered);
  }),
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const product = await prisma.product.findFirst({
      where: { id: req.params.id, companyId: req.user!.companyId },
      include: { category: true, unit: true },
    });
    if (!product) throw new AppError("Produto nao encontrado", 404);
    res.json(product);
  }),
);

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const data = productSchema.parse(req.body);
    const product = await prisma.product.create({
      data: { ...data, companyId: req.user!.companyId },
    });
    res.status(201).json(product);
  }),
);

router.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const data = productSchema.partial().parse(req.body);
    const existing = await prisma.product.findFirst({
      where: { id: req.params.id, companyId: req.user!.companyId },
    });
    if (!existing) throw new AppError("Produto nao encontrado", 404);

    const product = await prisma.product.update({ where: { id: existing.id }, data });
    res.json(product);
  }),
);

router.delete(
  "/:id",
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
