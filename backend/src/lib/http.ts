import type { Request } from "express";
import { badRequest } from "./errors";

/** Paramètre de route typé (Express 5 type les paramètres en string | string[]). */
export function param(req: Request, name: string, maxLength = 200): string {
  const value = (req.params as Record<string, unknown>)[name];
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) throw badRequest("Paramètre invalide.");
  return value;
}
