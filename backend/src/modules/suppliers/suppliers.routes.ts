import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { authenticate } from "../../middlewares/auth";

const router = Router();
router.use(authenticate);

const supplierSchema = z.object({
  name: z.string().min(2),
  document: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  address: z.string().optional(),
});

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { search } = req.query;
    const suppliers = await prisma.supplier.findMany({
      where: search
        ? {
            OR: [
              { name: { contains: String(search), mode: "insensitive" } },
              { document: { contains: String(search), mode: "insensitive" } },
            ],
          }
        : undefined,
      orderBy: { name: "asc" },
    });
    res.json(suppliers);
  }),
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const supplier = await prisma.supplier.findUniqueOrThrow({ where: { id: req.params.id } });
    res.json(supplier);
  }),
);

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const data = supplierSchema.parse(req.body);
    const supplier = await prisma.supplier.create({ data });
    res.status(201).json(supplier);
  }),
);

router.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const data = supplierSchema.partial().parse(req.body);
    const supplier = await prisma.supplier.update({ where: { id: req.params.id }, data });
    res.json(supplier);
  }),
);

router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    await prisma.supplier.delete({ where: { id: req.params.id } });
    res.status(204).send();
  }),
);

export default router;
