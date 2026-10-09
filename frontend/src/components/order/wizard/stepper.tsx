import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export const STEPS = ["Documents", "Impression", "Retrait ou livraison", "Paiement"];

export function Stepper({ current, onSelect, maxReachable }: { current: number; onSelect: (i: number) => void; maxReachable: number }) {
  return (
    <ol className="flex items-center gap-1 overflow-x-auto pb-1 sm:gap-2" aria-label="Étapes de la commande">
      {STEPS.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={label} className="flex shrink-0 items-center gap-1 sm:gap-2">
            <button
              type="button"
              onClick={() => onSelect(i)}
              disabled={i > maxReachable}
              aria-current={active ? "step" : undefined}
              className={cn(
                "flex items-center gap-2 rounded-full border px-2.5 py-1.5 text-xs font-medium transition-colors sm:px-3 sm:text-sm",
                active ? "border-primary bg-primary text-white" : done ? "border-primary/40 bg-accent text-primary" : "border-slate-200 bg-white text-slate-500",
                "disabled:cursor-not-allowed",
              )}
            >
              <span className={cn("flex size-5 items-center justify-center rounded-full text-[11px] font-bold", active ? "bg-white text-primary" : done ? "bg-primary text-white" : "bg-slate-100")}>
                {done ? <Check className="size-3" strokeWidth={3} /> : i + 1}
              </span>
              <span className={cn(!active && "hidden sm:inline")}>{label}</span>
            </button>
            {i < STEPS.length - 1 && <span className="h-px w-3 bg-slate-300 sm:w-6" aria-hidden />}
          </li>
        );
      })}
    </ol>
  );
}
