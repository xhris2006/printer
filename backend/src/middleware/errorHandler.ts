import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { AppError } from "../lib/errors";
import { logger } from "../lib/logger";

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ error: { code: "NOT_FOUND", message: "Route introuvable." } });
}

/** Gestion centralisée des erreurs : aucun détail interne ni secret n'est renvoyé au client. */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Certaines informations sont invalides.",
        fields: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      },
    });
    return;
  }
  if (err instanceof AppError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    return;
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2025") {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Ressource introuvable." } });
      return;
    }
    if (err.code === "P2002") {
      res.status(409).json({ error: { code: "CONFLICT", message: "Cette ressource existe déjà." } });
      return;
    }
  }
  const status = (err as { status?: number; statusCode?: number }).status ?? (err as { statusCode?: number }).statusCode;
  if (status && status >= 400 && status < 500) {
    // Erreurs de parsing JSON, corps trop volumineux…
    const type = (err as { type?: string }).type;
    const message = type === "entity.too.large" ? "Requête trop volumineuse." : "Requête invalide.";
    res.status(status).json({ error: { code: "BAD_REQUEST", message } });
    return;
  }
  logger.error({ err, path: req.path, method: req.method }, "Erreur non gérée");
  res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Une erreur interne est survenue. Réessayez plus tard." } });
}
