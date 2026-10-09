import { Router } from "express";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { badRequest, conflict, forbidden, notFound } from "../../lib/errors";
import { paginate, pageResult, paginationSchema } from "../../lib/pagination";
import { secureToken } from "../../lib/ids";
import { frontendUrl } from "../../config/env";
import { currentUser, requireAdmin } from "../../middleware/auth";
import { audit } from "../audit/audit";
import { notify } from "../notifications/notifications.service";
import { phoneSchema } from "../auth/auth.schemas";
import { hashPassword } from "../auth/password";
import { createPasswordResetToken, publicUser } from "../auth/auth.service";
import { destroyUserSessions } from "../auth/session";
import { getSettings } from "../settings/settings.service";
import { reviewCashPayment, serializePayment, syncPayment } from "../payments/payments.service";
import { cancelGroup, GROUP_STATUS_LABELS, loadGroupForViewer, serializeGroup, startGroupProduction } from "../groups/groups.service";
import { quoteInclude, quoteLinesSchema, sendQuote, serializeQuote } from "../quotes/quotes.service";
import { STATUS_LABELS } from "../orders/status";
import { param } from "../../lib/http";

export const adminMiscRouter = Router();

// ─────────────── Tableau de bord ───────────────
adminMiscRouter.get("/stats", async (_req, res) => {
  const settings = await getSettings();
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const since30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const holdLimit = new Date(now.getTime() - settings["pickup.holdDays"] * 24 * 60 * 60 * 1000);

  const [byStatus, todayCount, monthRevenue, pendingCash, pendingQuotes, pendingDelegates, overduePickups, paidLast30, duplicates] = await Promise.all([
    prisma.order.groupBy({ by: ["status"], _count: { _all: true }, where: { status: { not: "DRAFT" } } }),
    prisma.order.count({ where: { createdAt: { gte: startOfDay }, status: { not: "DRAFT" } } }),
    prisma.payment.aggregate({ where: { status: "SUCCESSFUL", isDuplicate: false, confirmedAt: { gte: startOfMonth } }, _sum: { amount: true } }),
    prisma.payment.count({ where: { status: "PENDING_VERIFICATION" } }),
    prisma.quote.count({ where: { status: "REQUESTED" } }),
    prisma.delegateProfile.count({ where: { status: "PENDING" } }),
    prisma.order.count({ where: { status: "READY_FOR_PICKUP", readyAt: { lt: holdLimit } } }),
    prisma.payment.findMany({
      where: { status: "SUCCESSFUL", isDuplicate: false, confirmedAt: { gte: since30 } },
      select: { amount: true, confirmedAt: true },
    }),
    prisma.payment.count({ where: { isDuplicate: true } }),
  ]);

  const daily = new Map<string, { revenue: number; payments: number }>();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    daily.set(d.toISOString().slice(0, 10), { revenue: 0, payments: 0 });
  }
  for (const p of paidLast30) {
    const key = (p.confirmedAt as Date).toISOString().slice(0, 10);
    const entry = daily.get(key);
    if (entry) {
      entry.revenue += p.amount;
      entry.payments += 1;
    }
  }
  const counts = Object.fromEntries(byStatus.map((s) => [s.status, s._count._all]));
  res.json({
    ordersByStatus: Object.entries(STATUS_LABELS)
      .filter(([k]) => k !== "DRAFT")
      .map(([status, label]) => ({ status, label, count: counts[status] ?? 0 })),
    todayOrders: todayCount,
    monthRevenue: monthRevenue._sum.amount ?? 0,
    pendingPayments: counts.PENDING_PAYMENT ?? 0,
    productionQueue: (counts.PAID ?? 0) + (counts.TO_PREPARE ?? 0) + (counts.PRINTING ?? 0) + (counts.FINISHING ?? 0),
    readyForPickup: counts.READY_FOR_PICKUP ?? 0,
    overduePickups,
    pendingCashVerifications: pendingCash,
    pendingQuotes,
    pendingDelegates,
    duplicatePayments: duplicates,
    revenueLast30Days: [...daily.entries()].map(([date, v]) => ({ date, ...v })),
  });
});

