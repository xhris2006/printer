"use client";

import Link from "next/link";
import { useState } from "react";
import { useParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileSpreadsheet, PlayCircle, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { fcfa, formatDate } from "@/lib/format";
import { useMe } from "@/lib/hooks";
import { optionsSummary } from "@/lib/labels";
import type { Group } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, ErrorState, Spinner, StatCard } from "@/components/ui/feedback";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { OrderStatusBadge, PaymentStateBadge } from "@/components/order/status-badge";
import { ActionDialog, type ActionConfig } from "@/components/admin/action-dialog";
import { Banknote, Layers, Users } from "lucide-react";

export default function AdminGroupPage() {
  const { id } = useParams<{ id: string }>();
  const { data: me } = useMe();
  const qc = useQueryClient();
  const [action, setAction] = useState<ActionConfig | null>(null);
  const [starting, setStarting] = useState(false);
  const { data: group, isLoading, error, refetch } = useQuery({
    queryKey: ["admin", "group", id],
    queryFn: () => api<{ group: Group }>(`/admin/groups/${id}`).then((r) => r.group),
  });
  if (isLoading) return <Spinner />;
  if (error || !group) return <ErrorState message={errorMessage(error)} onRetry={() => refetch()} />;

  const start = async (override = false, reason?: string) => {
    setStarting(true);
    try {
      const res = await api<{ group: Group; released: number }>(`/admin/groups/${id}/start-production`, { body: { override, reason } });
      qc.setQueryData(["admin", "group", id], res.group);
      toast.success(`${res.released} commande(s) envoyée(s) en production.`);
    } catch (e) {
      toast.error(errorMessage(e));
      throw e;
    } finally {
      setStarting(false);
    }
  };
  const t = group.totals;
  const canStart = ["OPEN", "CLOSED"].includes(group.status) && !(group.mode === "STUDENT_CONTRIBUTIONS" && group.status === "OPEN");

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm text-muted-foreground">
            <Link href="/admin/groupes" className="hover:underline">
              Commandes groupées
            </Link>{" "}
            / {group.code}
          </p>
          <h1 className="mt-1 flex flex-wrap items-center gap-2 text-2xl font-bold">
            {group.name} <Badge variant="info">{group.statusLabel}</Badge>
          </h1>
          <p className="text-sm text-muted-foreground">
            {group.institution} · {group.field} · {group.level} · {group.className} — délégué : {group.delegate.fullName}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" asChild>
            <a href={`/api/groups/${group.id}/summary.pdf`}>
              <Download /> PDF
            </a>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <a href={`/api/groups/${group.id}/summary.csv`}>
              <FileSpreadsheet /> CSV
            </a>
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <StatCard icon={Users} label="Commandes confirmées" value={t.confirmedCount} />
        <StatCard icon={Layers} label="Documents / pages / feuilles" value={`${t.documentsCount} / ${t.pagesCount} / ${t.sheetsCount}`} tone="violet" />
        <StatCard icon={Banknote} label="Total" value={fcfa(t.totalAmount)} tone="amber" />
        <StatCard icon={Banknote} label="Payé (confirmé)" value={fcfa(t.paidAmount)} tone="green" hint={`${t.unpaidCount} non payée(s)`} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Production</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {group.mode === "DELEGATE_COLLECT" ? "Mode A (collecte par le délégué)" : "Mode B (contributions des étudiants)"} · règle :{" "}
            {group.productionRule === "FULL_PAYMENT" ? "paiement intégral" : "seules les contributions payées"}
            {group.defaultOptions ? ` · ${optionsSummary(group.defaultOptions)}` : ""}
          </p>
          {group.productionOverride && <Alert variant="warning" title="Production lancée par dérogation" />}
          {group.productionReady ? <Alert variant="success">Conditions de production remplies.</Alert> : <Alert variant="info">{group.productionBlockedReason}</Alert>}
          {canStart && (
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => start().catch(() => undefined)} disabled={!group.productionReady} loading={starting}>
                <PlayCircle /> Lancer la production
              </Button>
              {me?.role === "ADMIN" && !group.productionReady && (
                <Button
                  variant="outline"
                  onClick={() =>
                    setAction({
                      title: "Lancer par dérogation",
                      description: "Les commandes non payées seront autorisées à crédit. Décision journalisée.",
                      confirmLabel: "Lancer la production",
                      destructive: true,
                      fields: [{ name: "reason", label: "Motif", type: "textarea", required: true, minLength: 5 }],
                      onSubmit: (v) => start(true, v.reason),
                    })
                  }
                >
                  <ShieldAlert /> Dérogation administrateur
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Contributions ({group.contributions.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <THead>
              <TR>
                <TH>Participant</TH>
                <TH>Commande</TH>
                <TH className="text-right">Docs / pages</TH>
                <TH>Statut</TH>
                <TH>Paiement</TH>
                <TH className="text-right">Montant</TH>
              </TR>
            </THead>
            <TBody>
              {group.contributions.map((c) => (
                <TR key={c.id}>
                  <TD>
                    {c.contributor.fullName}
                    {c.isDelegate && <Badge variant="muted" className="ml-1">délégué</Badge>}
                  </TD>
                  <TD>
                    <Link href={`/admin/commandes/${c.order.id}`} className="font-mono text-xs text-primary hover:underline">
                      {c.order.reference}
                    </Link>
                    <p className="text-xs text-muted-foreground">{formatDate(c.createdAt)}</p>
                  </TD>
                  <TD className="text-right">
                    {c.order.documents.length} / {c.order.documents.reduce((s, d) => s + d.pageCount, 0)}
                  </TD>
                  <TD>
                    <OrderStatusBadge status={c.order.status} />
                  </TD>
                  <TD>
                    <PaymentStateBadge state={c.order.paymentStatus} credit={c.order.creditApproved} />
                  </TD>
                  <TD className="text-right font-semibold">{fcfa(c.order.total)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>
      <ActionDialog action={action} onClose={() => setAction(null)} />
    </div>
  );
}
