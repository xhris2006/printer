import type { FulfillmentMethod, OrderStatus, RoleCode } from "@prisma/client";

export const STATUS_LABELS: Record<OrderStatus, string> = {
  DRAFT: "Brouillon",
  PENDING_PAYMENT: "En attente de paiement",
  PAID: "Paiement confirmé",
  TO_PREPARE: "À préparer",
  PRINTING: "En impression",
  FINISHING: "En finition",
  READY_FOR_PICKUP: "Prête à retirer",
  OUT_FOR_DELIVERY: "En livraison",
  COMPLETED: "Livrée ou retirée",
  CANCELLED: "Annulée",
  REFUNDED: "Remboursée",
};

/** Transitions autorisées par la machine à états des commandes. */
const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  DRAFT: ["PENDING_PAYMENT", "CANCELLED"],
  PENDING_PAYMENT: ["PAID", "TO_PREPARE", "CANCELLED"],
  PAID: ["TO_PREPARE", "CANCELLED"],
  TO_PREPARE: ["PRINTING", "CANCELLED"],
  PRINTING: ["FINISHING", "READY_FOR_PICKUP", "OUT_FOR_DELIVERY"],
  FINISHING: ["READY_FOR_PICKUP", "OUT_FOR_DELIVERY"],
  READY_FOR_PICKUP: ["COMPLETED"],
  OUT_FOR_DELIVERY: ["COMPLETED", "READY_FOR_PICKUP"],
  COMPLETED: [],
  CANCELLED: ["REFUNDED"],
  REFUNDED: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Statuts que l'équipe peut appliquer via la mise à jour de production. */
export const PRODUCTION_STATUSES: OrderStatus[] = ["TO_PREPARE", "PRINTING", "FINISHING", "READY_FOR_PICKUP", "OUT_FOR_DELIVERY"];

export const ACTIVE_STATUSES: OrderStatus[] = [
  "PENDING_PAYMENT",
  "PAID",
  "TO_PREPARE",
  "PRINTING",
  "FINISHING",
  "READY_FOR_PICKUP",
  "OUT_FOR_DELIVERY",
];

export const IN_PRODUCTION_STATUSES: OrderStatus[] = ["TO_PREPARE", "PRINTING", "FINISHING"];

/**
 * Vérifie qu'un changement de statut manuel est permis pour ce rôle et ce mode de remise.
 * Retourne un message d'erreur ou null.
 */
export function validateManualTransition(
  from: OrderStatus,
  to: OrderStatus,
  role: RoleCode,
  fulfillment: FulfillmentMethod,
): string | null {
  if (!PRODUCTION_STATUSES.includes(to)) {
    return "Ce statut se met à jour via une action dédiée (paiement, remise, annulation ou remboursement).";
  }
  if (!canTransition(from, to)) return `Transition impossible : ${STATUS_LABELS[from]} → ${STATUS_LABELS[to]}.`;
  if (to === "OUT_FOR_DELIVERY" && fulfillment !== "DELIVERY") return "Cette commande n'est pas en livraison.";
  if (to === "READY_FOR_PICKUP" && fulfillment !== "PICKUP" && from !== "OUT_FOR_DELIVERY") {
    return "Cette commande doit être livrée (ou passez d'abord par « En livraison »).";
  }
  if (role !== "ADMIN" && role !== "OPERATOR") return "Action réservée à l'équipe.";
  return null;
}