// ─────────────── Paiements ───────────────
adminMiscRouter.get("/payments", requireAdmin, async (req, res) => {
  const q = paginationSchema
    .extend({
      status: z.enum(["CREATED", "PENDING", "SUCCESSFUL", "FAILED", "EXPIRED", "CANCELLED", "PENDING_VERIFICATION", "REJECTED"]).optional(),
      provider: z.enum(["FAPSHI", "MOCK", "CASH"]).optional(),
      duplicates: z.enum(["true", "false"]).optional(),
    })
    .parse(req.query);
  const where: Prisma.PaymentWhereInput = {
    ...(q.status ? { status: q.status } : {}),
    ...(q.provider ? { provider: q.provider } : {}),
    ...(q.duplicates === "true" ? { isDuplicate: true } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.payment.findMany({
      where,
      orderBy: { createdAt: "desc" },
      ...paginate(q.page, q.pageSize),
      include: {
        order: { select: { id: true, reference: true, customer: { select: { fullName: true, phone: true } } } },
        declaredBy: { select: { fullName: true } },
        verifiedBy: { select: { fullName: true } },
      },
    }),
    prisma.payment.count({ where }),
  ]);
  res.json(
    pageResult(
      items.map((p) => ({
        ...serializePayment(p),
        providerTransId: p.providerTransId,
        declarationNote: p.declarationNote,
        declaredBy: p.declaredBy?.fullName ?? null,
        verifiedBy: p.verifiedBy?.fullName ?? null,
        verifiedAt: p.verifiedAt,
        order: { id: p.order.id, reference: p.order.reference, customer: p.order.customer },
      })),
      total,
      q.page,
      q.pageSize,
    ),
  );
});

adminMiscRouter.get("/payments/:id/events", requireAdmin, async (req, res) => {
  const events = await prisma.paymentEvent.findMany({ where: { paymentId: param(req, "id") }, orderBy: { createdAt: "asc" } });
  res.json({ items: events });
});

adminMiscRouter.post("/payments/:id/review", requireAdmin, async (req, res) => {
  const input = z.object({ approve: z.boolean(), note: z.string().trim().min(3).max(500) }).parse(req.body);
  const payment = await reviewCashPayment(currentUser(req), param(req, "id"), input.approve, input.note, req.ip);
  res.json({ payment: serializePayment(payment) });
});

adminMiscRouter.post("/payments/:id/sync", requireAdmin, async (req, res) => {
  const payment = await syncPayment(param(req, "id"), "admin");
  await audit({ actorId: currentUser(req).id, action: "payment.synced", entityType: "Payment", entityId: payment.id, ip: req.ip });
  res.json({ payment: serializePayment(payment) });
});

// ─────────────── Utilisateurs & délégués ───────────────
adminMiscRouter.get("/users", requireAdmin, async (req, res) => {
  const q = paginationSchema
    .extend({
      q: z.string().trim().max(100).optional(),
      role: z.enum(["CUSTOMER", "DELEGATE", "OPERATOR", "ADMIN"]).optional(),
      delegateStatus: z.enum(["PENDING", "APPROVED", "REJECTED", "SUSPENDED"]).optional(),
    })
    .parse(req.query);
  const where: Prisma.UserWhereInput = {
    ...(q.role ? { roleCode: q.role } : {}),
    ...(q.delegateStatus ? { delegateProfile: { status: q.delegateStatus } } : {}),
    ...(q.q
      ? {
          OR: [
            { fullName: { contains: q.q, mode: "insensitive" } },
            { email: { contains: q.q, mode: "insensitive" } },
            { phone: { contains: q.q.replace(/\s/g, "") } },
          ],
        }
      : {}),
  };
  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      include: { delegateProfile: true, customerProfile: true, _count: { select: { orders: true } } },
      orderBy: { createdAt: "desc" },
      ...paginate(q.page, q.pageSize),
    }),
    prisma.user.count({ where }),
  ]);
  res.json(pageResult(users.map((u) => ({ ...publicUser(u), ordersCount: u._count.orders, lastLoginAt: u.lastLoginAt })), total, q.page, q.pageSize));
});

