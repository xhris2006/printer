import type { Request, Response } from "express";
import { badRequest } from "./errors";

/** Paramètre de route typé (Express 5 type les paramètres en string | string[]). */
export function param(req: Request, name: string, maxLength = 200): string {
  const value = (req.params as Record<string, unknown>)[name];
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) throw badRequest("Paramètre invalide.");
  return value;
}

/**
 * Téléchargement « par navigation » (?redirect=1) : la route répond par une redirection
 * vers le lien signé, utilisable dans un simple lien <a href> (aucun pop-up bloqué).
 */
export function isRedirectDownload(req: Request): boolean {
  const value = (req.query as Record<string, unknown> | undefined)?.redirect;
  return req.method === "GET" && (value === "1" || value === "true");
}

/** Renvoie un lien signé : en JSON par défaut, ou par redirection 302 avec ?redirect=1. */
export function sendDownload(req: Request, res: Response, payload: { url: string; expiresInSec: number } & Record<string, unknown>) {
  res.setHeader("Cache-Control", "private, no-store");
  if (isRedirectDownload(req)) {
    res.redirect(302, payload.url);
    return;
  }
  res.json(payload);
}
