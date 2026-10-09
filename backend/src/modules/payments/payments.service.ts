import { Prisma, type Payment, type User } from "@prisma/client";
import { prisma, type Tx } from "../../lib/prisma";
import { logger } from "../../lib/logger";
import { AppError, badRequest, conflict, forbidden, notFound, serviceUnavailable } from "../../lib/errors";
import { formatFcfa } from "../../lib/format";
import { nationalNumber } from "../../lib/phone";
import { env, frontendUrl } from "../../config/env";
import { registerJobHandler } from "../../jobs/queue";
import { audit } from "../audit/audit";
import { notify } from "../notifications/notifications.service";
import { getOrderDetail, lockOrder, MIN_ONLINE_PAYMENT, paymentEligibility, transitionOrder } from "../orders/orders.service";
import { refreshGroupStatus } from "../orders/groupStatus";
import { FapshiAdapter } from "./fapshi";
import { MockPaymentAdapter } from "./mock";
import { ProviderError, type PaymentProviderAdapter, type ProviderTransaction } from "./provider";

let provider: PaymentProviderAdapter | null | undefined;

export function getPaymentProvider(): PaymentProviderAdapter | null {
  if (provider !== undefined) return provider;
  switch (env.PAYMENT_PROVIDER) {
    case "fapshi":
      provider = new FapshiAdapter();
      break;
    case "mock":
      provider = new MockPaymentAdapter();
      break;
    default:
      provider = null;
  }
  return provider;
}

/** Pour les tests : injecte un fournisseur. */
export function setPaymentProvider(p: PaymentProviderAdapter | null) {
  provider = p;
}

export function paymentsPublicConfig() {
  const p = getPaymentProvider();
  return {
    enabled: Boolean(p),
    provider: p?.name ?? null,
    environment: p?.environment ?? null,
    testMode: p ? p.environment !== "LIVE" : false,
    directPay: Boolean(p?.supportsDirectPay),
    minAmount: MIN_ONLINE_PAYMENT,
  };
}

/** Données d'événement nettoyées (aucun secret, aucune clé). */
function sanitize(data: unknown): Prisma.InputJsonValue | undefined {
  if (!data || typeof data !== "object") return undefined;
  const allowed = [
    "transId",
    "status",
    "medium",
    "serviceName",
    "amount",
    "revenue",
    "externalId",
    "financialTransId",
    "dateInitiated",
    "dateConfirmed",
    "reason",
    "source",
    "message",
  ];
  const out: Record<string, unknown> = {};
  for (const key of allowed) {
    const v = (data as Record<string, unknown>)[key];
    if (v !== undefined && v !== null) out[key] = typeof v === "string" ? v.slice(0, 300) : v;
  }
  return out as Prisma.InputJsonValue;
}

async function recordEvent(
  db: Tx | typeof prisma,
  data: { paymentId?: string | null; provider: Payment["provider"]; type: string; providerTransId?: string | null; dedupeKey?: string; payload?: unknown },
) {
  return db.paymentEvent.create({
    data: {
      paymentId: data.paymentId ?? null,
      provider: data.provider,
      type: data.type,
      providerTransId: data.providerTransId ?? null,
      dedupeKey: data.dedupeKey,
      payload: sanitize(data.payload),
    },
  });
}

async function lockPayment(tx: Tx, paymentId: string) {
  await tx.$queryRaw`SELECT "id" FROM "Payment" WHERE "id" = ${paymentId} FOR UPDATE`;
}

async function notifyAdmins(tx: Tx, input: { orderId: string; type: string; title: string; body: string }) {
  const admins = await tx.user.findMany({ where: { roleCode: "ADMIN", isActive: true }, select: { id: true } });
  for (const admin of admins) {
    await notify({ userId: admin.id, orderId: input.orderId, type: input.type, title: input.title, body: input.body, link: `/admin/commandes/${input.orderId}`, email: false }, tx);
  }
}

export interface InitiateInput {
  method: "CHECKOUT" | "DIRECT";
  phone?: string;
  medium?: "mobile money" | "orange money";
}

/**
 * Crée une tentative de paiement pour une commande confirmée.
 * Le montant provient exclusivement de la commande enregistrée côté serveur.
 */
