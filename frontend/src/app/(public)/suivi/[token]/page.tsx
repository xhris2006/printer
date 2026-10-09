"use client";

import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { MapPin, PackageSearch, ShieldCheck } from "lucide-react";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";
import type { OrderStatus } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, Spinner } from "@/components/ui/feedback";
import { OrderStatusBadge } from "@/components/order/status-badge";
import { StatusTimeline } from "@/components/order/status-timeline";

interface Tracking {
  reference: string;
  status: OrderStatus;
  statusLabel: string;
  paid: boolean;
  fulfillmentMethod: "PICKUP" | "DELIVERY";
  itemsCount: number;
  pickupPoint: { name: string; address: string; hours: string | null } | null;
  timeline: { status: OrderStatus; label: string; at: string }[];
  createdAt: string;
  updatedAt: string;
}

export default function TrackingPage() {
  const { token } = useParams<{ token: string }>();
  const { data, isLoading, error } = useQuery({
    queryKey: ["tracking", token],
    queryFn: () => api<{ tracking: Tracking }>(`/tracking/${token}`).then((r) => r.tracking),
    refetchInterval: 60_000,
  });

  return (
    <div className="container-page max-w-2xl py-12">
      {isLoading && <Spinner />}
      {error && <EmptyState icon={PackageSearch} title="Lien de suivi invalide" description="Vérifiez le lien reçu ou connectez-vous à votre espace client pour retrouver votre commande." />}
      {data && (
        <Card>
          <CardHeader className="flex-row items-start justify-between gap-3">
            <div>
              <p className="text-xs text-muted-foreground">Suivi de commande</p>
              <CardTitle className="text-xl">{data.reference}</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                {data.itemsCount} document(s) · passée le {formatDate(data.createdAt)}
              </p>
            </div>
            <OrderStatusBadge status={data.status} />
          </CardHeader>
          <CardContent className="space-y-6">
            <StatusTimeline status={data.status} fulfillment={data.fulfillmentMethod} history={data.timeline.map((t) => ({ status: t.status, createdAt: t.at }))} />
            {data.pickupPoint && (
              <div className="flex items-start gap-3 rounded-lg bg-accent/60 p-4 text-sm">
                <MapPin className="mt-0.5 size-4 text-primary" />
                <div>
                  <p className="font-semibold">{data.pickupPoint.name}</p>
                  <p className="text-muted-foreground">{data.pickupPoint.address}</p>
                  {data.pickupPoint.hours && <p className="text-muted-foreground">{data.pickupPoint.hours}</p>}
                </div>
              </div>
            )}
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <ShieldCheck className="size-4" /> Ce lien n&apos;affiche ni vos documents, ni vos coordonnées, ni vos informations de paiement.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
