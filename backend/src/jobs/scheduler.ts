import { prisma } from "../lib/prisma";
import { logger } from "../lib/logger";
import { recoverStaleJobs } from "./queue";

const TASKS = [
  { type: "payments.reconcile", everyMs: 2 * 60 * 1000 },
  { type: "pickup.reminders", everyMs: 30 * 60 * 1000 },
  { type: "documents.retention", everyMs: 6 * 60 * 60 * 1000 },
  { type: "maintenance.cleanup", everyMs: 12 * 60 * 60 * 1000 },
];

/**
 * Planificateur des tâches périodiques. Une clé unique par créneau garantit
 * qu'une seule instance programme chaque tâche, même avec plusieurs workers.
 */
export async function scheduleDueTasks() {
  for (const task of TASKS) {
    const bucket = Math.floor(Date.now() / task.everyMs);
    try {
      await prisma.job.create({ data: { type: task.type, payload: {}, uniqueKey: `${task.type}:${bucket}`, maxAttempts: 1 } });
    } catch (error) {
      if ((error as { code?: string }).code !== "P2002") throw error;
    }
  }
}

export function startScheduler(): () => void {
  const tick = async () => {
    try {
      await recoverStaleJobs();
      await scheduleDueTasks();
    } catch (error) {
      logger.error({ err: error }, "Erreur du planificateur");
    }
  };
  void tick();
  const timer = setInterval(tick, 60 * 1000);
  return () => clearInterval(timer);
}
