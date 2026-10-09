"use client";

import Link from "next/link";
import { useState } from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Banknote, Copy, Download, FileSpreadsheet, Lock, Plus, RefreshCw, Unlock, XCircle } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { fcfa, formatDate } from "@/lib/format";
import { optionsSummary } from "@/lib/labels";
import type { Group } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, EmptyState, ErrorState, Spinner, StatCard } from "@/components/ui/feedback";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { OrderStatusBadge, PaymentStateBadge } from "@/components/order/status-badge";
import { WhatsAppIcon } from "@/components/layout/whatsapp-button";

export default function DelegateGroupPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [cashFor, setCashFor] = useState<{ orderId: string; reference: string; total: number } | null>(null);
  const [cashNote, setCashNote] = useState("");
  const { data: group, isLoading, error, refetch } = useQuery({
    queryKey: ["group", id],
    queryFn: () => api<{ group: Group }>(`/groups/${id}`).then((r) => r.group),
    refetchInterval: 60_000,
  });
  const action = useMutation({
    mutationFn: (path: string) => api<{ group: Group; cancelled?: number }>(`/groups/${id}/${path}`, { body: {} }),
    onSuccess: (res, path) => {
      qc.setQueryData(["group", id], res.group);
      const messages: Record<string, string> = {
        close: `Collecte clôturée${res.cancelled ? ` (${res.cancelled} contribution(s) non payée(s) annulée(s))` : ""}.`,
        reopen: "Collecte rouverte.",
        cancel: "Commande groupée annulée.",
        "share-link": "Nouveau lien généré : l'ancien ne fonctionne plus.",
      };
      toast.success(messages[path] ?? "Mise à jour effectuée.");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const declareCash = useMutation({
    mutationFn: () => api(`/groups/${id}/orders/${cashFor!.orderId}/cash-declaration`, { body: { amount: cashFor!.total, note: cashNote } }),
    onSuccess: () => {
      toast.success("Paiement signalé : il sera confirmé par l'administration après vérification.");
      setCashFor(null);
      setCashNote("");
      refetch();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (isLoading) return <Spinner />;
  if (error || !group) return <ErrorState message={errorMessage(error)} onRetry={() => refetch()} />;

  const shareUrl = typeof window !== "undefined" ? `${window.location.origin}/g/${group.shareToken}` : "";
  const open = group.status === "OPEN";
  const t = group.totals;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm text-muted-foreground">
            <Link href="/espace/delegue" className="hover:underline">
              Espace délégué
            </Link>{" "}
            / {group.code}
          </p>
          <h1 className="mt-1 flex flex-wrap items-center gap-2 text-2xl font-bold">
            {group.name} <Badge variant={open ? "success" : group.status === "CANCELLED" ? "danger" : "info"}>{group.statusLabel}</Badge>
          </h1>
          <p className="text-sm text-muted-foreground">
            {group.institution} · {group.field} · {group.level} · {group.className}
            {group.category ? ` · ${group.category}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" asChild>
            <a href={`/api/groups/${group.id}/summary.pdf`}>
              <Download /> Récapitulatif PDF
            </a>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <a href={`/api/groups/${group.id}/summary.csv`}>
              <FileSpreadsheet /> CSV
            </a>
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={Plus} label="Contributions" value={t.contributionsCount} hint={`${t.contributorsCount} participant(s)`} />
        <StatCard icon={Copy} label="Documents / pages" value={`${t.documentsCount} / ${t.pagesCount}`} tone="violet" />
        <StatCard icon={Banknote} label="Montant total" value={fcfa(t.totalAmount)} tone="amber" hint={`${t.confirmedCount} commande(s) confirmée(s)`} />
        <StatCard icon={Lock} label="Payé (confirmé)" value={fcfa(t.paidAmount)} tone="green" hint={`${t.paidCount} payée(s), ${t.unpaidCount} non payée(s)`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          {group.mode === "STUDENT_CONTRIBUTIONS" && open && (
            <Card>
              <CardHeader>
                <CardTitle>Lien de collecte</CardTitle>
                <CardDescription>Partagez ce lien sécurisé avec la classe : chaque étudiant envoie ses fichiers et paie sa part.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex gap-2">
                  <Input readOnly value={shareUrl} aria-label="Lien de collecte" onFocus={(e) => e.target.select()} />
                  <Button variant="outline" onClick={() => navigator.clipboard.writeText(shareUrl).then(() => toast.success("Lien copié."))} aria-label="Copier le lien">
                    <Copy />
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="success" asChild>
                    <a href={`https://wa.me/?text=${encodeURIComponent(`Collecte « ${group.name} » (${group.className}) : envoyez vos documents à imprimer ici : ${shareUrl}`)}`} target="_blank" rel="noopener noreferrer">
                      <WhatsAppIcon className="size-4" /> Partager sur WhatsApp
                    </a>
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => window.confirm("Générer un nouveau lien ? L'ancien lien ne fonctionnera plus.") && action.mutate("share-link")}>
                    <RefreshCw /> Nouveau lien
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Contributions</CardTitle>
              {open && (
                <Button size="sm" asChild>
                  <Link href={group.mode === "DELEGATE_COLLECT" ? `/espace/commandes/nouvelle?groupe=${group.id}` : `/espace/commandes/nouvelle?collecte=${group.shareToken}`}>
                    <Plus /> Ajouter des documents
                  </Link>
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {group.contributions.length === 0 ? (
                <EmptyState icon={Plus} title="Aucune contribution pour l'instant" description={group.mode === "DELEGATE_COLLECT" ? "Ajoutez les documents de la classe." : "Partagez le lien de collecte avec la classe."} />
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Participant</TH>
                      <TH>Commande</TH>
                      <TH className="text-right">Docs / pages</TH>
                      <TH>Statut</TH>
                      <TH className="text-right">Montant</TH>
                      <TH />
                    </TR>
                  </THead>
                  <TBody>
                    {group.contributions.map((c) => (
                      <TR key={c.id}>
                        <TD className="font-medium">
                          {c.contributor.fullName}
                          {c.isDelegate && <span className="ml-1 text-xs text-muted-foreground">(vous)</span>}
                        </TD>
                        <TD className="font-mono text-xs">{c.isDelegate ? <Link href={`/espace/commandes/${c.order.id}`} className="text-primary hover:underline">{c.order.reference}</Link> : c.order.reference}</TD>
                        <TD className="text-right">
                          {c.order.documents.length} / {c.order.documents.reduce((s, d) => s + d.pageCount, 0)}
                        </TD>
                        <TD>
                          <div className="flex flex-col gap-1">
                            <OrderStatusBadge status={c.order.status} />
                            <PaymentStateBadge state={c.order.paymentStatus} credit={c.order.creditApproved} />
                          </div>
                        </TD>
                        <TD className="text-right font-semibold">{fcfa(c.order.total)}</TD>
                        <TD className="text-right">
                          {c.order.status === "PENDING_PAYMENT" && c.order.paymentStatus === "UNPAID" && c.order.total !== null && (
                            <Button size="sm" variant="ghost" onClick={() => setCashFor({ orderId: c.order.id, reference: c.order.reference, total: c.order.total! })}>
                              Paiement espèces
                            </Button>
                          )}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Paramètres du lot</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>{group.mode === "DELEGATE_COLLECT" ? "Mode A — collecte par le délégué" : "Mode B — contributions des étudiants"}</p>
              {group.defaultOptions && <p className="text-muted-foreground">{optionsSummary(group.defaultOptions)}</p>}
              {group.mode === "STUDENT_CONTRIBUTIONS" && (
                <p className="text-muted-foreground">Règle : {group.productionRule === "FULL_PAYMENT" ? "paiement intégral avant impression" : "seules les contributions payées sont imprimées"}</p>
              )}
              {group.deadline && <p className="text-muted-foreground">Date limite : {formatDate(group.deadline, true)}</p>}
              {group.pickupPoint && <p className="text-muted-foreground">Retrait : {group.pickupPoint.name}</p>}
              {group.instructions && <p className="rounded-lg bg-slate-50 p-2 text-muted-foreground">{group.instructions}</p>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Production</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {group.productionReady ? (
                <Alert variant="success">Conditions remplies : l&apos;équipe peut lancer l&apos;impression.</Alert>
              ) : (
                <Alert variant="info">{group.productionBlockedReason}</Alert>
              )}
              {group.mode === "STUDENT_CONTRIBUTIONS" && open && (
                <Button className="w-full" onClick={() => window.confirm("Clôturer la collecte ? Les étudiants ne pourront plus contribuer.") && action.mutate("close")} loading={action.isPending}>
                  <Lock /> Clôturer la collecte
                </Button>
              )}
              {group.status === "CLOSED" && (
                <Button className="w-full" variant="outline" onClick={() => action.mutate("reopen")} loading={action.isPending}>
                  <Unlock /> Rouvrir la collecte
                </Button>
              )}
              {["OPEN", "CLOSED"].includes(group.status) && (
                <Button className="w-full text-destructive" variant="ghost" onClick={() => window.confirm("Annuler toute la commande groupée ?") && action.mutate("cancel")}>
                  <XCircle /> Annuler le lot
                </Button>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={Boolean(cashFor)} onOpenChange={(o) => !o && setCashFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Signaler un paiement en espèces</DialogTitle>
            <DialogDescription>
              Commande {cashFor?.reference} — {fcfa(cashFor?.total ?? 0)}. Le paiement ne sera considéré comme effectué qu&apos;après vérification par l&apos;administration.
            </DialogDescription>
          </DialogHeader>
          <Field label="Précisions (date, personne, référence de dépôt…)" htmlFor="cash-note">
            <Textarea id="cash-note" value={cashNote} onChange={(e) => setCashNote(e.target.value)} minLength={5} maxLength={500} />
          </Field>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCashFor(null)}>
              Annuler
            </Button>
            <Button onClick={() => declareCash.mutate()} loading={declareCash.isPending} disabled={cashNote.trim().length < 5}>
              Signaler le paiement
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
