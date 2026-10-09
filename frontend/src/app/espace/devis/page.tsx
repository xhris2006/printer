"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { FileSignature, Plus } from "lucide-react";
import { api } from "@/lib/api";
import { fcfa, formatDate } from "@/lib/format";
import type { Quote } from "@/lib/types";
import { QUOTE_VARIANT } from "@/lib/labels";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState, PageHeader, Skeleton } from "@/components/ui/feedback";


export default function QuotesPage() {
  const { data, isLoading } = useQuery({ queryKey: ["quotes"], queryFn: () => api<{ items: Quote[] }>("/quotes") });
  return (
    <div className="space-y-6">
      <PageHeader
        title="Devis & secrétariat"
        description="Mise en forme, saisie, photocopies, reliure… Décrivez votre besoin : nous établissons un devis précis."
        actions={
          <Button asChild>
            <Link href="/espace/devis/nouveau">
              <Plus /> Nouvelle demande
            </Link>
          </Button>
        }
      />
      {isLoading ? (
        <Skeleton className="h-40" />
      ) : !data || data.items.length === 0 ? (
        <EmptyState icon={FileSignature} title="Aucune demande de devis" description="Les prestations dont le prix ne peut pas être calculé automatiquement passent par un devis." />
      ) : (
        <div className="grid gap-3">
          {data.items.map((q) => (
            <Link key={q.id} href={`/espace/devis/${q.id}`}>
              <Card className="transition hover:border-primary/40">
                <CardContent className="flex flex-col gap-2 pt-5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">
                      {q.reference} · {formatDate(q.createdAt)}
                    </p>
                    <p className="font-semibold">{q.service.name}</p>
                    <p className="truncate text-sm text-muted-foreground">{q.description}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    {q.amount !== null && <span className="font-bold">{fcfa(q.amount)}</span>}
                    <Badge variant={QUOTE_VARIANT[q.status]}>{q.statusLabel}</Badge>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
