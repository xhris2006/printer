import type { NextFunction, Request, Response } from "express";
import { rateLimit } from "express-rate-limit";
import { env, frontendOrigins, isProduction, isTest } from "../config/env";
import { forbidden } from "../lib/errors";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Protection CSRF : les requêtes modifiantes provenant d'un navigateur doivent
 * avoir une origine autorisée. (Les cookies de session sont également SameSite=Lax.)
 */
export function originCheck(req: Request, _res: Response, next: NextFunction) {
  if (SAFE_METHODS.has(req.method)) return next();
  const origin = req.get("origin");
  if (!origin) return next(); // appels serveur à serveur (webhooks, outils) : pas de cookie tiers envoyé
  if (frontendOrigins.includes(origin.replace(/\/$/, ""))) return next();
  next(forbidden("Origine de la requête non autorisée."));
}

function limiter(windowMs: number, limit: number, message: string) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    skip: () => isTest || (env.DISABLE_RATE_LIMIT && !isProduction),
    message: { error: { code: "RATE_LIMITED", message } },
  });
}

export const authLimiter = limiter(15 * 60 * 1000, 20, "Trop de tentatives. Réessayez dans quelques minutes.");
export const passwordResetLimiter = limiter(60 * 60 * 1000, 5, "Trop de demandes de réinitialisation. Réessayez plus tard.");
export const uploadLimiter = limiter(60 * 1000, 120, "Trop de téléversements simultanés. Patientez un instant.");
export const paymentLimiter = limiter(60 * 1000, 20, "Trop de tentatives de paiement. Patientez un instant.");
export const publicLimiter = limiter(60 * 1000, 60, "Trop de requêtes. Patientez un instant.");
export const webhookLimiter = limiter(60 * 1000, 300, "Trop de requêtes.");
export const apiLimiter = limiter(60 * 1000, 600, "Trop de requêtes. Patientez un instant.");
