"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ScrollText } from "lucide-react";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { useDebounced } from "@/lib/hooks";
import type { Paginated } from "@/lib/types";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState, PageHeader, Skeleton } from "@/components/ui/feedback";
import { Input } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Pagination } from "@/components/ui/navigation";

interface Log {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: unknown;
  ip: string | null;
  createdAt: string;
  actor: { fullName: string; roleCode: string } | null;
}

export default function AuditPage() {
  const [action, setAction] = useState("");
  const [page, setPage] = useState(1);
  const da = useDebounced(action);
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "audit", da, page],
    queryFn: () => api<Paginated<Log>>(`/admin/audit-logs?page=${page}&pageSize=50${da ? `&action=${encodeURIComponent(da)}` : ""}`),
  });
  return (
    <div className="space-y-6">
      <PageHeader title="Journal d'audit" description="Actions administratives, paiements manuels, exceptions, téléchargements de fichiers et changements de tarifs." />
      <Input placeholder="Filtrer par action (ex. payment, order.credit, pricing)" value={action} onChange={(e) => setAction(e.target.value)} className="max-w-md" />
      <Card>
        <CardContent className="pt-5">
          {isLoading ? (
            <Skeleton className="h-64" />
          ) : !data || data.items.length === 0 ? (
            <EmptyState icon={ScrollText} title="Aucune entrée" />
          ) : (
            <>
              <Table>
                <THead>
                  <TR>
                    <TH>Date</TH>
                    <TH>Auteur</TH>
                    <TH>Action</TH>
                    <TH>Objet</TH>
                    <TH>Détails</TH>
                  </TR>
                </THead>
                <TBody>
                  {data.items.map((l) => (
                    <TR key={l.id}>
                      <TD className="text-xs whitespace-nowrap text-muted-foreground">{formatDate(l.createdAt, true)}</TD>
                      <TD className="text-sm">{l.actor ? `${l.actor.fullName} (${l.actor.roleCode})` : "Système"}</TD>
                      <TD className="font-mono text-xs">{l.action}</TD>
                      <TD className="text-xs">
                        {l.entityType}
                        {l.entityId ? <span className="block font-mono text-muted-foreground">{l.entityId.slice(0, 12)}…</span> : null}
                      </TD>
                      <TD className="max-w-[320px] truncate font-mono text-[11px] text-muted-foreground" title={l.metadata ? JSON.stringify(l.metadata) : ""}>
                        {l.metadata ? JSON.stringify(l.metadata) : "—"}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
              <Pagination page={data.page} pageCount={data.pageCount} onChange={setPage} />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
