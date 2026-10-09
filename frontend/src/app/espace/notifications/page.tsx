"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCheck } from "lucide-react";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";
import type { NotificationItem, Paginated } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState, PageHeader, Skeleton } from "@/components/ui/feedback";
import { Pagination } from "@/components/ui/navigation";
import { cn } from "@/lib/utils";

export default function NotificationsPage() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const { data, isLoading } = useQuery({
    queryKey: ["notifications", page],
    queryFn: () => api<Paginated<NotificationItem> & { unread: number }>(`/notifications?page=${page}&pageSize=20`),
  });
  const readAll = useMutation({
    mutationFn: () => api("/notifications/read-all", { body: {} }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
  const markRead = (id: string) => api(`/notifications/${id}/read`, { body: {} }).then(() => qc.invalidateQueries({ queryKey: ["notifications"] }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Notifications"
        description="Confirmations de paiement, disponibilité, rappels de retrait et devis."
        actions={
          (data?.unread ?? 0) > 0 && (
            <Button variant="outline" onClick={() => readAll.mutate()} loading={readAll.isPending}>
              <CheckCheck /> Tout marquer comme lu
            </Button>
          )
        }
      />
      <Card>
        <CardContent className="pt-5">
          {isLoading ? (
            <Skeleton className="h-40" />
          ) : !data || data.items.length === 0 ? (
            <EmptyState icon={Bell} title="Aucune notification" />
          ) : (
            <>
              <ul className="divide-y">
                {data.items.map((n) => (
                  <li key={n.id} className={cn("flex gap-3 py-3", !n.readAt && "bg-accent/30 -mx-2 rounded-lg px-2")}>
                    <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.readAt ? "bg-transparent" : "bg-primary")} aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold">{n.title}</p>
                      <p className="text-sm text-slate-600">{n.body}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{formatDate(n.createdAt, true)}</p>
                    </div>
                    {n.link && (
                      <Button size="sm" variant="ghost" asChild onClick={() => !n.readAt && markRead(n.id)}>
                        <Link href={n.link}>Voir</Link>
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
              <Pagination page={data.page} pageCount={data.pageCount} onChange={setPage} />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
