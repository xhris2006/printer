import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/lib/prisma";
import { setPaymentProvider } from "../src/modules/payments/payments.service";
import { MockPaymentAdapter } from "../src/modules/payments/mock";
import { resetDb } from "./helpers/db";
import { makePdf } from "./helpers/files";
import { defaultOptions, loginAs, ORIGIN, pickup, uploadDocument, type Agent } from "./helpers/api";

let mock: MockPaymentAdapter;
beforeEach(async () => {
  await resetDb();
  mock = new MockPaymentAdapter();
  setPaymentProvider(mock);
});

const groupInput = (mode: "DELEGATE_COLLECT" | "STUDENT_CONTRIBUTIONS", rule: "FULL_PAYMENT" | "PAID_ONLY" = "FULL_PAYMENT") => ({
  name: "Fascicules Algorithmique S3",
  institution: "Université de Yaoundé I",
  field: "Informatique",
  level: "L2",
  className: "L2 Info A",
  category: "Algorithmique",
  instructions: "Agrafer chaque fascicule",
  mode,
  productionRule: rule,
  defaultOptions: { ...defaultOptions, sides: "DOUBLE", finishingCode: "STAPLE" },
});

async function contribute(agent: Agent, shareToken: string, pages: number) {
  const doc = await uploadDocument(agent, await makePdf(pages), "contribution.pdf");
  const draft = await agent.post("/api/orders").set("Origin", ORIGIN).send({ items: [{ documentId: doc.id, options: defaultOptions }], fulfillment: pickup(), groupShareToken: shareToken });
  expect(draft.status).toBe(201);
  const confirmed = await agent.post(`/api/orders/${draft.body.order.id}/confirm`).set("Origin", ORIGIN).send({});
  return confirmed.body.order;
}

async function payWithMock(agent: Agent, orderId: string) {
  const init = await agent.post(`/api/orders/${orderId}/payments`).set("Origin", ORIGIN).send({ method: "CHECKOUT" });
  return agent.post(`/api/payments/${init.body.payment.id}/simulate`).set("Origin", ORIGIN).send({ outcome: "SUCCESSFUL" });
}

