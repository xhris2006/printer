"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ClipboardList, Download, Search } from "lucide-react";
import { api } from "@/lib/api";
import { useDebounced, useMe } from "@/lib/hooks";
import { ORDER_STATUS_LABELS } from "@/lib/labels";
import type { AdminOrderRow, Paginated } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState, ErrorState, PageHeader, Skeleton, Spinner } from "@/components/ui/feedback";
import { Input, Label, NativeSelect } from "@/components/ui/input";
import { Pagination } from "@/components/ui/navigation";
import { OrdersAdminTable } from "@/components/admin/orders-admin-table";

function AdminOrders() {
  const params = useSearchParams();
  const { data: me } = useMe();
  const [filters, setFilters] = useState({
    status: params.get("status") ?? "",
    type: params.get("type") ?? "",
    paymentStatus: params.get("paymentStatus") ?? "",
    fulfillment: "",
    from: "",
    to: "",
    q: "",
  });
  const [page, setPage] = useState(1);
  const q = useDebounced(filters.q, 350);
  const query = new URLSearchParams(Object.entries({ ...filters, q }).filter(([, v]) => v) as [string, string][]);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["admin", "orders", query.toString(), page],
    queryFn: () => api<Paginated<AdminOrderRow>>(`/admin/orders?${query.toString()}&page=${page}&pageSize=25`),
    placeholderData: (prev) => prev,
  });
  const set = (k: keyof typeof filters) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setFilters((f) => ({ ...f, [k]: e.target.value }));
    setPage(1);
  };
  return (
    <div className="space-y-6">
      <PageHeader
        title="Commandes"
        description={data ? `${data.total} commande(s)` : undefined}
        actions={
          me?.role === "ADMIN" && (
            <Button variant="outline" asChild>
              <a href={`/api/admin/orders/export.csv?${query.toString()}`}>
                <Download /> Exporter en CSV
              </a>
            </Button>
          )
        }
      />
      <Card>
        <CardContent className="grid gap-3 pt-5 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="q">Recherche</Label>
            <div className="relative">
              <Search className="absolute top-2.5 left-3 size-4 text-muted-foreground" />
              <Input id="q" className="pl-9" placeholder="Référence, nom ou téléphone" value={filters.q} onChange={set("q")} />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="st">Statut</Label>
            <NativeSelect id="st" value={filters.status} onChange={set("status")}>
              <option value="">Tous (hors brouillons)</option>
              {Object.entries(ORDER_STATUS_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1">
            <Label htmlFor="ps">Paiement</Label>
            <NativeSelect id="ps" value={filters.paymentStatus} onChange={set("paymentStatus")}>
              <option value="">Tous</option>
              <option value="UNPAID">Non payé</option>
              <option value="PENDING">En cours</option>
              <option value="PAID">Payé</option>
              <option value="REFUNDED">Remboursé</option>
            </NativeSelect>
          </div>
          <div className="space-y-1">
            <Label htmlFor="ty">Type</Label>
            <NativeSelect id="ty" value={filters.type} onChange={set("type")}>
              <option value="">Tous</option>
              <option value="STANDARD">Impression</option>
              <option value="GROUP">Groupée</option>
              <option value="SERVICE">Prestation sur devis</option>
            </NativeSelect>
          </div>
          <div className="space-y-1">
            <Label htmlFor="fu">Remise</Label>
            <NativeSelect id="fu" value={filters.fulfillment} onChange={set("fulfillment")}>
              <option value="">Toutes</option>
              <option value="PICKUP">Retrait</option>
              <option value="DELIVERY">Livraison</option>
            </NativeSelect>
          </div>
          <div className="space-y-1">
            <Label htmlFor="fr">Du</Label>
            <Input id="fr" type="date" value={filters.from} onChange={set("from")} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="to">Au</Label>
            <Input id="to" type="date" value={filters.to} onChange={set("to")} />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-5">
          {isLoading ? (
            <Skeleton className="h-64" />
          ) : error ? (
            <ErrorState message="Impossible de charger les commandes." onRetry={() => refetch()} />
          ) : !data || data.items.length === 0 ? (
            <EmptyState icon={ClipboardList} title="Aucune commande" description="Modifiez les filtres pour élargir la recherche." />
          ) : (
            <>
              <OrdersAdminTable rows={data.items} />
              <Pagination page={data.page} pageCount={data.pageCount} onChange={setPage} />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<Spinner />}>
      <AdminOrders />
    </Suspense>
  );
}
