import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import yauzl from "yauzl";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { prisma } from "../src/lib/prisma";
import { drainJobs } from "../src/jobs/queue";
import { setPaymentProvider } from "../src/modules/payments/payments.service";
import { MockPaymentAdapter } from "../src/modules/payments/mock";
import { getStorage } from "../src/modules/storage/storage";
import { archiveName } from "../src/modules/admin/files.export";
import { resetDb } from "./helpers/db";
import { makePdf, PNG_1X1 } from "./helpers/files";
import { app, createUser, defaultOptions, loginAs, ORIGIN, pickup, uploadDocument, type Agent } from "./helpers/api";

beforeEach(async () => {
  await resetDb();
  setPaymentProvider(new MockPaymentAdapter());
});

/** Récupère le contenu servi par un lien signé du stockage local. */
async function fetchSigned(url: string) {
  const res = await request(app)
    .get(new URL(url).pathname)
    .buffer(true)
    .parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on("data", (c: Buffer) => chunks.push(c));
      r.on("end", () => cb(null, Buffer.concat(chunks)));
    });
  return res;
}

function readZip(buffer: Buffer): Promise<Map<string, Buffer>> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err);
      const entries = new Map<string, Buffer>();
      zip.on("entry", (entry: yauzl.Entry) => {
        zip.openReadStream(entry, (e, stream) => {
          if (e || !stream) return reject(e);
          const chunks: Buffer[] = [];
          stream.on("data", (c: Buffer) => chunks.push(c));
          stream.on("end", () => {
            entries.set(entry.fileName, Buffer.concat(chunks));
            zip.readEntry();
          });
        });
      });
      zip.on("end", () => resolve(entries));
      zip.on("error", reject);
      zip.readEntry();
    });
  });
}

async function payWithMock(agent: Agent, orderId: string) {
  const init = await agent.post(`/api/orders/${orderId}/payments`).set("Origin", ORIGIN).send({ method: "CHECKOUT" });
  return agent.post(`/api/payments/${init.body.payment.id}/simulate`).set("Origin", ORIGIN).send({ outcome: "SUCCESSFUL" });
}

async function confirmedOrder(files: { content: Buffer; name: string }[], customer?: Awaited<ReturnType<typeof loginAs>>) {
  const c = customer ?? (await loginAs("CUSTOMER", { fullName: "Aïcha Mbarga" }));
  const docs = [];
  for (const f of files) docs.push(await uploadDocument(c.agent, f.content, f.name));
  const draft = await c.agent
    .post("/api/orders")
    .set("Origin", ORIGIN)
    .send({ items: docs.map((d, i) => ({ documentId: d.id, options: i === 0 ? { ...defaultOptions, copies: 2, sides: "DOUBLE", finishingCode: "SPIRAL" } : defaultOptions })), fulfillment: pickup() });
  expect(draft.status).toBe(201);
  const confirmed = await c.agent.post(`/api/orders/${draft.body.order.id}/confirm`).set("Origin", ORIGIN).send({});
  expect(confirmed.status).toBe(200);
  return { ...c, order: confirmed.body.order as { id: string; reference: string }, docs };
}

