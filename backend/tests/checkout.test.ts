import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/lib/prisma";
import { setPaymentProvider } from "../src/modules/payments/payments.service";
import { MockPaymentAdapter } from "../src/modules/payments/mock";
import { resetDb } from "./helpers/db";
import { makePdf } from "./helpers/files";
import { defaultOptions, loginAs, ORIGIN, pickup, uploadDocument, type Agent } from "./helpers/api";

beforeEach(async () => {
  await resetDb();
  setPaymentProvider(new MockPaymentAdapter());
});
afterEach(() => setPaymentProvider(new MockPaymentAdapter()));

async function draft(agent: Agent, pages = 10, fulfillment: object = pickup()) {
  const doc = await uploadDocument(agent, await makePdf(pages), "doc.pdf");
  const res = await agent.post("/api/orders").set("Origin", ORIGIN).send({ items: [{ documentId: doc.id, options: defaultOptions }], fulfillment });
  expect(res.status).toBe(201);
  return res.body.order as { id: string; status: string; total: number | null };
}

describe("Payer et valider / brouillon", () => {
  it("un brouillon reste un brouillon tant que le client ne paie pas, et n'est pas visible en production", async () => {
    const { agent } = await loginAs();
    const order = await draft(agent);
    expect(order.status).toBe("DRAFT");
    const drafts = await agent.get("/api/orders?scope=drafts");
    expect(drafts.body.items.map((o: { id: string }) => o.id)).toContain(order.id);
    expect((await agent.get("/api/orders?scope=active")).body.items).toHaveLength(0);
    expect((await agent.get("/api/orders/stats")).body).toMatchObject({ drafts: 1, active: 0 });

    const admin = await loginAs("ADMIN");
    expect((await admin.agent.get("/api/admin/orders")).body.items).toHaveLength(0);
    const production = (await admin.agent.get("/api/admin/production")).body;
    expect([...production.toRelease, ...production.inProduction, ...production.ready]).toHaveLength(0);
  });

  it("« Payer et valider » fige la commande, lance le paiement, et la valide seulement après paiement confirmé", async () => {
    const { agent } = await loginAs();
    const order = await draft(agent, 10);
    const res = await agent.post(`/api/orders/${order.id}/checkout`).set("Origin", ORIGIN).send({ method: "CHECKOUT" });
    expect(res.status).toBe(201);
    expect(res.body.redirectUrl).toContain("/paiement/simulateur");
    expect(res.body.order).toMatchObject({ status: "PENDING_PAYMENT", paymentStatus: "PENDING", total: 200 });
    const stored = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(stored.pricingSnapshot).not.toBeNull();

    const paid = await agent.post(`/api/payments/${res.body.payment.id}/simulate`).set("Origin", ORIGIN).send({ outcome: "SUCCESSFUL" });
    expect(paid.body.payment.status).toBe("SUCCESSFUL");
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("PAID");
    expect(await prisma.notification.count({ where: { orderId: order.id, title: { contains: "validée" } } })).toBe(1);
  });

  it("refuse de figer la commande si le paiement est impossible (frais de livraison à confirmer, minimum, paiement désactivé)", async () => {
    const { agent } = await loginAs();
    const delivery = await draft(agent, 10, { method: "DELIVERY", recipientName: "Awa", phone: "677000001", quarter: "Essos" });
    const r1 = await agent.post(`/api/orders/${delivery.id}/checkout`).set("Origin", ORIGIN).send({ method: "CHECKOUT" });
    expect(r1.status).toBe(409);
    expect(r1.body.error.code).toBe("DELIVERY_FEE_PENDING");
    expect((await prisma.order.findUniqueOrThrow({ where: { id: delivery.id } })).status).toBe("DRAFT");

    const small = await draft(agent, 2); // 40 FCFA
    const r2 = await agent.post(`/api/orders/${small.id}/checkout`).set("Origin", ORIGIN).send({ method: "CHECKOUT" });
    expect(r2.body.error.code).toBe("BELOW_MINIMUM");
    expect((await prisma.order.findUniqueOrThrow({ where: { id: small.id } })).status).toBe("DRAFT");

    setPaymentProvider(null);
    const normal = await draft(agent, 10);
    const r3 = await agent.post(`/api/orders/${normal.id}/checkout`).set("Origin", ORIGIN).send({ method: "CHECKOUT" });
    expect(r3.status).toBe(503);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: normal.id } })).status).toBe("DRAFT");
  });

  it("signale un changement de tarif entre le brouillon et le paiement", async () => {
    const { agent } = await loginAs();
    const order = await draft(agent, 10);
    await prisma.priceRule.updateMany({ where: { colorMode: "BW", sides: "SINGLE" }, data: { unitPrice: 30 } });
    const res = await agent.post(`/api/orders/${order.id}/checkout`).set("Origin", ORIGIN).send({ method: "CHECKOUT" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("PRICE_CHANGED");
    expect(await prisma.payment.count({ where: { orderId: order.id } })).toBe(0);
  });
});
