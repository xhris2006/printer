import { Router } from "express";
import { z } from "zod";
import { env } from "../../config/env";
import { safeEqual } from "../../lib/ids";
import { badRequest, notFound, unauthorized } from "../../lib/errors";
import { currentUser, requireAuth } from "../../middleware/auth";
import { paymentLimiter, webhookLimiter } from "../../middleware/security";
import { getOrderDetail, serializeOrder } from "../orders/orders.service";
import { MockPaymentAdapter } from "./mock";
import {
  getPaymentForViewer,
  getPaymentProvider,
  handleFapshiWebhook,
  serializePayment,
  syncPayment,
} from "./payments.service";
import { param } from "../../lib/http";

export const paymentsRouter = Router();

/** Webhook Fapshi — URL à renseigner dans le tableau de bord Fapshi. */
paymentsRouter.post("/fapshi/webhook", webhookLimiter, async (req, res) => {
  const adapter = getPaymentProvider();
  if (!adapter || adapter.name !== "FAPSHI") throw notFound();
  const expected = env.FAPSHI_WEBHOOK_SECRET;
  if (expected) {
    const received = req.get("x-wh-secret") ?? "";
    if (!safeEqual(received, expected)) throw unauthorized("Signature de webhook invalide.");
  }
  if (!req.body || typeof req.body !== "object") throw badRequest("Corps JSON attendu.");
  const result = await handleFapshiWebhook(req.body as Record<string, unknown>);
  res.json(result);
});

paymentsRouter.get("/:id", requireAuth, paymentLimiter, async (req, res) => {
  const me = currentUser(req);
  let payment = await getPaymentForViewer(me, param(req, "id"));
  const stale = !payment.lastCheckedAt || Date.now() - payment.lastCheckedAt.getTime() > 4000;
  if (["CREATED", "PENDING"].includes(payment.status) && stale) {
    await syncPayment(payment.id, "poll");
    payment = await getPaymentForViewer(me, param(req, "id"));
  }
  const order = await getOrderDetail(payment.orderId);
  res.json({ payment: serializePayment(payment), order: serializeOrder(order, "owner") });
});

/** Simulateur de paiement — disponible UNIQUEMENT avec PAYMENT_PROVIDER=mock (hors production). */
paymentsRouter.post("/:id/simulate", requireAuth, async (req, res) => {
  const adapter = getPaymentProvider();
  if (!(adapter instanceof MockPaymentAdapter) || env.NODE_ENV === "production") throw notFound();
  const { outcome } = z.object({ outcome: z.enum(["SUCCESSFUL", "FAILED"]) }).parse(req.body);
  const payment = await getPaymentForViewer(currentUser(req), param(req, "id"));
  if (!payment.providerTransId) throw badRequest("Paiement non initialisé.");
  adapter.setOutcome(payment.providerTransId, outcome);
  const updated = await syncPayment(payment.id, "simulator");
  res.json({ payment: serializePayment(updated) });
});
