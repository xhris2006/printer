"use client";

import Link from "next/link";
import { ArrowRight, BookOpen, Copy, FileText, Keyboard, PenLine, Printer, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/feedback";
import { Badge } from "@/components/ui/badge";
import { usePublicConfig } from "@/lib/hooks";

const ICONS: Record<string, typeof Printer> = {
  IMPRESSION: Printer,
  MISE_EN_FORME: PenLine,
  SAISIE: Keyboard,
  PHOTOCOPIES: Copy,
  RELIURE_AGRAFAGE: BookOpen,
  AUTRE: Sparkles,
};

export default function ServicesPage() {
  const { data, isLoading } = usePublicConfig();
  return (
    <div className="container-page py-12">
      <div className="mb-10 max-w-2xl space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Nos services</h1>
        <p className="text-slate-600">
          L&apos;impression est tarifée automatiquement. Pour les autres prestations, décrivez votre besoin et joignez vos fichiers : nous vous envoyons un devis précis, sans tarif fictif.
        </p>
      </div>
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {isLoading && Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-48" />)}
        {data?.services.map((s) => {
          const Icon = ICONS[s.code] ?? FileText;
          const isPrint = s.pricingMode === "PRINT_FLOW";
          return (
            <div key={s.id} className="flex flex-col rounded-xl border bg-white p-6 shadow-[var(--shadow-soft)]">
              <div className="mb-4 flex items-center justify-between">
                <div className="flex size-11 items-center justify-center rounded-lg bg-accent text-primary">
                  <Icon className="size-5" />
                </div>
                <Badge variant={isPrint ? "success" : "muted"}>{isPrint ? "Prix immédiat" : "Sur devis"}</Badge>
              </div>
              <h2 className="font-semibold">{s.name}</h2>
              <p className="mt-1 flex-1 text-sm text-muted-foreground">{s.description}</p>
              <Button className="mt-5" variant={isPrint ? "default" : "outline"} asChild>
                <Link href={isPrint ? "/espace/commandes/nouvelle" : `/espace/devis/nouveau?service=${s.code}`}>
                  {isPrint ? "Commander" : "Demander un devis"} <ArrowRight />
                </Link>
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
