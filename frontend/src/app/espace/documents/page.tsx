"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileText, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { formatBytes, formatDate } from "@/lib/format";
import type { ApiDocument, Paginated } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState, ErrorState, PageHeader, Skeleton } from "@/components/ui/feedback";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Pagination } from "@/components/ui/navigation";

const STATUS: Record<string, { label: string; variant: "success" | "warning" | "danger" | "muted" | "info" }> = {
  READY: { label: "Prêt", variant: "success" },
  ANALYZING: { label: "Analyse…", variant: "info" },
  UPLOADED: { label: "Reçu", variant: "info" },
  NEEDS_REVIEW: { label: "À vérifier", variant: "warning" },
  FAILED: { label: "Échec", variant: "danger" },
  REJECTED: { label: "Refusé", variant: "danger" },
};

export default function DocumentsPage() {
  const [page, setPage] = useState(1);
  const qc = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["documents", "list", page],
    queryFn: () => api<Paginated<ApiDocument>>(`/documents?page=${page}&pageSize=20`),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/documents/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Document supprimé.");
      qc.invalidateQueries({ queryKey: ["documents"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const download = async (id: string) => {
    try {
      const { url } = await api<{ url: string }>(`/documents/${id}/download`);
      window.open(url, "_blank", "noopener");
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <div className="space-y-6">
      <PageHeader
        title="Mes documents"
        description="Vos fichiers restent privés. Ils sont supprimés automatiquement après la durée de conservation."
        actions={
          <Button asChild>
            <Link href="/espace/commandes/nouvelle">
              <Plus /> Imprimer des documents
            </Link>
          </Button>
        }
      />
      <Card>
        <CardContent className="pt-5">
          {isLoading ? (
            <Skeleton className="h-48" />
          ) : error ? (
            <ErrorState message={errorMessage(error)} onRetry={() => refetch()} />
          ) : !data || data.items.length === 0 ? (
            <EmptyState icon={FileText} title="Aucun document" description="Les fichiers que vous téléversez apparaîtront ici." />
          ) : (
            <>
              <Table>
                <THead>
                  <TR>
                    <TH>Nom</TH>
                    <TH>Format</TH>
                    <TH className="text-right">Pages</TH>
                    <TH>Statut</TH>
                    <TH>Ajouté le</TH>
                    <TH className="text-right">Actions</TH>
                  </TR>
                </THead>
                <TBody>
                  {data.items.map((d) => (
                    <TR key={d.id}>
                      <TD className="max-w-[260px] truncate font-medium">{d.originalName}</TD>
                      <TD className="text-muted-foreground">
                        {d.kind} · {formatBytes(d.sizeBytes)}
                      </TD>
                      <TD className="text-right">{d.pageCount ?? "—"}</TD>
                      <TD>
                        <Badge variant={STATUS[d.status]?.variant ?? "muted"}>{STATUS[d.status]?.label ?? d.status}</Badge>
                      </TD>
                      <TD className="text-muted-foreground">{formatDate(d.createdAt)}</TD>
                      <TD className="text-right">
                        <div className="flex justify-end gap-1">
                          {d.status !== "REJECTED" && (
                            <Button size="icon" variant="ghost" onClick={() => download(d.id)} aria-label="Télécharger">
                              <Download />
                            </Button>
                          )}
                          <Button
                            size="icon"
                            variant="ghost"
                            className="text-destructive"
                            onClick={() => window.confirm("Supprimer ce document ?") && remove.mutate(d.id)}
                            aria-label="Supprimer"
                          >
                            <Trash2 />
                          </Button>
                        </div>
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
