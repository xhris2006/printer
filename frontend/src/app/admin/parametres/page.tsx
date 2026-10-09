"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorState, PageHeader, Skeleton } from "@/components/ui/feedback";
import { Field, Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Switch } from "@/components/ui/choice";
import { Badge } from "@/components/ui/badge";
import { ActionDialog, type ActionConfig } from "@/components/admin/action-dialog";

type Settings = {
  "uploads.maxFileSizeMb": number;
  "uploads.maxFilesPerOrder": number;
  "uploads.maxTotalSizeMb": number;
  "delivery.enabled": boolean;
  "delivery.defaultFee": number | null;
  "pickup.reminderAfterDays": number;
  "pickup.reminderIntervalDays": number;
  "pickup.maxReminders": number;
  "pickup.holdDays": number;
  "pickup.policyText": string;
  "documents.retentionDays": number;
  "groups.defaultProductionRule": "FULL_PAYMENT" | "PAID_ONLY";
  "delegates.autoApprove": boolean;
};
interface Service {
  id: string;
  code: string;
  name: string;
  description: string;
  pricingMode: "QUOTE" | "PRINT_FLOW";
  isActive: boolean;
  sortOrder: number;
}

const NUMBERS: { key: keyof Settings; label: string; hint?: string }[] = [
  { key: "uploads.maxFileSizeMb", label: "Taille maximale par fichier (Mo)" },
  { key: "uploads.maxFilesPerOrder", label: "Fichiers maximum par commande" },
  { key: "uploads.maxTotalSizeMb", label: "Taille totale maximale par commande (Mo)" },
  { key: "pickup.reminderAfterDays", label: "Premier rappel de retrait après (jours)" },
  { key: "pickup.reminderIntervalDays", label: "Intervalle entre rappels (jours)" },
  { key: "pickup.maxReminders", label: "Nombre maximal de rappels" },
  { key: "pickup.holdDays", label: "Durée de conservation des commandes prêtes (jours)", hint: "Au-delà, la commande est signalée « en retard » dans l'administration." },
  { key: "documents.retentionDays", label: "Conservation des fichiers après la commande (jours)", hint: "Les fichiers sont ensuite supprimés automatiquement." },
];

