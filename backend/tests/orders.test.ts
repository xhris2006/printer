import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/lib/prisma";
import { resetDb } from "./helpers/db";
import { makePdf, PNG_1X1 } from "./helpers/files";
import { defaultOptions, loginAs, ORIGIN, pickup, uploadDocument } from "./helpers/api";

beforeEach(resetDb);

async function customerWithDocs(pages: number[]) {
  const session = await loginAs();
  const docs = [];
  for (const [i, p] of pages.entries()) docs.push(await uploadDocument(session.agent, await makePdf(p), `doc-${i + 1}.pdf`));
  return { ...session, docs };
}

describe("Commandes multi-documents", () => {
  it("crée un brouillon avec des prix calculés côté serveur et ignore tout montant envoyé par le client", async () => {
    const { agent, docs } = await customerWithDocs([10, 20, 3]);
    const res = await agent
      .post("/api/orders")
      .set("Origin", ORIGIN)
      .send({
        items: [
          { documentId: docs[0].id, options: defaultOptions },
          { documentId: docs[1].id, options: { ...defaultOptions, sides: "DOUBLE" } },
          { documentId: docs[2].id, options: { ...defaultOptions, colorMode: "COLOR", finishingCode: "SPIRAL", copies: 2 } },
        ],
        fulfillment: pickup(),
        total: 1,
        subtotal: 1,
      });
    expect(res.status).toBe(201);
    const order = res.body.order;
    expect(order.status).toBe("DRAFT");
    // 10×20 + 20×15 + (3×25×2 + 250×2)
    expect(order.items.map((i: { lineTotal: number }) => i.lineTotal)).toEqual([200, 300, 650]);
    expect(order.items[1]).toMatchObject({ pageCount: 20, sheets: 10, faces: 20 });
    expect(order.total).toBe(1150);
    expect(order.pickupPoint.name).toContain("Mvam-essakoe");
  });

  it("gère 30 documents en une seule commande avec des paramètres partagés", async () => {
    const { agent } = await loginAs();
    const ids: string[] = [];
    for (let i = 0; i < 30; i++) ids.push((await uploadDocument(agent, PNG_1X1, `photo-${i}.png`, { analyze: i === 29 })).id);
    const res = await agent
      .post("/api/orders")
      .set("Origin", ORIGIN)
      .send({ items: ids.map((documentId) => ({ documentId, options: defaultOptions })), fulfillment: pickup() });
    expect(res.status).toBe(201);
    expect(res.body.order.items).toHaveLength(30);
    expect(res.body.order.total).toBe(30 * 20);
  });

  it("refuse un document en cours d'analyse ou appartenant à un autre client", async () => {
    const { agent } = await loginAs();
    const pending = await uploadDocument(agent, await makePdf(2), "a.pdf", { analyze: false });
    const r1 = await agent.post("/api/orders").set("Origin", ORIGIN).send({ items: [{ documentId: pending.id, options: defaultOptions }], fulfillment: pickup() });
    expect(r1.status).toBe(422);
    expect(r1.body.error.code).toBe("DOCUMENT_NOT_READY");

    const other = await customerWithDocs([1]);
    const r2 = await agent.post("/api/orders").set("Origin", ORIGIN).send({ items: [{ documentId: other.docs[0].id, options: defaultOptions }], fulfillment: pickup() });
    expect(r2.status).toBe(400);
    expect(r2.body.error.code).toBe("DOCUMENT_NOT_FOUND");
  });

  it("refuse une combinaison de tarif non configurée", async () => {
    const { agent, docs } = await customerWithDocs([4]);
    const res = await agent
      .post("/api/orders")
      .set("Origin", ORIGIN)
      .send({ items: [{ documentId: docs[0].id, options: { ...defaultOptions, colorMode: "COLOR", sides: "DOUBLE" } }], fulfillment: pickup() });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("PRICE_NOT_CONFIGURED");
  });

  it("confirme la commande : prix figés dans un instantané, indépendants des changements de tarif ultérieurs", async () => {
    const { agent, docs } = await customerWithDocs([10]);
    const draft = await agent.post("/api/orders").set("Origin", ORIGIN).send({ items: [{ documentId: docs[0].id, options: defaultOptions }], fulfillment: pickup() });
    const confirmed = await agent.post(`/api/orders/${draft.body.order.id}/confirm`).set("Origin", ORIGIN).send({});
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.order).toMatchObject({ status: "PENDING_PAYMENT", total: 200, canPay: true });
    const stored = await prisma.order.findUniqueOrThrow({ where: { id: draft.body.order.id } });
    expect(stored.pricingSnapshot).toMatchObject({ currency: "XAF" });

    await prisma.priceRule.updateMany({ where: { colorMode: "BW", sides: "SINGLE" }, data: { unitPrice: 999 } });
    const after = await agent.get(`/api/orders/${draft.body.order.id}`);
    expect(after.body.order.total).toBe(200);
  });

  it("livraison sans tarif configuré : total « à confirmer » et paiement bloqué", async () => {
    const { agent, docs } = await customerWithDocs([10]);
    const draft = await agent
      .post("/api/orders")
      .set("Origin", ORIGIN)
      .send({
        items: [{ documentId: docs[0].id, options: defaultOptions }],
        fulfillment: { method: "DELIVERY", recipientName: "Rebero Dior", phone: "694600007", quarter: "Mvog-Ada", directions: "Près de la pharmacie" },
      });
    expect(draft.status).toBe(201);
    expect(draft.body.order.total).toBeNull();
    const confirmed = await agent.post(`/api/orders/${draft.body.order.id}/confirm`).set("Origin", ORIGIN).send({});
    expect(confirmed.body.order.canPay).toBe(false);
    expect(confirmed.body.order.paymentBlockedReason).toMatch(/livraison/);
    const pay = await agent.post(`/api/orders/${draft.body.order.id}/payments`).set("Origin", ORIGIN).send({ method: "CHECKOUT" });
    expect(pay.status).toBe(409);
  });

  it("applique les frais d'une zone de livraison configurée (sans supplément express automatique)", async () => {
    const zone = await prisma.deliveryZone.create({ data: { name: "Mvog-Ada", fee: 500 } });
    const { agent, docs } = await customerWithDocs([10]);
    const draft = await agent
      .post("/api/orders")
      .set("Origin", ORIGIN)
      .send({
        items: [{ documentId: docs[0].id, options: defaultOptions }],
        fulfillment: { method: "DELIVERY", recipientName: "Rebero", phone: "+237694600007", quarter: "Mvog-Ada", zoneId: zone.id },
      });
    expect(draft.body.order).toMatchObject({ subtotal: 200, deliveryFee: 500, total: 700 });
  });

  it("modifie un brouillon, l'annule, puis recommande sans ressaisie", async () => {
    const { agent, docs } = await customerWithDocs([10, 4]);
    const draft = await agent.post("/api/orders").set("Origin", ORIGIN).send({ items: [{ documentId: docs[0].id, options: defaultOptions }], fulfillment: pickup() });
    const updated = await agent
      .put(`/api/orders/${draft.body.order.id}`)
      .set("Origin", ORIGIN)
      .send({ items: docs.map((d) => ({ documentId: d.id, options: { ...defaultOptions, copies: 2 } })), fulfillment: pickup() });
    expect(updated.body.order.items).toHaveLength(2);
    expect(updated.body.order.total).toBe((10 + 4) * 20 * 2);

    await agent.post(`/api/orders/${draft.body.order.id}/confirm`).set("Origin", ORIGIN).send({});
    const cancelled = await agent.post(`/api/orders/${draft.body.order.id}/cancel`).set("Origin", ORIGIN).send({ reason: "Erreur" });
    expect(cancelled.body.order.status).toBe("CANCELLED");

    const again = await agent.post(`/api/orders/${draft.body.order.id}/reorder`).set("Origin", ORIGIN).send({});
    expect(again.status).toBe(201);
    expect(again.body.order.status).toBe("DRAFT");
    expect(again.body.order.items.map((i: { copies: number }) => i.copies)).toEqual([2, 2]);
    expect(again.body.order.id).not.toBe(draft.body.order.id);
  });

  it("une commande d'un autre client est introuvable", async () => {
    const a = await customerWithDocs([1]);
    const b = await loginAs();
    const draft = await a.agent.post("/api/orders").set("Origin", ORIGIN).send({ items: [{ documentId: a.docs[0].id, options: defaultOptions }], fulfillment: pickup() });
    expect((await b.agent.get(`/api/orders/${draft.body.order.id}`)).status).toBe(404);
    expect((await b.agent.post(`/api/orders/${draft.body.order.id}/confirm`).set("Origin", ORIGIN).send({})).status).toBe(404);
  });

  it("bloque les requêtes modifiantes provenant d'une origine non autorisée (CSRF)", async () => {
    const { agent, docs } = await customerWithDocs([1]);
    const res = await agent.post("/api/orders").set("Origin", "https://evil.example").send({ items: [{ documentId: docs[0].id, options: defaultOptions }], fulfillment: pickup() });
    expect(res.status).toBe(403);
  });
});
