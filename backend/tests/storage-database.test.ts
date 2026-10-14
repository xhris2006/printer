import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { prisma } from "../src/lib/prisma";
import { resolveStorage } from "../src/config/env";
import { setPaymentProvider } from "../src/modules/payments/payments.service";
import { MockPaymentAdapter } from "../src/modules/payments/mock";
import { setStorage, storageStatus } from "../src/modules/storage/storage";
import { LocalStorage } from "../src/modules/storage/local";
import { DatabaseStorage } from "../src/modules/storage/database";
import { resetDb } from "./helpers/db";
import { makePdf } from "./helpers/files";
import { app, defaultOptions, loginAs, ORIGIN, pickup, uploadDocument } from "./helpers/api";

let work: string;
beforeAll(async () => {
  work = await mkdtemp(path.join(tmpdir(), "ps-dbstore-"));
});
afterAll(async () => {
  setStorage(new LocalStorage());
  await rm(work, { recursive: true, force: true });
});
beforeEach(async () => {
  await resetDb();
  setPaymentProvider(new MockPaymentAdapter());
});

async function fetchSigned(url: string) {
  return request(app)
    .get(new URL(url).pathname)
    .buffer(true)
    .parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on("data", (c: Buffer) => chunks.push(c));
      r.on("end", () => cb(null, Buffer.concat(chunks)));
    });
}

async function paidOrderWith(content: Buffer, name: string) {
  const c = await loginAs();
  const doc = await uploadDocument(c.agent, content, name);
  const draft = await c.agent.post("/api/orders").set("Origin", ORIGIN).send({ items: [{ documentId: doc.id, options: defaultOptions }], fulfillment: pickup() });
  await c.agent.post(`/api/orders/${draft.body.order.id}/confirm`).set("Origin", ORIGIN).send({});
  const init = await c.agent.post(`/api/orders/${draft.body.order.id}/payments`).set("Origin", ORIGIN).send({ method: "CHECKOUT" });
  await c.agent.post(`/api/payments/${init.body.payment.id}/simulate`).set("Origin", ORIGIN).send({ outcome: "SUCCESSFUL" });
  return { ...c, doc, orderId: draft.body.order.id as string };
}

const base = { NODE_ENV: "production" as const, STORAGE_DRIVER: undefined, S3_BUCKET: undefined, RAILWAY_VOLUME_MOUNT_PATH: undefined, RAILWAY_ENVIRONMENT_ID: undefined, RAILWAY_PROJECT_ID: undefined, RAILWAY_PUBLIC_DOMAIN: undefined };

