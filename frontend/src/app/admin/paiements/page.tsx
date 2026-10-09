"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Wallet } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { fcfa, formatDate } from "@/lib/format";
import { PAYMENT_STATUS_LABELS } from "@/lib/labels";
import type { Paginated, Payment } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState, PageHeader, Skeleton, Spinner } from "@/components/ui/feedback";
import { NativeSelect } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Pagination } from "@/components/ui/navigation";
import { PaymentStatusBadge } from "@/components/order/status-badge";
import { ActionDialog, type ActionConfig } from "@/components/admin/action-dialog";

type Row = Payment & {
  declaredBy: string | null;
  verifiedBy: string | null;
  verifiedAt: string | null;
  order: { id: string; reference: string; customer: { fullName: string; phone: string } };
};

function PaymentsAdmin() {
  const params = useSearchParams();
  const qc = useQueryClient();
  const [status, setStatus] = useState(params.get("status") ?? "");
  const [provider, setProvider] = useState("");
  const [duplicates] = useState(params.get("duplicates") === "true");
  const [page, setPage] = useState(1);
  const [action, setAction] = useState<ActionConfig | null>(null);
  const query = `page=${page}${status ? `&status=${status}` : ""}${provider ? `&provider=${provider}` : ""}${duplicates ? "&duplicates=true" : ""}`;
  const { data, isLoading } = useQuery({ queryKey: ["admin", "payments", query], queryFn: () => api<Paginated<Row>>(`/admin/payments?${query}`) });
  const refresh = () => qc.invalidateQueries({ queryKey: ["admin", "payments"] });

  const review = (p: Row, approve: boolean) =>
    setAction({
      title: approve ? "Confirmer le paiement déclaré" : "Rejeter le paiement déclaré",
      description: `${p.order.reference} — ${fcfa(p.amount)} déclaré par ${p.declaredBy ?? "?"}. ${approve ? "Confirmez uniquement après avoir constaté la réception des fonds." : ""}`,
      confirmLabel: approve ? "Confirmer" : "Rejeter",
      destructive: !approve,
      fields: [{ name: "note", label: "Note de vérification", type: "textarea", required: true, minLength: 3 }],
      onSubmit: async (v) => {
        try {
          await api(`/admin/payments/${p.id}/review`, { body: { approve, note: v.note } });
          toast.success(approve ? "Paiement confirmé." : "Paiement rejeté.");
          refresh();
        } catch (e) {
          toast.error(errorMessage(e));
          throw e;
        }
      },
    });
  const sync = async (p: Row) => {
    try {
      const r = await api<{ payment: Payment }>(`/admin/payments/${p.id}/sync`, { body: {} });
      toast.success(`Statut Fapshi : ${PAYMENT_STATUS_LABELS[r.payment.status]}`);
      refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Paiements" description={duplicates ? "Paiements reçus en double (à rembourser)." : "Tentatives Fapshi, déclarations en espèces et vérifications."} />
      <div className="flex flex-col gap-2 sm:flex-row">
        <NativeSelect value={status} onChange={(e) => setStatus(e.target.value)} className="sm:max-w-[240px]">
          <option value="">Tous les statuts</option>
          {Object.entries(PAYMENT_STATUS_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect value={provider} onChange={(e) => setProvider(e.target.value)} className="sm:max-w-[200px]">
          <option value="">Tous les moyens</option>
          <option value="FAPSHI">Fapshi</option>
          <option value="CASH">Espèces</option>
          <option value="MOCK">Simulateur</option>
        </NativeSelect>
      </div>
      <Card>
        <CardContent className="pt-5">
          {isLoading ? (
            <Skeleton className="h-48" />
          ) : !data || data.items.length === 0 ? (
            <EmptyState icon={Wallet} title="Aucun paiement" />
          ) : (
            <>
              <Table>
                <THead>
                  <TR>
                    <TH>Date</TH>
                    <TH>Commande</TH>
                    <TH>Moyen</TH>
                    <TH>Statut</TH>
                    <TH className="text-right">Montant</TH>
                    <TH />
                  </TR>
                </THead>
                <TBody>
                  {data.items.map((p) => (
                    <TR key={p.id}>
                      <TD className="text-xs text-muted-foreground">{formatDate(p.createdAt, true)}</TD>
                      <TD>
                        <Link href={`/admin/commandes/${p.order.id}`} className="font-mono text-xs font-semibold text-primary hover:underline">
                          {p.order.reference}
                        </Link>
                        <p className="text-xs">{p.order.customer.fullName}</p>
                      </TD>
                      <TD className="text-xs">
                        {p.provider}
                        {p.environment !== "LIVE" && <span className="text-amber-700"> ({p.environment})</span>}
                        {p.providerTransId && <p className="font-mono text-[11px] text-muted-foreground">{p.providerTransId}</p>}
                        {p.declarationNote && <p className="text-muted-foreground">{p.declarationNote}</p>}
                        {p.declaredBy && <p className="text-muted-foreground">Déclaré par {p.declaredBy}</p>}
                        {p.verifiedBy && <p className="text-muted-foreground">Vérifié par {p.verifiedBy}</p>}
                      </TD>
                      <TD>
                        <PaymentStatusBadge status={p.status} duplicate={p.isDuplicate} />
                        {p.failureReason && <p className="mt-1 max-w-[220px] text-xs text-red-700">{p.failureReason}</p>}
                      </TD>
                      <TD className="text-right font-semibold">{fcfa(p.amount)}</TD>
                      <TD className="text-right whitespace-nowrap">
                        {p.status === "PENDING_VERIFICATION" && (
                          <>
                            <Button size="sm" variant="success" onClick={() => review(p, true)}>
                              Confirmer
                            </Button>{" "}
                            <Button size="sm" variant="ghost" onClick={() => review(p, false)}>
                              Rejeter
                            </Button>
                          </>
                        )}
                        {["CREATED", "PENDING"].includes(p.status) && p.provider !== "CASH" && (
                          <Button size="sm" variant="ghost" onClick={() => sync(p)}>
                            <RefreshCw /> Revérifier
                          </Button>
                        )}
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
      <ActionDialog action={action} onClose={() => setAction(null)} />
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<Spinner />}>
      <PaymentsAdmin />
    </Suspense>
  );
}
