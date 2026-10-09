"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { useMe, usePublicConfig } from "@/lib/hooks";
import type { Group, PrintOptions } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, NativeSelect, Textarea } from "@/components/ui/input";
import { ChoiceGroup } from "@/components/ui/choice";
import { PageHeader, Spinner } from "@/components/ui/feedback";
import { PrintOptionsForm } from "@/components/order/print-options-form";

export default function NewGroupPage() {
  const router = useRouter();
  const { data: user } = useMe();
  const { data: config } = usePublicConfig();
  const [form, setForm] = useState({
    name: "",
    institution: user?.delegate?.institution ?? "",
    field: user?.delegate?.field ?? "",
    level: user?.delegate?.level ?? "",
    className: user?.delegate?.className ?? "",
    category: "",
    instructions: "",
    deadline: "",
    pickupPointId: "",
  });
  const [mode, setMode] = useState<"DELEGATE_COLLECT" | "STUDENT_CONTRIBUTIONS">("STUDENT_CONTRIBUTIONS");
  const [rule, setRule] = useState<"FULL_PAYMENT" | "PAID_ONLY">("FULL_PAYMENT");
  const [options, setOptions] = useState<PrintOptions>({ colorMode: "BW", sides: "DOUBLE", paperFormat: "A4", finishingCode: "STAPLE", copies: 1 });
  const [loading, setLoading] = useState(false);
  if (!config || !user) return <Spinner />;

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { group } = await api<{ group: Group }>("/groups", {
        body: {
          ...form,
          institution: form.institution || user.delegate?.institution,
          field: form.field || user.delegate?.field,
          level: form.level || user.delegate?.level,
          className: form.className || user.delegate?.className,
          category: form.category || undefined,
          instructions: form.instructions || undefined,
          deadline: form.deadline ? new Date(form.deadline).toISOString() : undefined,
          pickupPointId: form.pickupPointId || undefined,
          mode,
          productionRule: rule,
          defaultOptions: options,
        },
      });
      toast.success(`Lot ${group.code} créé.`);
      router.push(`/espace/delegue/groupes/${group.id}`);
    } catch (err) {
      toast.error(errorMessage(err));
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Nouvelle commande groupée" description="Définissez le lot, les paramètres communs et le mode de collecte." />
      <form onSubmit={submit} className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Le lot</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Nom du lot" htmlFor="gn" className="sm:col-span-2">
              <Input id="gn" value={form.name} onChange={set("name")} required minLength={3} placeholder="Ex. Fascicules Algorithmique S3" />
            </Field>
            <Field label="Établissement" htmlFor="gi" className="sm:col-span-2">
              <Input id="gi" value={form.institution || user.delegate?.institution || ""} onChange={set("institution")} required />
            </Field>
            <Field label="Filière" htmlFor="gf">
              <Input id="gf" value={form.field || user.delegate?.field || ""} onChange={set("field")} required />
            </Field>
            <Field label="Niveau" htmlFor="gl">
              <Input id="gl" value={form.level || user.delegate?.level || ""} onChange={set("level")} required />
            </Field>
            <Field label="Classe" htmlFor="gc">
              <Input id="gc" value={form.className || user.delegate?.className || ""} onChange={set("className")} required />
            </Field>
            <Field label="Matière / catégorie (facultatif)" htmlFor="gcat">
              <Input id="gcat" value={form.category} onChange={set("category")} />
            </Field>
            <Field label="Instructions (facultatif)" htmlFor="gins" className="sm:col-span-2">
              <Textarea id="gins" value={form.instructions} onChange={set("instructions")} maxLength={1500} placeholder="Ex. agrafer chaque fascicule, imprimer dans l'ordre des chapitres…" />
            </Field>
            <Field label="Date limite de collecte (facultatif)" htmlFor="gd">
              <Input id="gd" type="datetime-local" value={form.deadline} onChange={set("deadline")} />
            </Field>
            <Field label="Point de retrait" htmlFor="gp">
              <NativeSelect id="gp" value={form.pickupPointId} onChange={set("pickupPointId")}>
                {config.pickupPoints.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </CardContent>
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Mode de collecte</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <ChoiceGroup
                ariaLabel="Mode de collecte"
                value={mode}
                onChange={setMode}
                columns={2}
                options={[
                  { value: "DELEGATE_COLLECT", label: "Je rassemble les fichiers", description: "Mode A : une commande unique pour la classe." },
                  { value: "STUDENT_CONTRIBUTIONS", label: "Chaque étudiant contribue", description: "Mode B : lien partageable, paiement individuel." },
                ]}
              />
              {mode === "STUDENT_CONTRIBUTIONS" && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">Règle avant impression</p>
                  <ChoiceGroup
                    ariaLabel="Règle de production"
                    value={rule}
                    onChange={setRule}
                    columns={2}
                    options={[
                      { value: "FULL_PAYMENT", label: "Paiement intégral", description: "Toutes les contributions doivent être payées." },
                      { value: "PAID_ONLY", label: "Seulement les payées", description: "Les contributions non payées sont annulées à la clôture." },
                    ]}
                  />
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Paramètres d&apos;impression communs</CardTitle>
              <CardDescription>Appliqués par défaut ; des exceptions restent possibles par fichier.</CardDescription>
            </CardHeader>
            <CardContent>
              <PrintOptionsForm value={options} onChange={setOptions} config={config} compact />
            </CardContent>
          </Card>
          <Button type="submit" size="lg" className="w-full" loading={loading}>
            Créer le lot
          </Button>
        </div>
      </form>
    </div>
  );
}
