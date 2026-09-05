import { NextFunction, Request, Response } from "express";
import { MulterError } from "multer";
import { ZodError } from "zod";
import { AppError } from "../utils/AppError";

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
) {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({ error: err.message });
  }

  if (err instanceof MulterError) {
    return res.status(422).json({ error: `Falha no upload do arquivo: ${err.message}` });
  }

  if (err instanceof ZodError) {
    return res.status(422).json({
      error: "Erro de validacao",
      issues: err.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
  }

  console.error(err);
  return res.status(500).json({ error: "Erro interno do servidor" });
}
