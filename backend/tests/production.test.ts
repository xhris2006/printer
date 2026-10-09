import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { prisma } from "../src/lib/prisma";
import { setPaymentProvider } from "../src/modules/payments/payments.service";
import { MockPaymentAdapter } from "../src/modules/payments/mock";
import { resetDb } from "./helpers/db";
import { makePdf } from "./helpers/files";
import { app, defaultOptions, loginAs, ORIGIN, pickup, uploadDocument } from "./helpers/api";

beforeEach(async () => {
  await resetDb();
  setPaymentProvider(new MockPaymentAdapter());
});

async function paidOrder(customer?: Awaited<ReturnType<typeof loginAs>>) {
  const c = customer ?? (await loginAs());
  const doc = await uploadDocument(c.agent, await makePdf(10), "memoire.pdf");
  const draft = await c.agent.post("/api/orders").set("Origin", ORIGIN).send({ items: [{ documentId: doc.id, options: defaultOptions }], fulfillment: pickup() });
  await c.agent.post(`/api/orders/${draft.body.order.id}/confirm`).set("Origin", ORIGIN).send({});
  const init = await c.agent.post(`/api/orders/${draft.body.order.id}/payments`).set("Origin", ORIGIN).send({ method: "CHECKOUT" });
  await c.agent.post(`/api/payments/${init.body.payment.id}/simulate`).set("Origin", ORIGIN).send({ outcome: "SUCCESSFUL" });
  const order = (await c.agent.get(`/api/orders/${draft.body.order.id}`)).body.order;
  return { ...c, order, doc };
}

describe("Production, statuts et accès", () => {
  it("une commande non payée ne part jamais en production sans exception administrateur journalisée", async () => {
    const c = await loginAs();
    const doc = await uploadDocument(c.agent, await makePdf(10), "a.pdf");
    const draft = await c.agent.post("/api/orders").set("Origin", ORIGIN).send({ items: [{ documentId: doc.id, options: defaultOptions }], fulfillment: pickup() });
    await c.agent.post(`/api/orders/${draft.body.order.id}/confirm`).set("Origin", ORIGIN).send({});
    const operator = await loginAs("OPERATOR");
    const refused = await operator.agent.post(`/api/admin/orders/${draft.body.order.id}/status`).set("Origin", ORIGIN).send({ status: "TO_PREPARE" });
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe("PAYMENT_REQUIRED");

    // L'opérateur ne peut pas accorder d'exception
    expect((await operator.agent.post(`/api/admin/orders/${draft.body.order.id}/credit`).set("Origin", ORIGIN).send({ reason: "Client régulier" })).status).toBe(403);
    // L'opérateur ne peut pas télécharger les fichiers d'une commande non payée
    expect((await operator.agent.get(`/api/admin/documents/${doc.id}/download`)).status).toBe(403);

    const admin = await loginAs("ADMIN");
    const credit = await admin.agent.post(`/api/admin/orders/${draft.body.order.id}/credit`).set("Origin", ORIGIN).send({ reason: "Client régulier, paiement mensuel" });
    expect(credit.body.order.creditApproved).toBe(true);
    expect(await prisma.auditLog.count({ where: { action: "order.credit_approved" } })).toBe(1);
    const ok = await operator.agent.post(`/api/admin/orders/${draft.body.order.id}/status`).set("Origin", ORIGIN).send({ status: "TO_PREPARE" });
    expect(ok.status).toBe(200);
  });

  it("enchaîne les statuts de production, refuse les transitions invalides et remet avec code de retrait", async () => {
    const { order, agent } = await paidOrder();
    const operator = await loginAs("OPERATOR");
    const set = (status: string) => operator.agent.post(`/api/admin/orders/${order.id}/status`).set("Origin", ORIGIN).send({ status });

    expect((await set("READY_FOR_PICKUP")).status).toBe(409); // PAID → prête : interdit
    expect((await set("OUT_FOR_DELIVERY")).status).toBe(409);
    expect((await set("TO_PREPARE")).status).toBe(200);
    expect((await set("PRINTING")).status).toBe(200);
    expect((await set("FINISHING")).status).toBe(200);
    expect((await set("OUT_FOR_DELIVERY")).status).toBe(409); // retrait sur place, pas de livraison
    expect((await set("READY_FOR_PICKUP")).status).toBe(200);
    expect((await set("COMPLETED")).status).toBe(409); // remise uniquement via l'action dédiée

    const wrong = await operator.agent.post(`/api/admin/orders/${order.id}/handover`).set("Origin", ORIGIN).send({ code: "000000", recipientName: "Rebero" });
    const code = (await agent.get(`/api/orders/${order.id}`)).body.order.pickupCode;
    if (code !== "000000") expect(wrong.status).toBe(400);
    const handover = await operator.agent.post(`/api/admin/orders/${order.id}/handover`).set("Origin", ORIGIN).send({ code, recipientName: "Rebero Dior" });
    expect(handover.status).toBe(200);
    expect(handover.body.order.status).toBe("COMPLETED");
    expect(handover.body.order.pickup).toMatchObject({ status: "PICKED_UP", verifiedWithCode: true, pickedUpBy: "Rebero Dior" });

    const history = (await agent.get(`/api/orders/${order.id}`)).body.order.history.map((h: { status: string }) => h.status);
    expect(history).toEqual(["DRAFT", "PENDING_PAYMENT", "PAID", "TO_PREPARE", "PRINTING", "FINISHING", "READY_FOR_PICKUP", "COMPLETED"]);
  });

  it("l'opérateur télécharge les fichiers d'une commande payée via une URL temporaire, avec journalisation", async () => {
    const { doc } = await paidOrder();
    const operator = await loginAs("OPERATOR");
    const res = await operator.agent.get(`/api/admin/documents/${doc.id}/download`);
    expect(res.status).toBe(200);
    expect(res.body.expiresInSec).toBe(300);
    expect(await prisma.auditLog.count({ where: { action: "document.downloaded", entityId: doc.id } })).toBe(1);
  });

  it("contrôle d'accès par rôle sur l'administration", async () => {
    const customer = await loginAs();
    const operator = await loginAs("OPERATOR");
    const admin = await loginAs("ADMIN");
    expect((await request(app).get("/api/admin/orders")).status).toBe(401);
    expect((await customer.agent.get("/api/admin/orders")).status).toBe(403);
    expect((await operator.agent.get("/api/admin/orders")).status).toBe(200);
    expect((await operator.agent.get("/api/admin/production")).status).toBe(200);
    expect((await operator.agent.get("/api/admin/config/pricing")).status).toBe(403);
    expect((await operator.agent.get("/api/admin/payments")).status).toBe(403);
    expect((await operator.agent.get("/api/admin/audit-logs")).status).toBe(403);
    expect((await operator.agent.get("/api/admin/orders/export.csv")).status).toBe(403);
    expect((await admin.agent.get("/api/admin/config/pricing")).status).toBe(200);
  });

  it("l'administrateur configure les tarifs (dont le recto verso) avec journal d'audit", async () => {
    const admin = await loginAs("ADMIN");
    const res = await admin.agent
      .put("/api/admin/config/pricing/rules")
      .set("Origin", ORIGIN)
      .send({ rules: [{ colorMode: "COLOR", sides: "DOUBLE", paperFormat: "A4", unitPrice: 30, unit: "PER_FACE", isActive: true }] });
    expect(res.status).toBe(200);
    const grid = (await admin.agent.get("/api/admin/config/pricing")).body.rules;
    expect(grid).toHaveLength(8);
    expect(grid.find((r: { colorMode: string; sides: string; paperFormat: string }) => r.colorMode === "COLOR" && r.sides === "DOUBLE" && r.paperFormat === "A4").unitPrice).toBe(30);
    expect(await prisma.auditLog.count({ where: { action: "pricing.rules_updated" } })).toBe(1);
  });

  it("exporte les commandes en CSV (protection contre l'injection de formules)", async () => {
    const c = await loginAs("CUSTOMER", { fullName: "=HYPERLINK(evil)" });
    await paidOrder(c);
    const admin = await loginAs("ADMIN");
    const csv = await admin.agent.get("/api/admin/orders/export.csv");
    expect(csv.status).toBe(200);
    expect(csv.text).toContain("'=HYPERLINK(evil)");
  });
});