export async function initiatePayment(user: User, orderId: string, input: InitiateInput) {
  const adapter = getPaymentProvider();
  if (!adapter) throw serviceUnavailable("Le paiement en ligne n'est pas encore configuré. Contactez l'assistance.", "PAYMENTS_DISABLED");
  if (input.method === "DIRECT" && !adapter.supportsDirectPay) throw badRequest("Le paiement direct n'est pas disponible.");
  if (input.method === "DIRECT" && !input.phone) throw badRequest("Numéro de téléphone requis pour le paiement direct.");

  const prepared = await prisma.$transaction(async (tx) => {
    await lockOrder(tx, orderId);
    const order = await tx.order.findUnique({ where: { id: orderId }, include: { payments: true, customer: true } });
    if (!order || order.customerId !== user.id) throw notFound("Commande introuvable.");
    const eligibility = paymentEligibility(order);
    if (!eligibility.canPay) throw conflict(eligibility.reason ?? "Paiement impossible.", "PAYMENT_NOT_ALLOWED");
    if (order.payments.some((p) => p.status === "SUCCESSFUL" && !p.isDuplicate)) throw conflict("Cette commande est déjà payée.", "ALREADY_PAID");
    if (order.payments.some((p) => p.status === "PENDING_VERIFICATION")) {
      throw conflict("Un paiement déclaré est en cours de vérification pour cette commande.", "PAYMENT_IN_REVIEW");
    }

    // Réutilise un lien de paiement récent encore valide plutôt que d'en créer un second
    const recent = order.payments.find(
      (p) =>
        p.method === "FAPSHI_CHECKOUT" &&
        input.method === "CHECKOUT" &&
        ["CREATED", "PENDING"].includes(p.status) &&
        p.paymentLink &&
        p.amount === order.total &&
        p.environment === adapter.environment &&
        Date.now() - p.createdAt.getTime() < 30 * 60 * 1000,
    );
    if (recent) return { reuse: recent, superseded: [] as Payment[], order };

    const superseded = order.payments.filter((p) => ["CREATED", "PENDING"].includes(p.status) && p.provider !== "CASH");
    if (superseded.length > 0) {
      await tx.payment.updateMany({
        where: { id: { in: superseded.map((p) => p.id) } },
        data: { status: "CANCELLED", failureReason: "Remplacé par une nouvelle tentative" },
      });
    }
    const payment = await tx.payment.create({
      data: {
        orderId: order.id,
        provider: adapter.name,
        method: input.method === "DIRECT" ? "FAPSHI_DIRECT" : "FAPSHI_CHECKOUT",
        environment: adapter.environment,
        status: "CREATED",
        amount: order.total as number,
        payerPhone: input.phone ?? null,
        medium: input.medium ?? null,
      },
    });
    await tx.order.update({ where: { id: order.id }, data: { paymentStatus: "PENDING" } });
    return { reuse: null, superseded, order, payment };
  });

  if (prepared.reuse) return { payment: prepared.reuse, link: prepared.reuse.paymentLink };

  // Expiration best-effort des anciens liens chez le fournisseur
  for (const old of prepared.superseded) {
    if (old.providerTransId) await adapter.expire(old.providerTransId).catch(() => undefined);
  }

  const payment = prepared.payment as Payment;
  const order = prepared.order;
  const message = `Commande ${order.reference} - Print & Secretariat`;
  try {
    if (input.method === "DIRECT") {
      const result = await adapter.directPay({
        amount: payment.amount,
        phone: nationalNumber(input.phone as string),
        medium: input.medium,
        name: order.customer.fullName.slice(0, 100),
        email: order.customer.email,
        externalId: payment.id,
        userId: order.customerId,
        message,
      });
      const updated = await prisma.payment.update({
        where: { id: payment.id },
        data: { providerTransId: result.transId, status: "PENDING" },
      });
      await recordEvent(prisma, { paymentId: payment.id, provider: adapter.name, type: "INITIATED_DIRECT", providerTransId: result.transId, payload: { status: "PENDING", amount: payment.amount } });
      return { payment: updated, link: null };
    }
    const result = await adapter.initiateCheckout({
      amount: payment.amount,
      externalId: payment.id,
      userId: order.customerId,
      email: order.customer.email,
      redirectUrl: `${frontendUrl}/paiement/retour?payment=${payment.id}`,
      message,
    });
    const updated = await prisma.payment.update({
      where: { id: payment.id },
      data: { providerTransId: result.transId, paymentLink: result.link, status: "PENDING" },
    });
    await recordEvent(prisma, { paymentId: payment.id, provider: adapter.name, type: "INITIATED_CHECKOUT", providerTransId: result.transId, payload: { status: "CREATED", amount: payment.amount } });
    return { payment: updated, link: result.link };
  } catch (error) {
    const reason = error instanceof ProviderError ? error.message : "Erreur inattendue du fournisseur";
    await prisma.payment.update({ where: { id: payment.id }, data: { status: "FAILED", failureReason: reason.slice(0, 300) } });
    await resetOrderPaymentState(prisma, order.id);
    await recordEvent(prisma, { paymentId: payment.id, provider: adapter.name, type: "INITIATION_FAILED", payload: { reason } });
    logger.warn({ paymentId: payment.id, reason }, "Initialisation du paiement échouée");
    throw new AppError(502, "Le paiement n'a pas pu être initialisé. Vérifiez vos informations et réessayez.", "PAYMENT_INIT_FAILED");
  }
}

