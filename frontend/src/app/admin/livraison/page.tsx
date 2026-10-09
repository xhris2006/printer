"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MapPin, Plus, Trash2, Truck } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { fcfa } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader, Skeleton } from "@/components/ui/feedback";
import { Switch } from "@/components/ui/choice";
import { ActionDialog, type ActionConfig } from "@/components/admin/action-dialog";

interface Zone {
  id: string;
  name: string;
  fee: number;
  isActive: boolean;
}
interface Point {
  id: string;
  name: string;
  address: string;
  hours: string | null;
  phone: string | null;
  isActive: boolean;
  isDefault: boolean;
}

export default function DeliveryAdminPage() {
  const qc = useQueryClient();
  const [action, setAction] = useState<ActionConfig | null>(null);
  const zones = useQuery({ queryKey: ["admin", "zones"], queryFn: () => api<{ items: Zone[] }>("/admin/config/delivery-zones") });
  const points = useQuery({ queryKey: ["admin", "points"], queryFn: () => api<{ items: Point[] }>("/admin/config/pickup-points") });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["admin", "zones"] });
    qc.invalidateQueries({ queryKey: ["admin", "points"] });
    qc.invalidateQueries({ queryKey: ["public-config"] });
  };
  const run = async (fn: () => Promise<unknown>, msg: string) => {
    try {
      await fn();
      toast.success(msg);
      refresh();
    } catch (e) {
      toast.error(errorMessage(e));
      throw e;
    }
  };
  const zoneDialog = (z?: Zone) =>
    setAction({
      title: z ? `Modifier ${z.name}` : "Nouvelle zone de livraison",
      description: "Les frais s'appliquent aux nouvelles commandes. Aucun supplément express automatique.",
      confirmLabel: "Enregistrer",
      fields: [
        { name: "name", label: "Quartier / zone", required: true, minLength: 2, defaultValue: z?.name },
        { name: "fee", label: "Frais (FCFA)", type: "number", required: true, defaultValue: z?.fee?.toString() },
      ],
      onSubmit: (v) =>
        run(
          () =>
            z
              ? api(`/admin/config/delivery-zones/${z.id}`, { method: "PATCH", body: { name: v.name, fee: Number(v.fee) } })
              : api("/admin/config/delivery-zones", { body: { name: v.name, fee: Number(v.fee) } }),
          "Zone enregistrée.",
        ),
    });
  const pointDialog = (p?: Point) =>
    setAction({
      title: p ? `Modifier ${p.name}` : "Nouveau point de retrait",
      confirmLabel: "Enregistrer",
      fields: [
        { name: "name", label: "Nom", required: true, minLength: 2, defaultValue: p?.name },
        { name: "address", label: "Adresse", required: true, minLength: 2, defaultValue: p?.address },
        { name: "hours", label: "Horaires (facultatif)", defaultValue: p?.hours ?? "" },
        { name: "phone", label: "Téléphone (facultatif)", defaultValue: p?.phone ?? "" },
      ],
      onSubmit: (v) => {
        const body = { name: v.name, address: v.address, hours: v.hours || null, phone: v.phone || null };
        return run(() => (p ? api(`/admin/config/pickup-points/${p.id}`, { method: "PATCH", body }) : api("/admin/config/pickup-points", { body })), "Point de retrait enregistré.");
      },
    });

  return (
    <div className="space-y-6">
      <PageHeader title="Retrait & livraison" description="Points de retrait, zones et frais de livraison. Le tarif par défaut des quartiers non listés se règle dans Paramètres." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-start justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <MapPin className="size-5 text-primary" /> Points de retrait
              </CardTitle>
              <CardDescription>Au moins un point doit rester actif.</CardDescription>
            </div>
            <Button size="sm" onClick={() => pointDialog()}>
              <Plus /> Ajouter
            </Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {points.isLoading ? (
              <Skeleton className="h-24" />
            ) : (
              points.data?.items.map((p) => (
                <div key={p.id} className="flex items-start justify-between gap-3 rounded-lg border p-3">
                  <div className="text-sm">
                    <p className="font-semibold">
                      {p.name} {p.isDefault && <Badge>Par défaut</Badge>}
                    </p>
                    <p className="text-muted-foreground">{p.address}</p>
                    {p.hours && <p className="text-xs text-muted-foreground">{p.hours}</p>}
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <Switch checked={p.isActive} onChange={(v) => run(() => api(`/admin/config/pickup-points/${p.id}`, { method: "PATCH", body: { isActive: v } }), "Mis à jour.").catch(() => undefined)} label="Actif" />
                    <div className="flex gap-1">
                      {!p.isDefault && (
                        <Button size="sm" variant="ghost" onClick={() => run(() => api(`/admin/config/pickup-points/${p.id}`, { method: "PATCH", body: { isDefault: true } }), "Point par défaut modifié.").catch(() => undefined)}>
                          Par défaut
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => pointDialog(p)}>
                        Modifier
                      </Button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row items-start justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Truck className="size-5 text-primary" /> Zones de livraison
              </CardTitle>
              <CardDescription>Sans zone ni tarif par défaut, les frais sont « à confirmer » et le paiement attend votre validation.</CardDescription>
            </div>
            <Button size="sm" onClick={() => zoneDialog()}>
              <Plus /> Ajouter
            </Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {zones.isLoading ? (
              <Skeleton className="h-24" />
            ) : zones.data?.items.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">Aucune zone configurée.</p>
            ) : (
              zones.data?.items.map((z) => (
                <div key={z.id} className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
                  <div>
                    <p className="font-semibold">{z.name}</p>
                    <p className="text-muted-foreground">{fcfa(z.fee)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch checked={z.isActive} onChange={(v) => run(() => api(`/admin/config/delivery-zones/${z.id}`, { method: "PATCH", body: { isActive: v } }), "Mis à jour.").catch(() => undefined)} label="Active" />
                    <Button size="sm" variant="ghost" onClick={() => zoneDialog(z)}>
                      Modifier
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label="Supprimer"
                      onClick={() => window.confirm(`Supprimer la zone ${z.name} ?`) && run(() => api(`/admin/config/delivery-zones/${z.id}`, { method: "DELETE" }), "Zone supprimée.").catch(() => undefined)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
      <ActionDialog action={action} onClose={() => setAction(null)} />
    </div>
  );
}
