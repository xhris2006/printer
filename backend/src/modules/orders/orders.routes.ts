import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { notFound } from "../../lib/errors";
import { paginate, pageResult, paginationSchema } from "../../lib/pagination";
import { currentUser, requireAuth } from "../../middleware/auth";
import { paymentLimiter } from "../../middleware/security";
import { initiatePayment, serializePayment } from "../payments/payments.service";
import { orderPaymentSchema } from "../payments/payments.schemas";
import { whatsappSupportLink } from "../notifications/whatsapp";
import { orderInputSchema } from "./orders.schemas";
import {
  cancelOrderByCustomer,
  confirmOrder,
  createDraftOrder,
  getOrderDetail,
  reorder,
  serializeOrder,
  updateDraftOrder,
} from "./orders.service";
import { buildOrderReceipt } from "./receipt";
import { ACTIVE_STATUSES, STATUS_LABELS } from "./status";
import { param } from "../../lib/http";

export const ordersRouter = Router();
ordersRouter.use(requireAuth);

const listSchema = paginationSchema.extend({
  scope: z.enum(["active", "history", "all"]).default("all"),
});

ordersRouter.get("/", async (req, res) => {
  const me = currentUser(req);
  const q = listSchema.parse(req.query);
  const where = {
    customerId: me.id,
    ...(q.scope === "active"
      ? { status: { in: [...ACTIVE_STATUSES, "DRAFT" as const] } }
      : q.scope === "history"
        ? { status: { in: ["COMPLETED" as const, "CANCELLED" as const, "REFUNDED" as const] } }
        : {}),
  };
  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where,
      orderBy: { createdAt: "desc" },
      ...paginate(q.page, q.pageSize),
      include: { items: { select: { documentName: true, pageCount: true, copies: true, printConfig: true } }, groupOrder: true },
    }),
    prisma.order.count({ where }),
  ]);
  res.json(
    pageResult(
      orders.map((o) => ({
        id: o.id,
        reference: o.reference,
        type: o.type,
        status: o.status,
        statusLabel: STATUS_LABELS[o.status],
        paymentStatus: o.paymentStatus,
        fulfillmentMethod: o.fulfillmentMethod,
        total: o.total,
        itemsCount: o.items.length,
        pagesCount: o.items.reduce((s, i) => s + i.pageCount, 0),
        firstDocument: o.items[0]?.documentName ?? null,
        colorMode: o.items[0]?.printConfig?.colorMode ?? null,
        group: o.groupOrder ? { id: o.groupOrder.id, name: o.groupOrder.name, code: o.groupOrder.code } : null,
        createdAt: o.createdAt,
      })),
      total,
      q.page,
      q.pageSize,
    ),
  );
});

ordersRouter.get("/stats", async (req, res) => {
  const me = currentUser(req);
  const [active, completed, spent] = await Promise.all([
    prisma.order.count({ where: { customerId: me.id, status: { in: ACTIVE_STATUSES } } }),
    prisma.order.count({ where: { customerId: me.id, status: "COMPLETED" } }),
    prisma.order.aggregate({ where: { customerId: me.id, paymentStatus: "PAID" }, _sum: { amountPaid: true } }),
  ]);
  res.json({ active, completed, totalSpent: spent._sum.amountPaid ?? 0 });
});

ordersRouter.post("/", async (req, res) => {
  const input = orderInputSchema.parse(req.body);
  const order = await createDraftOrder(currentUser(req), input);
  res.status(201).json({ order: serializeOrder(order, "owner") });
});

async function getOwnedOrder(userId: string, orderId: string) {
  const order = await getOrderDetail(orderId);
  if (order.customerId !== userId) throw notFound("Commande introuvable.");
  return order;
}

ordersRouter.get("/:id", async (req, res) => {
  const me = currentUser(req);
  const order = await getOwnedOrder(me.id, param(req, "id"));
  res.json({
    order: serializeOrder(order, "owner"),
    supportLink: whatsappSupportLink(`Bonjour, j'ai besoin d'aide pour ma commande ${order.reference}.`),
  });
});

ordersRouter.put("/:id", async (req, res) => {
  const input = orderInputSchema.parse(req.body);
  const order = await updateDraftOrder(currentUser(req), param(req, "id"), input);
  res.json({ order: serializeOrder(order, "owner") });
});

ordersRouter.post("/:id/confirm", async (req, res) => {
  const order = await confirmOrder(currentUser(req), param(req, "id"));
  res.json({ order: serializeOrder(order, "owner") });
});

ordersRouter.post("/:id/cancel", async (req, res) => {
  const { reason } = z.object({ reason: z.string().trim().max(300).optional() }).parse(req.body ?? {});
  const order = await cancelOrderByCustomer(currentUser(req), param(req, "id"), reason);
  res.json({ order: serializeOrder(order, "owner") });
});

ordersRouter.post("/:id/reorder", async (req, res) => {
  const { draft, skipped } = await reorder(currentUser(req), param(req, "id"));
  res.status(201).json({ order: serializeOrder(draft, "owner"), skipped });
});

ordersRouter.post("/:id/payments", paymentLimiter, async (req, res) => {
  const input = orderPaymentSchema.parse(req.body ?? { method: "CHECKOUT" });
  const { payment, link } = await initiatePayment(currentUser(req), param(req, "id"), input);
  res.status(201).json({ payment: serializePayment(payment), redirectUrl: link });
});

ordersRouter.get("/:id/receipt.pdf", async (req, res) => {
  const me = currentUser(req);
  const order = await getOwnedOrder(me.id, param(req, "id"));
  const pdf = await buildOrderReceipt(order);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${order.reference}.pdf"`);
  res.setHeader("Cache-Control", "private, no-store");
  res.send(pdf);
});
