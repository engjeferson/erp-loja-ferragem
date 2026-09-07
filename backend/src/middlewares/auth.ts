import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { AppError } from "../utils/AppError";
import { Role } from "@prisma/client";

export interface AuthPayload {
  sub: string;
  role: Role;
  companyId: string;
  isPlatformAdmin?: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthPayload;
    }
  }
}

export function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;

  if (!header?.startsWith("Bearer ")) {
    throw new AppError("Token de autenticacao ausente", 401);
  }

  const token = header.slice("Bearer ".length);

  try {
    const payload = jwt.verify(token, env.jwtSecret) as AuthPayload;
    if (!payload.sub || !payload.companyId) {
      // Token emitido antes do multi-tenant (sem companyId) - forcar novo login
      // em vez de deixar as rotas quebrarem com companyId undefined.
      throw new AppError("Sessao expirada, faca login novamente", 401);
    }
    req.user = payload;
    next();
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("Token de autenticacao invalido ou expirado", 401);
  }
}

export function authorize(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user || (roles.length > 0 && !roles.includes(req.user.role))) {
      throw new AppError("Voce nao tem permissao para executar esta acao", 403);
    }
    next();
  };
}

export function requirePlatformAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!req.user?.isPlatformAdmin) {
    throw new AppError("Voce nao tem permissao para executar esta acao", 403);
  }
  next();
}
