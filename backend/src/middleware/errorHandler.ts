import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { AppError } from "../lib/errors";
import { isRedirectDownload } from "../lib/http";
import { frontendUrl } from "../config/env";
import { logger } from "../lib/logger";

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ error: { code: "NOT_FOUND", message: "Route introuvable." } });
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

/** Page d'erreur lisible pour un téléchargement ouvert par lien (au lieu d'un JSON brut). */
function downloadErrorPage(status: number, message: string, backHref: string) {
  const login = status === 401;
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Téléchargement impossible</title></head>
<body style="font-family:system-ui,Arial,sans-serif;background:#f5f7fb;color:#0f172a;margin:0;padding:24px">
<div style="max-width:480px;margin:10vh auto;background:#fff;border-radius:16px;padding:24px;box-shadow:0 4px 24px rgb(15 23 42/.08)">
<h1 style="font-size:20px;margin:0 0 8px">Téléchargement impossible</h1>
<p style="line-height:1.5;margin:0 0 20px">${escapeHtml(message)}</p>
<a href="${frontendUrl}${login ? "/connexion" : backHref}" style="display:inline-block;background:#1d4ed8;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">${login ? "Se connecter" : "Retour à l'espace"}</a>
</div></body></html>`;
}

/** Gestion centralisée des erreurs : aucun détail interne ni secret n'est renvoyé au client. */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  const navigational = isRedirectDownload(req) || req.originalUrl.startsWith("/api/storage/local/download/");
  if (navigational && !res.headersSent) {
    const status = err instanceof AppError ? err.status : err instanceof ZodError ? 400 : 500;
    const message = err instanceof AppError ? err.message : status === 400 ? "Lien de téléchargement invalide." : "Une erreur interne est survenue. Réessayez plus tard.";
    if (status >= 500) logger.error({ err, path: req.path, method: req.method }, "Erreur non gérée");
    res.status(status).type("html").send(downloadErrorPage(status, message, req.originalUrl.startsWith("/api/admin") ? "/admin" : "/espace"));
    return;
  }
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
