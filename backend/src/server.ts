import { createApp } from "./app";
import { env } from "./config/env";
import { logger } from "./lib/logger";
import { prisma } from "./lib/prisma";
import { startWorker, type WorkerHandle } from "./jobs/queue";
import { startScheduler } from "./jobs/scheduler";
import { getPaymentProvider } from "./modules/payments/payments.service";
import { isConverterAvailable } from "./modules/documents/converter";

async function main() {
  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, env: env.NODE_ENV }, "API Print & Secrétariat démarrée");
  });

  const provider = getPaymentProvider();
  if (!provider) logger.warn("Aucun fournisseur de paiement configuré : le paiement en ligne est désactivé.");
  else if (provider.environment !== "LIVE") logger.warn({ provider: provider.name }, "Paiements en MODE TEST : aucun argent réel n'est encaissé.");
  if (!(await isConverterAvailable())) logger.warn("LibreOffice introuvable : les DOC/DOCX passeront en vérification manuelle.");

  let worker: WorkerHandle | null = null;
  let stopScheduler: (() => void) | null = null;
  if (env.WORKER_INLINE) {
    worker = startWorker({ concurrency: env.WORKER_CONCURRENCY, pollMs: env.WORKER_POLL_MS });
    stopScheduler = startScheduler();
  }

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Arrêt en cours…");
    server.close();
    stopScheduler?.();
    await worker?.stop();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((error) => {
  logger.fatal({ err: error }, "Échec du démarrage");
  process.exit(1);
});
