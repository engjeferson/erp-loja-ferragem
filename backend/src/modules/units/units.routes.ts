import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { authenticate } from "../../middlewares/auth";

const router = Router();
router.use(authenticate);

const unitSchema = z.object({
  name: z.string().min(2),
  abbreviation: z.string().min(1).max(10),
});

router.get(
  "/",
  asyncHandler(async (_req, res) => {
    const units = await prisma.unit.findMany({ orderBy: { name: "asc" } });
    res.json(units);
  }),
);

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const data = unitSchema.parse(req.body);
    const unit = await prisma.unit.create({ data });
    res.status(201).json(unit);
  }),
);

router.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const data = unitSchema.partial().parse(req.body);
    const unit = await prisma.unit.update({ where: { id: req.params.id }, data });
    res.json(unit);
  }),
);

router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    await prisma.unit.delete({ where: { id: req.params.id } });
    res.status(204).send();
  }),
);

export default router;
