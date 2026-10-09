import { Router } from "express";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { badRequest, conflict, forbidden, notFound } from "../../lib/errors";
import { paginate, pageResult, paginationSchema } from "../../lib/pagination";
import { toCsv } from "../../lib/csv";
import { formatFcfa } from "../../lib/format";
import { safeEqual } from "../../lib/ids";
import { currentUser, requireAdmin } from "../../middleware/auth";
import { audit } from "../audit/audit";
import { notify } from "../notifications/notifications.service";
import { getSettings } from "../settings/settings.service";
import { assertCanDownload } from "../documents/documents.service";
import { getStorage } from "../storage/storage";
import { priceItem, PricingError, type FinishingLike, type PriceRuleLike } from "../pricing/pricing";
import {
  getOrderDetail,
  lockOrder,
  recordAdminCredit,
  serializeOrder,
  transitionOrder,
} from "../orders/orders.service";
import { STATUS_LABELS, validateManualTransition } from "../orders/status";
import { serializePayment } from "../payments/payments.service";
import { param } from "../../lib/http";

export const adminOrdersRouter = Router();

const ORDER_STATUSES = [
  "DRAFT",
  "PENDING_PAYMENT",
  "PAID",
  "TO_PREPARE",
  "PRINTING",
  "FINISHING",
  "READY_FOR_PICKUP",
  "OUT_FOR_DELIVERY",
  "COMPLETED",
  "CANCELLED",
  "REFUNDED",
] as const;

const filtersSchema = paginationSchema.extend({
  status: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(",").filter((s): s is (typeof ORDER_STATUSES)[number] => (ORDER_STATUSES as readonly string[]).includes(s)) : undefined)),
  type: z.enum(["STANDARD", "GROUP", "SERVICE"]).optional(),
  paymentStatus: z.enum(["UNPAID", "PENDING", "PAID", "REFUNDED"]).optional(),
  fulfillment: z.enum(["PICKUP", "DELIVERY"]).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  q: z.string().trim().max(100).optional(),
  groupId: z.string().max(64).optional(),
  includeDrafts: z.enum(["true", "false"]).optional(),
});

