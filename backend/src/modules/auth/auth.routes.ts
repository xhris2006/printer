import { Router } from "express";
import { prisma } from "../../lib/prisma";
import { badRequest, conflict, unauthorized } from "../../lib/errors";
import { sha256 } from "../../lib/ids";
import { env, frontendUrl } from "../../config/env";
import { currentUser, requireAuth } from "../../middleware/auth";
import { authLimiter, passwordResetLimiter } from "../../middleware/security";
import { audit } from "../audit/audit";
import { isEmailEnabled, sendEmail } from "../notifications/email";
import { getDummyHash, hashPassword, verifyPassword } from "./password";
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  updateProfileSchema,
} from "./auth.schemas";
import { createPasswordResetToken, findUserByIdentifier, publicUser } from "./auth.service";
import { clearSessionCookie, createSession, destroySession, destroyUserSessions, setSessionCookie } from "./session";

export const authRouter = Router();

authRouter.post("/register", authLimiter, async (req, res) => {
  const input = registerSchema.parse(req.body);
  const existing = await prisma.user.findFirst({
    where: { OR: [{ phone: input.phone }, ...(input.email ? [{ email: input.email }] : [])] },
  });
  if (existing) throw conflict("Un compte existe déjà avec ce numéro ou cet email.", "ACCOUNT_EXISTS");

  const user = await prisma.user.create({
    data: {
      fullName: input.fullName,
      phone: input.phone,
      email: input.email ?? null,
      passwordHash: await hashPassword(input.password),
      roleCode: "CUSTOMER",
      customerProfile: { create: {} },
    },
    include: { delegateProfile: true, customerProfile: true },
  });
  const token = await createSession(user.id, { ip: req.ip, userAgent: req.get("user-agent") });
  setSessionCookie(res, token);
  res.status(201).json({ user: publicUser(user) });
});

authRouter.post("/login", authLimiter, async (req, res) => {
  const input = loginSchema.parse(req.body);
  const user = await findUserByIdentifier(input.identifier);
  if (!user) {
    await verifyPassword(await getDummyHash(), input.password);
    throw unauthorized("Identifiants incorrects.");
  }
  const valid = await verifyPassword(user.passwordHash, input.password);
  if (!valid) throw unauthorized("Identifiants incorrects.");
  if (!user.isActive) throw unauthorized("Ce compte est désactivé. Contactez l'assistance.");

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  const token = await createSession(user.id, { ip: req.ip, userAgent: req.get("user-agent") });
  setSessionCookie(res, token);
  const full = await prisma.user.findUniqueOrThrow({
    where: { id: user.id },
    include: { delegateProfile: true, customerProfile: true },
  });
  res.json({ user: publicUser(full) });
});

authRouter.post("/logout", async (req, res) => {
  const token = req.cookies?.[env.SESSION_COOKIE_NAME];
  if (typeof token === "string") await destroySession(token);
  clearSessionCookie(res);
  res.json({ ok: true });
});

authRouter.get("/me", async (req, res) => {
  if (!req.user) {
    res.json({ user: null });
    return;
  }
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: req.user.id },
    include: { delegateProfile: true, customerProfile: true },
  });
  res.json({ user: publicUser(user) });
});

authRouter.patch("/me", requireAuth, async (req, res) => {
  const me = currentUser(req);
  const input = updateProfileSchema.parse(req.body);
  if (input.email) {
    const taken = await prisma.user.findFirst({ where: { email: input.email, NOT: { id: me.id } } });
    if (taken) throw conflict("Cette adresse email est déjà utilisée.");
  }
  const user = await prisma.user.update({
    where: { id: me.id },
    data: {
      fullName: input.fullName,
      email: input.email,
      customerProfile: {
        upsert: {
          create: { quarter: input.quarter, addressDetails: input.addressDetails, notifyByEmail: input.notifyByEmail },
          update: { quarter: input.quarter, addressDetails: input.addressDetails, notifyByEmail: input.notifyByEmail },
        },
      },
    },
    include: { delegateProfile: true, customerProfile: true },
  });
  res.json({ user: publicUser(user) });
});

authRouter.post("/change-password", requireAuth, authLimiter, async (req, res) => {
  const me = currentUser(req);
  const input = changePasswordSchema.parse(req.body);
  if (!(await verifyPassword(me.passwordHash, input.currentPassword))) {
    throw badRequest("Mot de passe actuel incorrect.", "INVALID_PASSWORD");
  }
  await prisma.user.update({ where: { id: me.id }, data: { passwordHash: await hashPassword(input.newPassword) } });
  const token = req.cookies?.[env.SESSION_COOKIE_NAME];
  await destroyUserSessions(me.id, typeof token === "string" ? sha256(token) : undefined);
  await audit({ actorId: me.id, action: "user.password_changed", entityType: "User", entityId: me.id, ip: req.ip });
  res.json({ ok: true });
});

authRouter.post("/forgot-password", passwordResetLimiter, async (req, res) => {
  const input = forgotPasswordSchema.parse(req.body);
  const user = await findUserByIdentifier(input.identifier);
  if (user?.email && user.isActive && isEmailEnabled()) {
    const token = await createPasswordResetToken(user.id);
    const link = `${frontendUrl}/reinitialiser?token=${encodeURIComponent(token)}`;
    await sendEmail(
      user.email,
      "Réinitialisation de votre mot de passe",
      `Bonjour ${user.fullName},\n\nPour choisir un nouveau mot de passe, ouvrez ce lien (valable 1 heure) :\n${link}\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez ce message.`,
    ).catch(() => undefined);
  }
  // Réponse identique dans tous les cas (pas d'énumération de comptes)
  res.json({
    ok: true,
    emailEnabled: isEmailEnabled(),
    message: isEmailEnabled()
      ? "Si un compte avec email existe, un lien de réinitialisation vient d'être envoyé."
      : "La réinitialisation par email n'est pas disponible. Contactez l'assistance sur WhatsApp pour recevoir un lien sécurisé.",
  });
});

authRouter.post("/reset-password", passwordResetLimiter, async (req, res) => {
  const input = resetPasswordSchema.parse(req.body);
  const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash: sha256(input.token) } });
  if (!record || record.usedAt || record.expiresAt < new Date()) {
    throw badRequest("Lien invalide ou expiré. Demandez un nouveau lien.", "INVALID_TOKEN");
  }
  await prisma.$transaction([
    prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
    prisma.user.update({ where: { id: record.userId }, data: { passwordHash: await hashPassword(input.password) } }),
    prisma.session.deleteMany({ where: { userId: record.userId } }),
  ]);
  await audit({ actorId: record.userId, action: "user.password_reset", entityType: "User", entityId: record.userId, ip: req.ip });
  res.json({ ok: true });
});