export default function SettingsAdminPage() {
  const qc = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["admin", "settings"], queryFn: () => api<{ settings: Settings }>("/admin/config/settings").then((r) => r.settings) });
  const services = useQuery({ queryKey: ["admin", "services"], queryFn: () => api<{ items: Service[] }>("/admin/config/services") });
  const [draft, setDraft] = useState<Partial<Settings>>({});
  const [saving, setSaving] = useState(false);
  const [action, setAction] = useState<ActionConfig | null>(null);
  if (isLoading) return <Skeleton className="h-96" />;
  if (error || !data) return <ErrorState message="Paramètres indisponibles." onRetry={() => refetch()} />;
  const s = { ...data, ...draft };
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const save = async () => {
    setSaving(true);
    try {
      await api("/admin/config/settings", { method: "PUT", body: draft });
      toast.success("Paramètres enregistrés.");
      setDraft({});
      qc.invalidateQueries({ queryKey: ["admin", "settings"] });
      qc.invalidateQueries({ queryKey: ["public-config"] });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };
  const serviceDialog = (svc?: Service) =>
    setAction({
      title: svc ? `Modifier « ${svc.name} »` : "Nouvelle prestation",
      confirmLabel: "Enregistrer",
      fields: [
        ...(svc ? [] : [{ name: "code", label: "Code (MAJUSCULES, ex. TRADUCTION)", required: true, minLength: 2 }]),
        { name: "name", label: "Nom", required: true, minLength: 2, defaultValue: svc?.name },
        { name: "description", label: "Description", type: "textarea", required: true, minLength: 5, defaultValue: svc?.description },
        {
          name: "pricingMode",
          label: "Tarification",
          type: "select",
          defaultValue: svc?.pricingMode ?? "QUOTE",
          options: [
            { value: "QUOTE", label: "Sur devis" },
            { value: "PRINT_FLOW", label: "Commande d'impression (prix automatique)" },
          ],
        },
      ] as ActionConfig["fields"],
      onSubmit: async (v) => {
        try {
          if (svc) await api(`/admin/config/services/${svc.id}`, { method: "PATCH", body: { name: v.name, description: v.description, pricingMode: v.pricingMode } });
          else await api("/admin/config/services", { body: { code: v.code.toUpperCase(), name: v.name, description: v.description, pricingMode: v.pricingMode } });
          toast.success("Prestation enregistrée.");
          services.refetch();
          qc.invalidateQueries({ queryKey: ["public-config"] });
        } catch (e) {
          toast.error(errorMessage(e));
          throw e;
        }
      },
    });

  return (
    <div className="space-y-6">
      <PageHeader title="Paramètres" description="Limites de téléversement, livraison, rappels de retrait et politique de conservation." actions={<Button onClick={save} loading={saving} disabled={Object.keys(draft).length === 0}>Enregistrer</Button>} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Documents et rappels</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            {NUMBERS.map((n) => (
              <Field key={n.key} label={n.label} htmlFor={n.key} hint={n.hint}>
                <Input id={n.key} type="number" min={0} value={String(s[n.key] ?? "")} onChange={(e) => set(n.key, Number(e.target.value) as never)} />
              </Field>
            ))}
          </CardContent>
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Livraison</CardTitle>
              <CardDescription>Tarif appliqué aux quartiers sans zone configurée. Vide = « à confirmer » (paiement bloqué jusqu&apos;à validation).</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between rounded-lg border p-3">
                <span className="text-sm">Livraison proposée aux clients</span>
                <Switch checked={s["delivery.enabled"]} onChange={(v) => set("delivery.enabled", v)} label="Livraison activée" />
              </div>
              <Field label="Frais de livraison par défaut (FCFA)" htmlFor="dfee">
                <Input id="dfee" type="number" min={0} placeholder="À confirmer" value={s["delivery.defaultFee"] ?? ""} onChange={(e) => set("delivery.defaultFee", e.target.value === "" ? null : Number(e.target.value))} />
              </Field>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Retrait et délégués</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Field label="Politique de conservation (affichée au client)" htmlFor="pol">
                <Textarea id="pol" rows={3} value={s["pickup.policyText"]} onChange={(e) => set("pickup.policyText", e.target.value)} />
              </Field>
              <Field label="Règle de collecte par défaut des groupes" htmlFor="rule">
                <NativeSelect id="rule" value={s["groups.defaultProductionRule"]} onChange={(e) => set("groups.defaultProductionRule", e.target.value as Settings["groups.defaultProductionRule"])}>
                  <option value="FULL_PAYMENT">Paiement intégral avant production</option>
                  <option value="PAID_ONLY">Seules les contributions payées sont imprimées</option>
                </NativeSelect>
              </Field>
              <div className="flex items-center justify-between rounded-lg border p-3">
                <span className="text-sm">Approuver automatiquement les demandes de délégué</span>
                <Switch checked={s["delegates.autoApprove"]} onChange={(v) => set("delegates.autoApprove", v)} label="Approbation automatique" />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
      <Card>
        <CardHeader className="flex-row items-start justify-between">
          <div>
            <CardTitle>Prestations de secrétariat</CardTitle>
            <CardDescription>Les prestations « sur devis » créent une demande que vous chiffrez avant paiement.</CardDescription>
          </div>
          <Button size="sm" onClick={() => serviceDialog()}>
            Ajouter
          </Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {services.data?.items.map((svc) => (
            <div key={svc.id} className="flex items-start justify-between gap-3 rounded-lg border p-3 text-sm">
              <div>
                <p className="font-semibold">
                  {svc.name} <Badge variant={svc.pricingMode === "QUOTE" ? "muted" : "success"}>{svc.pricingMode === "QUOTE" ? "Sur devis" : "Prix automatique"}</Badge>
                </p>
                <p className="text-muted-foreground">{svc.description}</p>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={svc.isActive}
                  onChange={(v) =>
                    api(`/admin/config/services/${svc.id}`, { method: "PATCH", body: { isActive: v } })
                      .then(() => services.refetch())
                      .catch((e) => toast.error(errorMessage(e)))
                  }
                  label="Active"
                />
                <Button size="sm" variant="ghost" onClick={() => serviceDialog(svc)}>
                  Modifier
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
      <ActionDialog action={action} onClose={() => setAction(null)} />
    </div>
  );
}