function buildWhere(f: z.infer<typeof filtersSchema>): Prisma.OrderWhereInput {
  const to = f.to ? new Date(f.to.getTime() + 24 * 60 * 60 * 1000 - 1) : undefined;
  return {
    ...(f.status && f.status.length > 0 ? { status: { in: f.status } } : f.includeDrafts === "true" ? {} : { status: { not: "DRAFT" } }),
    ...(f.type ? { type: f.type } : {}),
    ...(f.paymentStatus ? { paymentStatus: f.paymentStatus } : {}),
    ...(f.fulfillment ? { fulfillmentMethod: f.fulfillment } : {}),
    ...(f.groupId ? { groupOrderId: f.groupId } : {}),
    ...(f.from || to ? { createdAt: { ...(f.from ? { gte: f.from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    ...(f.q
      ? {
          OR: [
            { reference: { contains: f.q, mode: "insensitive" } },
            { customer: { fullName: { contains: f.q, mode: "insensitive" } } },
            { customer: { phone: { contains: f.q.replace(/\s/g, "") } } },
          ],
        }
      : {}),
  };
}

const listInclude = {
  customer: { select: { id: true, fullName: true, phone: true } },
  items: { select: { pageCount: true, sheets: true, copies: true, document: { select: { pageCountSource: true } } } },
  groupOrder: { select: { id: true, code: true, name: true } },
  pickup: { select: { status: true, readyAt: true, rescheduledTo: true } },
} satisfies Prisma.OrderInclude;

type ListOrder = Prisma.OrderGetPayload<{ include: typeof listInclude }>;

function serializeListOrder(o: ListOrder, holdDays: number) {
  const overdue =
    o.status === "READY_FOR_PICKUP" &&
    o.readyAt !== null &&
    Date.now() - (o.pickup?.rescheduledTo ?? o.readyAt).getTime() > holdDays * 24 * 60 * 60 * 1000;
  return {
    id: o.id,
    reference: o.reference,
    type: o.type,
    status: o.status,
    statusLabel: STATUS_LABELS[o.status],
    paymentStatus: o.paymentStatus,
    creditApproved: o.creditApproved,
    fulfillmentMethod: o.fulfillmentMethod,
    total: o.total,
    customer: o.customer,
    group: o.groupOrder,
    itemsCount: o.items.length,
    pagesCount: o.items.reduce((s, i) => s + i.pageCount, 0),
    sheetsCount: o.items.reduce((s, i) => s + i.sheets, 0),
    needsPageCheck: o.items.some((i) => i.document?.pageCountSource === "CUSTOMER_DECLARED"),
    overduePickup: overdue,
    reminderCount: o.reminderCount,
    createdAt: o.createdAt,
    paidAt: o.paidAt,
    readyAt: o.readyAt,
  };
}

adminOrdersRouter.get("/orders", async (req, res) => {
  const f = filtersSchema.parse(req.query);
  const where = buildWhere(f);
  const settings = await getSettings();
  const [orders, total] = await Promise.all([
    prisma.order.findMany({ where, include: listInclude, orderBy: { createdAt: "desc" }, ...paginate(f.page, f.pageSize) }),
    prisma.order.count({ where }),
  ]);
  res.json(pageResult(orders.map((o) => serializeListOrder(o, settings["pickup.holdDays"])), total, f.page, f.pageSize));
});

adminOrdersRouter.get("/orders/export.csv", requireAdmin, async (req, res) => {
  const f = filtersSchema.parse({ ...req.query, page: 1, pageSize: 100 });
  const orders = await prisma.order.findMany({
    where: buildWhere(f),
    include: { ...listInclude, pickupPoint: true, delivery: true },
    orderBy: { createdAt: "desc" },
    take: 10_000,
  });
  const csv = toCsv(
    ["Référence", "Date", "Type", "Statut", "Paiement", "Client", "Téléphone", "Documents", "Pages", "Feuilles", "Remise", "Sous-total", "Livraison", "Total", "Payé", "Groupe"],
    orders.map((o) => [
      o.reference,
      o.createdAt,
      o.type,
      STATUS_LABELS[o.status],
      o.paymentStatus,
      o.customer.fullName,
      o.customer.phone,
      o.items.length,
      o.items.reduce((s, i) => s + i.pageCount, 0),
      o.items.reduce((s, i) => s + i.sheets, 0),
      o.fulfillmentMethod === "DELIVERY" ? `Livraison ${o.delivery?.quarter ?? ""}` : `Retrait ${o.pickupPoint?.name ?? ""}`,
      o.subtotal,
      o.deliveryFee ?? "",
      o.total ?? "",
      o.amountPaid,
      o.groupOrder?.code ?? "",
    ]),
  );
  await audit({ actorId: currentUser(req).id, action: "orders.exported", entityType: "Order", metadata: { count: orders.length }, ip: req.ip });
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="commandes-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(csv);
});

/** File de production : commandes payées (ou autorisées) à préparer, en cours, puis prêtes. */
adminOrdersRouter.get("/production", async (_req, res) => {
  const settings = await getSettings();
  const orders = await prisma.order.findMany({
    where: {
      OR: [
        { status: { in: ["TO_PREPARE", "PRINTING", "FINISHING", "READY_FOR_PICKUP", "OUT_FOR_DELIVERY"] } },
        { status: "PAID", OR: [{ groupOrderId: null }, { groupOrder: { mode: "DELEGATE_COLLECT" } }] },
        { status: "PENDING_PAYMENT", creditApproved: true },
      ],
    },
    include: listInclude,
    orderBy: [{ paidAt: "asc" }, { createdAt: "asc" }],
    take: 500,
  });
  const serialized = orders.map((o) => serializeListOrder(o, settings["pickup.holdDays"]));
  res.json({
    toRelease: serialized.filter((o) => o.status === "PAID" || o.status === "PENDING_PAYMENT"),
    inProduction: serialized.filter((o) => ["TO_PREPARE", "PRINTING", "FINISHING"].includes(o.status)),
    ready: serialized.filter((o) => ["READY_FOR_PICKUP", "OUT_FOR_DELIVERY"].includes(o.status)),
  });
});

adminOrdersRouter.get("/orders/:id", async (req, res) => {
  const order = await getOrderDetail(param(req, "id"));
  res.json({ order: serializeOrder(order, "staff") });
});

adminOrdersRouter.post("/orders/:id/status", async (req, res) => {
  const me = currentUser(req);
  const input = z.object({ status: z.enum(ORDER_STATUSES), note: z.string().trim().max(500).optional() }).parse(req.body);
  await prisma.$transaction(async (tx) => {
    await lockOrder(tx, param(req, "id"));
    const order = await tx.order.findUnique({ where: { id: param(req, "id") } });
    if (!order) throw notFound("Commande introuvable.");
    const error = validateManualTransition(order.status, input.status, me.roleCode, order.fulfillmentMethod);
    if (error) throw conflict(error, "INVALID_TRANSITION");
    await transitionOrder(tx, order.id, input.status, { actorId: me.id, note: input.note });
    await audit({ actorId: me.id, action: "order.status_changed", entityType: "Order", entityId: order.id, metadata: { from: order.status, to: input.status }, ip: req.ip }, tx);
  });
  res.json({ order: serializeOrder(await getOrderDetail(param(req, "id")), "staff") });
});

/** Exception administrateur : production autorisée sans paiement (client régulier, crédit). */
adminOrdersRouter.post("/orders/:id/credit", requireAdmin, async (req, res) => {
  const { reason } = z.object({ reason: z.string().trim().min(5, "Motif obligatoire").max(500) }).parse(req.body);
  const order = await recordAdminCredit(currentUser(req), param(req, "id"), reason, req.ip);
  res.json({ order: serializeOrder(order, "staff") });
});

adminOrdersRouter.post("/orders/:id/delivery-fee", requireAdmin, async (req, res) => {
  const me = currentUser(req);
  const { fee } = z.object({ fee: z.number().int().min(0).max(1_000_000) }).parse(req.body);
  await prisma.$transaction(async (tx) => {
    await lockOrder(tx, param(req, "id"));
    const order = await tx.order.findUnique({ where: { id: param(req, "id") } });
    if (!order) throw notFound("Commande introuvable.");
    if (order.fulfillmentMethod !== "DELIVERY") throw badRequest("Cette commande n'est pas en livraison.");
    if (order.paymentStatus === "PAID" || !["DRAFT", "PENDING_PAYMENT"].includes(order.status)) {
      throw conflict("Les frais ne peuvent plus être modifiés après paiement.");
    }
    const pending = await tx.payment.count({ where: { orderId: order.id, status: { in: ["CREATED", "PENDING", "PENDING_VERIFICATION"] } } });
    if (pending > 0) throw conflict("Un paiement est en cours pour cette commande.");
    await tx.order.update({ where: { id: order.id }, data: { deliveryFee: fee, total: order.subtotal + fee } });
    await tx.delivery.updateMany({ where: { orderId: order.id }, data: { fee } });
    await audit({ actorId: me.id, action: "order.delivery_fee_set", entityType: "Order", entityId: order.id, metadata: { fee }, ip: req.ip }, tx);
    await notify(
      {
        userId: order.customerId,
        orderId: order.id,
        type: "DELIVERY_FEE_CONFIRMED",
        title: `Frais de livraison confirmés — ${order.reference}`,
        body: `Frais de livraison : ${formatFcfa(fee)}. Total à régler : ${formatFcfa(order.subtotal + fee)}. Vous pouvez maintenant payer votre commande.`,
        link: `/espace/commandes/${order.id}`,
      },
      tx,
    );
  });
  res.json({ order: serializeOrder(await getOrderDetail(param(req, "id")), "staff") });
});

/** Vérification des pages déclarées par le client (avant paiement) : recalcul avec la grille figée. */
adminOrdersRouter.post("/orders/:id/items/:itemId/verify-pages", async (req, res) => {
  const me = currentUser(req);
  const { pageCount } = z.object({ pageCount: z.number().int().min(1).max(10_000) }).parse(req.body);
  await prisma.$transaction(async (tx) => {
    await lockOrder(tx, param(req, "id"));
    const order = await tx.order.findUnique({ where: { id: param(req, "id") }, include: { items: { include: { printConfig: true } }, payments: true } });
    if (!order) throw notFound("Commande introuvable.");
    const item = order.items.find((i) => i.id === param(req, "itemId"));
    if (!item || !item.printConfig || !item.documentId) throw notFound("Ligne introuvable.");
    if (item.pageCount === pageCount) {
      await tx.document.update({ where: { id: item.documentId }, data: { pageCountSource: "STAFF_SET", analysisError: null } });
      return;
    }
    if (order.status !== "PENDING_PAYMENT" || order.payments.some((p) => ["CREATED", "PENDING", "PENDING_VERIFICATION", "SUCCESSFUL"].includes(p.status))) {
      throw conflict("Le nombre de pages ne peut être corrigé qu'avant tout paiement. Contactez le client pour régulariser.");
    }
    const snapshot = order.pricingSnapshot as { rules?: PriceRuleLike[]; finishings?: FinishingLike[] } | null;
    if (!snapshot?.rules || !snapshot.finishings) throw conflict("Grille tarifaire de la commande indisponible.");
    let price;
    try {
      price = priceItem(pageCount, item.printConfig, snapshot.rules, snapshot.finishings);
    } catch (error) {
      if (error instanceof PricingError) throw conflict(error.message);
      throw error;
    }
    await tx.orderItem.update({
      where: { id: item.id },
      data: { pageCount, sheets: price.sheets, faces: price.faces, printCost: price.printCost, finishingCost: price.finishingCost, lineTotal: price.lineTotal },
    });
    await tx.document.update({ where: { id: item.documentId }, data: { pageCount, pageCountSource: "STAFF_SET", analysisError: null } });
    const items = await tx.orderItem.findMany({ where: { orderId: order.id } });
    const subtotal = items.reduce((s, i) => s + i.lineTotal, 0);
    await tx.order.update({
      where: { id: order.id },
      data: { subtotal, total: order.deliveryFee === null && order.fulfillmentMethod === "DELIVERY" ? null : subtotal + (order.deliveryFee ?? 0) },
    });
    await audit({ actorId: me.id, action: "order.pages_corrected", entityType: "Order", entityId: order.id, metadata: { itemId: item.id, from: item.pageCount, to: pageCount }, ip: req.ip }, tx);
    await notify(
      {
        userId: order.customerId,
        orderId: order.id,
        type: "ORDER_UPDATED",
        title: `Commande ${order.reference} mise à jour`,
        body: `Le nombre de pages de « ${item.documentName} » a été vérifié (${pageCount} pages). Le montant a été recalculé.`,
        link: `/espace/commandes/${order.id}`,
      },
      tx,
    );
  });
  res.json({ order: serializeOrder(await getOrderDetail(param(req, "id")), "staff") });
});

/** Remise au point de retrait avec preuve (code de retrait ou vérification d'identité). */
adminOrdersRouter.post("/orders/:id/handover", async (req, res) => {
  const me = currentUser(req);
  const input = z
    .object({
      code: z.string().trim().max(10).optional(),
      recipientName: z.string().trim().min(2).max(120),
      note: z.string().trim().max(500).optional(),
    })
    .parse(req.body);
  await prisma.$transaction(async (tx) => {
    await lockOrder(tx, param(req, "id"));
    const order = await tx.order.findUnique({ where: { id: param(req, "id") } });
    if (!order) throw notFound("Commande introuvable.");
    if (order.status !== "READY_FOR_PICKUP") throw conflict("La commande n'est pas prête à être retirée.");
    const verified = Boolean(input.code) && safeEqual(input.code as string, order.pickupCode);
    if (input.code && !verified) throw badRequest("Code de retrait incorrect.", "INVALID_PICKUP_CODE");
    if (!verified && (!input.note || input.note.length < 5)) {
      throw badRequest("Sans code de retrait, précisez la vérification effectuée (pièce d'identité, appel…).");
    }
    await tx.pickup.upsert({
      where: { orderId: order.id },
      create: { orderId: order.id, pickupPointId: order.pickupPointId, status: "PICKED_UP", pickedUpAt: new Date(), pickedUpBy: input.recipientName, verifiedWithCode: verified, note: input.note, handledById: me.id },
      update: { status: "PICKED_UP", pickedUpAt: new Date(), pickedUpBy: input.recipientName, verifiedWithCode: verified, note: input.note, handledById: me.id },
    });
    await transitionOrder(tx, order.id, "COMPLETED", { actorId: me.id, note: `Retirée par ${input.recipientName}${verified ? " (code vérifié)" : ""}` });
    await audit({ actorId: me.id, action: "order.handed_over", entityType: "Order", entityId: order.id, metadata: { recipientName: input.recipientName, verified }, ip: req.ip }, tx);
  });
  res.json({ order: serializeOrder(await getOrderDetail(param(req, "id")), "staff") });
});

adminOrdersRouter.post("/orders/:id/deliver", async (req, res) => {
  const me = currentUser(req);
  const input = z.object({ receivedBy: z.string().trim().min(2).max(120), note: z.string().trim().max(500).optional() }).parse(req.body);
  await prisma.$transaction(async (tx) => {
    await lockOrder(tx, param(req, "id"));
    const order = await tx.order.findUnique({ where: { id: param(req, "id") } });
    if (!order) throw notFound("Commande introuvable.");
    if (order.status !== "OUT_FOR_DELIVERY") throw conflict("La commande n'est pas en livraison.");
    await tx.delivery.update({
      where: { orderId: order.id },
      data: { status: "DELIVERED", deliveredAt: new Date(), receivedBy: input.receivedBy, proofNote: input.note, handledById: me.id },
    });
    await transitionOrder(tx, order.id, "COMPLETED", { actorId: me.id, note: `Livrée à ${input.receivedBy}` });
    await audit({ actorId: me.id, action: "order.delivered", entityType: "Order", entityId: order.id, metadata: { receivedBy: input.receivedBy }, ip: req.ip }, tx);
  });
  res.json({ order: serializeOrder(await getOrderDetail(param(req, "id")), "staff") });
});

adminOrdersRouter.post("/orders/:id/delivery-failed", async (req, res) => {
  const me = currentUser(req);
  const { note } = z.object({ note: z.string().trim().min(5).max(500) }).parse(req.body);
  await prisma.$transaction(async (tx) => {
    await lockOrder(tx, param(req, "id"));
    const order = await tx.order.findUnique({ where: { id: param(req, "id") } });
    if (!order) throw notFound("Commande introuvable.");
    if (order.status !== "OUT_FOR_DELIVERY") throw conflict("La commande n'est pas en livraison.");
    await tx.delivery.update({ where: { orderId: order.id }, data: { status: "FAILED", proofNote: note, handledById: me.id } });
    await transitionOrder(tx, order.id, "READY_FOR_PICKUP", { actorId: me.id, note: `Livraison échouée : ${note}` });
    await audit({ actorId: me.id, action: "order.delivery_failed", entityType: "Order", entityId: order.id, metadata: { note }, ip: req.ip }, tx);
  });
  res.json({ order: serializeOrder(await getOrderDetail(param(req, "id")), "staff") });
});

adminOrdersRouter.post("/orders/:id/pickup-reschedule", async (req, res) => {
  const me = currentUser(req);
  const input = z.object({ date: z.coerce.date(), note: z.string().trim().max(500).optional() }).parse(req.body);
  const order = await prisma.order.findUnique({ where: { id: param(req, "id") }, include: { pickupPoint: true } });
  if (!order) throw notFound("Commande introuvable.");
  if (order.status !== "READY_FOR_PICKUP") throw conflict("La commande n'est pas en attente de retrait.");
  await prisma.pickup.update({ where: { orderId: order.id }, data: { rescheduledTo: input.date, note: input.note, status: "READY" } });
  await audit({ actorId: me.id, action: "order.pickup_rescheduled", entityType: "Order", entityId: order.id, metadata: { date: input.date.toISOString() }, ip: req.ip });
  await notify({
    userId: order.customerId,
    orderId: order.id,
    type: "PICKUP_RESCHEDULED",
    title: `Retrait reporté — ${order.reference}`,
    body: `Votre commande reste disponible${order.pickupPoint ? ` à « ${order.pickupPoint.name} »` : ""} jusqu'au ${input.date.toLocaleDateString("fr-FR")}. Code de retrait : ${order.pickupCode}.`,
    link: `/espace/commandes/${order.id}`,
  });
  res.json({ order: serializeOrder(await getOrderDetail(order.id), "staff") });
});

adminOrdersRouter.post("/orders/:id/not-collected", requireAdmin, async (req, res) => {
  const me = currentUser(req);
  const { note } = z.object({ note: z.string().trim().min(5).max(500) }).parse(req.body);
  const order = await prisma.order.findUnique({ where: { id: param(req, "id") } });
  if (!order) throw notFound("Commande introuvable.");
  if (order.status !== "READY_FOR_PICKUP") throw conflict("La commande n'est pas en attente de retrait.");
  await prisma.pickup.update({ where: { orderId: order.id }, data: { status: "NOT_COLLECTED", note } });
  await audit({ actorId: me.id, action: "order.not_collected", entityType: "Order", entityId: order.id, metadata: { note }, ip: req.ip });
  res.json({ order: serializeOrder(await getOrderDetail(order.id), "staff") });
});

adminOrdersRouter.post("/orders/:id/remind", async (req, res) => {
  const me = currentUser(req);
  const order = await prisma.order.findUnique({ where: { id: param(req, "id") }, include: { pickupPoint: true } });
  if (!order) throw notFound("Commande introuvable.");
  if (order.status !== "READY_FOR_PICKUP") throw conflict("La commande n'est pas en attente de retrait.");
  await notify({
    userId: order.customerId,
    orderId: order.id,
    type: "PICKUP_REMINDER",
    title: `Rappel : votre commande ${order.reference} vous attend`,
    body: `Votre commande est prête${order.pickupPoint ? ` à « ${order.pickupPoint.name} »` : ""}. Code de retrait : ${order.pickupCode}.`,
    link: `/espace/commandes/${order.id}`,
  });
  await prisma.order.update({ where: { id: order.id }, data: { reminderCount: { increment: 1 }, lastReminderAt: new Date() } });
  await audit({ actorId: me.id, action: "order.reminder_sent", entityType: "Order", entityId: order.id, ip: req.ip });
  res.json({ ok: true });
});

adminOrdersRouter.post("/orders/:id/cancel", requireAdmin, async (req, res) => {
  const me = currentUser(req);
  const { reason } = z.object({ reason: z.string().trim().min(5).max(500) }).parse(req.body);
  await prisma.$transaction(async (tx) => {
    await lockOrder(tx, param(req, "id"));
    const order = await tx.order.findUnique({ where: { id: param(req, "id") } });
    if (!order) throw notFound("Commande introuvable.");
    if (!["DRAFT", "PENDING_PAYMENT", "PAID", "TO_PREPARE"].includes(order.status)) {
      throw conflict("Commande déjà en impression ou terminée : annulation impossible.");
    }
    await tx.payment.updateMany({
      where: { orderId: order.id, status: { in: ["CREATED", "PENDING", "PENDING_VERIFICATION"] } },
      data: { status: "CANCELLED", failureReason: "Commande annulée par l'administration" },
    });
    await transitionOrder(tx, order.id, "CANCELLED", { actorId: me.id, note: reason });
    await audit({ actorId: me.id, action: "order.cancelled", entityType: "Order", entityId: order.id, metadata: { reason, paid: order.paymentStatus === "PAID" }, ip: req.ip }, tx);
  });
  res.json({ order: serializeOrder(await getOrderDetail(param(req, "id")), "staff") });
});

/**
 * Enregistrement d'un remboursement effectué (Fapshi ne propose pas d'API de
 * remboursement : le remboursement est réalisé hors application puis consigné ici).
 */
adminOrdersRouter.post("/orders/:id/refund", requireAdmin, async (req, res) => {
  const me = currentUser(req);
  const input = z
    .object({
      amount: z.number().int().positive(),
      method: z.enum(["MOBILE_MONEY", "CASH", "FAPSHI_PAYOUT", "OTHER"]),
      reference: z.string().trim().max(120).optional(),
      note: z.string().trim().min(5).max(500),
    })
    .parse(req.body);
  await prisma.$transaction(async (tx) => {
    await lockOrder(tx, param(req, "id"));
    const order = await tx.order.findUnique({ where: { id: param(req, "id") }, include: { refunds: true, payments: true } });
    if (!order) throw notFound("Commande introuvable.");
    const received = order.payments.filter((p) => p.status === "SUCCESSFUL").reduce((s, p) => s + p.amount, 0);
    const refunded = order.refunds.reduce((s, r) => s + r.amount, 0);
    if (input.amount > received - refunded) throw badRequest(`Montant supérieur au montant remboursable (${formatFcfa(received - refunded)}).`);
    await tx.refund.create({ data: { orderId: order.id, amount: input.amount, method: input.method, reference: input.reference, note: input.note, processedById: me.id } });
    const fullyRefunded = order.status === "CANCELLED" && refunded + input.amount >= order.amountPaid && order.amountPaid > 0;
    if (fullyRefunded) {
      await tx.order.update({ where: { id: order.id }, data: { paymentStatus: "REFUNDED" } });
      await transitionOrder(tx, order.id, "REFUNDED", { actorId: me.id, note: `Remboursement ${formatFcfa(input.amount)} (${input.method})` });
    }
    await audit({ actorId: me.id, action: "order.refund_recorded", entityType: "Order", entityId: order.id, metadata: { ...input, fullyRefunded }, ip: req.ip }, tx);
  });
  res.json({ order: serializeOrder(await getOrderDetail(param(req, "id")), "staff") });
});

/** Paiement en espèces reçu au comptoir par un administrateur. */
adminOrdersRouter.post("/orders/:id/cash-payment", requireAdmin, async (req, res) => {
  const me = currentUser(req);
  const { note } = z.object({ note: z.string().trim().min(3).max(500) }).parse(req.body);
  const payment = await prisma.$transaction(async (tx) => {
    await lockOrder(tx, param(req, "id"));
    const order = await tx.order.findUnique({ where: { id: param(req, "id") }, include: { payments: true } });
    if (!order) throw notFound("Commande introuvable.");
    if (order.status !== "PENDING_PAYMENT" || order.paymentStatus === "PAID") throw conflict("Cette commande n'est pas en attente de paiement.");
    if (order.total === null || order.total <= 0) throw conflict("Le montant total n'est pas encore défini.");
    if (order.payments.some((p) => ["PENDING", "PENDING_VERIFICATION"].includes(p.status))) throw conflict("Un autre paiement est en cours.");
    const p = await tx.payment.create({
      data: {
        orderId: order.id,
        provider: "CASH",
        method: "CASH_DECLARATION",
        environment: "OFFLINE",
        status: "SUCCESSFUL",
        amount: order.total,
        declaredById: me.id,
        declarationNote: note,
        verifiedById: me.id,
        verifiedAt: new Date(),
        confirmedAt: new Date(),
      },
    });
    await tx.payment.updateMany({ where: { orderId: order.id, id: { not: p.id }, status: "CREATED" }, data: { status: "CANCELLED" } });
    await tx.order.update({ where: { id: order.id }, data: { paymentStatus: "PAID", amountPaid: { increment: order.total }, paidAt: new Date() } });
    await transitionOrder(tx, order.id, "PAID", { actorId: me.id, note: "Paiement en espèces reçu au comptoir" });
    await tx.paymentEvent.create({ data: { paymentId: p.id, provider: "CASH", type: "CASH_RECEIVED", payload: { amount: order.total } } });
    await audit({ actorId: me.id, action: "payment.cash_recorded", entityType: "Payment", entityId: p.id, metadata: { orderId: order.id, amount: order.total, note }, ip: req.ip }, tx);
    await notify(
      {
        userId: order.customerId,
        orderId: order.id,
        type: "PAYMENT_CONFIRMED",
        title: `Paiement confirmé — ${order.reference}`,
        body: `Paiement de ${formatFcfa(order.total)} reçu. Code de retrait : ${order.pickupCode}.`,
        link: `/espace/commandes/${order.id}`,
      },
      tx,
    );
    return p;
  });
  res.status(201).json({ payment: serializePayment(payment) });
});

adminOrdersRouter.get("/documents/:id/download", async (req, res) => {
  const me = currentUser(req);
  const { variant } = z.object({ variant: z.enum(["original", "pdf"]).default("original") }).parse(req.query);
  const doc = await prisma.document.findUnique({ where: { id: param(req, "id") } });
  if (!doc || doc.status === "DELETED" || doc.purgedAt) throw notFound("Document introuvable ou supprimé.");
  await assertCanDownload(me, doc);
  if (me.roleCode === "OPERATOR") {
    // L'opérateur n'accède qu'aux fichiers des commandes payées ou autorisées
    const allowed = await prisma.orderItem.findFirst({
      where: { documentId: doc.id, order: { OR: [{ paymentStatus: "PAID" }, { creditApproved: true }] } },
    });
    if (!allowed && !doc.quoteId) throw forbidden("Fichier accessible après confirmation du paiement.");
  }
  const key = variant === "pdf" && doc.pdfStorageKey ? doc.pdfStorageKey : doc.storageKey;
  const filename = variant === "pdf" && doc.pdfStorageKey ? doc.originalName.replace(/\.[^.]+$/, "") + ".pdf" : doc.originalName;
  const url = await getStorage().getDownloadUrl(key, { filename, expiresInSec: 300, inline: variant === "pdf" });
  await audit({ actorId: me.id, action: "document.downloaded", entityType: "Document", entityId: doc.id, metadata: { variant }, ip: req.ip });
  res.json({ url, expiresInSec: 300 });
});
