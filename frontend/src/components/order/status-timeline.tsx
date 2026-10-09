import { Check } from "lucide-react";
import { ORDER_STATUS_LABELS } from "@/lib/labels";
import { formatDate } from "@/lib/format";
import type { OrderStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Frise de suivi : étapes franchies avec leur date. */
export function StatusTimeline({ status, history, fulfillment }: { status: OrderStatus; history: { status: OrderStatus; createdAt: string }[]; fulfillment: "PICKUP" | "DELIVERY" }) {
  if (status === "CANCELLED" || status === "REFUNDED") {
    return (
      <ol className="space-y-2 text-sm">
        {history.map((h, i) => (
          <li key={i} className="flex justify-between gap-3">
            <span>{ORDER_STATUS_LABELS[h.status]}</span>
            <span className="text-muted-foreground">{formatDate(h.createdAt, true)}</span>
          </li>
        ))}
      </ol>
    );
  }
  const steps: OrderStatus[] = [
    "PENDING_PAYMENT",
    "PAID",
    "TO_PREPARE",
    "PRINTING",
    "FINISHING",
    fulfillment === "DELIVERY" ? "OUT_FOR_DELIVERY" : "READY_FOR_PICKUP",
    "COMPLETED",
  ];
  const reached = new Map(history.map((h) => [h.status, h.createdAt]));
  const currentIndex = Math.max(steps.indexOf(status), ...history.map((h) => steps.indexOf(h.status)));
  return (
    <ol className="relative space-y-4">
      {steps.map((step, i) => {
        const done = i <= currentIndex;
        const current = step === status;
        const date = reached.get(step);
        return (
          <li key={step} className="relative flex gap-3">
            {i < steps.length - 1 && <span className={cn("absolute top-6 left-[11px] h-[calc(100%-4px)] w-0.5", i < currentIndex ? "bg-primary" : "bg-slate-200")} aria-hidden />}
            <span
              className={cn(
                "relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full border-2 text-[10px]",
                done ? "border-primary bg-primary text-white" : "border-slate-300 bg-white",
                current && "ring-4 ring-primary/15",
              )}
            >
              {done && <Check className="size-3.5" strokeWidth={3} />}
            </span>
            <div className="-mt-0.5">
              <p className={cn("text-sm", current ? "font-semibold text-slate-900" : done ? "text-slate-700" : "text-muted-foreground")}>
                {step === "COMPLETED" ? (fulfillment === "DELIVERY" ? "Livrée" : "Retirée") : ORDER_STATUS_LABELS[step]}
              </p>
              {date && <p className="text-xs text-muted-foreground">{formatDate(date, true)}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
