import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { prisma } from "../src/lib/prisma";
import { setPaymentProvider, getPaymentProvider, applyProviderStatus } from "../src/modules/payments/payments.service";
import { MockPaymentAdapter } from "../src/modules/payments/mock";
import { FapshiAdapter, mapFapshiTransaction } from "../src/modules/payments/fapshi";
import type { PaymentProviderAdapter, ProviderTransaction } from "../src/modules/payments/provider";
import { resetDb } from "./helpers/db";
import { makePdf } from "./helpers/files";
import { app, defaultOptions, loginAs, ORIGIN, pickup, uploadDocument, type Agent } from "./helpers/api";

let mock: MockPaymentAdapter;
beforeEach(async () => {
  await resetDb();
  mock = new MockPaymentAdapter();
  setPaymentProvider(mock);
});
afterEach(() => {
  setPaymentProvider(new MockPaymentAdapter());
  vi.restoreAllMocks();
});

async function confirmedOrder(pages = 10, agentSession?: { agent: Agent }) {
  const session = agentSession ?? (await loginAs());
  const doc = await uploadDocument(session.agent, await makePdf(pages), "doc.pdf");
  const draft = await session.agent.post("/api/orders").set("Origin", ORIGIN).send({ items: [{ documentId: doc.id, options: defaultOptions }], fulfillment: pickup() });
  const confirmed = await session.agent.post(`/api/orders/${draft.body.order.id}/confirm`).set("Origin", ORIGIN).send({});
  return { ...session, order: confirmed.body.order };
}

