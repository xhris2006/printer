"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, Copy, FileImage, FileText, Loader2, RefreshCw, Settings2, Trash2 } from "lucide-react";
import { formatBytes, fcfa } from "@/lib/format";
import { optionsSummary } from "@/lib/labels";
import type { ItemPrice, PrintOptions, PublicConfig } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/feedback";
import { Badge } from "@/components/ui/badge";
import { PrintOptionsForm } from "@/components/order/print-options-form";
import type { WizardDoc } from "./types";

export function DocumentRow({
  doc,
  options,
  price,
  priceError,
  config,
  mode,
  onRemove,
  onRetry,
  onDeclarePages,
  onCustomize,
  onChangeOptions,
  onCopyToAll,
}: {
  doc: WizardDoc;
  options: PrintOptions;
  price?: ItemPrice;
  priceError?: string;
  config: PublicConfig;
  mode: "documents" | "options";
  onRemove: () => void;
  onRetry: () => void;
  onDeclarePages: (pages: number) => Promise<void>;
  onCustomize: (custom: boolean) => void;
  onChangeOptions: (o: PrintOptions) => void;
  onCopyToAll: () => void;
}) {
  const [pages, setPages] = useState("");
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const d = doc.document;
  const isImage = d?.kind === "JPEG" || d?.kind === "PNG" || /\.(jpe?g|png)$/i.test(doc.name);
  const Icon = isImage ? FileImage : FileText;

  return (
    <li className="rounded-xl border bg-white p-3 sm:p-4">
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-red-50 text-red-600">
          <Icon className="size-5" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="truncate text-sm font-semibold" title={doc.name}>
              {doc.name}
            </p>
            {doc.custom && mode === "options" && <Badge variant="violet">Paramètres personnalisés</Badge>}
          </div>
          <p className="text-xs text-muted-foreground">
            {(d?.kind ?? doc.name.split(".").pop() ?? "").toUpperCase()} · {formatBytes(d?.sizeBytes ?? doc.size)}
            {d?.pageCount ? ` · ${d.pageCount} page${d.pageCount > 1 ? "s" : ""}` : ""}
            {d?.pageCountSource === "CUSTOMER_DECLARED" && " (déclarées)"}
          </p>
          {mode === "options" && <p className="mt-0.5 text-xs text-slate-600">{optionsSummary(options)}</p>}

          {doc.phase === "uploading" || doc.phase === "queued" ? (
            <div className="mt-2 space-y-1">
              <Progress value={doc.progress} />
              <p className="text-xs text-muted-foreground">{doc.phase === "queued" ? "En attente…" : `Téléversement ${doc.progress} %`}</p>
            </div>
          ) : doc.phase === "processing" ? (
            <p className="mt-1.5 flex items-center gap-1.5 text-xs text-primary">
              <Loader2 className="size-3.5 animate-spin" /> Analyse du document (comptage des pages)…
            </p>
          ) : doc.phase === "error" || (d && ["FAILED", "REJECTED"].includes(d.status)) ? (
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-red-700">
              <AlertTriangle className="size-3.5" /> {doc.error ?? d?.analysisError ?? "Erreur"}
              {d?.status === "FAILED" && (
                <Button size="sm" variant="ghost" onClick={onRetry}>
                  <RefreshCw /> Réessayer
                </Button>
              )}
            </div>
          ) : d?.status === "NEEDS_REVIEW" ? (
            <div className="mt-2 space-y-2 rounded-lg bg-amber-50 p-2.5 text-xs text-amber-900">
              <p className="flex items-start gap-1.5">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {d.analysisError}
              </p>
              <form
                className="flex items-center gap-2"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const n = Number(pages);
                  if (!Number.isInteger(n) || n < 1) return;
                  setSaving(true);
                  await onDeclarePages(n).finally(() => setSaving(false));
                }}
              >
                <Input className="h-8 w-24 bg-white" type="number" min={1} placeholder="Pages" value={pages} onChange={(e) => setPages(e.target.value)} aria-label="Nombre de pages" />
                <Button size="sm" type="submit" loading={saving}>
                  Confirmer
                </Button>
              </form>
            </div>
          ) : d?.status === "READY" ? (
            <p className="mt-1 flex items-center gap-1.5 text-xs text-green-700">
              <CheckCircle2 className="size-3.5" /> {d.pageCountSource === "CUSTOMER_DECLARED" ? "Nombre de pages indiqué (vérifié avant impression)" : "Analyse terminée"}
              {d.analysisError && d.pageCountSource === "DETECTED" && <span className="text-muted-foreground">· {d.analysisError}</span>}
            </p>
          ) : null}
          {priceError && <p className="mt-1 text-xs font-medium text-amber-700">{priceError}</p>}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="text-sm font-bold text-slate-900">{price ? fcfa(price.lineTotal) : "—"}</span>
          {price && <span className="text-[11px] text-muted-foreground">{price.sheets} feuille(s)</span>}
          <button type="button" onClick={onRemove} className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label={`Retirer ${doc.name}`}>
            <Trash2 className="size-4" />
          </button>
        </div>
      </div>

      {mode === "options" && d?.status === "READY" && (
        <div className="mt-3 flex flex-wrap gap-2 border-t pt-3">
          <Button
            size="sm"
            variant={open ? "secondary" : "outline"}
            onClick={() => {
              if (!doc.custom) onCustomize(true);
              setOpen((v) => !v);
            }}
          >
            <Settings2 /> {open ? "Fermer" : "Modifier ce document"}
          </Button>
          {doc.custom && (
            <>
              <Button size="sm" variant="ghost" onClick={onCopyToAll}>
                <Copy /> Appliquer ces paramètres à tous
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  onCustomize(false);
                  setOpen(false);
                }}
              >
                Revenir aux paramètres communs
              </Button>
            </>
          )}
        </div>
      )}
      {mode === "options" && open && doc.custom && (
        <div className="mt-3 rounded-lg bg-slate-50 p-3">
          <PrintOptionsForm value={options} onChange={onChangeOptions} config={config} compact />
        </div>
      )}
    </li>
  );
}
