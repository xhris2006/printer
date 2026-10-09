"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { FileSignature } from "lucide-react";
import { api } from "@/lib/api";
import { fcfa, formatDate } from "@/lib/format";
import { QUOTE_VARIANT } from "@/lib/labels";
import type { Paginated, Quote } from "@/lib/types";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState, PageHeader, Skeleton, Spinner } from "@/components/ui/feedback";
import { Tabs, Pagination } from "@/components/ui/navigation";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

function QuotesAdmin() {
  const params = useSearchParams();
  const [status, setStatus] = useState(params.get("status") ?? "REQUESTED");
  const [page, setPage] = useState(1);
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "quotes", status, page],
    queryFn: () => api<Paginated<Quote>>(`/admin/quotes?page=${page}${status !== "ALL" ? `&status=${status}` : ""}`),
  });
  return (
    <div className="space-y-6">
      <PageHeader title="Devis" description="Prestations de secrétariat : établissez un devis puis le client l'accepte et paie." />
      <Tabs
        value={status}
        onChange={(v) => {
          setStatus(v);
          setPage(1);
        }}
        options={[
          { value: "REQUESTED", label: "À établir" },
          { value: "QUOTED", label: "Envoyés" },
          { value: "ACCEPTED", label: "Acceptés" },
          { value: "ALL", label: "Tous" },
        ]}
      />
      <Card>
        <CardContent className="pt-5">
          {isLoading ? (
            <Skeleton className="h-40" />
          ) : !data || data.items.length === 0 ? (
            <EmptyState icon={FileSignature} title="Aucune demande" />
          ) : (
            <>
              <Table>
                <THead>
                  <TR>
                    <TH>Demande</TH>
                    <TH>Client</TH>
                    <TH>Statut</TH>
                    <TH className="text-right">Montant</TH>
                  </TR>
                </THead>
                <TBody>
                  {data.items.map((q) => (
                    <TR key={q.id}>
                      <TD>
                        <Link href={`/admin/devis/${q.id}`} className="font-semibold text-primary hover:underline">
                          {q.service.name}
                        </Link>
                        <p className="text-xs text-muted-foreground">
                          {q.reference} · {formatDate(q.createdAt)}
                        </p>
                        <p className="max-w-[360px] truncate text-xs text-muted-foreground">{q.description}</p>
                      </TD>
                      <TD>
                        {q.customer?.fullName}
                        <p className="text-xs text-muted-foreground">{q.customer?.phone}</p>
                      </TD>
                      <TD>
                        <Badge variant={QUOTE_VARIANT[q.status]}>{q.statusLabel}</Badge>
                      </TD>
                      <TD className="text-right font-semibold">{q.amount !== null ? fcfa(q.amount) : "—"}</TD>
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

export default function Page() {
  return (
    <Suspense fallback={<Spinner />}>
      <QuotesAdmin />
    </Suspense>
  );
}