describe("Délégués de classe", () => {
  it("un client doit faire approuver son espace délégué avant de créer un groupe", async () => {
    const { agent, user } = await loginAs();
    expect((await agent.post("/api/groups").set("Origin", ORIGIN).send(groupInput("DELEGATE_COLLECT"))).status).toBe(403);
    const req = await agent.post("/api/delegate/request").set("Origin", ORIGIN).send({ institution: "UY1", field: "Info", level: "L2", className: "L2 A" });
    expect(req.body.user.delegate.status).toBe("PENDING");

    const admin = await loginAs("ADMIN");
    await admin.agent.post(`/api/admin/delegates/${user.id}/review`).set("Origin", ORIGIN).send({ decision: "APPROVED" });
    const after = await agent.post("/api/groups").set("Origin", ORIGIN).send(groupInput("DELEGATE_COLLECT"));
    expect(after.status).toBe(201);
    expect(after.body.group.code).toMatch(/^GRP-/);
    expect(after.body.group.shareToken.length).toBeGreaterThan(20);
  });

  it("mode A : le délégué commande pour la classe avec paramètres communs et exceptions par fichier", async () => {
    const { agent } = await loginAs("DELEGATE");
    const group = (await agent.post("/api/groups").set("Origin", ORIGIN).send(groupInput("DELEGATE_COLLECT"))).body.group;
    const docs = [await uploadDocument(agent, await makePdf(20), "td1.pdf"), await uploadDocument(agent, await makePdf(8), "td2.pdf")];
    const common = { ...defaultOptions, sides: "DOUBLE", finishingCode: "STAPLE", copies: 40 };
    const draft = await agent
      .post("/api/orders")
      .set("Origin", ORIGIN)
      .send({ groupId: group.id, fulfillment: pickup(), items: [{ documentId: docs[0].id, options: common }, { documentId: docs[1].id, options: { ...common, sides: "SINGLE" } }] });
    expect(draft.status).toBe(201);
    expect(draft.body.order.type).toBe("GROUP");
    // td1 : 20 pages × 40 ex × 15 + 40 × 50 ; td2 : 8 × 40 × 20 + 40 × 50
    expect(draft.body.order.total).toBe(20 * 40 * 15 + 2000 + 8 * 40 * 20 + 2000);
    await agent.post(`/api/orders/${draft.body.order.id}/confirm`).set("Origin", ORIGIN).send({});
    const detail = await agent.get(`/api/groups/${group.id}`);
    expect(detail.body.group.totals).toMatchObject({ confirmedCount: 1, documentsCount: 2, pagesCount: 28, paidAmount: 0 });
  });

  it("mode B : les étudiants contribuent via le lien ; contributions enregistrées individuellement", async () => {
    const delegate = await loginAs("DELEGATE");
    const group = (await delegate.agent.post("/api/groups").set("Origin", ORIGIN).send(groupInput("STUDENT_CONTRIBUTIONS"))).body.group;

    const publicInfo = await delegate.agent.get(`/api/public/groups/${group.shareToken}`);
    expect(publicInfo.body.group).toMatchObject({ acceptingContributions: true, className: "L2 Info A" });
    expect(publicInfo.body.group.delegateName).not.toContain(" ");

    const s1 = await loginAs("CUSTOMER", { fullName: "Alice Étudiante" });
    const s2 = await loginAs("CUSTOMER", { fullName: "Bob Étudiant" });
    const o1 = await contribute(s1.agent, group.shareToken, 10);
    const o2 = await contribute(s2.agent, group.shareToken, 5);
    expect(o1.type).toBe("GROUP");
    await payWithMock(s1.agent, o1.id);

    const detail = (await delegate.agent.get(`/api/groups/${group.id}`)).body.group;
    expect(detail.contributions).toHaveLength(2);
    expect(detail.totals).toMatchObject({ confirmedCount: 2, paidCount: 1, unpaidCount: 1, totalAmount: 200 + 100, paidAmount: 200 });
    // Le délégué voit les noms et statuts, pas les fichiers ni les coordonnées
    expect(detail.contributions[0].order.documents[0]).not.toHaveProperty("documentId");
    expect(JSON.stringify(detail)).not.toContain(s1.user.phone);

    const participations = await s2.agent.get("/api/groups/participations");
    expect(participations.body.items[0]).toMatchObject({ code: group.code, order: { id: o2.id } });
  });

  it("un délégué n'accède jamais au groupe, aux documents ou aux paiements d'un autre délégué", async () => {
    const d1 = await loginAs("DELEGATE");
    const d2 = await loginAs("DELEGATE");
    const g1 = (await d1.agent.post("/api/groups").set("Origin", ORIGIN).send(groupInput("STUDENT_CONTRIBUTIONS"))).body.group;
    const student = await loginAs();
    const order = await contribute(student.agent, g1.shareToken, 3);

    expect((await d2.agent.get(`/api/groups/${g1.id}`)).status).toBe(404);
    expect((await d2.agent.get(`/api/groups/${g1.id}/summary.pdf`)).status).toBe(404);
    expect((await d2.agent.post(`/api/groups/${g1.id}/close`).set("Origin", ORIGIN).send({})).status).toBe(404);
    expect((await d2.agent.get(`/api/orders/${order.id}`)).status).toBe(404);
    expect((await d2.agent.post(`/api/groups/${g1.id}/orders/${order.id}/cash-declaration`).set("Origin", ORIGIN).send({ amount: order.total, note: "Payé en espèces" })).status).toBe(404);
    // Le délégué du groupe lui-même ne peut pas télécharger les fichiers des étudiants
    const docId = (await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } })).documentId as string;
    expect((await d1.agent.get(`/api/documents/${docId}/download`)).status).toBe(404);
    expect((await d1.agent.get(`/api/admin/documents/${docId}/download`)).status).toBe(403);
    // Un étudiant ne voit pas le détail du groupe
    expect((await student.agent.get(`/api/groups/${g1.id}`)).status).toBe(404);
  });

  it("le délégué signale un paiement en espèces ; seul l'administrateur peut le confirmer", async () => {
    const delegate = await loginAs("DELEGATE");
    const group = (await delegate.agent.post("/api/groups").set("Origin", ORIGIN).send(groupInput("STUDENT_CONTRIBUTIONS"))).body.group;
    const student = await loginAs();
    const order = await contribute(student.agent, group.shareToken, 10);

    const declared = await delegate.agent
      .post(`/api/groups/${group.id}/orders/${order.id}/cash-declaration`)
      .set("Origin", ORIGIN)
      .send({ amount: order.total, note: "Remis en main propre le 9/10" });
    expect(declared.status).toBe(201);
    expect(declared.body.payment.status).toBe("PENDING_VERIFICATION");
    let stored = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(stored.paymentStatus).toBe("PENDING");
    expect(stored.status).toBe("PENDING_PAYMENT");

    // Le délégué ne peut pas valider lui-même
    expect((await delegate.agent.post(`/api/admin/payments/${declared.body.payment.id}/review`).set("Origin", ORIGIN).send({ approve: true, note: "ok" })).status).toBe(403);

    const admin = await loginAs("ADMIN");
    const review = await admin.agent.post(`/api/admin/payments/${declared.body.payment.id}/review`).set("Origin", ORIGIN).send({ approve: true, note: "Espèces reçues au comptoir" });
    expect(review.status).toBe(200);
    stored = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(stored).toMatchObject({ paymentStatus: "PAID", status: "PAID" });
    expect(await prisma.auditLog.count({ where: { action: "payment.cash_verified" } })).toBe(1);
  });

  it("règle FULL_PAYMENT : production refusée tant qu'une contribution n'est pas payée", async () => {
    const delegate = await loginAs("DELEGATE");
    const group = (await delegate.agent.post("/api/groups").set("Origin", ORIGIN).send(groupInput("STUDENT_CONTRIBUTIONS", "FULL_PAYMENT"))).body.group;
    const s1 = await loginAs();
    const s2 = await loginAs();
    const o1 = await contribute(s1.agent, group.shareToken, 10);
    await contribute(s2.agent, group.shareToken, 10);
    await payWithMock(s1.agent, o1.id);

    const admin = await loginAs("ADMIN");
    // Avant clôture : refus
    expect((await admin.agent.post(`/api/admin/groups/${group.id}/start-production`).set("Origin", ORIGIN).send({})).status).toBe(409);
    // Une commande payée d'une collecte ouverte ne peut pas partir seule en production
    expect((await admin.agent.post(`/api/admin/orders/${o1.id}/status`).set("Origin", ORIGIN).send({ status: "TO_PREPARE" })).status).toBe(409);

    await delegate.agent.post(`/api/groups/${group.id}/close`).set("Origin", ORIGIN).send({});
    const refused = await admin.agent.post(`/api/admin/groups/${group.id}/start-production`).set("Origin", ORIGIN).send({});
    expect(refused.status).toBe(409);
    expect(refused.body.error.message).toMatch(/non payée/);

    // Dérogation administrateur journalisée
    const override = await admin.agent.post(`/api/admin/groups/${group.id}/start-production`).set("Origin", ORIGIN).send({ override: true, reason: "Classe habituée, paiement à la remise" });
    expect(override.status).toBe(200);
    expect(override.body.released).toBe(2);
    expect(await prisma.auditLog.count({ where: { action: "group.production_override" } })).toBe(1);
  });

  it("règle PAID_ONLY : à la clôture, les contributions non payées sont annulées et seules les payées partent en production", async () => {
    const delegate = await loginAs("DELEGATE");
    const group = (await delegate.agent.post("/api/groups").set("Origin", ORIGIN).send(groupInput("STUDENT_CONTRIBUTIONS", "PAID_ONLY"))).body.group;
    const s1 = await loginAs();
    const s2 = await loginAs();
    const o1 = await contribute(s1.agent, group.shareToken, 10);
    const o2 = await contribute(s2.agent, group.shareToken, 10);
    await payWithMock(s1.agent, o1.id);
    const closed = await delegate.agent.post(`/api/groups/${group.id}/close`).set("Origin", ORIGIN).send({});
    expect(closed.body.cancelled).toBe(1);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: o2.id } })).status).toBe("CANCELLED");

    const admin = await loginAs("ADMIN");
    const started = await admin.agent.post(`/api/admin/groups/${group.id}/start-production`).set("Origin", ORIGIN).send({});
    expect(started.status).toBe(200);
    expect(started.body.group.status).toBe("IN_PRODUCTION");
    expect((await prisma.order.findUniqueOrThrow({ where: { id: o1.id } })).status).toBe("TO_PREPARE");
    // Les contributions ne sont plus acceptées
    const s3 = await loginAs();
    const doc = await uploadDocument(s3.agent, await makePdf(1), "late.pdf");
    const late = await s3.agent.post("/api/orders").set("Origin", ORIGIN).send({ items: [{ documentId: doc.id, options: defaultOptions }], fulfillment: pickup(), groupShareToken: group.shareToken });
    expect(late.status).toBe(409);
  });

  it("produit un récapitulatif PDF et CSV pour le délégué", async () => {
    const delegate = await loginAs("DELEGATE");
    const group = (await delegate.agent.post("/api/groups").set("Origin", ORIGIN).send(groupInput("STUDENT_CONTRIBUTIONS"))).body.group;
    const student = await loginAs("CUSTOMER", { fullName: "Chantal Étudiante" });
    await contribute(student.agent, group.shareToken, 4);
    const pdf = await delegate.agent.get(`/api/groups/${group.id}/summary.pdf`).buffer(true);
    expect(pdf.status).toBe(200);
    expect(pdf.headers["content-type"]).toBe("application/pdf");
    const csv = await delegate.agent.get(`/api/groups/${group.id}/summary.csv`);
    expect(csv.text).toContain("Chantal Étudiante");
  });
});