adminMiscRouter.post("/users", requireAdmin, async (req, res) => {
  const me = currentUser(req);
  const input = z
    .object({
      fullName: z.string().trim().min(2).max(120),
      phone: phoneSchema,
      email: z.string().trim().toLowerCase().email().optional(),
      role: z.enum(["CUSTOMER", "OPERATOR", "ADMIN"]),
    })
    .parse(req.body);
  const exists = await prisma.user.findFirst({ where: { OR: [{ phone: input.phone }, ...(input.email ? [{ email: input.email }] : [])] } });
  if (exists) throw conflict("Un compte existe déjà avec ce numéro ou cet email.");
  // Mot de passe aléatoire jamais communiqué : l'utilisateur définit le sien via le lien sécurisé
  const user = await prisma.user.create({
    data: {
      fullName: input.fullName,
      phone: input.phone,
      email: input.email,
      roleCode: input.role,
      passwordHash: await hashPassword(secureToken(32)),
      customerProfile: { create: {} },
    },
    include: { delegateProfile: true, customerProfile: true },
  });
  const token = await createPasswordResetToken(user.id, 72 * 60 * 60 * 1000);
  await audit({ actorId: me.id, action: "user.created", entityType: "User", entityId: user.id, metadata: { role: input.role }, ip: req.ip });
  res.status(201).json({ user: publicUser(user), setupLink: `${frontendUrl}/reinitialiser?token=${encodeURIComponent(token)}`, setupLinkExpiresInHours: 72 });
});

adminMiscRouter.patch("/users/:id", requireAdmin, async (req, res) => {
  const me = currentUser(req);
  const input = z.object({ role: z.enum(["CUSTOMER", "DELEGATE", "OPERATOR", "ADMIN"]).optional(), isActive: z.boolean().optional() }).parse(req.body);
  const target = await prisma.user.findUnique({ where: { id: param(req, "id") }, include: { delegateProfile: true } });
  if (!target) throw notFound("Utilisateur introuvable.");
  if (target.id === me.id && (input.role && input.role !== "ADMIN" || input.isActive === false)) {
    throw forbidden("Vous ne pouvez pas retirer vos propres droits d'administration.");
  }
  if (target.roleCode === "ADMIN" && (input.role && input.role !== "ADMIN" || input.isActive === false)) {
    const admins = await prisma.user.count({ where: { roleCode: "ADMIN", isActive: true, id: { not: target.id } } });
    if (admins === 0) throw conflict("Il doit rester au moins un administrateur actif.");
  }
  if (input.role === "DELEGATE" && target.delegateProfile?.status !== "APPROVED") {
    throw badRequest("Approuvez d'abord la demande de délégué de cet utilisateur.");
  }
  const user = await prisma.user.update({
    where: { id: target.id },
    data: { roleCode: input.role, isActive: input.isActive },
    include: { delegateProfile: true, customerProfile: true },
  });
  if (input.isActive === false) await destroyUserSessions(target.id);
  await audit({ actorId: me.id, action: "user.updated", entityType: "User", entityId: target.id, metadata: { before: { role: target.roleCode, isActive: target.isActive }, after: input }, ip: req.ip });
  res.json({ user: publicUser(user) });
});

/** Lien de réinitialisation à transmettre au client (ex. via WhatsApp) lorsque l'email n'est pas disponible. */
adminMiscRouter.post("/users/:id/reset-link", requireAdmin, async (req, res) => {
  const me = currentUser(req);
  const user = await prisma.user.findUnique({ where: { id: param(req, "id") } });
  if (!user) throw notFound("Utilisateur introuvable.");
  const token = await createPasswordResetToken(user.id);
  await audit({ actorId: me.id, action: "user.reset_link_created", entityType: "User", entityId: user.id, ip: req.ip });
  res.json({ link: `${frontendUrl}/reinitialiser?token=${encodeURIComponent(token)}`, expiresInMinutes: 60 });
});

