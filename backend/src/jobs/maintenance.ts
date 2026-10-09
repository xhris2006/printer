import { prisma } from "../lib/prisma";
import { logger } from "../lib/logger";
import { registerJobHandler } from "./queue";
import { getSettings } from "../modules/settings/settings.service";
import { notify } from "../modules/notifications/notifications.service";
import { deleteDocumentFiles } from "../modules/documents/documents.service";

const DAY = 24 * 60 * 60 * 1000;

/** Rappels de retrait pour les commandes prêtes non récupérées. */
export async function sendPickupReminders() {
  const s = await getSettings();
  if (s["pickup.maxReminders"] === 0) return 0;
  const now = Date.now();
  const orders = await prisma.order.findMany({
    where: {
      status: "READY_FOR_PICKUP",
      reminderCount: { lt: s["pickup.maxReminders"] },
      readyAt: { lt: new Date(now - s["pickup.reminderAfterDays"] * DAY) },
      OR: [{ lastReminderAt: null }, { lastReminderAt: { lt: new Date(now - s["pickup.reminderIntervalDays"] * DAY) } }],
      pickup: { status: { not: "NOT_COLLECTED" } },
    },
    include: { pickupPoint: true },
    take: 200,
  });
  for (const order of orders) {
    await notify({
      userId: order.customerId,
      orderId: order.id,
      type: "PICKUP_REMINDER",
      title: `Rappel : votre commande ${order.reference} vous attend`,
      body: `Votre commande est prête${order.pickupPoint ? ` à « ${order.pickupPoint.name} »` : ""}. Code de retrait : ${order.pickupCode}. ${s["pickup.policyText"]}`,
      link: `/espace/commandes/${order.id}`,
    });
    await prisma.order.update({ where: { id: order.id }, data: { reminderCount: { increment: 1 }, lastReminderAt: new Date() } });
  }
  return orders.length;
}

/** Politique de conservation : suppression des fichiers après la période définie. */
export async function applyDocumentRetention() {
  const s = await getSettings();
  const limit = new Date(Date.now() - s["documents.retentionDays"] * DAY);
  let purged = 0;

  const purge = async (doc: { id: string; storageKey: string; pdfStorageKey: string | null }) => {
    await deleteDocumentFiles(doc);
    await prisma.document.update({ where: { id: doc.id }, data: { status: "DELETED", purgedAt: new Date() } });
    purged++;
  };

  // Documents dont toutes les commandes sont terminées depuis plus que la durée de conservation
  const finished = await prisma.document.findMany({
    where: {
      purgedAt: null,
      status: { not: "DELETED" },
      orderItems: { some: {} },
      NOT: {
        orderItems: {
          some: {
            order: {
              OR: [
                { status: { notIn: ["COMPLETED", "CANCELLED", "REFUNDED"] } },
                { updatedAt: { gte: limit } },
              ],
            },
          },
        },
      },
      OR: [{ quoteId: null }, { quote: { status: { in: ["ACCEPTED", "REJECTED", "CANCELLED", "EXPIRED"] }, updatedAt: { lt: limit } } }],
    },
    take: 500,
  });
  for (const doc of finished) await purge(doc);

  // Documents jamais utilisés (ni commande ni devis) après 7 jours
  const orphans = await prisma.document.findMany({
    where: { purgedAt: null, status: { not: "DELETED" }, orderItems: { none: {} }, quoteId: null, createdAt: { lt: new Date(Date.now() - 7 * DAY) } },
    take: 500,
  });
  for (const doc of orphans) await purge(doc);

  // Téléversements jamais finalisés
  const expiredUploads = await prisma.document.findMany({
    where: { status: "PENDING_UPLOAD", uploadExpiresAt: { lt: new Date() } },
    take: 500,
  });
  for (const doc of expiredUploads) await purge(doc);

  return purged;
}

export async function cleanupTechnicalData() {
  await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  await prisma.passwordResetToken.deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - DAY) } } });
  await prisma.job.deleteMany({ where: { status: "DONE", updatedAt: { lt: new Date(Date.now() - 7 * DAY) } } });
}

registerJobHandler("pickup.reminders", async () => {
  const count = await sendPickupReminders();
  if (count > 0) logger.info({ count }, "Rappels de retrait envoyés");
});
registerJobHandler("documents.retention", async () => {
  const count = await applyDocumentRetention();
  if (count > 0) logger.info({ count }, "Documents supprimés (politique de conservation)");
});
registerJobHandler("maintenance.cleanup", async () => {
  await cleanupTechnicalData();
});
