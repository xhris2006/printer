"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ClipboardList, Plus } from "lucide-react";
import { api } from "@/lib/api";
import type { OrderSummary, Paginated } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState, ErrorState, PageHeader, Skeleton } from "@/components/ui/feedback";
import { OrdersTable } from "@/components/order/orders-table";
import { Pagination, Tabs } from "@/components/ui/navigation";

const SCOPES = [
  { value: "active", label: "En cours" },
  { value: "history", label: "Historique" },
  { value: "all", label: "Toutes" },
] as const;

export default function OrdersPage() {
  const [scope, setScope] = useState<(typeof SCOPES)[number]["value"]>("active");
  const [page, setPage] = useState(1);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["orders", scope, page],
    queryFn: () => api<Paginated<OrderSummary>>(`/orders?scope=${scope}&page=${page}&pageSize=15`),
    placeholderData: (prev) => prev,
  });
  return (
    <div className="space-y-6">
      <PageHeader
        title="Mes commandes"
        description="Suivez vos commandes, téléchargez vos reçus et recommandez en un clic."
        actions={
          <Button asChild>
            <Link href="/espace/commandes/nouvelle">
              <Plus /> Nouvelle commande
            </Link>
          </Button>
        }
      />
      <Tabs
        value={scope}
        onChange={(v) => {
          setScope(v);
          setPage(1);
        }}
        options={SCOPES.map((s) => ({ value: s.value, label: s.label }))}
      />
      <Card>
        <CardContent className="pt-5">
          {isLoading ? (
            <Skeleton className="h-48" />
          ) : error ? (
            <ErrorState message="Impossible de charger vos commandes." onRetry={() => refetch()} />
          ) : data && data.items.length > 0 ? (
            <>
              <OrdersTable orders={data.items} />
              <Pagination page={data.page} pageCount={data.pageCount} onChange={setPage} />
            </>
          ) : (
            <EmptyState icon={ClipboardList} title="Aucune commande" description={scope === "active" ? "Vous n'avez aucune commande en cours." : "Aucune commande dans cette catégorie."} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
