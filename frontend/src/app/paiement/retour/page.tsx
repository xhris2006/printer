"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Clock, XCircle } from "lucide-react";
import { api } from "@/lib/api";
import { fcfa } from "@/lib/format";
import type { Order, Payment } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Spinner } from "@/components/ui/feedback";

/** Retour de la page Fapshi : le statut est revérifié côté serveur auprès de Fapshi. */
function PaymentReturn() {
  const paymentId = useSearchParams().get("payment") ?? "";
  const [startedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 3000);
    return () => clearInterval(t);
  }, []);
  const { data, error } = useQuery({
    queryKey: ["payment", paymentId],
    queryFn: () => api<{ payment: Payment; order: Order }>(`/payments/${paymentId}`),
    enabled: Boolean(paymentId),
    refetchInterval: (q) => {
      const s = q.state.data?.payment.status;
      return s && ["CREATED", "PENDING"].includes(s) && Date.now() - startedAt < 5 * 60_000 ? 3000 : false;
    },
  });

  if (!paymentId || error) {
    return (
      <Card>
        <CardContent className="space-y-4 pt-6 text-center">
          <p className="text-sm text-muted-foreground">Paiement introuvable. Consultez vos commandes pour vérifier son statut.</p>
          <Button asChild>
            <Link href="/espace/commandes">Voir mes commandes</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }
  if (!data) return <Spinner label="Vérification du paiement auprès de Fapshi…" />;

  const { payment, order } = data;
  const success = payment.status === "SUCCESSFUL" && !payment.isDuplicate;
  const failed = ["FAILED", "EXPIRED", "CANCELLED", "REJECTED"].includes(payment.status);
  const waitingLong = now - startedAt > 5 * 60_000;

  return (
    <Card className="animate-fade-up">
      <CardContent className="flex flex-col items-center gap-4 pt-8 pb-6 text-center">
        {success ? (
          <>
            <div className="flex size-16 items-center justify-center rounded-full bg-green-100 text-green-600">
              <CheckCircle2 className="size-9" />
            </div>
            <h1 className="text-xl font-bold">Commande envoyée !</h1>
            <p className="text-sm font-medium text-slate-700">Votre paiement de {fcfa(payment.amount)} est confirmé.</p>
            <p className="text-sm text-muted-foreground">
              Votre commande {order.reference} part en préparation. Vous recevrez une notification à chaque étape
              {order.pickupCode ? (
                <>
                  {" "}
                  — code de retrait : <strong className="font-mono">{order.pickupCode}</strong>
                </>
              ) : null}
              .
            </p>
          </>
        ) : failed ? (
          <>
            <div className="flex size-16 items-center justify-center rounded-full bg-red-100 text-red-600">
              <XCircle className="size-9" />
            </div>
            <h1 className="text-xl font-bold">Paiement non abouti</h1>
            <p className="text-sm text-muted-foreground">{payment.failureReason ?? "Le paiement a été refusé ou annulé."} Aucun montant n&apos;a été validé pour cette tentative.</p>
          </>
        ) : (
          <>
            <div className="flex size-16 items-center justify-center rounded-full bg-amber-100 text-amber-600">
              <Clock className="size-9" />
            </div>
            <h1 className="text-xl font-bold">Paiement en attente</h1>
            <p className="text-sm text-muted-foreground">
              {waitingLong
                ? "Nous n'avons pas encore reçu la confirmation. Si vous avez validé le paiement, il apparaîtra automatiquement dans votre commande dès sa confirmation."
                : "Validez le paiement sur votre téléphone si demandé. Cette page se met à jour automatiquement."}
            </p>
            {!waitingLong && <Spinner className="py-2" label="Vérification en cours…" />}
          </>
        )}
        <div className="grid w-full gap-2">
          <Button asChild>
            <Link href={`/espace/commandes/${order.id}`}>{failed ? "Réessayer le paiement" : "Voir ma commande"}</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/espace/commandes">Voir mes commandes</Link>
          </Button>
          <Button variant="ghost" asChild>
            <Link href="/">Retour à l&apos;accueil</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<Spinner />}>
      <PaymentReturn />
    </Suspense>
  );
}
