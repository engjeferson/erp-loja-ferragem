import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { prisma } from "../../config/prisma";
import { env } from "../../config/env";
import { AppError } from "../../utils/AppError";
import { asyncHandler } from "../../utils/asyncHandler";

const router = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post(
  "/login",
  asyncHandler(async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);

    const user = await prisma.user.findUnique({ where: { email }, include: { company: true } });
    if (!user || !user.active) {
      throw new AppError("Credenciais invalidas", 401);
    }

    if (!user.company.active) {
      throw new AppError("Esta empresa esta desativada. Fale com o suporte.", 403);
    }

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatches) {
      throw new AppError("Credenciais invalidas", 401);
    }

    const token = jwt.sign(
      { sub: user.id, role: user.role, companyId: user.companyId, isPlatformAdmin: user.isPlatformAdmin },
      env.jwtSecret,
      { expiresIn: env.jwtExpiresIn } as jwt.SignOptions,
    );

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        companyName: user.company.name,
        isPlatformAdmin: user.isPlatformAdmin,
      },
    });
  }),
);

export default router;
