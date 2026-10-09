"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Banknote, ClipboardList, Factory, FileSignature, GraduationCap, PackageCheck, Wallet } from "lucide-react";
import { api } from "@/lib/api";
import { fcfa } from "@/lib/format";
import { useMe } from "@/lib/hooks";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, ErrorState, PageHeader, Skeleton, StatCard } from "@/components/ui/feedback";
import { RevenueChart } from "@/components/admin/revenue-chart";

interface Stats {
  ordersByStatus: { status: string; label: string; count: number }[];
  todayOrders: number;
  monthRevenue: number;
  pendingPayments: number;
  productionQueue: number;
  readyForPickup: number;
  overduePickups: number;
  pendingCashVerifications: number;
  pendingQuotes: number;
  pendingDelegates: number;
  duplicatePayments: number;
  revenueLast30Days: { date: string; revenue: number; payments: number }[];
}

export default function AdminDashboard() {
  const { data: me } = useMe();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["admin", "stats"], queryFn: () => api<Stats>("/admin/stats"), refetchInterval: 60_000 });
  if (isLoading) return <Skeleton className="h-96" />;
  if (error || !data) return <ErrorState message="Statistiques indisponibles." onRetry={() => refetch()} />;
  const isAdmin = me?.role === "ADMIN";
  return (
    <div className="space-y-6">
      <PageHeader title="Tableau de bord" description="Activité des ventes, de la production et des retraits." />
      {isAdmin && (data.pendingCashVerifications > 0 || data.duplicatePayments > 0 || data.pendingDelegates > 0 || data.pendingQuotes > 0) && (
        <div className="grid gap-2 md:grid-cols-2">
          {data.pendingCashVerifications > 0 && (
            <Alert variant="warning" title={`${data.pendingCashVerifications} paiement(s) déclaré(s) à vérifier`} action={<Link className="text-sm font-semibold underline" href="/admin/paiements?status=PENDING_VERIFICATION">Vérifier</Link>} />
          )}
          {data.duplicatePayments > 0 && (
            <Alert variant="error" title={`${data.duplicatePayments} paiement(s) en double à rembourser`} action={<Link className="text-sm font-semibold underline" href="/admin/paiements?duplicates=true">Voir</Link>} />
          )}
          {data.pendingDelegates > 0 && (
            <Alert variant="info" title={`${data.pendingDelegates} demande(s) de délégué`} action={<Link className="text-sm font-semibold underline" href="/admin/utilisateurs?delegateStatus=PENDING">Examiner</Link>} />
          )}
          {data.pendingQuotes > 0 && (
            <Alert variant="info" title={`${data.pendingQuotes} demande(s) de devis`} action={<Link className="text-sm font-semibold underline" href="/admin/devis?status=REQUESTED">Répondre</Link>} />
          )}
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={ClipboardList} label="Commandes du jour" value={data.todayOrders} />
        {isAdmin && <StatCard icon={Wallet} label="Encaissé ce mois" value={fcfa(data.monthRevenue)} tone="green" />}
        <StatCard icon={Factory} label="File de production" value={data.productionQueue} tone="violet" />
        <StatCard icon={PackageCheck} label="Prêtes à retirer" value={data.readyForPickup} tone="amber" hint={data.overduePickups > 0 ? `${data.overduePickups} au-delà du délai de conservation` : undefined} />
        <StatCard icon={Banknote} label="En attente de paiement" value={data.pendingPayments} tone="red" />
        {isAdmin && <StatCard icon={FileSignature} label="Devis à établir" value={data.pendingQuotes} />}
        {isAdmin && <StatCard icon={GraduationCap} label="Délégués à valider" value={data.pendingDelegates} tone="violet" />}
        {data.overduePickups > 0 && <StatCard icon={AlertTriangle} label="Retraits en retard" value={data.overduePickups} tone="red" />}
      </div>
      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        {isAdmin && (
          <Card>
            <CardHeader>
              <CardTitle>Encaissements des 30 derniers jours</CardTitle>
            </CardHeader>
            <CardContent>
              <RevenueChart data={data.revenueLast30Days} />
            </CardContent>
          </Card>
        )}
        <Card>
          <CardHeader>
            <CardTitle>Commandes par statut</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {data.ordersByStatus.map((s) => (
                <li key={s.status}>
                  <Link href={`/admin/commandes?status=${s.status}`} className="flex items-center justify-between rounded-md px-2 py-1 hover:bg-slate-50">
                    <span>{s.label}</span>
                    <span className="font-semibold">{s.count}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
