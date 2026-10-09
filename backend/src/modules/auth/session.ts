import type { Response } from "express";
import { prisma } from "../../lib/prisma";
import { secureToken, sha256 } from "../../lib/ids";
import { cookieSecure, env } from "../../config/env";

const TTL_MS = env.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;

export async function createSession(userId: string, meta: { ip?: string; userAgent?: string }) {
  const token = secureToken(32);
  await prisma.session.create({
    data: {
      tokenHash: sha256(token),
      userId,
      expiresAt: new Date(Date.now() + TTL_MS),
      ip: meta.ip?.slice(0, 64),
      userAgent: meta.userAgent?.slice(0, 255),
    },
  });
  return token;
}

export function setSessionCookie(res: Response, token: string) {
  res.cookie(env.SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: cookieSecure,
    sameSite: "lax",
    path: "/",
    maxAge: TTL_MS,
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(env.SESSION_COOKIE_NAME, { httpOnly: true, secure: cookieSecure, sameSite: "lax", path: "/" });
}

export async function findSessionUser(token: string) {
  const session = await prisma.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: { include: { delegateProfile: true } } },
  });
  if (!session) return null;
  if (session.expiresAt < new Date() || !session.user.isActive) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }
  // Mise à jour paresseuse (au plus une fois par heure) pour limiter les écritures
  if (Date.now() - session.lastUsedAt.getTime() > 60 * 60 * 1000) {
    await prisma.session
      .update({ where: { id: session.id }, data: { lastUsedAt: new Date(), expiresAt: new Date(Date.now() + TTL_MS) } })
      .catch(() => undefined);
  }
  return { session, user: session.user };
}

export async function destroySession(token: string) {
  await prisma.session.deleteMany({ where: { tokenHash: sha256(token) } });
}

export async function destroyUserSessions(userId: string, exceptTokenHash?: string) {
  await prisma.session.deleteMany({
    where: { userId, ...(exceptTokenHash ? { NOT: { tokenHash: exceptTokenHash } } : {}) },
  });
}