async function resetOrderPaymentState(db: Tx | typeof prisma, orderId: string) {
  const order = await db.order.findUnique({ where: { id: orderId }, include: { payments: true } });
  if (!order || order.paymentStatus === "PAID" || order.paymentStatus === "REFUNDED") return;
  const stillPending = order.payments.some((p) => ["CREATED", "PENDING", "PENDING_VERIFICATION"].includes(p.status));
  await db.order.update({ where: { id: orderId }, data: { paymentStatus: stillPending ? "PENDING" : "UNPAID" } });
}

/**
 * Applique un statut vérifié auprès du fournisseur. Idempotent : un paiement déjà
 * confirmé n'est jamais retraité, et le montant ainsi que la référence sont contrôlés.
 */
export async function applyProviderStatus(paymentId: string, txn: ProviderTransaction, source: string) {
  return prisma.$transaction(async (tx) => {
    const initial = await tx.payment.findUnique({ where: { id: paymentId } });
    if (!initial) throw notFound("Paiement introuvable.");
    await lockOrder(tx, initial.orderId);
    await lockPayment(tx, paymentId);
    const payment = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });

    if (payment.status === "SUCCESSFUL") {
      await recordEvent(tx, { paymentId, provider: payment.provider, type: "ALREADY_CONFIRMED_IGNORED", providerTransId: txn.transId, payload: { status: txn.status, source } });
      return { payment, changed: false };
    }
    if (payment.providerTransId && txn.transId && payment.providerTransId !== txn.transId) {
      await recordEvent(tx, { paymentId, provider: payment.provider, type: "TRANSACTION_MISMATCH", providerTransId: txn.transId, payload: { source } });
      return { payment, changed: false };
    }

    const base = { providerStatus: txn.status, lastCheckedAt: new Date(), medium: txn.medium ?? payment.medium };

    if (txn.status === "SUCCESSFUL") {
      const amountOk = txn.amount === payment.amount;
      const referenceOk = !txn.externalId || txn.externalId === payment.id;
      if (!amountOk || !referenceOk) {
        const updated = await tx.payment.update({
          where: { id: paymentId },
          data: { ...base, failureReason: !amountOk ? `Montant reçu (${txn.amount}) différent du montant attendu (${payment.amount})` : "Référence externe incohérente" },
        });
        await recordEvent(tx, { paymentId, provider: payment.provider, type: "VERIFICATION_FAILED", providerTransId: txn.transId, payload: { ...txn, source } });
        await audit({ action: "payment.verification_failed", entityType: "Payment", entityId: paymentId, metadata: { amountOk, referenceOk, source } }, tx);
        await notifyAdmins(tx, {
          orderId: payment.orderId,
          type: "PAYMENT_ANOMALY",
          title: "Paiement à vérifier",
          body: `Un paiement signalé réussi présente une incohérence (${!amountOk ? "montant" : "référence"}). Vérification manuelle requise.`,
        });
        return { payment: updated, changed: true };
      }

      const order = await tx.order.findUniqueOrThrow({ where: { id: payment.orderId } });
      const alreadyPaid = order.paymentStatus === "PAID" || order.paymentStatus === "REFUNDED";
      const orderClosed = ["CANCELLED", "REFUNDED"].includes(order.status);
      if (alreadyPaid || orderClosed) {
        const updated = await tx.payment.update({
          where: { id: paymentId },
          data: { ...base, status: "SUCCESSFUL", isDuplicate: true, confirmedAt: new Date() },
        });
        await recordEvent(tx, { paymentId, provider: payment.provider, type: "DUPLICATE_PAYMENT", providerTransId: txn.transId, payload: { ...txn, source } });
        await audit({ action: "payment.duplicate_received", entityType: "Payment", entityId: paymentId, metadata: { orderId: order.id, amount: payment.amount } }, tx);
        await notifyAdmins(tx, {
          orderId: order.id,
          type: "PAYMENT_DUPLICATE",
          title: `Paiement supplémentaire sur ${order.reference}`,
          body: `Un paiement de ${formatFcfa(payment.amount)} a été reçu alors que la commande était déjà réglée ou annulée. Un remboursement est à prévoir.`,
        });
        return { payment: updated, changed: true };
      }

      const updated = await tx.payment.update({
        where: { id: paymentId },
        data: { ...base, status: "SUCCESSFUL", confirmedAt: new Date(), failureReason: null },
      });
      await tx.order.update({
        where: { id: order.id },
        data: { paymentStatus: "PAID", amountPaid: { increment: payment.amount }, paidAt: new Date() },
      });
      if (order.status === "PENDING_PAYMENT") {
        await transitionOrder(tx, order.id, "PAID", { actorId: null, note: `Paiement confirmé (${payment.provider})` });
      }
      await tx.payment.updateMany({
        where: { orderId: order.id, id: { not: paymentId }, status: { in: ["CREATED", "PENDING"] } },
        data: { status: "CANCELLED", failureReason: "Commande réglée par un autre paiement" },
      });
      await recordEvent(tx, { paymentId, provider: payment.provider, type: "CONFIRMED", providerTransId: txn.transId, payload: { ...txn, source } });
      await notify(
        {
          userId: order.customerId,
          orderId: order.id,
          type: "PAYMENT_CONFIRMED",
          title: `Paiement confirmé — ${order.reference}`,
          body: `Nous avons bien reçu votre paiement de ${formatFcfa(payment.amount)}. Votre reçu est disponible dans votre espace. Code de retrait : ${order.pickupCode}.`,
          link: `/espace/commandes/${order.id}`,
        },
        tx,
      );
      if (order.groupOrderId) await refreshGroupStatus(tx, order.groupOrderId);
      return { payment: updated, changed: true };
    }

    if (txn.status === "FAILED" || txn.status === "EXPIRED") {
      if (payment.status === txn.status) return { payment, changed: false };
      const updated = await tx.payment.update({
        where: { id: paymentId },
        data: {
          ...base,
          status: payment.status === "CANCELLED" ? "CANCELLED" : txn.status,
          failureReason: txn.status === "FAILED" ? "Paiement refusé ou annulé chez l'opérateur" : "Lien de paiement expiré",
        },
      });
      await recordEvent(tx, { paymentId, provider: payment.provider, type: txn.status, providerTransId: txn.transId, payload: { ...txn, source } });
      await resetOrderPaymentState(tx, payment.orderId);
      return { payment: updated, changed: true };
    }

    const updated = await tx.payment.update({ where: { id: paymentId }, data: base });
    return { payment: updated, changed: false };
  });
}

