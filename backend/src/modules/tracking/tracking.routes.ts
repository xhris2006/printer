import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { notFound } from "../../lib/errors";
import { publicLimiter } from "../../middleware/security";
import { STATUS_LABELS } from "../orders/status";
import { param } from "../../lib/http";

/**
 * Suivi public par lien sécurisé (jeton non devinable).
 * Ne révèle ni les documents, ni les données personnelles, ni les paiements.
 */
export const trackingRouter = Router();

trackingRouter.get("/:token", publicLimiter, async (req, res) => {
  const token = z.string().min(16).max(128).safeParse(param(req, "token"));
  if (!token.success) throw notFound("Lien de suivi invalide.");
  const order = await prisma.order.findUnique({
    where: { trackingToken: token.data },
    include: {
      statusHistory: { orderBy: { createdAt: "asc" }, select: { toStatus: true, createdAt: true } },
      pickupPoint: { select: { name: true, address: true, hours: true } },
      _count: { select: { items: true } },
    },
  });
  if (!order || order.status === "DRAFT") throw notFound("Lien de suivi invalide.");
  res.json({
    tracking: {
      reference: order.reference,
      status: order.status,
      statusLabel: STATUS_LABELS[order.status],
      paid: order.paymentStatus === "PAID",
      fulfillmentMethod: order.fulfillmentMethod,
      itemsCount: order._count.items,
      pickupPoint: order.fulfillmentMethod === "PICKUP" ? order.pickupPoint : null,
      timeline: order.statusHistory.map((h) => ({ status: h.toStatus, label: STATUS_LABELS[h.toStatus], at: h.createdAt })),
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    },
  });
});
