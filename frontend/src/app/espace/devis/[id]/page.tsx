"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { fcfa, formatDate } from "@/lib/format";
import type { Quote } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, ErrorState, Spinner } from "@/components/ui/feedback";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { QUOTE_VARIANT } from "@/lib/labels";

export default function QuoteDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: ["quote", id], queryFn: () => api<{ quote: Quote }>(`/quotes/${id}`).then((r) => r.quote) });
  const accept = useMutation({
    mutationFn: () => api<{ orderId: string }>(`/quotes/${id}/accept`, { body: {} }),
    onSuccess: (r) => {
      toast.success("Devis accepté : vous pouvez maintenant payer.");
      router.push(`/espace/commandes/${r.orderId}`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const reject = useMutation({
    mutationFn: () => api(`/quotes/${id}/reject`, { body: {} }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["quote", id] }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (isLoading) return <Spinner />;
  if (error || !data) return <ErrorState message={errorMessage(error)} />;
  const q = data;
  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <p className="text-sm text-muted-foreground">
          <Link href="/espace/devis" className="hover:underline">
            Devis
          </Link>{" "}
          / {q.reference}
        </p>
        <h1 className="mt-1 flex flex-wrap items-center gap-2 text-2xl font-bold">
          {q.service.name} <Badge variant={QUOTE_VARIANT[q.status]}>{q.statusLabel}</Badge>
        </h1>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Votre demande</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p className="whitespace-pre-line">{q.description}</p>
          {q.deadline && <p className="text-muted-foreground">Date souhaitée : {formatDate(q.deadline)}</p>}
          {q.documents.length > 0 && <p className="text-muted-foreground">Pièces jointes : {q.documents.map((d) => d.originalName).join(", ")}</p>}
        </CardContent>
      </Card>
      {q.status === "REQUESTED" && <Alert variant="info">Notre équipe étudie votre demande. Vous serez notifié dès que le devis est prêt.</Alert>}
      {q.amount !== null && (
        <Card>
          <CardHeader>
            <CardTitle>Devis proposé</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Table>
              <THead>
                <TR>
                  <TH>Prestation</TH>
                  <TH className="text-right">Qté</TH>
                  <TH className="text-right">Prix unitaire</TH>
                  <TH className="text-right">Montant</TH>
                </TR>
              </THead>
              <TBody>
                {q.lines.map((l, i) => (
                  <TR key={i}>
                    <TD>{l.label}</TD>
                    <TD className="text-right">{l.quantity}</TD>
                    <TD className="text-right">{fcfa(l.unitPrice)}</TD>
                    <TD className="text-right font-semibold">{fcfa(l.quantity * l.unitPrice)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <div className="flex justify-between border-t pt-3 text-lg font-bold">
              <span>Total</span>
              <span className="text-primary">{fcfa(q.amount)}</span>
            </div>
            {q.adminMessage && <Alert>{q.adminMessage}</Alert>}
            {q.validUntil && <p className="text-xs text-muted-foreground">Valable jusqu&apos;au {formatDate(q.validUntil)}</p>}
            {q.status === "QUOTED" && (
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => accept.mutate()} loading={accept.isPending}>
                  Accepter et payer
                </Button>
                <Button variant="outline" onClick={() => reject.mutate()} loading={reject.isPending}>
                  Refuser
                </Button>
              </div>
            )}
            {q.order && (
              <Button variant="outline" asChild>
                <Link href={`/espace/commandes/${q.order.id}`}>Voir la commande {q.order.reference}</Link>
              </Button>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
