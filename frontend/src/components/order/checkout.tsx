"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { FilePen, ShieldCheck, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { fcfa, formatPhone } from "@/lib/format";
import { useMe, usePublicConfig } from "@/lib/hooks";
import type { Order, Payment, PublicConfig } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/input";
import { ChoiceGroup } from "@/components/ui/choice";
import { Tabs } from "@/components/ui/navigation";

/** Ce que le client peut faire pour valider un brouillon. */
export type CheckoutMode = "PAY" | "FEE_PENDING" | "BELOW_MIN" | "PAYMENTS_DISABLED";

export function checkoutMode(order: Pick<Order, "total">, config: PublicConfig): CheckoutMode {
  if (order.total === null) return "FEE_PENDING";
  if (!config.payments.enabled) return "PAYMENTS_DISABLED";
  if (order.total < config.payments.minAmount) return "BELOW_MIN";
  return "PAY";
}

export function checkoutLabel(mode: CheckoutMode, total: number | null) {
  switch (mode) {
    case "PAY":
      return `Payer ${fcfa(total)} et valider`;
    case "FEE_PENDING":
      return "Envoyer pour confirmation des frais";
    case "PAYMENTS_DISABLED":
      return "Valider la commande";
    case "BELOW_MIN":
      return "Montant minimum non atteint";
  }
}

export interface PaymentChoice {
  method: "CHECKOUT" | "DIRECT";
  phone: string;
  medium: "mobile money" | "orange money";
}

export function usePaymentChoice(): [PaymentChoice, (c: PaymentChoice) => void] {
  const { data: me } = useMe();
  const [choice, setChoice] = useState<PaymentChoice | null>(null);
  const value: PaymentChoice = choice ?? { method: "CHECKOUT", phone: me ? formatPhone(me.phone) : "", medium: "mobile money" };
  return [value, setChoice];
}

/** Lancement du paiement (le brouillon n'est figé qu'à ce moment) ou envoi sans paiement en ligne. */
export function useCheckout() {
  const router = useRouter();
  const qc = useQueryClient();
  const [loading, setLoading] = useState<"pay" | "submit" | null>(null);

  const pay = async (order: Order, choice: PaymentChoice) => {
    setLoading("pay");
    try {
      const body = choice.method === "DIRECT" ? { method: "DIRECT", phone: choice.phone, medium: choice.medium } : { method: "CHECKOUT" };
      const res = await api<{ payment: Payment; redirectUrl: string | null }>(`/orders/${order.id}/checkout`, { body });
      qc.invalidateQueries({ queryKey: ["orders"] });
      if (res.redirectUrl) {
        window.location.assign(res.redirectUrl);
        return;
      }
      toast.success("Validez le paiement sur votre téléphone.");
      router.push(`/paiement/retour?payment=${res.payment.id}`);
    } catch (error) {
      toast.error(errorMessage(error));
      // Si la commande a malgré tout été figée (tarif modifié, service de paiement indisponible…),
      // le client retrouve la commande pour relancer le paiement.
      const latest = await api<{ order: Order }>(`/orders/${order.id}`).catch(() => null);
      if (latest && latest.order.status !== "DRAFT") router.push(`/espace/commandes/${order.id}`);
      setLoading(null);
    }
  };

  const submit = async (order: Order, mode: CheckoutMode) => {
    setLoading("submit");
    try {
      await api<{ order: Order }>(`/orders/${order.id}/confirm`, { body: {} });
      qc.invalidateQueries({ queryKey: ["orders"] });
      toast.success(
        mode === "FEE_PENDING"
          ? "Demande envoyée : vous serez notifié dès que les frais de livraison seront confirmés pour payer."
          : "Commande transmise : contactez l'assistance pour la régler et la valider.",
      );
      router.push(`/espace/commandes/${order.id}`);
    } catch (error) {
      toast.error(errorMessage(error));
      setLoading(null);
    }
  };

  const run = (order: Order, mode: CheckoutMode, choice: PaymentChoice) => (mode === "PAY" ? pay(order, choice) : submit(order, mode));
  return { run, loading };
}

