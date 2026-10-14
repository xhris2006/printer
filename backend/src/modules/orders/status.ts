import type { FulfillmentMethod, GroupMode, GroupStatus, OrderStatus, PaymentState } from "@prisma/client";

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
 * Changement de statut proposé à l'équipe sur une commande :
 * - DIRECT : appliqué tel quel (étapes de production, avance ou correction) ;
 * - les autres passent par l'action dédiée qui enregistre la preuve
 *   (remise avec code, livraison, échec de livraison, paiement en espèces réellement reçu,
 *   annulation motivée, remboursement consigné).
 */
export type StatusChangeKind = "DIRECT" | "HANDOVER" | "DELIVER" | "DELIVERY_FAILED" | "CASH" | "CANCEL" | "REFUND";

export interface StatusOption {
  status: OrderStatus;
  label: string;
  kind: StatusChangeKind;
  /** Réservé aux administrateurs */
  adminOnly: boolean;
  /** Retour à une étape précédente : motif obligatoire, client prévenu */
  correction: boolean;
}

export interface StatusContext {
  status: OrderStatus;
  fulfillmentMethod: FulfillmentMethod;
  paymentStatus: PaymentState;
  creditApproved: boolean;
  total: number | null;
  amountPaid: number;
  groupOrder?: { mode: GroupMode; status: GroupStatus } | null;
}

/** Rang des étapes de production (les étapes peuvent être sautées en avançant). */
const STEP: Partial<Record<OrderStatus, number>> = { TO_PREPARE: 1, PRINTING: 2, FINISHING: 3, READY_FOR_PICKUP: 4, OUT_FOR_DELIVERY: 4, COMPLETED: 5 };
const PRE_PRODUCTION: OrderStatus[] = ["PENDING_PAYMENT", "PAID"];
const CANCELLABLE: OrderStatus[] = ["DRAFT", "PENDING_PAYMENT", "PAID", "TO_PREPARE"];

export function isProductionStatus(status: OrderStatus) {
  return PRODUCTION_STATUSES.includes(status);
}

export function isPreProductionStatus(status: OrderStatus) {
  return PRE_PRODUCTION.includes(status);
}

/** Statuts vers lesquels l'équipe peut faire passer la commande, et comment. */
export function statusOptions(order: StatusContext): StatusOption[] {
  const options: StatusOption[] = [];
  const add = (status: OrderStatus, kind: StatusChangeKind, extra: Partial<Pick<StatusOption, "adminOnly" | "correction">> = {}) => {
    if (status !== order.status && !options.some((o) => o.status === status)) {
      options.push({ status, label: STATUS_LABELS[status], kind, adminOnly: false, correction: false, ...extra });
    }
  };
  const finalStep: OrderStatus = order.fulfillmentMethod === "DELIVERY" ? "OUT_FOR_DELIVERY" : "READY_FOR_PICKUP";
  const path: OrderStatus[] = ["TO_PREPARE", "PRINTING", "FINISHING", finalStep];
  const printable = order.paymentStatus === "PAID" || order.creditApproved;
  const groupBlocked =
    order.groupOrder?.mode === "STUDENT_CONTRIBUTIONS" && !["IN_PRODUCTION", "READY", "COMPLETED"].includes(order.groupOrder.status);
  const current = STEP[order.status];

  if (order.status === "PENDING_PAYMENT" && order.paymentStatus !== "PAID" && order.total !== null && order.total > 0) {
    add("PAID", "CASH", { adminOnly: true });
  }
  if (isPreProductionStatus(order.status) && printable && !groupBlocked) {
    for (const s of path) add(s, "DIRECT");
  }
  if (current !== undefined && order.status !== "COMPLETED") {
    for (const s of path) {
      const step = STEP[s] as number;
      if (step > current) add(s, "DIRECT");
      else if (step < current) add(s, "DIRECT", { adminOnly: true, correction: true });
    }
    if (order.status === "READY_FOR_PICKUP") {
      add("COMPLETED", "HANDOVER");
      // Commande en livraison repassée « prête » après un échec : nouvelle tentative
      if (order.fulfillmentMethod === "DELIVERY") add("OUT_FOR_DELIVERY", "DIRECT");
    }
    if (order.status === "OUT_FOR_DELIVERY") {
      add("COMPLETED", "DELIVER");
      add("READY_FOR_PICKUP", "DELIVERY_FAILED");
    }
  }
  if (order.status === "COMPLETED") {
    add("READY_FOR_PICKUP", "DIRECT", { adminOnly: true, correction: true });
    if (order.fulfillmentMethod === "DELIVERY") add("OUT_FOR_DELIVERY", "DIRECT", { adminOnly: true, correction: true });
  }
  if (CANCELLABLE.includes(order.status)) add("CANCELLED", "CANCEL", { adminOnly: true });
  if (order.status === "CANCELLED" && order.amountPaid > 0 && order.paymentStatus !== "REFUNDED") add("REFUNDED", "REFUND", { adminOnly: true });
  return options;
}
