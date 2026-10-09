import Link from "next/link";
import { AlertTriangle, Clock } from "lucide-react";
import { fcfa, formatDate, formatPhone } from "@/lib/format";
import { ORDER_TYPE_LABELS } from "@/lib/labels";
import type { AdminOrderRow } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { OrderStatusBadge, PaymentStateBadge } from "@/components/order/status-badge";

export function OrdersAdminTable({ rows }: { rows: AdminOrderRow[] }) {
  return (
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
  );
}
