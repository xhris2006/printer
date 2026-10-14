import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/lib/prisma";
import { setPaymentProvider } from "../src/modules/payments/payments.service";
import { MockPaymentAdapter } from "../src/modules/payments/mock";
import { statusOptions, type StatusContext } from "../src/modules/orders/status";
import { resetDb } from "./helpers/db";
import { makePdf } from "./helpers/files";
import { defaultOptions, loginAs, ORIGIN, pickup, uploadDocument } from "./helpers/api";

beforeEach(async () => {
  await resetDb();
  setPaymentProvider(new MockPaymentAdapter());
});

async function confirmedOrder(pay = true) {
  const c = await loginAs();
  const doc = await uploadDocument(c.agent, await makePdf(10), "cours.pdf");
  const draft = await c.agent.post("/api/orders").set("Origin", ORIGIN).send({ items: [{ documentId: doc.id, options: defaultOptions }], fulfillment: pickup() });
  await c.agent.post(`/api/orders/${draft.body.order.id}/confirm`).set("Origin", ORIGIN).send({});
  if (pay) {
    const init = await c.agent.post(`/api/orders/${draft.body.order.id}/payments`).set("Origin", ORIGIN).send({ method: "CHECKOUT" });
    await c.agent.post(`/api/payments/${init.body.payment.id}/simulate`).set("Origin", ORIGIN).send({ outcome: "SUCCESSFUL" });
  }
  return { ...c, orderId: draft.body.order.id as string };
}

const ctx = (over: Partial<StatusContext>): StatusContext => ({
  status: "PAID",
  fulfillmentMethod: "PICKUP",
  paymentStatus: "PAID",
  creditApproved: false,
  total: 1000,
  amountPaid: 1000,
  groupOrder: null,
  ...over,
});
const summary = (c: StatusContext) => statusOptions(c).map((o) => `${o.status}:${o.kind}${o.adminOnly ? ":admin" : ""}${o.correction ? ":correction" : ""}`);

