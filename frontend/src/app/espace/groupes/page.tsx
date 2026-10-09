"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { api } from "@/lib/api";
import { fcfa, formatDate } from "@/lib/format";
import type { GroupStatus, OrderStatus, PaymentState } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState, PageHeader, Skeleton } from "@/components/ui/feedback";
import { OrderStatusBadge, PaymentStateBadge } from "@/components/order/status-badge";

interface Participation {
  groupId: string;
  code: string;
  name: string;
  className: string;
  institution: string;
  groupStatus: GroupStatus;
  groupStatusLabel: string;
  shareToken: string | null;
  order: { id: string; reference: string; status: OrderStatus; statusLabel: string; paymentStatus: PaymentState; total: number | null };
  createdAt: string;
}

export default function ParticipationsPage() {
  const { data, isLoading } = useQuery({ queryKey: ["participations"], queryFn: () => api<{ items: Participation[] }>("/groups/participations") });
  return (
    <div className="space-y-6">
      <PageHeader title="Mes collectes" description="Les commandes groupées de classe auxquelles vous avez contribué." />
      {isLoading ? (
        <Skeleton className="h-40" />
      ) : !data || data.items.length === 0 ? (
        <EmptyState icon={Users} title="Aucune participation" description="Lorsque votre délégué partage un lien de collecte, vos contributions apparaissent ici." />
      ) : (
        <div className="grid gap-3">
          {data.items.map((p) => (
            <Card key={p.order.id}>
              <CardContent className="flex flex-col gap-3 pt-5 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">
                    {p.code} · {p.institution} · {p.className}
                  </p>
                  <p className="font-semibold">{p.name}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <Badge variant="muted">Lot : {p.groupStatusLabel}</Badge>
                    <OrderStatusBadge status={p.order.status} />
                    <PaymentStateBadge state={p.order.paymentStatus} />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Ma contribution {p.order.reference} · {fcfa(p.order.total)} · {formatDate(p.createdAt)}
                  </p>
                </div>
                <div className="flex gap-2">
                  {p.shareToken && (
                    <Button size="sm" variant="outline" asChild>
                      <Link href={`/espace/commandes/nouvelle?collecte=${p.shareToken}`}>Ajouter d&apos;autres documents</Link>
                    </Button>
                  )}
                  <Button size="sm" asChild>
                    <Link href={`/espace/commandes/${p.order.id}`}>Voir</Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
