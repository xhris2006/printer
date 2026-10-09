import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/lib/prisma";
import { applyDocumentRetention, sendPickupReminders } from "../src/jobs/maintenance";
import { getStorage } from "../src/modules/storage/storage";
import { resetDb } from "./helpers/db";
import { makePdf } from "./helpers/files";
import { defaultOptions, loginAs, ORIGIN, pickup, uploadDocument } from "./helpers/api";

beforeEach(resetDb);

describe("Rappels et conservation", () => {
  it("envoie des rappels de retrait espacés et plafonnés", async () => {
    const { agent, user } = await loginAs();
    const doc = await uploadDocument(agent, await makePdf(5), "a.pdf");
    const draft = await agent.post("/api/orders").set("Origin", ORIGIN).send({ items: [{ documentId: doc.id, options: defaultOptions }], fulfillment: pickup() });
    await prisma.order.update({ where: { id: draft.body.order.id }, data: { status: "READY_FOR_PICKUP", readyAt: new Date(Date.now() - 5 * 24 * 3600 * 1000) } });
    await prisma.pickup.update({ where: { orderId: draft.body.order.id }, data: { status: "READY" } });
    expect(await sendPickupReminders()).toBe(1);
    expect(await sendPickupReminders()).toBe(0); // intervalle non écoulé
    expect(await prisma.notification.count({ where: { userId: user.id, type: "PICKUP_REMINDER" } })).toBe(1);
  });

  it("supprime les fichiers après la durée de conservation et les documents orphelins", async () => {
    const { agent } = await loginAs();
    const used = await uploadDocument(agent, await makePdf(1), "used.pdf");
    const orphan = await uploadDocument(agent, await makePdf(1), "orphan.pdf");
    const draft = await agent.post("/api/orders").set("Origin", ORIGIN).send({ items: [{ documentId: used.id, options: defaultOptions }], fulfillment: pickup() });
    const old = new Date(Date.now() - 60 * 24 * 3600 * 1000);
    await prisma.$executeRaw`UPDATE "Order" SET "status" = 'COMPLETED', "updatedAt" = ${old} WHERE "id" = ${draft.body.order.id}`;
    await prisma.$executeRaw`UPDATE "Document" SET "createdAt" = ${old} WHERE "id" = ${orphan.id}`;
    expect(await applyDocumentRetention()).toBe(2);
    for (const id of [used.id, orphan.id]) {
      const d = await prisma.document.findUniqueOrThrow({ where: { id } });
      expect(d.status).toBe("DELETED");
      expect(await getStorage().head(d.storageKey)).toBeNull();
    }
  });
});