describe("Changement de statut par l'administration", () => {
  it("règles proposées selon le statut, le paiement, le mode de remise et le groupe", () => {
    expect(summary(ctx({}))).toEqual(["TO_PREPARE:DIRECT", "PRINTING:DIRECT", "FINISHING:DIRECT", "READY_FOR_PICKUP:DIRECT", "CANCELLED:CANCEL:admin"]);
    // Non payée : encaissement espèces (preuve) ou annulation, jamais de production
    expect(summary(ctx({ status: "PENDING_PAYMENT", paymentStatus: "UNPAID", amountPaid: 0 }))).toEqual(["PAID:CASH:admin", "CANCELLED:CANCEL:admin"]);
    // Exception administrateur : production possible
    expect(summary(ctx({ status: "PENDING_PAYMENT", paymentStatus: "UNPAID", creditApproved: true, amountPaid: 0 }))).toContain("PRINTING:DIRECT");
    // Contribution d'une collecte non lancée : production depuis le groupe uniquement
    expect(summary(ctx({ groupOrder: { mode: "STUDENT_CONTRIBUTIONS", status: "CLOSED" } }))).toEqual(["CANCELLED:CANCEL:admin"]);
    // En impression : avancer (même en sautant la finition) ou corriger (admin)
    expect(summary(ctx({ status: "PRINTING" }))).toEqual(["TO_PREPARE:DIRECT:admin:correction", "FINISHING:DIRECT", "READY_FOR_PICKUP:DIRECT"]);
    // Livraison : jamais « prête à retirer » directement, remise et échec par leurs actions
    expect(summary(ctx({ status: "FINISHING", fulfillmentMethod: "DELIVERY" }))).toContain("OUT_FOR_DELIVERY:DIRECT");
    expect(summary(ctx({ status: "FINISHING", fulfillmentMethod: "DELIVERY" }))).not.toContain("READY_FOR_PICKUP:DIRECT");
    expect(summary(ctx({ status: "OUT_FOR_DELIVERY", fulfillmentMethod: "DELIVERY" }))).toEqual(
      expect.arrayContaining(["COMPLETED:DELIVER", "READY_FOR_PICKUP:DELIVERY_FAILED", "FINISHING:DIRECT:admin:correction"]),
    );
    expect(summary(ctx({ status: "READY_FOR_PICKUP", fulfillmentMethod: "DELIVERY" }))).toContain("OUT_FOR_DELIVERY:DIRECT");
    expect(summary(ctx({ status: "READY_FOR_PICKUP" }))).toContain("COMPLETED:HANDOVER");
    expect(summary(ctx({ status: "COMPLETED" }))).toEqual(["READY_FOR_PICKUP:DIRECT:admin:correction"]);
    expect(summary(ctx({ status: "CANCELLED" }))).toEqual(["REFUNDED:REFUND:admin"]);
    expect(summary(ctx({ status: "REFUNDED", paymentStatus: "REFUNDED" }))).toEqual([]);
  });

  it("avance en sautant des étapes, uniquement après paiement", async () => {
    const unpaid = await confirmedOrder(false);
    const operator = await loginAs("OPERATOR");
    const refused = await operator.agent.post(`/api/admin/orders/${unpaid.orderId}/status`).set("Origin", ORIGIN).send({ status: "PRINTING" });
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe("PAYMENT_REQUIRED");

    const { orderId, user } = await confirmedOrder();
    const res = await operator.agent.post(`/api/admin/orders/${orderId}/status`).set("Origin", ORIGIN).send({ status: "READY_FOR_PICKUP" });
    expect(res.status).toBe(200);
    expect(res.body.order.status).toBe("READY_FOR_PICKUP");
    expect(res.body.order.statusOptions.map((o: { status: string }) => o.status)).toContain("COMPLETED");
    expect(await prisma.pickup.findUnique({ where: { orderId } })).toMatchObject({ status: "READY" });
    expect(await prisma.notification.count({ where: { userId: user.id, type: "ORDER_READY_FOR_PICKUP" } })).toBe(1);

    // La liste des commandes expose aussi les changements possibles
    const list = await operator.agent.get("/api/admin/orders");
    const row = list.body.items.find((o: { id: string }) => o.id === orderId);
    expect(row.statusOptions.some((o: { status: string; kind: string }) => o.status === "COMPLETED" && o.kind === "HANDOVER")).toBe(true);
  });

  it("corrige une étape (administrateur, motif obligatoire, client prévenu, journalisé)", async () => {
    const { orderId, user } = await confirmedOrder();
    const operator = await loginAs("OPERATOR");
    const admin = await loginAs("ADMIN");
    await operator.agent.post(`/api/admin/orders/${orderId}/status`).set("Origin", ORIGIN).send({ status: "READY_FOR_PICKUP" });

    expect((await operator.agent.post(`/api/admin/orders/${orderId}/status`).set("Origin", ORIGIN).send({ status: "PRINTING", note: "Erreur de manipulation" })).status).toBe(403);
    const noNote = await admin.agent.post(`/api/admin/orders/${orderId}/status`).set("Origin", ORIGIN).send({ status: "PRINTING" });
    expect(noNote.status).toBe(400);
    expect(noNote.body.error.code).toBe("NOTE_REQUIRED");

    const ok = await admin.agent.post(`/api/admin/orders/${orderId}/status`).set("Origin", ORIGIN).send({ status: "PRINTING", note: "Une page est à réimprimer" });
    expect(ok.status).toBe(200);
    expect(ok.body.order.status).toBe("PRINTING");
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { pickup: true } });
    expect(order.readyAt).toBeNull();
    expect(order.pickup?.status).toBe("WAITING");
    const notice = await prisma.notification.findFirstOrThrow({ where: { userId: user.id, type: "ORDER_STATUS_CORRECTED" } });
    expect(notice.body).toContain("En impression");
    expect(notice.body).toContain("Une page est à réimprimer");
    expect(await prisma.auditLog.count({ where: { action: "order.status_corrected", entityId: orderId } })).toBe(1);
    const history = await prisma.orderStatusHistory.findMany({ where: { orderId }, orderBy: { createdAt: "asc" } });
    expect(history.map((h) => h.toStatus).slice(-2)).toEqual(["READY_FOR_PICKUP", "PRINTING"]);
  });

  it("les statuts exigeant une preuve passent par leur action dédiée ; une remise erronée peut être annulée", async () => {
    const { orderId, agent } = await confirmedOrder();
    const admin = await loginAs("ADMIN");
    const set = (status: string, note?: string) => admin.agent.post(`/api/admin/orders/${orderId}/status`).set("Origin", ORIGIN).send({ status, note });

    for (const status of ["CANCELLED", "COMPLETED"]) {
      const res = await set(status);
      expect(res.status).toBe(409);
    }
    expect((await set("CANCELLED")).body.error.code).toBe("DEDICATED_ACTION");
    expect((await set("READY_FOR_PICKUP")).status).toBe(200);
    expect((await set("COMPLETED")).body.error.code).toBe("DEDICATED_ACTION");

    const code = (await agent.get(`/api/orders/${orderId}`)).body.order.pickupCode;
    await admin.agent.post(`/api/admin/orders/${orderId}/handover`).set("Origin", ORIGIN).send({ code, recipientName: "Mauvaise personne" });
    const fixed = await set("READY_FOR_PICKUP", "Remise enregistrée sur la mauvaise commande");
    expect(fixed.status).toBe(200);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { pickup: true } });
    expect(order.status).toBe("READY_FOR_PICKUP");
    expect(order.completedAt).toBeNull();
    expect(order.pickup).toMatchObject({ status: "READY", pickedUpBy: null, verifiedWithCode: false });
    const again = await admin.agent.post(`/api/admin/orders/${orderId}/handover`).set("Origin", ORIGIN).send({ code, recipientName: "Bonne personne" });
    expect(again.body.order.status).toBe("COMPLETED");
  });
});
