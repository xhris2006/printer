"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, ClipboardList, FilePlus2, Plus, Wallet } from "lucide-react";
import { api } from "@/lib/api";
import { fcfa } from "@/lib/format";
import { useMe } from "@/lib/hooks";
import type { OrderSummary, Paginated } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, EmptyState, ErrorState, Skeleton, StatCard } from "@/components/ui/feedback";
import { OrdersTable } from "@/components/order/orders-table";

export default function DashboardPage() {
  const { data: user } = useMe();
  const stats = useQuery({ queryKey: ["orders", "stats"], queryFn: () => api<{ active: number; completed: number; totalSpent: number }>("/orders/stats") });
  const recent = useQuery({ queryKey: ["orders", "recent"], queryFn: () => api<Paginated<OrderSummary>>("/orders?pageSize=5") });

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm text-muted-foreground">Bonjour,</p>
          <h1 className="text-2xl font-bold tracking-tight">{user?.fullName}</h1>
          <p className="text-sm text-muted-foreground">Voici un aperçu de votre activité.</p>
        </div>
        <Button asChild>
          <Link href="/espace/commandes/nouvelle">
            <Plus /> Nouvelle commande
          </Link>
        </Button>
      </div>

      {user?.delegate?.status === "PENDING" && <Alert variant="info" title="Demande d'espace délégué en cours">Votre demande sera examinée par notre équipe. Vous serez notifié dès sa validation.</Alert>}

      <div className="grid gap-4 sm:grid-cols-3">
        {stats.isLoading ? (
          Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-32" />)
        ) : (
          <>
            <StatCard icon={ClipboardList} label="Commandes en cours" value={stats.data?.active ?? 0} />
            <StatCard icon={CheckCircle2} label="Commandes terminées" value={stats.data?.completed ?? 0} tone="green" />
            <StatCard icon={Wallet} label="Total dépensé" value={fcfa(stats.data?.totalSpent ?? 0)} tone="amber" />
          </>
        )}
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Vos dernières commandes</CardTitle>
          <Link href="/espace/commandes" className="text-xs font-medium text-primary hover:underline">
            Voir tout
          </Link>
        </CardHeader>
        <CardContent>
          {recent.isLoading ? (
            <Skeleton className="h-40" />
          ) : recent.error ? (
            <ErrorState message="Impossible de charger vos commandes." onRetry={() => recent.refetch()} />
          ) : recent.data && recent.data.items.length > 0 ? (
            <OrdersTable orders={recent.data.items} />
          ) : (
            <EmptyState
              icon={FilePlus2}
              title="Vous n'avez pas encore passé de commande ?"
              description="Commencez dès maintenant : téléversez vos documents, choisissez vos options et payez par Mobile Money."
              action={
                <Button asChild>
                  <Link href="/espace/commandes/nouvelle">Nouvelle commande</Link>
                </Button>
              }
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
