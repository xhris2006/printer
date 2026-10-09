import { hostname } from "node:os";
import { Prisma, type Job } from "@prisma/client";
import { prisma, type Db } from "../lib/prisma";
import { logger } from "../lib/logger";

/**
 * File de traitement persistante basée sur PostgreSQL (SELECT … FOR UPDATE SKIP LOCKED).
 * Aucun service supplémentaire n'est nécessaire ; le worker peut tourner dans le
 * processus API (WORKER_INLINE=true) ou dans un processus dédié (npm run start:worker).
 */
export type JobHandler = (payload: Prisma.JsonValue, job: Job) => Promise<void>;

const handlers = new Map<string, JobHandler>();

export function registerJobHandler(type: string, handler: JobHandler) {
  handlers.set(type, handler);
}

export async function enqueue(
  type: string,
  payload: Prisma.InputJsonValue,
  options: { runAt?: Date; maxAttempts?: number } = {},
  db: Db = prisma,
) {
  return db.job.create({
    data: { type, payload, runAt: options.runAt ?? new Date(), maxAttempts: options.maxAttempts ?? 3 },
  });
}

const workerId = `${hostname()}:${process.pid}`;

/** Réserve atomiquement le prochain job disponible. */
export async function claimNextJob(types?: string[]): Promise<Job | null> {
  const typeFilter = types && types.length > 0 ? Prisma.sql`AND "type" IN (${Prisma.join(types)})` : Prisma.empty;
  const rows = await prisma.$queryRaw<Job[]>`
    UPDATE "Job" SET "status" = 'RUNNING', "lockedAt" = NOW(), "lockedBy" = ${workerId},
      "attempts" = "attempts" + 1, "updatedAt" = NOW()
    WHERE "id" = (
      SELECT "id" FROM "Job"
      WHERE "status" = 'PENDING' AND "runAt" <= NOW() ${typeFilter}
      ORDER BY "runAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING *`;
  return rows[0] ?? null;
}

export async function runJob(job: Job): Promise<void> {
  const handler = handlers.get(job.type);
  try {
    if (!handler) throw new Error(`Aucun gestionnaire pour le job ${job.type}`);
    await handler(job.payload, job);
    await prisma.job.update({ where: { id: job.id }, data: { status: "DONE", lockedAt: null, lastError: null } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const retry = job.attempts < job.maxAttempts;
    // Backoff exponentiel : 30 s, 2 min, 8 min…
    const delay = 30_000 * 4 ** Math.max(0, job.attempts - 1);
    await prisma.job.update({
      where: { id: job.id },
      data: {
        status: retry ? "PENDING" : "FAILED",
        lockedAt: null,
        lastError: message.slice(0, 2000),
        runAt: retry ? new Date(Date.now() + delay) : undefined,
      },
    });
    logger.warn({ jobId: job.id, type: job.type, attempts: job.attempts, retry, error: message }, "Échec du job");
  }
}

/** Remet en file les jobs bloqués (processus arrêté pendant l'exécution). */
export async function recoverStaleJobs(staleMs = 15 * 60 * 1000) {
  await prisma.job.updateMany({
    where: { status: "RUNNING", lockedAt: { lt: new Date(Date.now() - staleMs) } },
    data: { status: "PENDING", lockedAt: null },
  });
}

/** Traite tous les jobs disponibles (utile pour les tests et scripts). */
export async function drainJobs(types?: string[], max = 100): Promise<number> {
  let count = 0;
  for (; count < max; count++) {
    const job = await claimNextJob(types);
    if (!job) break;
    await runJob(job);
  }
  return count;
}

export interface WorkerHandle {
  stop: () => Promise<void>;
}

export function startWorker(options: { concurrency: number; pollMs: number }): WorkerHandle {
  let stopped = false;
  const loops: Promise<void>[] = [];
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const loop = async () => {
    while (!stopped) {
      try {
        const job = await claimNextJob();
        if (job) {
          await runJob(job);
          continue;
        }
      } catch (error) {
        logger.error({ err: error }, "Erreur de la boucle du worker");
      }
      await sleep(options.pollMs);
    }
  };
  for (let i = 0; i < options.concurrency; i++) loops.push(loop());
  logger.info({ concurrency: options.concurrency }, "Worker de traitement démarré");
  return {
    stop: async () => {
      stopped = true;
      await Promise.all(loops);
    },
  };
}