describe("Suivi de commande", () => {
  it("le lien public révèle le statut sans documents, données personnelles ni paiement", async () => {
    const { order, user } = await paidOrder();
    const res = await request(app).get(`/api/tracking/${order.trackingToken}`);
    expect(res.status).toBe(200);
    expect(res.body.tracking).toMatchObject({ reference: order.reference, status: "PAID", statusLabel: "Paiement confirmé", itemsCount: 1 });
    const text = JSON.stringify(res.body);
    expect(text).not.toContain(user.phone);
    expect(text).not.toContain(user.fullName);
    expect(text).not.toContain("memoire.pdf");
    expect(text).not.toContain(order.pickupCode);
    expect(text).not.toContain("transId");
  });

  it("un jeton invalide ou une référence devinée ne donne rien", async () => {
    const { order } = await paidOrder();
    expect((await request(app).get(`/api/tracking/${order.reference}`)).status).toBe(404);
    expect((await request(app).get("/api/tracking/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).status).toBe(404);
  });

  it("le reçu PDF est disponible pour le client après paiement", async () => {
    const { order, agent } = await paidOrder();
    const res = await agent.get(`/api/orders/${order.id}/receipt.pdf`).buffer(true);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
  });
});

describe("Prestations sur devis", () => {
  it("demande de devis → devis administrateur → acceptation → commande payable", async () => {
    const c = await loginAs();
    const doc = await uploadDocument(c.agent, await makePdf(3), "brouillon-memoire.pdf");
    const req = await c.agent.post("/api/quotes").set("Origin", ORIGIN).send({ serviceCode: "MISE_EN_FORME", description: "Mise en forme de mon mémoire de 60 pages", documentIds: [doc.id] });
    expect(req.status).toBe(201);
    expect(req.body.quote.status).toBe("REQUESTED");

    // Le client ne peut pas accepter un devis sans montant
    expect((await c.agent.post(`/api/quotes/${req.body.quote.id}/accept`).set("Origin", ORIGIN).send({})).status).toBe(409);

    const admin = await loginAs("ADMIN");
    const sent = await admin.agent
      .post(`/api/admin/quotes/${req.body.quote.id}/send`)
      .set("Origin", ORIGIN)
      .send({ lines: [{ label: "Mise en forme (60 pages)", quantity: 60, unitPrice: 100 }], message: "Livraison sous 48 h" });
    expect(sent.body.quote).toMatchObject({ status: "QUOTED", amount: 6000 });

    const accepted = await c.agent.post(`/api/quotes/${req.body.quote.id}/accept`).set("Origin", ORIGIN).send({});
    expect(accepted.status).toBe(201);
    const order = (await c.agent.get(`/api/orders/${accepted.body.orderId}`)).body.order;
    expect(order).toMatchObject({ type: "SERVICE", status: "PENDING_PAYMENT", total: 6000, canPay: true });
  });
});