describe("Fichiers à imprimer côté administration", () => {
  it("téléchargement par lien direct : redirection vers le lien signé, fichier intact, page d'erreur lisible", async () => {
    const pdf = await makePdf(3);
    const { order, docs, agent } = await confirmedOrder([{ content: pdf, name: "mémoire.pdf" }]);
    await payWithMock(agent, order.id);
    const admin = await loginAs("ADMIN");

    const res = await admin.agent.get(`/api/admin/documents/${docs[0].id}/download?variant=original&redirect=1`);
    expect(res.status).toBe(302);
    expect(res.headers["cache-control"]).toContain("no-store");
    expect(res.headers.location).toMatch(/^http:\/\/localhost:4000\/api\/storage\/local\/download\//);
    const file = await fetchSigned(res.headers.location);
    expect(file.status).toBe(200);
    expect(file.headers["content-type"]).toBe("application/pdf");
    expect(file.headers["content-disposition"]).toContain("attachment");
    expect(Buffer.compare(file.body as Buffer, pdf)).toBe(0);

    // Mode JSON conservé pour l'API
    const json = await admin.agent.get(`/api/admin/documents/${docs[0].id}/download`);
    expect(json.status).toBe(200);
    expect(json.body.url).toMatch(/^http:\/\/localhost:4000\//);

    // Le client télécharge aussi son propre fichier par lien direct
    expect((await agent.get(`/api/documents/${docs[0].id}/download?redirect=1`)).status).toBe(302);

    // Erreur en mode lien direct : page HTML au lieu d'un JSON brut
    const stranger = await loginAs();
    const denied = await stranger.agent.get(`/api/documents/${docs[0].id}/download?redirect=1`);
    expect(denied.status).toBe(404);
    expect(denied.headers["content-type"]).toContain("text/html");
    expect(denied.text).toContain("Téléchargement impossible");
    const anonymous = await request(app).get(`/api/admin/documents/${docs[0].id}/download?redirect=1`);
    expect(anonymous.status).toBe(401);
    expect(anonymous.text).toContain("/connexion");
  });

  it("archive ZIP d'une commande : originaux, PDF convertis et fiche de production, puis suppression automatique", async () => {
    const pdf = await makePdf(4);
    const { order, docs, agent } = await confirmedOrder([
      { content: pdf, name: "Mémoire de fin d'études.pdf" },
      { content: PNG_1X1, name: "photo.png" },
    ]);
    // PDF converti disponible pour l'image (comme après une conversion)
    const work = await mkdtemp(path.join(tmpdir(), "ps-test-"));
    const converted = await makePdf(1);
    await writeFile(path.join(work, "c.pdf"), converted);
    await getStorage().putFile(`converted/${docs[1].id}.pdf`, path.join(work, "c.pdf"), "application/pdf");
    await rm(work, { recursive: true, force: true });
    await prisma.document.update({ where: { id: docs[1].id }, data: { pdfStorageKey: `converted/${docs[1].id}.pdf` } });

    const operator = await loginAs("OPERATOR");
    // Non payée : l'opérateur n'a pas accès aux fichiers
    expect((await operator.agent.get(`/api/admin/orders/${order.id}/archive`)).status).toBe(403);
    // Un client n'a jamais accès à l'administration
    expect((await agent.get(`/api/admin/orders/${order.id}/archive`)).status).toBe(403);

    await payWithMock(agent, order.id);
    const res = await operator.agent.get(`/api/admin/orders/${order.id}/archive`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ filename: `${order.reference}-fichiers.zip`, fileCount: 3, missingCount: 0 });

    const download = await fetchSigned(res.body.url);
    expect(download.status).toBe(200);
    expect(download.headers["content-type"]).toBe("application/zip");
    expect(download.headers["content-disposition"]).toContain(`${order.reference}-fichiers.zip`);
    const entries = await readZip(download.body as Buffer);
    expect([...entries.keys()].sort()).toEqual(["00_FICHE_PRODUCTION.txt", "01_Memoire de fin d'etudes.pdf", "02_photo.pdf", "02_photo.png"]);
    expect(Buffer.compare(entries.get("01_Memoire de fin d'etudes.pdf") as Buffer, pdf)).toBe(0);
    expect(Buffer.compare(entries.get("02_photo.pdf") as Buffer, converted)).toBe(0);

    const sheet = (entries.get("00_FICHE_PRODUCTION.txt") as Buffer).toString("utf8");
    expect(sheet).toContain(order.reference);
    expect(sheet).toContain("Aïcha Mbarga");
    expect(sheet).toContain("Payé");
    expect(sheet).toContain("Mémoire de fin d'études.pdf");
    expect(sheet).toContain("2 exemplaire(s) · Noir et blanc · Recto verso · A4 · Finition :");
    expect(sheet).toContain("Retrait — Centre de santé de Mvam-essakoe");
    expect(sheet).not.toContain("Code de retrait");
    expect(await prisma.auditLog.count({ where: { action: "order.files_exported", entityId: order.id } })).toBe(1);

    // Lien direct (redirection) pour un simple <a href>
    const redirect = await operator.agent.get(`/api/admin/orders/${order.id}/archive?redirect=1`);
    expect(redirect.status).toBe(302);

    // Les archives temporaires sont supprimées automatiquement
    await prisma.job.updateMany({ where: { type: "storage.deleteExport" }, data: { runAt: new Date() } });
    expect(await drainJobs(["storage.deleteExport"])).toBe(2);
    expect((await fetchSigned(res.body.url)).status).toBe(404);
    // Les fichiers des clients, eux, restent en place
    expect(await getStorage().head(docs[0].storageKey)).not.toBeNull();
  });

  it("signale les fichiers supprimés au lieu d'échouer, et refuse une archive vide", async () => {
    const { order, docs, agent } = await confirmedOrder([
      { content: await makePdf(2), name: "a.pdf" },
      { content: await makePdf(2), name: "b.pdf" },
    ]);
    await payWithMock(agent, order.id);
    const admin = await loginAs("ADMIN");
    await prisma.document.update({ where: { id: docs[1].id }, data: { status: "DELETED", purgedAt: new Date() } });
    const res = await admin.agent.get(`/api/admin/orders/${order.id}/archive`);
    expect(res.status).toBe(200);
    expect(res.body.fileCount).toBe(1);
    const sheet = (await readZip((await fetchSigned(res.body.url)).body as Buffer)).get("00_FICHE_PRODUCTION.txt")?.toString("utf8");
    expect(sheet).toContain("indisponible");

    await prisma.document.update({ where: { id: docs[0].id }, data: { status: "DELETED", purgedAt: new Date() } });
    const empty = await admin.agent.get(`/api/admin/orders/${order.id}/archive`);
    expect(empty.status).toBe(409);
    expect(empty.body.error.code).toBe("NO_FILES");
  });

  it("archive d'une commande groupée : un dossier par contribution payée, les non payées exclues", async () => {
    const delegate = await loginAs("DELEGATE");
    const group = (
      await delegate.agent
        .post("/api/groups")
        .set("Origin", ORIGIN)
        .send({
          name: "Fascicules S3",
          institution: "Université de Yaoundé I",
          field: "Informatique",
          level: "L2",
          className: "L2 Info A",
          mode: "STUDENT_CONTRIBUTIONS",
          productionRule: "PAID_ONLY",
          defaultOptions,
        })
    ).body.group;
    const s1 = await loginAs("CUSTOMER", { fullName: "Étudiant Un" });
    const s2 = await loginAs("CUSTOMER", { fullName: "Étudiant Deux" });
    const contribute = async (agent: Agent) => {
      const doc = await uploadDocument(agent, await makePdf(5), "td.pdf");
      const draft = await agent.post("/api/orders").set("Origin", ORIGIN).send({ items: [{ documentId: doc.id, options: defaultOptions }], fulfillment: pickup(), groupShareToken: group.shareToken });
      return (await agent.post(`/api/orders/${draft.body.order.id}/confirm`).set("Origin", ORIGIN).send({})).body.order;
    };
    const o1 = await contribute(s1.agent);
    await contribute(s2.agent);

    const admin = await loginAs("ADMIN");
    const none = await admin.agent.get(`/api/admin/groups/${group.id}/archive`);
    expect(none.status).toBe(409);

    await payWithMock(s1.agent, o1.id);
    const res = await admin.agent.get(`/api/admin/groups/${group.id}/archive`);
    expect(res.status).toBe(200);
    expect(res.body.filename).toBe(`${group.code}-fichiers.zip`);
    const entries = await readZip((await fetchSigned(res.body.url)).body as Buffer);
    expect([...entries.keys()].sort()).toEqual(["00_FICHE_PRODUCTION.txt", `01_Etudiant Un_${o1.reference}/01_td.pdf`]);
    const sheet = entries.get("00_FICHE_PRODUCTION.txt")?.toString("utf8") ?? "";
    expect(sheet).toContain(group.code);
    expect(sheet).toContain("1 non payée(s) exclue(s)");
    expect(sheet).not.toContain("Étudiant Deux");
  });

  it("l'équipe (admin et opérateurs) est prévenue de chaque commande payée à imprimer", async () => {
    const admin = await createUser("ADMIN");
    const operator = await createUser("OPERATOR");
    const inactive = await createUser("OPERATOR");
    await prisma.user.update({ where: { id: inactive.id }, data: { isActive: false } });

    const { order, agent, user } = await confirmedOrder([{ content: await makePdf(6), name: "rapport.pdf" }]);
    expect(await prisma.notification.count({ where: { type: "STAFF_ORDER_TO_PRINT" } })).toBe(0);
    await payWithMock(agent, order.id);

    const notes = await prisma.notification.findMany({ where: { type: "STAFF_ORDER_TO_PRINT", channel: "IN_APP" } });
    expect(notes.map((n) => n.userId).sort()).toEqual([admin.id, operator.id].sort());
    expect(notes[0]).toMatchObject({ orderId: order.id, link: `/admin/commandes/${order.id}` });
    expect(notes[0].title).toContain(order.reference);
    expect(notes[0].body).toContain("1 fichier(s)");
    expect(await prisma.notification.count({ where: { userId: user.id, type: "STAFF_ORDER_TO_PRINT" } })).toBe(0);

    // Paiement en espèces saisi par un administrateur : les autres membres de l'équipe sont prévenus
    const cashier = await loginAs("ADMIN");
    const second = await confirmedOrder([{ content: await makePdf(2), name: "cv.pdf" }]);
    const cash = await cashier.agent.post(`/api/admin/orders/${second.order.id}/cash-payment`).set("Origin", ORIGIN).send({ note: "Reçu au comptoir" });
    expect(cash.status).toBe(201);
    const cashNotes = await prisma.notification.findMany({ where: { type: "STAFF_ORDER_TO_PRINT", orderId: second.order.id } });
    expect(cashNotes.map((n) => n.userId).sort()).toEqual([admin.id, operator.id].sort());
  });

  it("collecte étudiante : pas d'alerte par contribution, mais une alerte à la clôture", async () => {
    await createUser("OPERATOR");
    const delegate = await loginAs("DELEGATE");
    const group = (
      await delegate.agent
        .post("/api/groups")
        .set("Origin", ORIGIN)
        .send({ name: "TD Réseaux", institution: "UY1", field: "Info", level: "L3", className: "L3 B", mode: "STUDENT_CONTRIBUTIONS", defaultOptions })
    ).body.group;
    const student = await loginAs();
    const doc = await uploadDocument(student.agent, await makePdf(10), "td.pdf");
    const draft = await student.agent.post("/api/orders").set("Origin", ORIGIN).send({ items: [{ documentId: doc.id, options: defaultOptions }], fulfillment: pickup(), groupShareToken: group.shareToken });
    await student.agent.post(`/api/orders/${draft.body.order.id}/confirm`).set("Origin", ORIGIN).send({});
    await payWithMock(student.agent, draft.body.order.id);
    expect(await prisma.notification.count({ where: { type: "STAFF_ORDER_TO_PRINT" } })).toBe(0);

    await delegate.agent.post(`/api/groups/${group.id}/close`).set("Origin", ORIGIN).send({});
    const closed = await prisma.notification.findMany({ where: { type: "STAFF_GROUP_CLOSED" } });
    expect(closed).toHaveLength(1);
    expect(closed[0].link).toBe(`/admin/groupes/${group.id}`);
    expect(closed[0].body).toContain("1 commande(s) payée(s) sur 1");
  });

  it("noms de fichiers d'archive compatibles avec tous les décompresseurs", () => {
    expect(archiveName("Mémoire « final » été.docx")).toBe("Memoire _ final _ ete.docx");
    expect(archiveName('a/b\\c:d*e?f"g<h>i|j')).toBe("a_b_c_d_e_f_g_h_i_j");
    expect(archiveName("   ")).toBe("document");
  });
});