describe("Stockage des fichiers dans PostgreSQL", () => {
  it("choisit un stockage persistant en production", () => {
    // Par défaut en production : base de données (aucun disque éphémère)
    expect(resolveStorage(base).driver).toBe("database");
    // Volume Railway monté : disque persistant
    expect(resolveStorage({ ...base, RAILWAY_VOLUME_MOUNT_PATH: "/data" }).driver).toBe("local");
    expect(resolveStorage({ ...base, S3_BUCKET: "bucket" }).driver).toBe("s3");
    // « local » demandé sur Railway sans volume : bascule sur la base, avec explication
    const railway = resolveStorage({ ...base, STORAGE_DRIVER: "local", RAILWAY_PUBLIC_DOMAIN: "api.up.railway.app" });
    expect(railway.driver).toBe("database");
    expect(railway.note).toContain("sans volume");
    expect(resolveStorage({ ...base, STORAGE_DRIVER: "local", RAILWAY_PUBLIC_DOMAIN: "api.up.railway.app", RAILWAY_VOLUME_MOUNT_PATH: "/data" }).driver).toBe("local");
    expect(resolveStorage({ ...base, NODE_ENV: "development" }).driver).toBe("local");
    expect(resolveStorage({ ...base, STORAGE_DRIVER: "database", NODE_ENV: "development" }).driver).toBe("database");
  });

  it("découpe, relit à l'identique et supprime un fichier en plusieurs blocs", async () => {
    const storage = new DatabaseStorage({ chunkSize: 1000 });
    const content = Buffer.from(Array.from({ length: 4321 }, (_, i) => i % 251));
    const source = path.join(work, "source.bin");
    await writeFile(source, content);
    await storage.putFile("documents/test/a.bin", source, "application/octet-stream");
    expect(await storage.head("documents/test/a.bin")).toEqual({ size: 4321 });
    expect(await prisma.storedFileChunk.count({ where: { fileKey: "documents/test/a.bin" } })).toBe(5);

    const out = path.join(work, "out.bin");
    await storage.downloadToFile("documents/test/a.bin", out);
    expect((await readFile(out)).equals(content)).toBe(true);

    // Remplacement : jamais de blocs orphelins
    await writeFile(source, Buffer.from("court"));
    await storage.putFile("documents/test/a.bin", source, "text/plain");
    expect(await prisma.storedFileChunk.count({ where: { fileKey: "documents/test/a.bin" } })).toBe(1);

    await storage.delete("documents/test/a.bin");
    expect(await storage.head("documents/test/a.bin")).toBeNull();
    expect(await prisma.storedFileChunk.count()).toBe(0);
  });

  it("parcours complet : le fichier reste disponible après un « redémarrage », sur n'importe quel appareil", async () => {
    setStorage(new DatabaseStorage({ chunkSize: 64 * 1024 }));
    const pdf = await makePdf(30);
    const { doc, orderId } = await paidOrderWith(pdf, "memoire.pdf");
    expect(doc.status).toBe("READY");
    expect(doc.pageCount).toBe(30);
    expect(await prisma.storedFile.count({ where: { key: doc.storageKey } })).toBe(1);

    // Nouvelle instance (redémarrage du conteneur, autre serveur) : rien n'est gardé en mémoire ni sur disque
    setStorage(new DatabaseStorage({ chunkSize: 64 * 1024 }));
    const admin = await loginAs("ADMIN");
    const res = await admin.agent.get(`/api/admin/documents/${doc.id}/download?variant=original&redirect=1`);
    expect(res.status).toBe(302);
    const file = await fetchSigned(res.headers.location);
    expect(file.status).toBe(200);
    expect((file.body as Buffer).equals(pdf)).toBe(true);

    const archive = await admin.agent.get(`/api/admin/orders/${orderId}/archive`);
    expect(archive.status).toBe(200);
    expect(archive.body.fileCount).toBe(1);
    expect((await fetchSigned(archive.body.url)).status).toBe(200);

    const check = await admin.agent.get(`/api/admin/orders/${orderId}/files-check`);
    expect(check.body).toEqual({ checked: 1, missing: [] });
    expect(storageStatus()).toMatchObject({ driver: "database", persistent: true });
    expect((await admin.agent.get("/api/admin/stats")).body.storage).toMatchObject({ driver: "database", persistent: true });
  });

  it("disque local effacé (conteneur redémarré) : fichier signalé manquant, et les fichiers encore sur disque sont importés", async () => {
    const legacyDir = path.join(work, "legacy");
    const local = new LocalStorage(legacyDir);
    setStorage(local);
    const { doc, orderId } = await paidOrderWith(await makePdf(10), "rapport.pdf");
    const admin = await loginAs("ADMIN");

    // Fichier encore présent sur l'ancien disque : importé en base à la première lecture
    const db = new DatabaseStorage({ legacy: local });
    setStorage(db);
    expect((await admin.agent.get(`/api/admin/orders/${orderId}/files-check`)).body.missing).toEqual([]);
    expect(await prisma.storedFile.count({ where: { key: doc.storageKey } })).toBe(1);

    // Fichier perdu (ni en base ni sur disque) : signalé clairement
    await prisma.storedFile.deleteMany({});
    await rm(legacyDir, { recursive: true, force: true });
    expect((await admin.agent.get(`/api/admin/orders/${orderId}/files-check`)).body.missing).toEqual([doc.id]);
    const res = await admin.agent.get(`/api/admin/documents/${doc.id}/download?redirect=1`);
    const page = await request(app).get(new URL(res.headers.location).pathname);
    expect(page.status).toBe(404);
    expect(page.text).toContain("plus disponible sur le serveur");
  });
});
