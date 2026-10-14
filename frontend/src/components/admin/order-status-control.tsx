"use client";

import { useState } from "react";
import { ArrowLeftRight, ChevronRight } from "lucide-react";
import { fcfa } from "@/lib/format";
import { ORDER_STATUS_LABELS } from "@/lib/labels";
import type { OrderStatus, Role, StatusChangeKind, StatusOption } from "@/lib/types";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { OrderStatusBadge } from "@/components/order/status-badge";
import { ActionDialog, type ActionConfig } from "./action-dialog";

/** Commande visée par un changement de statut (fiche ou ligne de liste). */
export interface StatusTarget {
  id: string;
  reference: string;
  status: OrderStatus;
  total: number | null;
  amountPaid: number;
  customerName?: string;
  recipientName?: string | null;
}

/** Appel d'une action d'administration de la commande : `/admin/orders/:id/<path>`. */
export type StatusSubmit = (path: string, body: unknown, success: string) => Promise<void>;

const HINTS: Record<StatusChangeKind, string> = {
  DIRECT: "",
  HANDOVER: "Avec code de retrait",
  DELIVER: "Avec nom du réceptionnaire",
  DELIVERY_FAILED: "Motif requis",
  CASH: "Espèces réellement reçues",
  CANCEL: "Motif requis",
  REFUND: "Remboursement effectué",
};

