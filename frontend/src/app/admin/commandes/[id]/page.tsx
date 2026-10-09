"use client";

import Link from "next/link";
import { useState } from "react";
import { useParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Banknote, BellRing, CalendarClock, CheckCircle2, Download, FileCheck2, HandCoins, KeyRound, PackageCheck, ShieldCheck, Truck, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { fcfa, formatDate, formatPhone, whatsappLink } from "@/lib/format";
import { useMe } from "@/lib/hooks";
import { ORDER_STATUS_LABELS, ORDER_TYPE_LABELS, optionsSummary } from "@/lib/labels";
import type { Order, OrderStatus } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, ErrorState, Spinner } from "@/components/ui/feedback";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { OrderStatusBadge, PaymentStateBadge, PaymentStatusBadge } from "@/components/order/status-badge";
import { StatusTimeline } from "@/components/order/status-timeline";
import { WhatsAppIcon } from "@/components/layout/whatsapp-button";
import { ActionDialog, type ActionConfig } from "@/components/admin/action-dialog";

const NEXT_STATUSES: Partial<Record<OrderStatus, OrderStatus[]>> = {
  PAID: ["TO_PREPARE"],
  PENDING_PAYMENT: ["TO_PREPARE"],
  TO_PREPARE: ["PRINTING"],
  PRINTING: ["FINISHING", "READY_FOR_PICKUP", "OUT_FOR_DELIVERY"],
  FINISHING: ["READY_FOR_PICKUP", "OUT_FOR_DELIVERY"],
};

