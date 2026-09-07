import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { authenticate } from "../../middlewares/auth";
import { AppError } from "../../utils/AppError";

const router = Router();
router.use(authenticate);

const categorySchema = z.object({
  name: z.string().min(2),
  description: z.string().optional(),
});

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const categories = await prisma.category.findMany({
      where: { companyId: req.user!.companyId },
      orderBy: { name: "asc" },
    });
    res.json(categories);
  }),
);

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const data = categorySchema.parse(req.body);
    const category = await prisma.category.create({
      data: { ...data, companyId: req.user!.companyId },
    });
    res.status(201).json(category);
  }),
);

router.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const data = categorySchema.partial().parse(req.body);
    const existing = await prisma.category.findFirst({
      where: { id: req.params.id, companyId: req.user!.companyId },
    });
    if (!existing) throw new AppError("Categoria nao encontrada", 404);

    const category = await prisma.category.update({ where: { id: existing.id }, data });
    res.json(category);
  }),
);

router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const existing = await prisma.category.findFirst({
      where: { id: req.params.id, companyId: req.user!.companyId },
    });
    if (!existing) throw new AppError("Categoria nao encontrada", 404);

    await prisma.category.delete({ where: { id: existing.id } });
    res.status(204).send();
  }),
);

export default router;
