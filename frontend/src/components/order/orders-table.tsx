import Link from "next/link";
import { fcfa, formatDate } from "@/lib/format";
import { COLOR_LABELS, ORDER_TYPE_LABELS } from "@/lib/labels";
import type { OrderSummary } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { OrderStatusBadge } from "./status-badge";

export function OrdersTable({ orders }: { orders: OrderSummary[] }) {
  return (
    <>
      {/* Mobile : cartes */}
      <ul className="space-y-2 md:hidden">
        {orders.map((o) => (
          <li key={o.id}>
            <Link href={`/espace/commandes/${o.id}`} className="block rounded-lg border bg-white p-3 hover:border-primary/40">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-xs font-semibold">{o.reference}</span>
                <OrderStatusBadge status={o.status} />
              </div>
              <p className="mt-1 truncate text-sm">{o.firstDocument ?? ORDER_TYPE_LABELS[o.type]}{o.itemsCount > 1 ? ` + ${o.itemsCount - 1}` : ""}</p>
              <div className="mt-1 flex justify-between text-xs text-muted-foreground">
                <span>{formatDate(o.createdAt)}</span>
                <span className="font-semibold text-slate-800">{fcfa(o.total)}</span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
      {/* Bureau : tableau */}
      <div className="hidden md:block">
        <Table>
          <THead>
            <TR>
              <TH>N°</TH>
              <TH>Document</TH>
              <TH>Type</TH>
              <TH>Statut</TH>
              <TH>Date</TH>
              <TH className="text-right">Montant</TH>
              <TH className="text-right">Action</TH>
            </TR>
          </THead>
          <TBody>
            {orders.map((o) => (
              <TR key={o.id}>
                <TD className="font-mono text-xs font-semibold">{o.reference}</TD>
                <TD className="max-w-[220px] truncate">
                  {o.firstDocument ?? "—"}
                  {o.itemsCount > 1 && <span className="text-muted-foreground"> +{o.itemsCount - 1}</span>}
                </TD>
                <TD className="text-muted-foreground">
                  {o.group ? "Groupée" : o.type === "SERVICE" ? "Prestation" : `Impression ${o.colorMode ? COLOR_LABELS[o.colorMode].toLowerCase() : ""}`}
                </TD>
                <TD>
                  <OrderStatusBadge status={o.status} />
                </TD>
                <TD className="text-muted-foreground">{formatDate(o.createdAt)}</TD>
                <TD className="text-right font-semibold">{fcfa(o.total)}</TD>
                <TD className="text-right">
                  <Button size="sm" variant="outline" asChild>
                    <Link href={`/espace/commandes/${o.id}`}>Voir</Link>
                  </Button>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </div>
    </>
  );
}