export default function AdminOrderPage() {
  const { id } = useParams<{ id: string }>();
  const { data: me } = useMe();
  const qc = useQueryClient();
  const [action, setAction] = useState<ActionConfig | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const { data: order, isLoading, error, refetch } = useQuery({
    queryKey: ["admin", "order", id],
    queryFn: () => api<{ order: Order }>(`/admin/orders/${id}`).then((r) => r.order),
  });

  if (isLoading) return <Spinner />;
  if (error || !order) return <ErrorState message={errorMessage(error)} onRetry={() => refetch()} />;

  const isAdmin = me?.role === "ADMIN";
  const update = (o: Order) => {
    qc.setQueryData(["admin", "order", id], o);
    qc.invalidateQueries({ queryKey: ["admin", "orders"] });
    qc.invalidateQueries({ queryKey: ["admin", "production"] });
  };
  const call = async (path: string, body: unknown, success: string) => {
    try {
      const res = await api<{ order?: Order }>(`/admin/orders/${order.id}/${path}`, { body });
      if (res.order) update(res.order);
      else refetch();
      toast.success(success);
    } catch (e) {
      toast.error(errorMessage(e));
      throw e;
    }
  };
  const setStatus = async (status: OrderStatus) => {
    setBusy(status);
    await call("status", { status }, `Statut : ${ORDER_STATUS_LABELS[status]}`).catch(() => undefined);
    setBusy(null);
  };
  const download = async (documentId: string, variant: "original" | "pdf") => {
    try {
      const { url } = await api<{ url: string }>(`/admin/documents/${documentId}/download?variant=${variant}`);
      window.open(url, "_blank", "noopener");
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const allowedNext = (NEXT_STATUSES[order.status] ?? []).filter((s) => {
    if (s === "OUT_FOR_DELIVERY") return order.fulfillmentMethod === "DELIVERY";
    if (s === "READY_FOR_PICKUP") return order.fulfillmentMethod === "PICKUP";
    if (s === "TO_PREPARE") return order.paymentStatus === "PAID" || order.creditApproved;
    return true;
  });
  const contactMessage =
    order.status === "READY_FOR_PICKUP"
      ? `Bonjour ${order.customer?.fullName}, votre commande ${order.reference} est prête au point de retrait. Merci de passer la récupérer.`
      : `Bonjour ${order.customer?.fullName}, au sujet de votre commande ${order.reference} :`;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm text-muted-foreground">
            <Link href="/admin/commandes" className="hover:underline">
              Commandes
            </Link>{" "}
            / {order.reference}
          </p>
          <h1 className="mt-1 flex flex-wrap items-center gap-2 text-2xl font-bold">
            {order.reference} <OrderStatusBadge status={order.status} /> <PaymentStateBadge state={order.paymentStatus} credit={order.creditApproved} />
            <Badge variant="muted">{ORDER_TYPE_LABELS[order.type]}</Badge>
          </h1>
          <p className="text-sm text-muted-foreground">Créée le {formatDate(order.createdAt, true)}</p>
        </div>
        {order.customer?.phone && (
          <Button variant="outline" size="sm" asChild>
            <a href={whatsappLink(order.customer.phone, contactMessage)} target="_blank" rel="noopener noreferrer">
              <WhatsAppIcon className="text-green-600" /> Contacter le client
            </a>
          </Button>
        )}
      </div>

      {order.payments.some((p) => p.isDuplicate) && <Alert variant="error" title="Paiement en double reçu">Un remboursement doit être effectué puis consigné.</Alert>}
      {order.creditApproved && order.paymentStatus !== "PAID" && <Alert variant="warning" title="Exception administrateur (production sans paiement)">{order.creditReason}</Alert>}
      {order.status === "CANCELLED" && order.paymentStatus === "PAID" && <Alert variant="warning" title="Commande annulée après paiement">Consignez le remboursement effectué.</Alert>}

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Actions</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {allowedNext.map((s) => (
                <Button key={s} onClick={() => setStatus(s)} loading={busy === s}>
                  {s === "TO_PREPARE" ? "Envoyer en production" : `Passer à « ${ORDER_STATUS_LABELS[s]} »`}
                </Button>
              ))}
              {order.status === "PAID" && order.group && order.group.mode === "STUDENT_CONTRIBUTIONS" && (
                <Alert variant="info">Contribution de collecte : la production se lance depuis la commande groupée {order.group.code}.</Alert>
              )}
              {order.status === "READY_FOR_PICKUP" && (
                <>
                  <Button
                    variant="success"
                    onClick={() =>
                      setAction({
                        title: "Remise au client",
                        description: "Saisissez le code de retrait présenté par le client. Sans code, décrivez la vérification effectuée.",
                        confirmLabel: "Confirmer la remise",
                        fields: [
                          { name: "code", label: "Code de retrait (6 chiffres)" },
                          { name: "recipientName", label: "Nom de la personne qui retire", required: true, minLength: 2, defaultValue: order.customer?.fullName },
                          { name: "note", label: "Vérification (si pas de code)", type: "textarea" },
                        ],
                        onSubmit: (v) => call("handover", { code: v.code || undefined, recipientName: v.recipientName, note: v.note || undefined }, "Commande remise."),
                      })
                    }
                  >
                    <PackageCheck /> Remettre
                  </Button>
                  <Button variant="outline" onClick={() => call("remind", {}, "Rappel envoyé.").catch(() => undefined)}>
                    <BellRing /> Envoyer un rappel
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() =>
                      setAction({
                        title: "Reporter le retrait",
                        confirmLabel: "Reporter",
                        fields: [
                          { name: "date", label: "Nouvelle date limite", type: "date", required: true },
                          { name: "note", label: "Note", type: "textarea" },
                        ],
                        onSubmit: (v) => call("pickup-reschedule", { date: v.date, note: v.note || undefined }, "Retrait reporté, client notifié."),
                      })
                    }
                  >
                    <CalendarClock /> Reporter
                  </Button>
                  {isAdmin && (
                    <Button
                      variant="ghost"
                      onClick={() =>
                        setAction({
                          title: "Marquer comme non retirée",
                          description: "Appliquez ensuite la politique de conservation de l'établissement.",
                          confirmLabel: "Enregistrer",
                          fields: [{ name: "note", label: "Note (contacts effectués, décision…)", type: "textarea", required: true, minLength: 5 }],
                          onSubmit: (v) => call("not-collected", { note: v.note }, "Enregistré."),
                        })
                      }
                    >
                      Non retirée
                    </Button>
                  )}
                </>
              )}
              {order.status === "OUT_FOR_DELIVERY" && (
                <>
                  <Button
                    variant="success"
                    onClick={() =>
                      setAction({
                        title: "Livraison effectuée",
                        confirmLabel: "Confirmer la livraison",
                        fields: [
                          { name: "receivedBy", label: "Reçue par", required: true, minLength: 2, defaultValue: order.delivery?.recipientName },
                          { name: "note", label: "Preuve / remarque", type: "textarea" },
                        ],
                        onSubmit: (v) => call("deliver", { receivedBy: v.receivedBy, note: v.note || undefined }, "Livraison enregistrée."),
                      })
                    }
                  >
                    <Truck /> Livrée
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() =>
                      setAction({
                        title: "Livraison échouée",
                        description: "La commande repassera « Prête à retirer ».",
                        confirmLabel: "Enregistrer",
                        fields: [{ name: "note", label: "Motif", type: "textarea", required: true, minLength: 5 }],
                        onSubmit: (v) => call("delivery-failed", { note: v.note }, "Livraison échouée enregistrée."),
                      })
                    }
                  >
                    Échec de livraison
                  </Button>
                </>
              )}
              {isAdmin && order.status === "PENDING_PAYMENT" && order.paymentStatus !== "PAID" && (
                <>
                  <Button
                    variant="outline"
                    onClick={() =>
                      setAction({
                        title: "Encaissement en espèces",
                        description: `Montant : ${fcfa(order.total)}. Confirmez uniquement si l'argent a bien été reçu.`,
                        confirmLabel: "Confirmer l'encaissement",
                        fields: [{ name: "note", label: "Note (reçu, personne…)", required: true, minLength: 3 }],
                        onSubmit: (v) => call("cash-payment", { note: v.note }, "Paiement enregistré."),
                      })
                    }
                    disabled={order.total === null}
                  >
                    <Banknote /> Paiement espèces reçu
                  </Button>
                  {!order.creditApproved && (
                    <Button
                      variant="outline"
                      onClick={() =>
                        setAction({
                          title: "Autoriser sans paiement",
                          description: "Exception pour un client régulier ou une commande à crédit. Cette décision est journalisée.",
                          confirmLabel: "Autoriser",
                          fields: [{ name: "reason", label: "Motif", type: "textarea", required: true, minLength: 5 }],
                          onSubmit: (v) => call("credit", { reason: v.reason }, "Exception enregistrée."),
                        })
                      }
                    >
                      <ShieldCheck /> Exception (crédit)
                    </Button>
                  )}
                </>
              )}
              {isAdmin && order.fulfillmentMethod === "DELIVERY" && ["DRAFT", "PENDING_PAYMENT"].includes(order.status) && order.paymentStatus !== "PAID" && (
                <Button
                  variant="outline"
                  onClick={() =>
                    setAction({
                      title: "Frais de livraison",
                      confirmLabel: "Enregistrer et notifier",
                      fields: [{ name: "fee", label: "Montant (FCFA)", type: "number", required: true, defaultValue: order.deliveryFee?.toString() }],
                      onSubmit: (v) => call("delivery-fee", { fee: Number(v.fee) }, "Frais enregistrés, client notifié."),
                    })
                  }
                >
                  <HandCoins /> Fixer les frais de livraison
                </Button>
              )}
              {isAdmin && ["DRAFT", "PENDING_PAYMENT", "PAID", "TO_PREPARE"].includes(order.status) && (
                <Button
                  variant="ghost"
                  className="text-destructive"
                  onClick={() =>
                    setAction({
                      title: "Annuler la commande",
                      description: order.paymentStatus === "PAID" ? "La commande est payée : consignez ensuite le remboursement effectué." : undefined,
                      confirmLabel: "Annuler la commande",
                      destructive: true,
                      fields: [{ name: "reason", label: "Motif (communiqué au client)", type: "textarea", required: true, minLength: 5 }],
                      onSubmit: (v) => call("cancel", { reason: v.reason }, "Commande annulée."),
                    })
                  }
                >
                  <Ban /> Annuler
                </Button>
              )}
              {isAdmin && order.payments.some((p) => p.status === "SUCCESSFUL") && order.paymentStatus !== "REFUNDED" && (
                <Button
                  variant="ghost"
                  onClick={() =>
                    setAction({
                      title: "Consigner un remboursement",
                      description: "Fapshi ne propose pas d'API de remboursement : effectuez le remboursement (transfert Mobile Money, espèces…) puis enregistrez-le ici.",
                      confirmLabel: "Enregistrer",
                      fields: [
                        { name: "amount", label: "Montant remboursé (FCFA)", type: "number", required: true, defaultValue: order.amountPaid.toString() },
                        {
                          name: "method",
                          label: "Moyen",
                          type: "select",
                          defaultValue: "MOBILE_MONEY",
                          options: [
                            { value: "MOBILE_MONEY", label: "Mobile Money" },
                            { value: "FAPSHI_PAYOUT", label: "Transfert Fapshi" },
                            { value: "CASH", label: "Espèces" },
                            { value: "OTHER", label: "Autre" },
                          ],
                        },
                        { name: "reference", label: "Référence de l'opération" },
                        { name: "note", label: "Note", type: "textarea", required: true, minLength: 5 },
                      ],
                      onSubmit: (v) => call("refund", { amount: Number(v.amount), method: v.method, reference: v.reference || undefined, note: v.note }, "Remboursement consigné."),
                    })
                  }
                >
                  <Undo2 /> Remboursement
                </Button>
              )}
              {allowedNext.length === 0 && !["READY_FOR_PICKUP", "OUT_FOR_DELIVERY"].includes(order.status) && !isAdmin && (
                <p className="text-sm text-muted-foreground">Aucune action de production disponible pour ce statut.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Documents à produire</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <THead>
                  <TR>
                    <TH>Document / options</TH>
                    <TH className="text-right">Pages</TH>
                    <TH className="text-right">Ex.</TH>
                    <TH className="text-right">Feuilles</TH>
                    <TH className="text-right">Montant</TH>
                    <TH />
                  </TR>
                </THead>
                <TBody>
                  {order.items.map((item) => (
                    <TR key={item.id}>
                      <TD>
                        <p className="max-w-[280px] truncate font-medium">{item.documentName ?? item.description}</p>
                        {item.options && <p className="text-xs text-muted-foreground">{optionsSummary(item.options)}</p>}
                        {item.pageCountSource === "CUSTOMER_DECLARED" && (
                          <button
                            className="mt-1 text-xs font-semibold text-amber-700 underline"
                            onClick={() =>
                              setAction({
                                title: "Vérifier le nombre de pages",
                                description: "Possible avant tout paiement : le montant est recalculé avec la grille figée de la commande.",
                                confirmLabel: "Valider",
                                fields: [{ name: "pageCount", label: "Nombre réel de pages", type: "number", required: true, defaultValue: String(item.pageCount) }],
                                onSubmit: (v) => call(`items/${item.id}/verify-pages`, { pageCount: Number(v.pageCount) }, "Pages vérifiées."),
                              })
                            }
                          >
                            Pages déclarées par le client — vérifier
                          </button>
                        )}
                      </TD>
                      <TD className="text-right">{item.kind === "PRINT" ? item.pageCount : "—"}</TD>
                      <TD className="text-right">{item.copies}</TD>
                      <TD className="text-right">{item.kind === "PRINT" ? item.sheets : "—"}</TD>
                      <TD className="text-right font-semibold">{fcfa(item.lineTotal)}</TD>
                      <TD className="text-right whitespace-nowrap">
                        {item.documentId && item.documentAvailable && (
                          <>
                            <Button size="icon" variant="ghost" onClick={() => download(item.documentId!, "original")} aria-label="Télécharger l'original">
                              <Download />
                            </Button>
                            {item.documentKind && ["DOC", "DOCX"].includes(item.documentKind) && (
                              <Button size="icon" variant="ghost" onClick={() => download(item.documentId!, "pdf")} aria-label="Télécharger la version PDF">
                                <FileCheck2 />
                              </Button>
                            )}
                          </>
                        )}
                        {item.documentId && !item.documentAvailable && <span className="text-xs text-muted-foreground">Supprimé</span>}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
              <div className="mt-4 space-y-1 border-t pt-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Sous-total</span>
                  <span>{fcfa(order.subtotal)}</span>
                </div>
                {order.fulfillmentMethod === "DELIVERY" && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Livraison</span>
                    <span>{fcfa(order.deliveryFee)}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold">
                  <span>Total</span>
                  <span>{fcfa(order.total)}</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>Encaissé</span>
                  <span>{fcfa(order.amountPaid)}</span>
                </div>
              </div>
              {order.notes && <Alert className="mt-4" title="Remarques du client">{order.notes}</Alert>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Paiements et remboursements</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {order.payments.length === 0 && <p className="text-muted-foreground">Aucune tentative de paiement.</p>}
              {order.payments.map((p) => (
                <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2">
                  <div>
                    <p className="font-medium">
                      {p.provider} · {p.method === "CASH_DECLARATION" ? "Espèces" : p.method === "FAPSHI_DIRECT" ? "Paiement direct" : "Lien de paiement"}
                      {p.environment !== "LIVE" && <span className="ml-1 text-xs text-amber-700">({p.environment})</span>}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(p.createdAt, true)}
                      {p.providerTransId ? ` · transId ${p.providerTransId}` : ""}
                      {p.medium ? ` · ${p.medium}` : ""}
                    </p>
                    {p.declarationNote && <p className="text-xs text-muted-foreground">Note : {p.declarationNote}</p>}
                    {p.failureReason && <p className="text-xs text-red-700">{p.failureReason}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{fcfa(p.amount)}</span>
                    <PaymentStatusBadge status={p.status} duplicate={p.isDuplicate} />
                  </div>
                </div>
              ))}
              {order.refunds.map((r) => (
                <div key={r.id} className="flex justify-between rounded-lg border border-dashed px-3 py-2">
                  <span>
                    Remboursement {r.method} {r.reference ? `· ${r.reference}` : ""} · {formatDate(r.createdAt)}
                  </span>
                  <span className="font-semibold">-{fcfa(r.amount)}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Client</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <p className="font-medium">{order.customer?.fullName}</p>
              {order.customer?.phone && <p>{formatPhone(order.customer.phone)}</p>}
              {order.customer?.email && <p className="text-muted-foreground">{order.customer.email}</p>}
              {order.group && (
                <p className="pt-2">
                  Groupe :{" "}
                  <Link className="text-primary hover:underline" href={`/admin/groupes/${order.group.id}`}>
                    {order.group.code} — {order.group.name}
                  </Link>
                </p>
              )}
              {order.quote && <p className="pt-2">Devis : {order.quote.reference}</p>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {order.fulfillmentMethod === "DELIVERY" ? <Truck className="size-4" /> : <KeyRound className="size-4" />}
                {order.fulfillmentMethod === "DELIVERY" ? "Livraison" : "Retrait"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              {order.delivery ? (
                <>
                  <p className="font-medium">{order.delivery.recipientName}</p>
                  <p>{order.delivery.phone}</p>
                  <p>
                    {order.delivery.quarter}
                    {order.delivery.zone ? ` (zone ${order.delivery.zone.name})` : ""}
                  </p>
                  {order.delivery.directions && <p className="text-muted-foreground">{order.delivery.directions}</p>}
                  <p>Frais : {fcfa(order.delivery.fee)}</p>
                  {order.delivery.deliveredAt && (
                    <p className="flex items-center gap-1 text-green-700">
                      <CheckCircle2 className="size-4" /> Livrée le {formatDate(order.delivery.deliveredAt, true)} à {order.delivery.receivedBy}
                    </p>
                  )}
                  {order.delivery.proofNote && <p className="text-muted-foreground">{order.delivery.proofNote}</p>}
                </>
              ) : (
                <>
                  <p className="font-medium">{order.pickupPoint?.name}</p>
                  {order.pickup?.rescheduledTo && <p className="text-amber-700">Reporté au {formatDate(order.pickup.rescheduledTo)}</p>}
                  {order.pickup?.status === "NOT_COLLECTED" && <Badge variant="danger">Non retirée</Badge>}
                  {order.pickup?.pickedUpAt && (
                    <p className="flex items-center gap-1 text-green-700">
                      <CheckCircle2 className="size-4" /> Retirée le {formatDate(order.pickup.pickedUpAt, true)} par {order.pickup.pickedUpBy}
                      {order.pickup.verifiedWithCode ? " (code vérifié)" : ""}
                    </p>
                  )}
                  {order.pickup?.note && <p className="text-muted-foreground">{order.pickup.note}</p>}
                </>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Historique</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <StatusTimeline status={order.status} history={order.history} fulfillment={order.fulfillmentMethod} />
              <ul className="space-y-1 border-t pt-3 text-xs text-muted-foreground">
                {order.history.map((h, i) => (
                  <li key={i}>
                    {formatDate(h.createdAt, true)} — {h.label}
                    {h.note ? ` : ${h.note}` : ""}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
      <ActionDialog action={action} onClose={() => setAction(null)} />
    </div>
  );
}
