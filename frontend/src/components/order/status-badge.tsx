import { Badge } from "@/components/ui/badge";
import { ORDER_STATUS_LABELS, PAYMENT_STATE_LABELS, PAYMENT_STATUS_LABELS } from "@/lib/labels";
import type { OrderStatus, PaymentState, PaymentStatus } from "@/lib/types";

const ORDER_VARIANTS: Record<OrderStatus, "default" | "success" | "warning" | "danger" | "muted" | "info" | "violet"> = {
  DRAFT: "muted",
  PENDING_PAYMENT: "warning",
  PAID: "info",
  TO_PREPARE: "violet",
  PRINTING: "default",
  FINISHING: "default",
  READY_FOR_PICKUP: "success",
  OUT_FOR_DELIVERY: "info",
  COMPLETED: "success",
  CANCELLED: "danger",
  REFUNDED: "muted",
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return <Badge variant={ORDER_VARIANTS[status]}>{ORDER_STATUS_LABELS[status]}</Badge>;
}

export function PaymentStateBadge({ state, credit }: { state: PaymentState; credit?: boolean }) {
  if (credit && state !== "PAID") return <Badge variant="violet">Exception autorisée</Badge>;
  const variant = state === "PAID" ? "success" : state === "PENDING" ? "warning" : state === "REFUNDED" ? "muted" : "danger";
  return <Badge variant={variant}>{PAYMENT_STATE_LABELS[state]}</Badge>;
}

export function PaymentStatusBadge({ status, duplicate }: { status: PaymentStatus; duplicate?: boolean }) {
  if (duplicate) return <Badge variant="danger">Doublon à rembourser</Badge>;
  const variant = status === "SUCCESSFUL" ? "success" : ["PENDING", "CREATED", "PENDING_VERIFICATION"].includes(status) ? "warning" : status === "CANCELLED" ? "muted" : "danger";
  return <Badge variant={variant}>{PAYMENT_STATUS_LABELS[status]}</Badge>;
}
