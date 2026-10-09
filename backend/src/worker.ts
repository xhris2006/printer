/**
 * Processus worker dédié (optionnel) : analyse/conversion des documents, emails,
 * rappels et rapprochement des paiements. À utiliser avec WORKER_INLINE=false sur l'API.
 */
import { env } from "./config/env";
import { logger } from "./lib/logger";
import { prisma } from "./lib/prisma";
import { startWorker } from "./jobs/queue";
import { startScheduler } from "./jobs/scheduler";
import "./modules/documents/documents.service";
import "./modules/notifications/notifications.service";
import "./modules/payments/payments.service";
import "./jobs/maintenance";

const worker = startWorker({ concurrency: env.WORKER_CONCURRENCY, pollMs: env.WORKER_POLL_MS });
const stopScheduler = startScheduler();
logger.info("Worker Print & Secrétariat démarré");

const shutdown = async () => {
  stopScheduler();
  await worker.stop();
  await prisma.$disconnect();
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
