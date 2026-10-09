"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { COLOR_LABELS, SIDES_LABELS } from "@/lib/labels";
import type { ColorMode, FinishingCode, PaperFormat, PricingUnit, Sides } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, ErrorState, PageHeader, Skeleton } from "@/components/ui/feedback";
import { Input, NativeSelect } from "@/components/ui/input";
import { Switch } from "@/components/ui/choice";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

interface Rule {
  colorMode: ColorMode;
  sides: Sides;
  paperFormat: PaperFormat;
  unitPrice: number | null;
  unit: PricingUnit;
  isActive: boolean;
}
interface Finishing {
  code: FinishingCode;
  label: string;
  price: number;
  isActive: boolean;
}

export default function PricingAdminPage() {
  const qc = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["admin", "pricing"], queryFn: () => api<{ rules: Rule[]; finishings: Finishing[] }>("/admin/config/pricing") });
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [finishings, setFinishings] = useState<Finishing[] | null>(null);
  const [saving, setSaving] = useState<"rules" | "finishings" | null>(null);
  if (isLoading) return <Skeleton className="h-96" />;
  if (error || !data) return <ErrorState message="Tarifs indisponibles." onRetry={() => refetch()} />;
  const r = rules ?? data.rules;
  const f = finishings ?? data.finishings;
  const setRule = (i: number, patch: Partial<Rule>) => setRules(r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const setFin = (i: number, patch: Partial<Finishing>) => setFinishings(f.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const save = async (kind: "rules" | "finishings") => {
    setSaving(kind);
    try {
      if (kind === "rules") await api("/admin/config/pricing/rules", { method: "PUT", body: { rules: r } });
      else await api("/admin/config/pricing/finishings", { method: "PUT", body: { finishings: f } });
      toast.success("Tarifs enregistrés. Ils s'appliquent aux nouvelles commandes ; les commandes confirmées conservent leur tarif.");
      setRules(null);
      setFinishings(null);
      qc.invalidateQueries({ queryKey: ["admin", "pricing"] });
      qc.invalidateQueries({ queryKey: ["public-config"] });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Tarifs" description="Montants en FCFA. Chaque combinaison possède son propre prix : le recto verso n'est jamais cumulé avec le tarif N&B ou couleur." />
      <Card>
        <CardHeader>
          <CardTitle>Impression</CardTitle>
          <CardDescription>« Par page » = par face imprimée ; « par feuille » = par feuille physique. Sans prix, la combinaison n&apos;est pas commandable.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Table>
            <THead>
              <TR>
                <TH>Format</TH>
                <TH>Couleur</TH>
                <TH>Faces</TH>
                <TH>Prix (FCFA)</TH>
                <TH>Unité</TH>
                <TH>Active</TH>
              </TR>
            </THead>
            <TBody>
              {r.map((rule, i) => (
                <TR key={`${rule.paperFormat}-${rule.colorMode}-${rule.sides}`}>
                  <TD className="font-semibold">{rule.paperFormat}</TD>
                  <TD>{COLOR_LABELS[rule.colorMode]}</TD>
                  <TD>{SIDES_LABELS[rule.sides]}</TD>
                  <TD>
                    <Input
                      type="number"
                      min={0}
                      className="h-8 w-28"
                      placeholder="Non défini"
                      value={rule.unitPrice ?? ""}
                      onChange={(e) => setRule(i, { unitPrice: e.target.value === "" ? null : Number(e.target.value) })}
                      aria-label="Prix"
                    />
                  </TD>
                  <TD>
                    <NativeSelect className="h-8 w-36 text-xs" value={rule.unit} onChange={(e) => setRule(i, { unit: e.target.value as PricingUnit })} aria-label="Unité">
                      <option value="PER_FACE">par page</option>
                      <option value="PER_SHEET">par feuille</option>
                    </NativeSelect>
                  </TD>
                  <TD>
                    <Switch checked={rule.isActive} onChange={(v) => setRule(i, { isActive: v })} label="Active" />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
          {r.some((x) => x.isActive && x.unitPrice === null) && <Alert variant="warning">Une combinaison active sans prix reste indisponible pour les clients.</Alert>}
          <Button onClick={() => save("rules")} loading={saving === "rules"} disabled={!rules}>
            Enregistrer les prix d&apos;impression
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Reliure et finition</CardTitle>
          <CardDescription>Prix par exemplaire.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Table>
            <THead>
              <TR>
                <TH>Option</TH>
                <TH>Libellé</TH>
                <TH>Prix (FCFA)</TH>
                <TH>Active</TH>
              </TR>
            </THead>
            <TBody>
              {f.map((fin, i) => (
                <TR key={fin.code}>
                  <TD className="font-mono text-xs">{fin.code}</TD>
                  <TD>
                    <Input className="h-8" value={fin.label} onChange={(e) => setFin(i, { label: e.target.value })} aria-label="Libellé" />
                  </TD>
                  <TD>
                    <Input type="number" min={0} className="h-8 w-28" value={fin.price} disabled={fin.code === "NONE"} onChange={(e) => setFin(i, { price: Number(e.target.value) })} aria-label="Prix" />
                  </TD>
                  <TD>{fin.code !== "NONE" && <Switch checked={fin.isActive} onChange={(v) => setFin(i, { isActive: v })} label="Active" />}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <Button onClick={() => save("finishings")} loading={saving === "finishings"} disabled={!finishings}>
            Enregistrer les finitions
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
