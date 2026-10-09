"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { FlaskConical } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, Spinner } from "@/components/ui/feedback";

/** Simulateur de paiement — disponible uniquement en développement (PAYMENT_PROVIDER=mock). */
function Simulator() {
  const paymentId = useSearchParams().get("payment") ?? "";
  const router = useRouter();
  const [loading, setLoading] = useState<"SUCCESSFUL" | "FAILED" | null>(null);
  const simulate = async (outcome: "SUCCESSFUL" | "FAILED") => {
    setLoading(outcome);
    try {
      await api(`/payments/${paymentId}/simulate`, { body: { outcome } });
      router.replace(`/paiement/retour?payment=${paymentId}`);
    } catch (error) {
      toast.error(errorMessage(error));
      setLoading(null);
    }
  };
  return (
    <Card className="border-amber-300">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FlaskConical className="size-5 text-amber-600" /> Simulateur de paiement
        </CardTitle>
        <CardDescription>Environnement de développement uniquement.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert variant="warning" title="MODE TEST — aucun argent réel">
          Ce simulateur remplace la page Fapshi lorsque les identifiants Fapshi ne sont pas configurés. Il est désactivé en production.
        </Alert>
        <div className="grid gap-2">
          <Button variant="success" onClick={() => simulate("SUCCESSFUL")} loading={loading === "SUCCESSFUL"} disabled={!paymentId || loading !== null}>
            Simuler un paiement réussi
          </Button>
          <Button variant="outline" onClick={() => simulate("FAILED")} loading={loading === "FAILED"} disabled={!paymentId || loading !== null}>
            Simuler un échec
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<Spinner />}>
      <Simulator />
    </Suspense>
  );
}