describe("Paiements", () => {
  it("initialise un paiement Fapshi (lien de paiement) avec le montant de la commande", async () => {
    const { agent, order } = await confirmedOrder(10);
    const res = await agent.post(`/api/orders/${order.id}/payments`).set("Origin", ORIGIN).send({ method: "CHECKOUT", amount: 5 });
    expect(res.status).toBe(201);
    expect(res.body.payment).toMatchObject({ status: "PENDING", amount: 200, environment: "SANDBOX" });
    expect(res.body.redirectUrl).toContain("/paiement/simulateur");
    // Second clic : le lien existant est réutilisé (pas de double tentative)
    const again = await agent.post(`/api/orders/${order.id}/payments`).set("Origin", ORIGIN).send({ method: "CHECKOUT" });
    expect(again.body.payment.id).toBe(res.body.payment.id);
  });

  it("confirme la commande uniquement après vérification du succès auprès du fournisseur", async () => {
    const { agent, order } = await confirmedOrder(10);
    const init = await agent.post(`/api/orders/${order.id}/payments`).set("Origin", ORIGIN).send({ method: "CHECKOUT" });
    const pending = await agent.get(`/api/payments/${init.body.payment.id}`);
    expect(pending.body.payment.status).toBe("PENDING");
    expect(pending.body.order.paymentStatus).toBe("PENDING");

    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: init.body.payment.id } });
    mock.setOutcome(payment.providerTransId as string, "SUCCESSFUL");
    await prisma.payment.update({ where: { id: payment.id }, data: { lastCheckedAt: null } });
    const paid = await agent.get(`/api/payments/${payment.id}`);
    expect(paid.body.payment.status).toBe("SUCCESSFUL");
    expect(paid.body.order).toMatchObject({ status: "PAID", paymentStatus: "PAID", amountPaid: 200 });
    expect(paid.body.order.pickupCode).toMatch(/^\d{6}$/);
    const notif = await prisma.notification.findFirst({ where: { orderId: order.id, type: "PAYMENT_CONFIRMED" } });
    expect(notif).not.toBeNull();
  });

  it("traite les notifications dupliquées de manière idempotente (un seul encaissement)", async () => {
    const { agent, order } = await confirmedOrder(10);
    const init = await agent.post(`/api/orders/${order.id}/payments`).set("Origin", ORIGIN).send({ method: "CHECKOUT" });
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: init.body.payment.id } });
    const txn: ProviderTransaction = { transId: payment.providerTransId as string, status: "SUCCESSFUL", amount: 200, externalId: payment.id, medium: "mobile money", financialTransId: "X1", dateConfirmed: new Date().toISOString() };
    await Promise.all([applyProviderStatus(payment.id, txn, "webhook"), applyProviderStatus(payment.id, txn, "webhook"), applyProviderStatus(payment.id, txn, "poll")]);
    const stored = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(stored.amountPaid).toBe(200);
    expect(await prisma.orderStatusHistory.count({ where: { orderId: order.id, toStatus: "PAID" } })).toBe(1);
    expect(await prisma.paymentEvent.count({ where: { paymentId: payment.id, type: "CONFIRMED" } })).toBe(1);
  });

  it("refuse de confirmer un paiement dont le montant ne correspond pas", async () => {
    const { agent, order } = await confirmedOrder(10);
    const init = await agent.post(`/api/orders/${order.id}/payments`).set("Origin", ORIGIN).send({ method: "CHECKOUT" });
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: init.body.payment.id } });
    await applyProviderStatus(payment.id, { transId: payment.providerTransId as string, status: "SUCCESSFUL", amount: 100, externalId: payment.id, medium: null, financialTransId: null, dateConfirmed: null }, "webhook");
    const stored = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(stored.paymentStatus).not.toBe("PAID");
    expect(stored.status).toBe("PENDING_PAYMENT");
    expect(await prisma.paymentEvent.count({ where: { paymentId: payment.id, type: "VERIFICATION_FAILED" } })).toBe(1);
  });

  it("un second paiement réussi est marqué comme doublon à rembourser", async () => {
    const { agent, order } = await confirmedOrder(10);
    const first = await agent.post(`/api/orders/${order.id}/payments`).set("Origin", ORIGIN).send({ method: "CHECKOUT" });
    await prisma.payment.update({ where: { id: first.body.payment.id }, data: { createdAt: new Date(Date.now() - 60 * 60 * 1000) } });
    const second = await agent.post(`/api/orders/${order.id}/payments`).set("Origin", ORIGIN).send({ method: "CHECKOUT" });
    expect(second.body.payment.id).not.toBe(first.body.payment.id);
    const p1 = await prisma.payment.findUniqueOrThrow({ where: { id: first.body.payment.id } });
    const p2 = await prisma.payment.findUniqueOrThrow({ where: { id: second.body.payment.id } });
    expect(p1.status).toBe("CANCELLED");
    const ok = (p: typeof p1): ProviderTransaction => ({ transId: p.providerTransId as string, status: "SUCCESSFUL", amount: 200, externalId: p.id, medium: null, financialTransId: null, dateConfirmed: null });
    await applyProviderStatus(p2.id, ok(p2), "webhook");
    await applyProviderStatus(p1.id, ok(p1), "webhook");
    const after1 = await prisma.payment.findUniqueOrThrow({ where: { id: p1.id } });
    expect(after1).toMatchObject({ status: "SUCCESSFUL", isDuplicate: true });
    const stored = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(stored.amountPaid).toBe(200);
  });

  it("un paiement échoué laisse la commande en attente de paiement", async () => {
    const { agent, order } = await confirmedOrder(10);
    const init = await agent.post(`/api/orders/${order.id}/payments`).set("Origin", ORIGIN).send({ method: "CHECKOUT" });
    const res = await agent.post(`/api/payments/${init.body.payment.id}/simulate`).set("Origin", ORIGIN).send({ outcome: "FAILED" });
    expect(res.body.payment.status).toBe("FAILED");
    const stored = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(stored).toMatchObject({ status: "PENDING_PAYMENT", paymentStatus: "UNPAID" });
  });

  it("applique le minimum Fapshi de 100 FCFA", async () => {
    const { agent, order } = await confirmedOrder(2); // 40 FCFA
    expect(order.canPay).toBe(false);
    const res = await agent.post(`/api/orders/${order.id}/payments`).set("Origin", ORIGIN).send({ method: "CHECKOUT" });
    expect(res.status).toBe(409);
  });
});

/** Faux adaptateur « FAPSHI » pour tester le webhook sans appel réseau. */
class FakeFapshi implements PaymentProviderAdapter {
  readonly name = "FAPSHI" as const;
  readonly environment = "SANDBOX" as const;
  readonly supportsDirectPay = false;
  statuses = new Map<string, ProviderTransaction>();
  counter = 0;
  async initiateCheckout(r: { amount: number; externalId: string }) {
    const transId = `FAP${++this.counter}`;
    this.statuses.set(transId, { transId, status: "CREATED", amount: r.amount, externalId: r.externalId, medium: null, financialTransId: null, dateConfirmed: null });
    return { transId, link: `https://checkout.fapshi.com/link/${transId}` };
  }
  async directPay(): Promise<{ transId: string }> {
    throw new Error("non supporté");
  }
  async getStatus(transId: string) {
    return this.statuses.get(transId) as ProviderTransaction;
  }
  async expire() {}
}

