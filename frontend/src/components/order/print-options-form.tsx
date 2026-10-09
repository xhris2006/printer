"use client";

import { Minus, Plus } from "lucide-react";
import { ChoiceGroup } from "@/components/ui/choice";
import { Label } from "@/components/ui/input";
import { fcfa } from "@/lib/format";
import { COLOR_LABELS, FINISHING_LABELS, SIDES_LABELS } from "@/lib/labels";
import type { FinishingCode, PrintOptions, PublicConfig } from "@/lib/types";
import { cn } from "@/lib/utils";

function ruleFor(config: PublicConfig, o: Pick<PrintOptions, "colorMode" | "sides" | "paperFormat">) {
  return config.pricing.rules.find((r) => r.colorMode === o.colorMode && r.sides === o.sides && r.paperFormat === o.paperFormat);
}

export function isAvailable(config: PublicConfig, o: Pick<PrintOptions, "colorMode" | "sides" | "paperFormat">) {
  return Boolean(ruleFor(config, o)?.available);
}

/** Formulaire des options d'impression (couleur, faces, format, reliure, exemplaires). */
export function PrintOptionsForm({ value, onChange, config, compact = false }: { value: PrintOptions; onChange: (v: PrintOptions) => void; config: PublicConfig; compact?: boolean }) {
  const set = <K extends keyof PrintOptions>(key: K, v: PrintOptions[K]) => onChange({ ...value, [key]: v });
  const priceLabel = (o: Pick<PrintOptions, "colorMode" | "sides" | "paperFormat">) => {
    const r = ruleFor(config, o);
    return r?.available && r.unitPrice !== null ? `${fcfa(r.unitPrice)} ${r.unit === "PER_SHEET" ? "/ feuille" : "/ page"}` : undefined;
  };
  const finishings = config.pricing.finishings;
  return (
    <div className={cn("grid gap-4", compact ? "md:grid-cols-2" : "")}>
      <div className="space-y-2">
        <Label>Couleur</Label>
        <ChoiceGroup
          ariaLabel="Couleur"
          value={value.colorMode}
          onChange={(v) => set("colorMode", v)}
          options={(["BW", "COLOR"] as const).map((c) => ({
            value: c,
            label: COLOR_LABELS[c],
            description: compact ? undefined : priceLabel({ ...value, colorMode: c }),
            disabled: !isAvailable(config, { ...value, colorMode: c }),
            disabledReason: "Non disponible avec ces options",
          }))}
        />
      </div>
      <div className="space-y-2">
        <Label>Recto / verso</Label>
        <ChoiceGroup
          ariaLabel="Recto ou recto verso"
          value={value.sides}
          onChange={(v) => set("sides", v)}
          options={(["SINGLE", "DOUBLE"] as const).map((s) => ({
            value: s,
            label: SIDES_LABELS[s],
            description: compact ? undefined : priceLabel({ ...value, sides: s }),
            disabled: !isAvailable(config, { ...value, sides: s }),
            disabledReason: "Non disponible avec ces options",
          }))}
        />
      </div>
      <div className="space-y-2">
        <Label>Format</Label>
        <ChoiceGroup
          ariaLabel="Format du papier"
          value={value.paperFormat}
          onChange={(v) => set("paperFormat", v)}
          options={(["A4", "A3"] as const).map((f) => ({
            value: f,
            label: f,
            disabled: !isAvailable(config, { ...value, paperFormat: f }),
            disabledReason: "Tarif à venir",
          }))}
        />
      </div>
      <div className="space-y-2">
        <Label>Reliure</Label>
        <ChoiceGroup
          ariaLabel="Reliure"
          value={value.finishingCode}
          onChange={(v) => set("finishingCode", v as FinishingCode)}
          options={(["NONE", ...finishings.filter((f) => f.code !== "NONE").map((f) => f.code)] as FinishingCode[]).map((code) => {
            const f = finishings.find((x) => x.code === code);
            return {
              value: code,
              label: code === "NONE" ? FINISHING_LABELS.NONE : (f?.label ?? FINISHING_LABELS[code]),
              description: code !== "NONE" && f && !compact ? `+${fcfa(f.price)} / exemplaire` : undefined,
            };
          })}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="copies">Nombre d&apos;exemplaires</Label>
        <div className="flex w-40 items-center rounded-lg border border-input bg-white">
          <button type="button" className="p-2.5 text-slate-600 hover:text-primary disabled:opacity-40" onClick={() => set("copies", Math.max(1, value.copies - 1))} disabled={value.copies <= 1} aria-label="Diminuer">
            <Minus className="size-4" />
          </button>
          <input
            id="copies"
            type="number"
            min={1}
            max={1000}
            value={value.copies}
            onChange={(e) => set("copies", Math.min(1000, Math.max(1, Number(e.target.value) || 1)))}
            className="w-full min-w-0 bg-transparent text-center text-sm font-semibold outline-none"
          />
          <button type="button" className="p-2.5 text-slate-600 hover:text-primary" onClick={() => set("copies", Math.min(1000, value.copies + 1))} aria-label="Augmenter">
            <Plus className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