/** Interroge le fournisseur (source de vérité) puis applique le statut obtenu. */
export async function syncPayment(paymentId: string, source: "webhook" | "poll" | "admin" | "reconcile" | "simulator") {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment) throw notFound("Paiement introuvable.");
  if (payment.provider === "CASH" || !payment.providerTransId) return payment;
  const adapter = getPaymentProvider();
  if (!adapter || adapter.name !== payment.provider) return payment;
  let txn: ProviderTransaction;
  try {
    txn = await adapter.getStatus(payment.providerTransId);
  } catch (error) {
    await prisma.payment.update({ where: { id: paymentId }, data: { lastCheckedAt: new Date() } });
    logger.warn({ paymentId, err: error instanceof Error ? error.message : error }, "Vérification du statut de paiement impossible");
    return payment;
  }
  const { payment: updated } = await applyProviderStatus(paymentId, txn, source);
  return updated;
}

/**
 * Traitement du webhook Fapshi : authentification par en-tête x-wh-secret,
 * déduplication, puis revérification du statut via l'API (on ne se fie pas au corps).
 */
export async function handleFapshiWebhook(body: Record<string, unknown>) {
  const transId = typeof body.transId === "string" ? body.transId.slice(0, 120) : null;
  if (!transId) throw badRequest("transId manquant.");
  const status = typeof body.status === "string" ? body.status.toUpperCase().slice(0, 20) : "UNKNOWN";
  const payment =
    (await prisma.payment.findUnique({ where: { providerTransId: transId } })) ??
    (typeof body.externalId === "string"
      ? await prisma.payment.findFirst({ where: { id: body.externalId, provider: "FAPSHI" } })
      : null);

  let duplicate = false;
  try {
    await recordEvent(prisma, {
      paymentId: payment?.id ?? null,
      provider: "FAPSHI",
      type: "WEBHOOK_RECEIVED",
      providerTransId: transId,
      dedupeKey: `webhook:${transId}:${status}`,
      payload: body,
    });
  } catch (error) {
    if ((error as { code?: string }).code !== "P2002") throw error;
    duplicate = true;
  }
  if (!payment) {
    logger.warn({ transId }, "Webhook Fapshi pour une transaction inconnue");
    return { ok: true, duplicate, matched: false };
  }
  if (duplicate && payment.status === "SUCCESSFUL") return { ok: true, duplicate, matched: true };
  await syncPayment(payment.id, "webhook");
  return { ok: true, duplicate, matched: true };
}