adminMiscRouter.post("/delegates/:userId/review", requireAdmin, async (req, res) => {
  const me = currentUser(req);
  const input = z.object({ decision: z.enum(["APPROVED", "REJECTED", "SUSPENDED"]), note: z.string().trim().max(500).optional() }).parse(req.body);
  const profile = await prisma.delegateProfile.findUnique({ where: { userId: param(req, "userId") }, include: { user: true } });
  if (!profile) throw notFound("Demande introuvable.");
  await prisma.$transaction(async (tx) => {
    await tx.delegateProfile.update({
      where: { id: profile.id },
      data: { status: input.decision, reviewNote: input.note, reviewedById: me.id, reviewedAt: new Date() },
    });
    if (input.decision === "APPROVED" && profile.user.roleCode === "CUSTOMER") {
      await tx.user.update({ where: { id: profile.userId }, data: { roleCode: "DELEGATE" } });
    }
    if (input.decision !== "APPROVED" && profile.user.roleCode === "DELEGATE") {
      await tx.user.update({ where: { id: profile.userId }, data: { roleCode: "CUSTOMER" } });
    }
    await audit({ actorId: me.id, action: `delegate.${input.decision.toLowerCase()}`, entityType: "DelegateProfile", entityId: profile.id, metadata: { note: input.note ?? null }, ip: req.ip }, tx);
    await notify(
      {
        userId: profile.userId,
        type: "DELEGATE_REVIEW",
        title: input.decision === "APPROVED" ? "Espace délégué activé" : "Demande d'espace délégué",
        body:
          input.decision === "APPROVED"
            ? "Votre espace délégué est activé : vous pouvez créer des commandes groupées pour votre classe."
            : `Votre demande n'a pas été acceptée${input.note ? ` : ${input.note}` : "."}`,
        link: "/espace/delegue",
      },
      tx,
    );
  });
  res.json({ ok: true });
});