/** Boîte de dialogue adaptée au changement demandé (preuve, motif ou simple confirmation). */
export function statusChangeAction(target: StatusTarget, option: Pick<StatusOption, "status" | "kind" | "correction">, submit: StatusSubmit): ActionConfig {
  const label = ORDER_STATUS_LABELS[option.status];
  switch (option.kind) {
    case "HANDOVER":
      return {
        title: "Remise au client",
        description: "Saisissez le code de retrait présenté par le client. Sans code, décrivez la vérification effectuée.",
        confirmLabel: "Confirmer la remise",
        fields: [
          { name: "code", label: "Code de retrait (6 chiffres)" },
          { name: "recipientName", label: "Nom de la personne qui retire", required: true, minLength: 2, defaultValue: target.customerName },
          { name: "note", label: "Vérification (si pas de code)", type: "textarea" },
        ],
        onSubmit: (v) => submit("handover", { code: v.code || undefined, recipientName: v.recipientName, note: v.note || undefined }, "Commande remise."),
      };
    case "DELIVER":
      return {
        title: "Livraison effectuée",
        confirmLabel: "Confirmer la livraison",
        fields: [
          { name: "receivedBy", label: "Reçue par", required: true, minLength: 2, defaultValue: target.recipientName ?? undefined },
          { name: "note", label: "Preuve / remarque", type: "textarea" },
        ],
        onSubmit: (v) => submit("deliver", { receivedBy: v.receivedBy, note: v.note || undefined }, "Livraison enregistrée."),
      };
    case "DELIVERY_FAILED":
      return {
        title: "Livraison échouée",
        description: "La commande repassera « Prête à retirer ».",
        confirmLabel: "Enregistrer",
        fields: [{ name: "note", label: "Motif", type: "textarea", required: true, minLength: 5 }],
        onSubmit: (v) => submit("delivery-failed", { note: v.note }, "Livraison échouée enregistrée."),
      };
    case "CASH":
      return {
        title: "Encaissement en espèces",
        description: `Montant : ${fcfa(target.total)}. Confirmez uniquement si l'argent a bien été reçu : la commande passera « Paiement confirmé ».`,
        confirmLabel: "Confirmer l'encaissement",
        fields: [{ name: "note", label: "Note (reçu, personne…)", required: true, minLength: 3 }],
        onSubmit: (v) => submit("cash-payment", { note: v.note }, "Paiement enregistré."),
      };
    case "CANCEL":
      return {
        title: "Annuler la commande",
        description: target.amountPaid > 0 ? "La commande est payée : consignez ensuite le remboursement effectué." : undefined,
        confirmLabel: "Annuler la commande",
        destructive: true,
        fields: [{ name: "reason", label: "Motif (communiqué au client)", type: "textarea", required: true, minLength: 5 }],
        onSubmit: (v) => submit("cancel", { reason: v.reason }, "Commande annulée."),
      };
    case "REFUND":
      return {
        title: "Consigner un remboursement",
        description: "Fapshi ne propose pas d'API de remboursement : effectuez le remboursement (transfert Mobile Money, espèces…) puis enregistrez-le ici.",
        confirmLabel: "Enregistrer",
        fields: [
          { name: "amount", label: "Montant remboursé (FCFA)", type: "number", required: true, defaultValue: target.amountPaid.toString() },
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
        onSubmit: (v) => submit("refund", { amount: Number(v.amount), method: v.method, reference: v.reference || undefined, note: v.note }, "Remboursement consigné."),
      };
    case "DIRECT":
      if (option.correction) {
        return {
          title: `Revenir à « ${label} »`,
          description: "Correction d'une erreur : le client est prévenu avec le motif ci-dessous. Action journalisée.",
          confirmLabel: "Corriger le statut",
          destructive: true,
          fields: [{ name: "note", label: "Motif (communiqué au client)", type: "textarea", required: true, minLength: 5 }],
          onSubmit: (v) => submit("status", { status: option.status, note: v.note }, `Statut corrigé : ${label}`),
        };
      }
      return {
        title: `Passer à « ${label} »`,
        description:
          option.status === "READY_FOR_PICKUP"
            ? "Le client est prévenu que sa commande est prête, avec son code de retrait."
            : option.status === "OUT_FOR_DELIVERY"
              ? "Le client est prévenu que sa commande est en route."
              : "Le client suit l'avancement depuis son espace.",
        confirmLabel: "Mettre à jour",
        fields: [{ name: "note", label: "Note (historique, facultatif)", type: "textarea" }],
        onSubmit: (v) => submit("status", { status: option.status, note: v.note || undefined }, `Statut : ${label}`),
      };
  }
}

/** Bouton « Changer le statut » : liste des statuts possibles, puis la saisie adaptée. */
export function StatusChangeButton({
  target,
  options,
  role,
  submit,
  label = "Changer le statut",
  ...buttonProps
}: { target: StatusTarget; options: StatusOption[] | undefined; role?: Role; submit: StatusSubmit; label?: string } & Omit<ButtonProps, "onClick">) {
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState<ActionConfig | null>(null);
  const visible = (options ?? []).filter((o) => role === "ADMIN" || !o.adminOnly);
  if (visible.length === 0) return null;

  const isOther = (o: StatusOption) => o.kind === "CANCEL" || o.kind === "REFUND" || o.kind === "DELIVERY_FAILED";
  const groups = [
    { title: "Avancer", items: visible.filter((o) => !o.correction && !isOther(o)) },
    { title: "Corriger une erreur (revenir en arrière)", items: visible.filter((o) => o.correction) },
    { title: "Autres", items: visible.filter(isOther) },
  ].filter((g) => g.items.length > 0);

  return (
    <>
      <Button {...buttonProps} onClick={() => setOpen(true)}>
        <ArrowLeftRight /> {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Changer le statut — {target.reference}</DialogTitle>
            <DialogDescription>
              Statut actuel : <strong>{ORDER_STATUS_LABELS[target.status]}</strong>
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] space-y-4 overflow-y-auto">
            {groups.map((g) => (
              <div key={g.title} className="space-y-2">
                <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{g.title}</p>
                <ul className="space-y-2">
                  {g.items.map((o) => (
                    <li key={`${o.status}-${o.kind}`}>
                      <button
                        type="button"
                        className="flex min-h-12 w-full items-center justify-between gap-3 rounded-lg border bg-white px-3 py-2.5 text-left transition hover:border-primary/40 hover:bg-accent/50"
                        onClick={() => {
                          setOpen(false);
                          setAction(statusChangeAction(target, o, submit));
                        }}
                        aria-label={`Passer à ${o.label}`}
                      >
                        <span className="flex flex-wrap items-center gap-2">
                          <OrderStatusBadge status={o.status} />
                          {(HINTS[o.kind] || o.correction) && (
                            <span className="text-xs text-muted-foreground">{o.correction ? "Motif requis, client prévenu" : HINTS[o.kind]}</span>
                          )}
                        </span>
                        <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
      <ActionDialog action={action} onClose={() => setAction(null)} />
    </>
  );
}
