"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { CalendarClock, GraduationCap, Info, MapPin, Users } from "lucide-react";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { useMe } from "@/lib/hooks";
import { optionsSummary } from "@/lib/labels";
import type { GroupStatus, PrintOptions } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, EmptyState, Spinner } from "@/components/ui/feedback";
import { Badge } from "@/components/ui/badge";

interface PublicGroup {
  code: string;
  name: string;
  institution: string;
  field: string;
  level: string;
  className: string;
  category: string | null;
  instructions: string | null;
  delegateName: string;
  deadline: string | null;
  status: GroupStatus;
  statusLabel: string;
  acceptingContributions: boolean;
  defaultOptions: PrintOptions | null;
  pickupPoint: { name: string; address: string } | null;
}

export default function GroupInvitePage() {
  const { token } = useParams<{ token: string }>();
  const { data: user } = useMe();
  const { data, isLoading, error } = useQuery({
    queryKey: ["public-group", token],
    queryFn: () => api<{ group: PublicGroup }>(`/public/groups/${token}`).then((r) => r.group),
  });
  const target = `/espace/commandes/nouvelle?collecte=${encodeURIComponent(token)}`;

  return (
    <div className="container-page max-w-2xl py-12">
      {isLoading && <Spinner />}
      {error && <EmptyState icon={Users} title="Lien de collecte invalide" description="Ce lien n'existe pas ou a été renouvelé par le délégué. Demandez-lui le nouveau lien." />}
      {data && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <Badge variant={data.acceptingContributions ? "success" : "muted"}>{data.acceptingContributions ? "Collecte ouverte" : data.statusLabel}</Badge>
              <span className="text-xs text-muted-foreground">{data.code}</span>
            </div>
            <CardTitle className="mt-2 text-2xl">{data.name}</CardTitle>
            <p className="text-sm text-muted-foreground">Commande groupée organisée par {data.delegateName}, délégué(e) de classe.</p>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-3 text-sm sm:grid-cols-2">
              <p className="flex items-start gap-2">
                <GraduationCap className="mt-0.5 size-4 text-primary" />
                <span>
                  {data.institution}
                  <br />
                  <span className="text-muted-foreground">
                    {data.field} · {data.level} · {data.className}
                  </span>
                </span>
              </p>
              {data.deadline && (
                <p className="flex items-start gap-2">
                  <CalendarClock className="mt-0.5 size-4 text-primary" /> Date limite : {formatDate(data.deadline, true)}
                </p>
              )}
              {data.pickupPoint && (
                <p className="flex items-start gap-2">
                  <MapPin className="mt-0.5 size-4 text-primary" /> Remise au délégué · {data.pickupPoint.name}
                </p>
              )}
              {data.category && (
                <p className="flex items-start gap-2">
                  <Info className="mt-0.5 size-4 text-primary" /> {data.category}
                </p>
              )}
            </div>
            {data.defaultOptions && (
              <div className="rounded-lg bg-accent/60 p-3 text-sm">
                <span className="font-semibold">Paramètres du lot : </span>
                {optionsSummary(data.defaultOptions)}
              </div>
            )}
            {data.instructions && <Alert title="Instructions du délégué">{data.instructions}</Alert>}
            <Alert variant="info">
              Votre contribution est enregistrée à votre nom et payée individuellement (Mobile Money). Le délégué voit votre nom et le statut de paiement, pas vos fichiers.
            </Alert>
            {data.acceptingContributions ? (
              user ? (
                <Button size="lg" className="w-full" asChild>
                  <Link href={target}>Envoyer mes documents</Link>
                </Button>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  <Button size="lg" asChild>
                    <Link href={`/inscription?next=${encodeURIComponent(target)}`}>Créer un compte</Link>
                  </Button>
                  <Button size="lg" variant="outline" asChild>
                    <Link href={`/connexion?next=${encodeURIComponent(target)}`}>Se connecter</Link>
                  </Button>
                </div>
              )
            ) : (
              <Alert variant="warning">Cette collecte n&apos;accepte plus de contributions.</Alert>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