/** Le délégué signale un paiement en espèces ou collectif : il reste à confirmer par un administrateur. */
export async function declareCashPayment(declarer: User, orderId: string, input: { amount: number; note: string }) {
  return prisma.$transaction(async (tx) => {
    await lockOrder(tx, orderId);
    const order = await tx.order.findUnique({ where: { id: orderId }, include: { payments: true, groupOrder: true } });
    if (!order) throw notFound("Commande introuvable.");
    // Réservé aux commandes groupées : seul le délégué du groupe peut signaler un paiement collecté
    if (!order.groupOrder || order.groupOrder.delegateId !== declarer.id) {
      throw forbidden("Seul le délégué du groupe peut signaler un paiement en espèces ou collectif.");
    }
    if (order.status !== "PENDING_PAYMENT" || order.paymentStatus === "PAID") throw conflict("Cette commande n'est pas en attente de paiement.");
    if (order.total === null) throw conflict("Le montant total n'est pas encore connu.");
    if (input.amount !== order.total) throw badRequest(`Le montant déclaré doit correspondre au total de la commande (${formatFcfa(order.total)}).`);
    if (order.payments.some((p) => p.status === "PENDING_VERIFICATION")) throw conflict("Un paiement est déjà en attente de vérification.");
    const payment = await tx.payment.create({
      data: {
        orderId,
        provider: "CASH",
        method: "CASH_DECLARATION",
        environment: "OFFLINE",
        status: "PENDING_VERIFICATION",
        amount: input.amount,
        declaredById: declarer.id,
        declarationNote: input.note,
      },
    });
    await tx.order.update({ where: { id: orderId }, data: { paymentStatus: "PENDING" } });
    await recordEvent(tx, { paymentId: payment.id, provider: "CASH", type: "CASH_DECLARED", payload: { amount: input.amount, source: "declaration" } });
    await audit({ actorId: declarer.id, action: "payment.cash_declared", entityType: "Payment", entityId: payment.id, metadata: { orderId, amount: input.amount } }, tx);
    await notifyAdmins(tx, {
      orderId,
      type: "PAYMENT_DECLARED",
      title: `Paiement en espèces déclaré — ${order.reference}`,
      body: `${declarer.fullName} déclare un paiement de ${formatFcfa(input.amount)}. Vérifiez la réception avant de le confirmer.`,
    });
    return payment;
  });
}

