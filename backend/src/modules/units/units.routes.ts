import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { authenticate } from "../../middlewares/auth";
import { AppError } from "../../utils/AppError";

const router = Router();
router.use(authenticate);

const unitSchema = z.object({
  name: z.string().min(2),
  abbreviation: z.string().min(1).max(10),
});

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const units = await prisma.unit.findMany({
      where: { companyId: req.user!.companyId },
      orderBy: { name: "asc" },
    });
    res.json(units);
  }),
);

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const data = unitSchema.parse(req.body);
    const unit = await prisma.unit.create({ data: { ...data, companyId: req.user!.companyId } });
    res.status(201).json(unit);
  }),
);

router.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const data = unitSchema.partial().parse(req.body);
    const existing = await prisma.unit.findFirst({
      where: { id: req.params.id, companyId: req.user!.companyId },
    });
    if (!existing) throw new AppError("Unidade nao encontrada", 404);

    const unit = await prisma.unit.update({ where: { id: existing.id }, data });
    res.json(unit);
  }),
);

router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const existing = await prisma.unit.findFirst({
      where: { id: req.params.id, companyId: req.user!.companyId },
    });
    if (!existing) throw new AppError("Unidade nao encontrada", 404);

    await prisma.unit.delete({ where: { id: existing.id } });
    res.status(204).send();
  }),
);

export default router;
