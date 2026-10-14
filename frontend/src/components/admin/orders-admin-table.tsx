"use client";

import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Clock } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { useMe } from "@/lib/hooks";
import { fcfa, formatDate, formatPhone } from "@/lib/format";
import { ORDER_TYPE_LABELS } from "@/lib/labels";
import type { AdminOrderRow } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { OrderStatusBadge, PaymentStateBadge } from "@/components/order/status-badge";
import { StatusChangeButton, type StatusTarget } from "./order-status-control";

export function OrdersAdminTable({ rows }: { rows: AdminOrderRow[] }) {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const target = (o: AdminOrderRow): StatusTarget => ({
    id: o.id,
    reference: o.reference,
    status: o.status,
    total: o.total,
    amountPaid: o.amountPaid,
    customerName: o.customer.fullName,
  });
  // Changement de statut depuis la liste : même API et mêmes règles que la fiche commande
  const submitFor =
    (o: AdminOrderRow) =>
    async (path: string, body: unknown, success: string) => {
      try {
        await api(`/admin/orders/${o.id}/${path}`, { body });
        toast.success(`${o.reference} — ${success}`);
        qc.invalidateQueries({ queryKey: ["admin"] });
      } catch (e) {
        toast.error(errorMessage(e));
        throw e;
      }
    };
  const canChange = (o: AdminOrderRow) => o.statusOptions.some((opt) => me?.role === "ADMIN" || !opt.adminOnly);

  return (
    <>
    <ul className="space-y-2 md:hidden">
      {rows.map((o) => (
        <li key={o.id} className="overflow-hidden rounded-lg border bg-white">
          <Link href={`/admin/commandes/${o.id}`} className="block p-3 active:bg-slate-50">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-xs font-semibold text-primary">{o.reference}</span>
              <OrderStatusBadge status={o.status} />
            </div>
            <p className="mt-1 text-sm font-medium">{o.customer.fullName}</p>
            <p className="text-xs text-muted-foreground">
              {o.itemsCount} doc. · {o.pagesCount} p. · {o.fulfillmentMethod === "DELIVERY" ? "Livraison" : "Retrait"}
              {o.group ? ` · ${o.group.code}` : ""}
            </p>
            <div className="mt-2 flex items-center justify-between">
              <PaymentStateBadge state={o.paymentStatus} credit={o.creditApproved} />
              <span className="text-sm font-semibold">{fcfa(o.total)}</span>
            </div>
            {(o.needsPageCheck || o.overduePickup) && (
              <p className="mt-1 flex items-center gap-1 text-xs text-amber-700">
                <AlertTriangle className="size-3" /> {o.needsPageCheck ? "Pages à vérifier" : "Retrait en retard"}
              </p>
            )}
          </Link>
          {canChange(o) && (
            <div className="border-t px-2 py-1">
              <StatusChangeButton target={target(o)} options={o.statusOptions} role={me?.role} submit={submitFor(o)} variant="ghost" size="sm" className="w-full text-primary" />
            </div>
          )}
        </li>
      ))}
    </ul>
    <div className="hidden md:block">
    <Table>
      <THead>
        <TR>
          <TH>Commande</TH>
          <TH>Client</TH>
          <TH>Contenu</TH>
          <TH>Statut</TH>
          <TH>Paiement</TH>
          <TH className="text-right">Total</TH>
        </TR>
      </THead>
      <TBody>
        {rows.map((o) => (
          <TR key={o.id} className="cursor-pointer">
            <TD>
              <Link href={`/admin/commandes/${o.id}`} className="font-mono text-xs font-semibold text-primary hover:underline">
                {o.reference}
              </Link>
              <p className="text-xs text-muted-foreground">{formatDate(o.createdAt, true)}</p>
              <div className="mt-1 flex flex-wrap gap-1">
                <Badge variant="muted">{ORDER_TYPE_LABELS[o.type]}</Badge>
                {o.group && <Badge variant="violet">{o.group.code}</Badge>}
                <Badge variant="muted">{o.fulfillmentMethod === "DELIVERY" ? "Livraison" : "Retrait"}</Badge>
              </div>
            </TD>
            <TD>
              <p className="font-medium">{o.customer.fullName}</p>
              <p className="text-xs text-muted-foreground">{formatPhone(o.customer.phone)}</p>
            </TD>
            <TD className="text-sm">
              {o.itemsCount} doc. · {o.pagesCount} p. · {o.sheetsCount} f.
              {o.needsPageCheck && (
                <p className="flex items-center gap-1 text-xs text-amber-700">
                  <AlertTriangle className="size-3" /> Pages à vérifier
                </p>
              )}
            </TD>
            <TD>
              <OrderStatusBadge status={o.status} />
              {canChange(o) && (
                <div className="mt-1">
                  <StatusChangeButton target={target(o)} options={o.statusOptions} role={me?.role} submit={submitFor(o)} variant="link" size="sm" label="Changer" className="h-auto py-0 text-xs" />
                </div>
              )}
              {o.overduePickup && (
                <p className="mt-1 flex items-center gap-1 text-xs text-red-700">
                  <Clock className="size-3" /> Non retirée ({o.reminderCount} rappel(s))
                </p>
              )}
            </TD>
            <TD>
              <PaymentStateBadge state={o.paymentStatus} credit={o.creditApproved} />
            </TD>
            <TD className="text-right font-semibold">{fcfa(o.total)}</TD>
          </TR>
        ))}
      </TBody>
    </Table>
    </div>
    </>
  );
}
