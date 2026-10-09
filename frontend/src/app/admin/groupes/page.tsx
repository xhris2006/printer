"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { UsersRound } from "lucide-react";
import { api } from "@/lib/api";
import { fcfa, formatDate } from "@/lib/format";
import { useDebounced } from "@/lib/hooks";
import type { GroupMode, GroupStatus, Paginated } from "@/lib/types";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState, PageHeader, Skeleton } from "@/components/ui/feedback";
import { Input, NativeSelect } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Pagination } from "@/components/ui/navigation";

interface Row {
  id: string;
  code: string;
  name: string;
  institution: string;
  className: string;
  mode: GroupMode;
  status: GroupStatus;
  statusLabel: string;
  productionRule: string;
  delegate: { fullName: string; phone: string };
  ordersCount: number;
  paidCount: number;
  totalAmount: number;
  paidAmount: number;
  deadline: string | null;
  createdAt: string;
}

export default function AdminGroupsPage() {
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const dq = useDebounced(q);
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "groups", status, dq, page],
    queryFn: () => api<Paginated<Row>>(`/admin/groups?page=${page}${status ? `&status=${status}` : ""}${dq ? `&q=${encodeURIComponent(dq)}` : ""}`),
  });
  return (
    <div className="space-y-6">
      <PageHeader title="Commandes groupées" description="Lots des délégués de classe et collectes des étudiants." />
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input placeholder="Code, nom, établissement, classe…" value={q} onChange={(e) => setQ(e.target.value)} className="sm:max-w-xs" />
        <NativeSelect value={status} onChange={(e) => setStatus(e.target.value)} className="sm:max-w-[220px]">
          <option value="">Tous les statuts</option>
          <option value="OPEN">Collecte ouverte</option>
          <option value="CLOSED">Collecte clôturée</option>
          <option value="IN_PRODUCTION">En production</option>
          <option value="READY">Prête</option>
          <option value="COMPLETED">Terminée</option>
          <option value="CANCELLED">Annulée</option>
        </NativeSelect>
      </div>
      <Card>
        <CardContent className="pt-5">
          {isLoading ? (
            <Skeleton className="h-48" />
          ) : !data || data.items.length === 0 ? (
            <EmptyState icon={UsersRound} title="Aucune commande groupée" />
          ) : (
            <>
              <Table>
                <THead>
                  <TR>
                    <TH>Lot</TH>
                    <TH>Délégué</TH>
                    <TH>Statut</TH>
                    <TH className="text-right">Commandes payées</TH>
                    <TH className="text-right">Payé / total</TH>
                  </TR>
                </THead>
                <TBody>
                  {data.items.map((g) => (
                    <TR key={g.id}>
                      <TD>
                        <Link href={`/admin/groupes/${g.id}`} className="font-semibold text-primary hover:underline">
                          {g.name}
                        </Link>
                        <p className="text-xs text-muted-foreground">
                          {g.code} · {g.institution} · {g.className} · {g.mode === "DELEGATE_COLLECT" ? "Mode A" : "Mode B"}
                          {g.deadline ? ` · limite ${formatDate(g.deadline)}` : ""}
                        </p>
                      </TD>
                      <TD>
                        {g.delegate.fullName}
                        <p className="text-xs text-muted-foreground">{g.delegate.phone}</p>
                      </TD>
                      <TD>
                        <Badge variant={g.status === "OPEN" ? "success" : g.status === "CLOSED" ? "warning" : g.status === "CANCELLED" ? "danger" : "info"}>{g.statusLabel}</Badge>
                      </TD>
                      <TD className="text-right">
                        {g.paidCount} / {g.ordersCount}
                      </TD>
                      <TD className="text-right font-semibold">
                        {fcfa(g.paidAmount)} / {fcfa(g.totalAmount)}
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
