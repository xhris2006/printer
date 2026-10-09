import type { GroupStatus, OrderStatus } from "@prisma/client";
import type { Tx } from "../../lib/prisma";

const PRODUCTION: OrderStatus[] = ["TO_PREPARE", "PRINTING", "FINISHING"];
const DONE_OR_READY: OrderStatus[] = ["READY_FOR_PICKUP", "OUT_FOR_DELIVERY", "COMPLETED"];

/**
 * Met à jour le statut d'une commande groupée à partir de l'avancement de ses commandes.
 * Le statut n'avance qu'une fois la production lancée (jamais de retour en arrière).
 */
export async function refreshGroupStatus(tx: Tx, groupId: string): Promise<GroupStatus | null> {
  const group = await tx.groupOrder.findUnique({
    where: { id: groupId },
    include: { orders: { select: { status: true } } },
  });
  if (!group || group.status === "CANCELLED" || group.status === "COMPLETED") return group?.status ?? null;

  const active = group.orders.map((o) => o.status).filter((s) => !["DRAFT", "CANCELLED", "REFUNDED"].includes(s));
  const productionStarted = active.some((s) => PRODUCTION.includes(s) || DONE_OR_READY.includes(s));
  const canDerive =
    ["IN_PRODUCTION", "READY"].includes(group.status) || (group.mode === "DELEGATE_COLLECT" && productionStarted);
  if (!canDerive || active.length === 0) return group.status;

  // Commandes encore en attente de paiement : elles ne bloquent pas l'avancement des autres
  const relevant = active.filter((s) => s !== "PENDING_PAYMENT" && s !== "PAID");
  let next: GroupStatus = group.status;
  if (relevant.length > 0 && relevant.every((s) => s === "COMPLETED") && relevant.length === active.length) next = "COMPLETED";
  else if (relevant.length > 0 && relevant.every((s) => DONE_OR_READY.includes(s)) && relevant.length === active.length) next = "READY";
  else if (productionStarted) next = "IN_PRODUCTION";

  if (next !== group.status) {
    await tx.groupOrder.update({
      where: { id: groupId },
      data: { status: next, ...(next === "IN_PRODUCTION" && !group.productionStartedAt ? { productionStartedAt: new Date() } : {}) },
    });
  }
  return next;
}