describe("Webhook Fapshi", () => {
  it("authentifie le webhook (x-wh-secret), revérifie le statut via l'API et ignore les doublons", async () => {
    const fake = new FakeFapshi();
    setPaymentProvider(fake);
    const { agent, order } = await confirmedOrder(10);
    const init = await agent.post(`/api/orders/${order.id}/payments`).set("Origin", ORIGIN).send({ method: "CHECKOUT" });
    expect(init.body.redirectUrl).toContain("fapshi.com");
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: init.body.payment.id } });
    const transId = payment.providerTransId as string;

    const noSecret = await request(app).post("/api/payments/fapshi/webhook").send({ transId, status: "SUCCESSFUL", amount: 200 });
    expect(noSecret.status).toBe(401);

    // Le corps prétend SUCCESSFUL mais l'API Fapshi indique encore CREATED : rien n'est confirmé
    const forged = await request(app).post("/api/payments/fapshi/webhook").set("x-wh-secret", "whsec-test-123").send({ transId, status: "SUCCESSFUL", amount: 200 });
    expect(forged.status).toBe(200);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).paymentStatus).not.toBe("PAID");

    fake.statuses.set(transId, { ...(fake.statuses.get(transId) as ProviderTransaction), status: "SUCCESSFUL" });
    await prisma.paymentEvent.deleteMany({ where: { dedupeKey: { startsWith: "webhook:" } } });
    const real = await request(app).post("/api/payments/fapshi/webhook").set("x-wh-secret", "whsec-test-123").send({ transId, status: "SUCCESSFUL", amount: 200 });
    expect(real.body).toMatchObject({ ok: true, matched: true, duplicate: false });
    const dup = await request(app).post("/api/payments/fapshi/webhook").set("x-wh-secret", "whsec-test-123").send({ transId, status: "SUCCESSFUL", amount: 200 });
    expect(dup.body.duplicate).toBe(true);
    const stored = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(stored).toMatchObject({ paymentStatus: "PAID", status: "PAID", amountPaid: 200 });
  });

  it("répond sans erreur à une transaction inconnue", async () => {
    setPaymentProvider(new FakeFapshi());
    const res = await request(app).post("/api/payments/fapshi/webhook").set("x-wh-secret", "whsec-test-123").send({ transId: "INCONNU", status: "SUCCESSFUL" });
    expect(res.body).toMatchObject({ ok: true, matched: false });
  });
});

describe("Adaptateur Fapshi", () => {
  it("appelle l'API officielle avec les en-têtes apiuser/apikey et les champs documentés", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      calls.push({ url: String(url), init: init as RequestInit });
      return new Response(JSON.stringify({ message: "Request successful", link: "https://checkout.fapshi.com/link/abc", transId: "TX123", dateInitiated: "2026-10-09" }), { status: 200 });
    });
    const adapter = new FapshiAdapter();
    const out = await adapter.initiateCheckout({ amount: 500, externalId: "pay_1", userId: "user_1", email: "a@b.cm", redirectUrl: "http://localhost:3000/paiement/retour?payment=pay_1", message: "Commande PS-1" });
    expect(out).toEqual({ transId: "TX123", link: "https://checkout.fapshi.com/link/abc" });
    expect(calls[0].url).toBe("https://sandbox.fapshi.com/initiate-pay");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(Object.keys(headers)).toEqual(expect.arrayContaining(["apiuser", "apikey"]));
    expect(JSON.parse(calls[0].init.body as string)).toMatchObject({ amount: 500, externalId: "pay_1", userId: "user_1", redirectUrl: expect.any(String) });
  });

  it("convertit la réponse /payment-status", () => {
    expect(mapFapshiTransaction({ transId: "T", status: "SUCCESSFUL", amount: 1500, externalId: "p", medium: "orange money", financialTransId: "F", dateConfirmed: "2026" })).toEqual({
      transId: "T",
      status: "SUCCESSFUL",
      amount: 1500,
      externalId: "p",
      medium: "orange money",
      financialTransId: "F",
      dateConfirmed: "2026",
    });
    expect(mapFapshiTransaction({ transId: "T", status: "weird" }).status).toBe("PENDING");
  });

  it("le simulateur n'est utilisé que hors production", () => {
    expect(getPaymentProvider()?.environment).toBe("SANDBOX");
  });
});
