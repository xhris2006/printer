import type { ColorMode, FinishingCode, OrderStatus, PaperFormat, PaymentState, PaymentStatus, Quote, Sides } from "./types";

export const COLOR_LABELS: Record<ColorMode, string> = { BW: "Noir et blanc", COLOR: "Couleur" };
export const SIDES_LABELS: Record<Sides, string> = { SINGLE: "Recto simple", DOUBLE: "Recto verso" };
export const FORMAT_LABELS: Record<PaperFormat, string> = { A4: "A4", A3: "A3" };
export const FINISHING_LABELS: Record<FinishingCode, string> = {
  NONE: "Sans reliure",
  STAPLE: "Agrafage",
  SPIRAL: "Reliure spirale",
  HARDCOVER: "Reliure cartonnée rigide",
};

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
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

export const PAYMENT_STATE_LABELS: Record<PaymentState, string> = {
  UNPAID: "Non payé",
  PENDING: "Paiement en cours",
  PAID: "Payé",
  REFUNDED: "Remboursé",
};

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  CREATED: "Créé",
  PENDING: "En attente",
  SUCCESSFUL: "Réussi",
  FAILED: "Échoué",
  EXPIRED: "Expiré",
  CANCELLED: "Annulé",
  PENDING_VERIFICATION: "À vérifier",
  REJECTED: "Rejeté",
};

export const ORDER_TYPE_LABELS = { STANDARD: "Impression", GROUP: "Groupée", SERVICE: "Prestation" } as const;

/** Étapes affichées dans la frise de suivi. */
export const TRACKING_STEPS: OrderStatus[] = ["PENDING_PAYMENT", "PAID", "TO_PREPARE", "PRINTING", "FINISHING", "READY_FOR_PICKUP", "COMPLETED"];

export function optionsSummary(o: { colorMode: ColorMode; sides: Sides; paperFormat: PaperFormat; finishingCode: FinishingCode; copies: number }) {
  return `${COLOR_LABELS[o.colorMode]} · ${SIDES_LABELS[o.sides]} · ${o.paperFormat} · ${FINISHING_LABELS[o.finishingCode]}${o.copies > 1 ? ` · ${o.copies} ex.` : ""}`;
}

export const QUOTE_VARIANT: Record<Quote["status"], "warning" | "info" | "success" | "muted" | "danger"> = {
  REQUESTED: "warning",
  QUOTED: "info",
  ACCEPTED: "success",
  REJECTED: "muted",
  CANCELLED: "muted",
  EXPIRED: "danger",
};
