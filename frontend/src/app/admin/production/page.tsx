"use client";

import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Factory, PackageCheck, PlayCircle } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { fcfa, formatDate } from "@/lib/format";
import { ORDER_STATUS_LABELS } from "@/lib/labels";
import type { AdminOrderRow, OrderStatus } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState, ErrorState, PageHeader, Skeleton } from "@/components/ui/feedback";
import { OrderStatusBadge } from "@/components/order/status-badge";

const NEXT: Partial<Record<OrderStatus, OrderStatus>> = { PAID: "TO_PREPARE", TO_PREPARE: "PRINTING", PRINTING: "FINISHING" };

function Column({ title, description, rows, icon: Icon, onAdvance }: { title: string; description: string; rows: AdminOrderRow[]; icon: typeof Factory; onAdvance: (o: AdminOrderRow, s: OrderStatus) => void }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Icon className="size-5 text-primary" /> {title} <Badge variant="muted">{rows.length}</Badge>
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">Rien pour le moment.</p>}
        {rows.map((o) => {
          const next = o.status === "PENDING_PAYMENT" ? "TO_PREPARE" : NEXT[o.status];
          const readyNext = o.status === "FINISHING" || o.status === "PRINTING" ? (o.fulfillmentMethod === "DELIVERY" ? "OUT_FOR_DELIVERY" : "READY_FOR_PICKUP") : null;
          return (
            <div key={o.id} className="rounded-lg border bg-white p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <Link href={`/admin/commandes/${o.id}`} className="font-mono text-xs font-semibold text-primary hover:underline">
                    {o.reference}
                  </Link>
                  <p className="truncate text-sm font-medium">{o.customer.fullName}</p>
                  <p className="text-xs text-muted-foreground">
                    {o.itemsCount} doc. · {o.pagesCount} p. · {o.sheetsCount} feuilles · {o.fulfillmentMethod === "DELIVERY" ? "Livraison" : "Retrait"}
                    {o.group ? ` · ${o.group.code}` : ""}
                  </p>
                  {o.needsPageCheck && (
                    <p className="flex items-center gap-1 text-xs text-amber-700">
                      <AlertTriangle className="size-3" /> Pages déclarées à vérifier
                    </p>
                  )}
                  {o.overduePickup && <p className="text-xs text-red-700">Retrait en retard ({o.reminderCount} rappel(s))</p>}
                </div>
                <div className="flex flex-col items-end gap-1">
                  <OrderStatusBadge status={o.status} />
                  <span className="text-xs text-muted-foreground">{fcfa(o.total)}</span>
                  {o.creditApproved && o.paymentStatus !== "PAID" && <Badge variant="violet">Exception</Badge>}
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {next && (
                  <Button size="sm" onClick={() => onAdvance(o, next)}>
                    {next === "TO_PREPARE" ? "Lancer la préparation" : ORDER_STATUS_LABELS[next]}
                  </Button>
                )}
                {readyNext && (
                  <Button size="sm" variant="success" onClick={() => onAdvance(o, readyNext)}>
                    {ORDER_STATUS_LABELS[readyNext]}
                  </Button>
                )}
                {["READY_FOR_PICKUP", "OUT_FOR_DELIVERY"].includes(o.status) && (
                  <Button size="sm" variant="outline" asChild>
                    <Link href={`/admin/commandes/${o.id}`}>{o.status === "READY_FOR_PICKUP" ? "Remettre" : "Confirmer la livraison"}</Link>
                  </Button>
                )}
                <span className="ml-auto self-center text-[11px] text-muted-foreground">{o.paidAt ? `Payée ${formatDate(o.paidAt, true)}` : ""}</span>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

export default function ProductionPage() {
  const qc = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["admin", "production"],
    queryFn: () => api<{ toRelease: AdminOrderRow[]; inProduction: AdminOrderRow[]; ready: AdminOrderRow[] }>("/admin/production"),
    refetchInterval: 30_000,
  });
  const advance = async (o: AdminOrderRow, status: OrderStatus) => {
    try {
      await api(`/admin/orders/${o.id}/status`, { body: { status } });
      toast.success(`${o.reference} : ${ORDER_STATUS_LABELS[status]}`);
      qc.invalidateQueries({ queryKey: ["admin", "production"] });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <div className="space-y-6">
      <PageHeader title="Production" description="Seules les commandes payées (ou autorisées par un administrateur) apparaissent ici." />
      {isLoading ? (
        <Skeleton className="h-96" />
      ) : error || !data ? (
        <ErrorState message="File de production indisponible." onRetry={() => refetch()} />
      ) : data.toRelease.length + data.inProduction.length + data.ready.length === 0 ? (
        <EmptyState icon={Factory} title="Aucune commande en production" description="Les commandes apparaissent ici dès la confirmation de leur paiement." />
      ) : (
        <div className="grid gap-6 xl:grid-cols-3">
          <Column title="À lancer" description="Paiement confirmé" rows={data.toRelease} icon={PlayCircle} onAdvance={advance} />
          <Column title="En cours" description="Préparation, impression, finition" rows={data.inProduction} icon={Factory} onAdvance={advance} />
          <Column title="À remettre" description="Prêtes à retirer ou en livraison" rows={data.ready} icon={PackageCheck} onAdvance={advance} />
        </div>
      )}
    </div>
  );
}
