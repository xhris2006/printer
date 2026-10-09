"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Download, KeyRound, MapPin, PencilLine, RotateCcw, Truck, Users, XCircle } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { fcfa, formatDate } from "@/lib/format";
import { usePublicConfig } from "@/lib/hooks";
import { optionsSummary } from "@/lib/labels";
import type { Order } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, ErrorState, Spinner } from "@/components/ui/feedback";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { OrderStatusBadge, PaymentStateBadge, PaymentStatusBadge } from "@/components/order/status-badge";
import { StatusTimeline } from "@/components/order/status-timeline";
import { PaymentPanel } from "@/components/order/payment-panel";
import { WhatsAppIcon } from "@/components/layout/whatsapp-button";

export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { data: config } = usePublicConfig();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["order", id],
    queryFn: () => api<{ order: Order; supportLink: string }>(`/orders/${id}`),
    refetchInterval: (q) => (q.state.data && ["PENDING_PAYMENT", "PAID", "TO_PREPARE", "PRINTING", "FINISHING"].includes(q.state.data.order.status) ? 30_000 : false),
  });

  const cancel = useMutation({
    mutationFn: () => api<{ order: Order }>(`/orders/${id}/cancel`, { body: { reason: "Annulée par le client" } }),
    onSuccess: () => {
      toast.success("Commande annulée.");
      qc.invalidateQueries({ queryKey: ["order", id] });
      qc.invalidateQueries({ queryKey: ["orders"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const reorder = useMutation({
    mutationFn: () => api<{ order: Order; skipped: number }>(`/orders/${id}/reorder`, { body: {} }),
    onSuccess: (res) => {
      if (res.skipped > 0) toast.warning(`${res.skipped} document(s) n'étaient plus disponibles et ont été retirés.`);
      router.push(`/espace/commandes/nouvelle?brouillon=${res.order.id}`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (isLoading) return <Spinner />;
  if (error || !data) return <ErrorState message={errorMessage(error)} onRetry={() => refetch()} />;
  const { order, supportLink } = data;
  const paid = order.paymentStatus === "PAID";
  const trackingUrl = typeof window !== "undefined" && order.trackingToken ? `${window.location.origin}/suivi/${order.trackingToken}` : "";
  const canCancel = ["DRAFT", "PENDING_PAYMENT"].includes(order.status) && !paid && !order.payments.some((p) => p.status === "PENDING_VERIFICATION");
  const hasPrintItems = order.items.some((i) => i.kind === "PRINT");

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm text-muted-foreground">
            <Link href="/espace/commandes" className="hover:underline">
              Mes commandes
            </Link>{" "}
            / {order.reference}
          </p>
          <h1 className="mt-1 flex flex-wrap items-center gap-2 text-2xl font-bold tracking-tight">
            Commande {order.reference} <OrderStatusBadge status={order.status} /> <PaymentStateBadge state={order.paymentStatus} credit={order.creditApproved} />
          </h1>
          <p className="text-sm text-muted-foreground">Passée le {formatDate(order.createdAt, true)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" asChild>
            <a href={`/api/orders/${order.id}/receipt.pdf`}>
              <Download /> {paid ? "Reçu PDF" : "Récapitulatif PDF"}
            </a>
          </Button>
          {hasPrintItems && order.status !== "DRAFT" && (
            <Button variant="outline" size="sm" onClick={() => reorder.mutate()} loading={reorder.isPending}>
              <RotateCcw /> Recommander
            </Button>
          )}
          <Button variant="outline" size="sm" asChild>
            <a href={supportLink} target="_blank" rel="noopener noreferrer">
              <WhatsAppIcon className="text-green-600" /> Aide
            </a>
          </Button>
          {canCancel && (
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive"
              onClick={() => {
                if (window.confirm("Annuler cette commande ?")) cancel.mutate();
              }}
              loading={cancel.isPending}
            >
              <XCircle /> Annuler
            </Button>
          )}
        </div>
      </div>

      {order.status === "DRAFT" && (
        <Alert
          variant="info"
          title="Brouillon non confirmé"
          action={
            <Button size="sm" asChild>
              <Link href={`/espace/commandes/nouvelle?brouillon=${order.id}`}>
                <PencilLine /> Reprendre
              </Link>
            </Button>
          }
        >
          Vérifiez vos options puis confirmez la commande pour passer au paiement.
        </Alert>
      )}
      {order.status === "CANCELLED" && <Alert variant="error" title="Commande annulée">{order.cancelReason}</Alert>}

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          {order.status === "PENDING_PAYMENT" && <PaymentPanel order={order} />}

          {(paid || order.creditApproved) && order.pickupCode && order.status !== "COMPLETED" && (
            <Card className="border-green-200 bg-green-50/60">
              <CardContent className="flex flex-col gap-4 pt-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex size-11 items-center justify-center rounded-full bg-green-100 text-green-700">
                    <KeyRound className="size-5" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-green-900">Code de retrait</p>
                    <p className="text-xs text-green-800/80">À présenter lors du retrait ou de la livraison.</p>
                  </div>
                </div>
                <p className="font-mono text-3xl font-bold tracking-[0.3em] text-green-800">{order.pickupCode}</p>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>
                {order.items.length} {order.type === "SERVICE" ? "prestation(s)" : "document(s)"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <THead>
                  <TR>
                    <TH>{order.type === "SERVICE" ? "Prestation" : "Document"}</TH>
                    {hasPrintItems && <TH className="text-right">Pages</TH>}
                    {hasPrintItems && <TH className="text-right">Feuilles</TH>}
                    <TH className="text-right">Montant</TH>
                  </TR>
                </THead>
                <TBody>
                  {order.items.map((item) => (
                    <TR key={item.id}>
                      <TD>
                        <p className="max-w-[320px] truncate font-medium">{item.documentName ?? item.description}</p>
                        <p className="text-xs text-muted-foreground">{item.options ? optionsSummary(item.options) : `${item.copies} × ${fcfa(item.unitPrice)}`}</p>
                        {item.pageCountSource === "CUSTOMER_DECLARED" && <p className="text-xs text-amber-700">Pages déclarées : vérification avant impression</p>}
                      </TD>
                      {hasPrintItems && <TD className="text-right">{item.kind === "PRINT" ? item.pageCount : "—"}</TD>}
                      {hasPrintItems && <TD className="text-right">{item.kind === "PRINT" ? item.sheets : "—"}</TD>}
                      <TD className="text-right font-semibold">{fcfa(item.lineTotal)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
              <div className="mt-4 space-y-1.5 border-t pt-4 text-sm">
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
                <div className="flex justify-between text-base font-bold">
                  <span>Total</span>
                  <span className="text-primary">{fcfa(order.total)}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {order.payments.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Paiements</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {order.payments.map((p) => (
                  <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm">
                    <span>
                      {p.provider === "CASH" ? "Espèces (déclaration)" : "Fapshi"} · {formatDate(p.createdAt, true)}
                      {p.environment === "SANDBOX" && <span className="ml-1 text-xs text-amber-700">(test)</span>}
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="font-semibold">{fcfa(p.amount)}</span>
                      <PaymentStatusBadge status={p.status} duplicate={p.isDuplicate} />
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Suivi</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <StatusTimeline status={order.status} history={order.history} fulfillment={order.fulfillmentMethod} />
              {trackingUrl && order.status !== "DRAFT" && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => {
                    navigator.clipboard.writeText(trackingUrl).then(() => toast.success("Lien de suivi copié."));
                  }}
                >
                  <Copy /> Copier le lien de suivi
                </Button>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {order.fulfillmentMethod === "DELIVERY" ? <Truck className="size-4 text-primary" /> : <MapPin className="size-4 text-primary" />}
                {order.fulfillmentMethod === "DELIVERY" ? "Livraison" : "Retrait sur place"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              {order.fulfillmentMethod === "DELIVERY" && order.delivery ? (
                <>
                  <p className="font-medium">{order.delivery.recipientName}</p>
                  <p className="text-muted-foreground">{order.delivery.phone}</p>
                  <p>{order.delivery.quarter}</p>
                  {order.delivery.directions && <p className="text-muted-foreground">{order.delivery.directions}</p>}
                  <p className="pt-1">Frais : {fcfa(order.delivery.fee)}</p>
                </>
              ) : order.pickupPoint ? (
                <>
                  <p className="font-medium">{order.pickupPoint.name}</p>
                  <p className="text-muted-foreground">{order.pickupPoint.address}</p>
                  {order.pickupPoint.hours && <p className="text-muted-foreground">{order.pickupPoint.hours}</p>}
                  {order.pickup?.rescheduledTo && <p className="pt-1 text-amber-700">Retrait reporté jusqu&apos;au {formatDate(order.pickup.rescheduledTo)}</p>}
                  {config && order.status === "READY_FOR_PICKUP" && <p className="pt-2 text-xs text-muted-foreground">{config.pickupPolicy}</p>}
                </>
              ) : null}
            </CardContent>
          </Card>
          {order.group && (
            <Card>
              <CardContent className="flex items-center gap-3 pt-5 text-sm">
                <Users className="size-5 text-primary" />
                <div>
                  <p className="font-medium">Commande groupée</p>
                  <p className="text-muted-foreground">
                    {order.group.name} · {order.group.code}
                  </p>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
