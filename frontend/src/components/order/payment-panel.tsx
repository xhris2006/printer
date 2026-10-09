"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CreditCard, FlaskConical, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { fcfa } from "@/lib/format";
import { usePublicConfig } from "@/lib/hooks";
import type { Order, Payment } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/input";
import { ChoiceGroup } from "@/components/ui/choice";
import { Tabs } from "@/components/ui/navigation";

/** Paiement Fapshi : lien de paiement sécurisé (toutes méthodes) ou paiement direct Mobile Money si activé. */
export function PaymentPanel({ order }: { order: Order }) {
  const router = useRouter();
  const { data: config } = usePublicConfig();
  const [mode, setMode] = useState<"CHECKOUT" | "DIRECT">("CHECKOUT");
  const [phone, setPhone] = useState(order.customer?.phone ?? "");
  const [medium, setMedium] = useState<"mobile money" | "orange money">("mobile money");
  const [loading, setLoading] = useState(false);

  const pending = order.payments.find((p) => p.status === "PENDING_VERIFICATION");

  if (!order.canPay) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="size-5 text-primary" /> Paiement
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Alert variant={pending ? "info" : "warning"}>{pending ? "Un paiement déclaré est en cours de vérification par notre équipe." : order.paymentBlockedReason}</Alert>
        </CardContent>
      </Card>
    );
  }

  const pay = async () => {
    setLoading(true);
    try {
      const body = mode === "DIRECT" ? { method: "DIRECT", phone, medium } : { method: "CHECKOUT" };
      const res = await api<{ payment: Payment; redirectUrl: string | null }>(`/orders/${order.id}/payments`, { body });
      if (res.redirectUrl) {
        window.location.assign(res.redirectUrl);
        return;
      }
      toast.success("Demande envoyée : validez le paiement sur votre téléphone.");
      router.push(`/paiement/retour?payment=${res.payment.id}`);
    } catch (error) {
      toast.error(errorMessage(error));
      setLoading(false);
    }
  };

  return (
    <Card className="border-primary/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CreditCard className="size-5 text-primary" /> Paiement sécurisé
        </CardTitle>
        <CardDescription>L&apos;impression démarre uniquement après confirmation du paiement par Fapshi.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {config && !config.payments.enabled && (
          <Alert variant="warning" title="Paiement en ligne indisponible">
            Le paiement en ligne n&apos;est pas encore configuré. Contactez l&apos;assistance WhatsApp pour finaliser votre commande.
          </Alert>
        )}
        {config?.payments.testMode && (
          <Alert variant="warning" title="Mode test">
            <span className="inline-flex items-center gap-1">
              <FlaskConical className="size-3.5" /> Aucun argent réel ne sera prélevé.
            </span>
          </Alert>
        )}
        <div className="flex items-baseline justify-between rounded-lg bg-accent/60 px-4 py-3">
          <span className="text-sm font-medium">Montant à payer</span>
          <span className="text-2xl font-bold text-primary">{fcfa(order.total)}</span>
        </div>
        {config?.payments.directPay && (
          <Tabs
            value={mode}
            onChange={setMode}
            options={[
              { value: "CHECKOUT", label: "Page de paiement Fapshi" },
              { value: "DIRECT", label: "Paiement direct" },
            ]}
          />
        )}
        {mode === "DIRECT" ? (
          <div className="space-y-3">
            <ChoiceGroup
              ariaLabel="Opérateur"
              value={medium}
              onChange={setMedium}
              options={[
                { value: "mobile money", label: "MTN Mobile Money" },
                { value: "orange money", label: "Orange Money" },
              ]}
            />
            <Field label="Numéro à débiter" htmlFor="pay-phone">
              <Input id="pay-phone" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="6 XX XX XX XX" />
            </Field>
          </div>
        ) : (
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <Smartphone className="mt-0.5 size-4 shrink-0" /> Vous serez redirigé vers la page sécurisée Fapshi pour payer par Mobile Money ou Orange Money, puis ramené ici.
          </p>
        )}
        <Button size="lg" className="w-full" onClick={pay} loading={loading} disabled={!config?.payments.enabled}>
          Payer {fcfa(order.total)}
        </Button>
      </CardContent>
    </Card>
  );
}
