import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { Prisma, Role } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { authenticate, authorize } from "../../middlewares/auth";
import { AppError } from "../../utils/AppError";

const router = Router();
router.use(authenticate);

const createUserSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(6),
  role: z.nativeEnum(Role).default(Role.VENDEDOR),
});

const updateUserSchema = z.object({
  name: z.string().min(2).optional(),
  role: z.nativeEnum(Role).optional(),
  active: z.boolean().optional(),
  password: z.string().min(6).optional(),
});

router.get(
  "/",
  authorize(Role.ADMIN, Role.GERENTE),
  asyncHandler(async (req, res) => {
    const users = await prisma.user.findMany({
      where: { companyId: req.user!.companyId },
      select: { id: true, name: true, email: true, role: true, active: true, createdAt: true },
      orderBy: { name: "asc" },
    });
    res.json(users);
  }),
);

router.post(
  "/",
  authorize(Role.ADMIN),
  asyncHandler(async (req, res) => {
    const data = createUserSchema.parse(req.body);
    const passwordHash = await bcrypt.hash(data.password, 10);

    try {
      const user = await prisma.user.create({
        data: {
          name: data.name,
          email: data.email,
          role: data.role,
          passwordHash,
          companyId: req.user!.companyId,
        },
        select: { id: true, name: true, email: true, role: true, active: true },
      });

      res.status(201).json(user);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new AppError("Este e-mail ja esta em uso", 409);
      }
      throw error;
    }
  }),
);

router.patch(
  "/:id",
  authorize(Role.ADMIN),
  asyncHandler(async (req, res) => {
    const data = updateUserSchema.parse(req.body);
    const { password, ...rest } = data;

    const existing = await prisma.user.findFirst({
      where: { id: req.params.id, companyId: req.user!.companyId },
    });
    if (!existing) throw new AppError("Usuario nao encontrado", 404);

    const user = await prisma.user.update({
      where: { id: existing.id },
      data: {
        ...rest,
        ...(password ? { passwordHash: await bcrypt.hash(password, 10) } : {}),
      },
      select: { id: true, name: true, email: true, role: true, active: true },
    });

    res.json(user);
  }),
);

export default router;