// ─────────────── Commandes groupées ───────────────
adminMiscRouter.get("/groups", async (req, res) => {
  const q = paginationSchema.extend({ status: z.enum(["OPEN", "CLOSED", "IN_PRODUCTION", "READY", "COMPLETED", "CANCELLED"]).optional(), q: z.string().trim().max(100).optional() }).parse(req.query);
  const where: Prisma.GroupOrderWhereInput = {
    ...(q.status ? { status: q.status } : {}),
    ...(q.q
      ? {
          OR: [
            { code: { contains: q.q, mode: "insensitive" } },
            { name: { contains: q.q, mode: "insensitive" } },
            { institution: { contains: q.q, mode: "insensitive" } },
            { className: { contains: q.q, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const [groups, total] = await Promise.all([
    prisma.groupOrder.findMany({
      where,
      orderBy: { createdAt: "desc" },
      ...paginate(q.page, q.pageSize),
      include: { delegate: { select: { fullName: true, phone: true } }, orders: { select: { status: true, paymentStatus: true, total: true, amountPaid: true } } },
    }),
    prisma.groupOrder.count({ where }),
  ]);
  res.json(
    pageResult(
      groups.map((g) => {
        const confirmed = g.orders.filter((o) => !["DRAFT", "CANCELLED", "REFUNDED"].includes(o.status));
        return {
          id: g.id,
          code: g.code,
          name: g.name,
          institution: g.institution,
          className: g.className,
          mode: g.mode,
          status: g.status,
          statusLabel: GROUP_STATUS_LABELS[g.status],
          productionRule: g.productionRule,
          delegate: g.delegate,
          ordersCount: confirmed.length,
          paidCount: confirmed.filter((o) => o.paymentStatus === "PAID").length,
          totalAmount: confirmed.reduce((s, o) => s + (o.total ?? 0), 0),
          paidAmount: confirmed.reduce((s, o) => s + (o.paymentStatus === "PAID" ? o.amountPaid : 0), 0),
          deadline: g.deadline,
          createdAt: g.createdAt,
        };
      }),
      total,
      q.page,
      q.pageSize,
    ),
  );
});

adminMiscRouter.get("/groups/:id", async (req, res) => {
  const { group } = await loadGroupForViewer(currentUser(req), param(req, "id"));
  res.json({ group: serializeGroup(group, "staff") });
});

adminMiscRouter.post("/groups/:id/start-production", async (req, res) => {
  const input = z.object({ override: z.boolean().default(false), reason: z.string().trim().max(500).optional() }).parse(req.body ?? {});
  const result = await startGroupProduction(currentUser(req), param(req, "id"), input, req.ip);
  const { group } = await loadGroupForViewer(currentUser(req), param(req, "id"));
  res.json({ group: serializeGroup(group, "staff"), ...result });
});

adminMiscRouter.post("/groups/:id/cancel", requireAdmin, async (req, res) => {
  await cancelGroup(currentUser(req), param(req, "id"));
  const { group } = await loadGroupForViewer(currentUser(req), param(req, "id"));
  res.json({ group: serializeGroup(group, "staff") });
});

// ─────────────── Devis ───────────────
adminMiscRouter.get("/quotes", requireAdmin, async (req, res) => {
  const q = paginationSchema.extend({ status: z.enum(["REQUESTED", "QUOTED", "ACCEPTED", "REJECTED", "CANCELLED", "EXPIRED"]).optional() }).parse(req.query);
  const where = q.status ? { status: q.status } : {};
  const [items, total] = await Promise.all([
    prisma.quote.findMany({ where, include: quoteInclude, orderBy: { createdAt: "desc" }, ...paginate(q.page, q.pageSize) }),
    prisma.quote.count({ where }),
  ]);
  res.json(pageResult(items.map((x) => serializeQuote(x, "staff")), total, q.page, q.pageSize));
});

adminMiscRouter.get("/quotes/:id", requireAdmin, async (req, res) => {
  const quote = await prisma.quote.findUnique({ where: { id: param(req, "id") }, include: quoteInclude });
  if (!quote) throw notFound("Devis introuvable.");
  res.json({ quote: serializeQuote(quote, "staff") });
});

adminMiscRouter.post("/quotes/:id/send", requireAdmin, async (req, res) => {
  const input = quoteLinesSchema.parse(req.body);
  const quote = await sendQuote(currentUser(req), param(req, "id"), input, req.ip);
  res.json({ quote: serializeQuote(quote, "staff") });
});

adminMiscRouter.post("/quotes/:id/cancel", requireAdmin, async (req, res) => {
  const { reason } = z.object({ reason: z.string().trim().min(3).max(500) }).parse(req.body);
  const quote = await prisma.quote.findUnique({ where: { id: param(req, "id") } });
  if (!quote) throw notFound("Devis introuvable.");
  if (!["REQUESTED", "QUOTED"].includes(quote.status)) throw conflict("Ce devis ne peut plus être annulé.");
  const updated = await prisma.quote.update({ where: { id: quote.id }, data: { status: "CANCELLED", adminMessage: reason }, include: quoteInclude });
  await audit({ actorId: currentUser(req).id, action: "quote.cancelled", entityType: "Quote", entityId: quote.id, metadata: { reason }, ip: req.ip });
  await notify({ userId: quote.customerId, type: "QUOTE_CANCELLED", title: `Demande ${quote.reference} clôturée`, body: reason, link: `/espace/devis/${quote.id}` });
  res.json({ quote: serializeQuote(updated, "staff") });
});

// ─────────────── Journal d'audit ───────────────
adminMiscRouter.get("/audit-logs", requireAdmin, async (req, res) => {
  const q = paginationSchema.extend({ action: z.string().trim().max(80).optional(), entityType: z.string().trim().max(60).optional(), entityId: z.string().max(64).optional() }).parse(req.query);
  const where: Prisma.AuditLogWhereInput = {
    ...(q.action ? { action: { contains: q.action } } : {}),
    ...(q.entityType ? { entityType: q.entityType } : {}),
    ...(q.entityId ? { entityId: q.entityId } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.auditLog.findMany({ where, include: { actor: { select: { fullName: true, roleCode: true } } }, orderBy: { createdAt: "desc" }, ...paginate(q.page, q.pageSize) }),
    prisma.auditLog.count({ where }),
  ]);
  res.json(pageResult(items, total, q.page, q.pageSize));
});
