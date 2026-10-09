import type { NextFunction, Request, Response } from "express";
import type { DelegateProfile, RoleCode, User } from "@prisma/client";
import { env } from "../config/env";
import { findSessionUser } from "../modules/auth/session";
import { forbidden, unauthorized } from "../lib/errors";

export type AuthUser = User & { delegateProfile: DelegateProfile | null };

declare module "express-serve-static-core" {
  interface Request {
    user?: AuthUser;
    sessionId?: string;
  }
}

/** Charge l'utilisateur depuis le cookie de session (sans exiger l'authentification). */
export async function loadSession(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[env.SESSION_COOKIE_NAME] as string | undefined;
  if (token && typeof token === "string" && token.length < 200) {
    const found = await findSessionUser(token);
    if (found) {
      req.user = found.user;
      req.sessionId = found.session.id;
    }
  }
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(unauthorized());
  next();
}

export function requireRole(...roles: RoleCode[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.roleCode)) return next(forbidden());
    next();
  };
}

export const requireStaff = requireRole("ADMIN", "OPERATOR");
export const requireAdmin = requireRole("ADMIN");

/** Délégué approuvé (ou administrateur). */
export function requireDelegate(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(unauthorized());
  const ok = req.user.roleCode === "ADMIN" || (req.user.roleCode === "DELEGATE" && req.user.delegateProfile?.status === "APPROVED");
  if (!ok) return next(forbidden("Espace réservé aux délégués de classe approuvés."));
  next();
}

export function currentUser(req: Request): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}

export const isStaff = (user: Pick<User, "roleCode">) => user.roleCode === "ADMIN" || user.roleCode === "OPERATOR";