/** Confirmation ou rejet d'un paiement déclaré, par un administrateur uniquement. */
export async function reviewCashPayment(admin: User, paymentId: string, approve: boolean, note: string, ip?: string) {
  return prisma.$transaction(async (tx) => {
    const initial = await tx.payment.findUnique({ where: { id: paymentId } });
    if (!initial) throw notFound("Paiement introuvable.");
    await lockOrder(tx, initial.orderId);
    await lockPayment(tx, paymentId);
    const payment = await tx.payment.findUniqueOrThrow({ where: { id: paymentId }, include: { order: true } });
    if (payment.status !== "PENDING_VERIFICATION") throw conflict("Ce paiement a déjà été traité.");
    if (!approve) {
      const updated = await tx.payment.update({
        where: { id: paymentId },
        data: { status: "REJECTED", verifiedById: admin.id, verifiedAt: new Date(), failureReason: note },
      });
      await resetOrderPaymentState(tx, payment.orderId);
      await audit({ actorId: admin.id, action: "payment.cash_rejected", entityType: "Payment", entityId: paymentId, metadata: { note }, ip }, tx);
      return updated;
    }
    if (payment.order.paymentStatus === "PAID") throw conflict("La commande est déjà payée.");
    const updated = await tx.payment.update({
      where: { id: paymentId },
      data: { status: "SUCCESSFUL", verifiedById: admin.id, verifiedAt: new Date(), confirmedAt: new Date() },
    });
    await tx.order.update({
      where: { id: payment.orderId },
      data: { paymentStatus: "PAID", amountPaid: { increment: payment.amount }, paidAt: new Date() },
    });
    if (payment.order.status === "PENDING_PAYMENT") {
      await transitionOrder(tx, payment.orderId, "PAID", { actorId: admin.id, note: `Paiement en espèces vérifié : ${note}` });
    }
    await tx.payment.updateMany({
      where: { orderId: payment.orderId, id: { not: paymentId }, status: { in: ["CREATED", "PENDING"] } },
      data: { status: "CANCELLED", failureReason: "Commande réglée en espèces" },
    });
    await recordEvent(tx, { paymentId, provider: "CASH", type: "CASH_VERIFIED", payload: { amount: payment.amount, source: "admin" } });
    await audit({ actorId: admin.id, action: "payment.cash_verified", entityType: "Payment", entityId: paymentId, metadata: { note, amount: payment.amount }, ip }, tx);
    await notify(
      {
        userId: payment.order.customerId,
        orderId: payment.orderId,
        type: "PAYMENT_CONFIRMED",
        title: `Paiement confirmé — ${payment.order.reference}`,
        body: `Votre paiement de ${formatFcfa(payment.amount)} a été vérifié par notre équipe. Code de retrait : ${payment.order.pickupCode}.`,
        link: `/espace/commandes/${payment.orderId}`,
      },
      tx,
    );
    if (payment.order.groupOrderId) await refreshGroupStatus(tx, payment.order.groupOrderId);
    return updated;
  });
}

export async function getPaymentForViewer(user: User, paymentId: string) {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId }, include: { order: true } });
  if (!payment || payment.order.customerId !== user.id) throw notFound("Paiement introuvable.");
  return payment;
}

export function serializePayment(p: Payment) {
  return {
    id: p.id,
    orderId: p.orderId,
    provider: p.provider,
    method: p.method,
    environment: p.environment,
    status: p.status,
    amount: p.amount,
    medium: p.medium,
    paymentLink: ["CREATED", "PENDING"].includes(p.status) ? p.paymentLink : null,
    failureReason: p.failureReason,
    isDuplicate: p.isDuplicate,
    createdAt: p.createdAt,
    confirmedAt: p.confirmedAt,
  };
}

/** Rapprochement périodique : rattrape un webhook manqué (Fapshi n'en envoie qu'un seul). */
export async function reconcilePendingPayments() {
  const pending = await prisma.payment.findMany({
    where: {
      status: { in: ["CREATED", "PENDING"] },
      provider: { not: "CASH" },
      providerTransId: { not: null },
      createdAt: { gt: new Date(Date.now() - 48 * 60 * 60 * 1000) },
      OR: [{ lastCheckedAt: null }, { lastCheckedAt: { lt: new Date(Date.now() - 2 * 60 * 1000) } }],
    },
    take: 50,
    orderBy: { createdAt: "asc" },
  });
  for (const p of pending) await syncPayment(p.id, "reconcile");
  return pending.length;
}

registerJobHandler("payments.reconcile", async () => {
  await reconcilePendingPayments();
});

export { getOrderDetail };
