"use client";

import { FlaskConical } from "lucide-react";
import { usePublicConfig } from "@/lib/hooks";

/** Bandeau visible lorsque les paiements ne sont pas en production (aucun argent réel). */
export function TestModeBanner() {
  const { data } = usePublicConfig();
  if (!data?.payments.enabled || !data.payments.testMode) return null;
  return (
    <div className="flex items-center justify-center gap-2 bg-amber-400 px-4 py-1.5 text-center text-xs font-semibold text-amber-950">
      <FlaskConical className="size-3.5" aria-hidden />
      MODE TEST — paiements {data.payments.provider === "MOCK" ? "simulés (développement)" : "Fapshi sandbox"} : aucun argent réel n&apos;est encaissé.
    </div>
  );
}