/** Choix du moyen de paiement (lien Fapshi, ou paiement direct si activé). */
export function PaymentMethodPicker({ value, onChange, config }: { value: PaymentChoice; onChange: (c: PaymentChoice) => void; config: PublicConfig }) {
  return (
    <div className="space-y-3">
      {config.payments.directPay && (
        <Tabs
          value={value.method}
          onChange={(method) => onChange({ ...value, method })}
          options={[
            { value: "CHECKOUT", label: "Page Fapshi" },
            { value: "DIRECT", label: "Paiement direct" },
          ]}
        />
      )}
      {value.method === "DIRECT" ? (
        <div className="space-y-3">
          <ChoiceGroup
            ariaLabel="Opérateur"
            value={value.medium}
            onChange={(medium) => onChange({ ...value, medium })}
            options={[
              { value: "mobile money", label: "MTN Mobile Money" },
              { value: "orange money", label: "Orange Money" },
            ]}
          />
          <Field label="Numéro à débiter" htmlFor="pay-phone">
            <Input id="pay-phone" type="tel" inputMode="tel" autoComplete="tel" value={value.phone} onChange={(e) => onChange({ ...value, phone: e.target.value })} />
          </Field>
        </div>
      ) : (
        <p className="flex items-start gap-2 text-sm text-muted-foreground">
          <Smartphone className="mt-0.5 size-4 shrink-0" aria-hidden /> Paiement sécurisé sur la page Fapshi (MTN Mobile Money ou Orange Money), puis retour automatique ici.
        </p>
      )}
    </div>
  );
}

/** Explication adaptée à la situation du brouillon. */
export function CheckoutNotice({ mode, config }: { mode: CheckoutMode; config: PublicConfig }) {
  if (mode === "FEE_PENDING") {
    return (
      <Alert variant="warning" title="Frais de livraison à confirmer">
        Envoyez votre commande : notre équipe confirme les frais, puis vous payez pour la valider.
      </Alert>
    );
  }
  if (mode === "BELOW_MIN") {
    return (
      <Alert variant="warning" title="Montant trop faible pour le paiement en ligne">
        Le paiement Fapshi nécessite au moins {fcfa(config.payments.minAmount)}. Ajoutez des documents ou des exemplaires, ou enregistrez le brouillon.
      </Alert>
    );
  }
  if (mode === "PAYMENTS_DISABLED") {
    return (
      <Alert variant="warning" title="Paiement en ligne indisponible">
        Validez la commande puis contactez l&apos;assistance WhatsApp pour la régler : elle ne sera imprimée qu&apos;après paiement.
      </Alert>
    );
  }
  return (
    <p className="flex items-start gap-2 text-sm text-slate-600">
      <ShieldCheck className="mt-0.5 size-4 shrink-0 text-green-600" aria-hidden /> Votre commande est validée dès que le paiement est confirmé. Tant que vous ne payez pas, elle reste un brouillon modifiable.
    </p>
  );
}

/** Carte « Valider ma commande » affichée sur un brouillon (page de détail). */
export function DraftCheckoutCard({ order }: { order: Order }) {
  const { data: config } = usePublicConfig();
  const [choice, setChoice] = usePaymentChoice();
  const { run, loading } = useCheckout();
  if (!config) return null;
  const mode = checkoutMode(order, config);
  return (
    <Card className="border-primary/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FilePen className="size-5 text-primary" /> Brouillon — à valider
        </CardTitle>
        <CardDescription>Cette commande n&apos;est pas encore validée : payez pour la lancer, ou modifiez-la.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-baseline justify-between rounded-lg bg-accent/60 px-4 py-3">
          <span className="text-sm font-medium">Total</span>
          <span className="text-2xl font-bold text-primary">{fcfa(order.total)}</span>
        </div>
        {config.payments.testMode && mode === "PAY" && <Alert variant="warning" title="Mode test">Aucun argent réel ne sera prélevé.</Alert>}
        {mode === "PAY" && <PaymentMethodPicker value={choice} onChange={setChoice} config={config} />}
        <CheckoutNotice mode={mode} config={config} />
        <div className="grid gap-2 sm:grid-cols-2">
          <Button size="lg" onClick={() => run(order, mode, choice)} loading={loading !== null} disabled={mode === "BELOW_MIN"}>
            {checkoutLabel(mode, order.total)}
          </Button>
          <Button size="lg" variant="outline" asChild>
            <Link href={`/espace/commandes/nouvelle?brouillon=${order.id}`}>Modifier le brouillon</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
