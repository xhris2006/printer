"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Calculator } from "lucide-react";
import { api } from "@/lib/api";
import { fcfa } from "@/lib/format";
import { usePublicConfig, useDebounced } from "@/lib/hooks";
import { COLOR_LABELS, FINISHING_LABELS, SIDES_LABELS } from "@/lib/labels";
import type { EstimateResponse, PrintOptions } from "@/lib/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { Skeleton, ErrorState } from "@/components/ui/feedback";
import { Badge } from "@/components/ui/badge";
import { PrintOptionsForm } from "@/components/order/print-options-form";

export function PricingTable() {
  const { data, isLoading, error, refetch } = usePublicConfig();
  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (error || !data) return <ErrorState message="La grille tarifaire est momentanément indisponible." onRetry={() => refetch()} />;
  const unit = (u: string) => (u === "PER_SHEET" ? "/ feuille" : "/ page");
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Impression</CardTitle>
          <CardDescription>Le tarif recto verso est un tarif à part entière : il ne s&apos;ajoute pas au tarif noir & blanc ou couleur.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3">Format</th>
                  <th className="py-2 pr-3">Couleur</th>
                  <th className="py-2 pr-3">Impression</th>
                  <th className="py-2 text-right">Prix</th>
                </tr>
              </thead>
              <tbody>
                {data.pricing.rules.map((r) => (
                  <tr key={`${r.paperFormat}-${r.colorMode}-${r.sides}`} className="border-b last:border-0">
                    <td className="py-2.5 pr-3 font-medium">{r.paperFormat}</td>
                    <td className="py-2.5 pr-3">{COLOR_LABELS[r.colorMode]}</td>
                    <td className="py-2.5 pr-3">{SIDES_LABELS[r.sides]}</td>
                    <td className="py-2.5 text-right font-semibold">
                      {r.available && r.unitPrice !== null ? (
                        <>
                          {fcfa(r.unitPrice)} <span className="text-xs font-normal text-muted-foreground">{unit(r.unit)}</span>
                        </>
                      ) : (
                        <Badge variant="muted">Sur demande</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Reliure et finition</CardTitle>
            <CardDescription>Prix par exemplaire.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {data.pricing.finishings
              .filter((f) => f.code !== "NONE")
              .map((f) => (
                <div key={f.code} className="flex justify-between">
                  <span>{f.label}</span>
                  <span className="font-semibold">{fcfa(f.price)}</span>
                </div>
              ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Retrait et livraison</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span>Retrait sur place</span>
              <span className="font-semibold text-green-700">Gratuit</span>
            </div>
            {data.delivery.enabled &&
              (data.delivery.zones.length > 0 ? (
                data.delivery.zones.map((z) => (
                  <div key={z.id} className="flex justify-between">
                    <span>Livraison {z.name}</span>
                    <span className="font-semibold">{fcfa(z.fee)}</span>
                  </div>
                ))
              ) : (
                <div className="flex justify-between">
                  <span>Livraison</span>
                  <span className="font-semibold">{data.delivery.defaultFee !== null ? fcfa(data.delivery.defaultFee) : "À confirmer"}</span>
                </div>
              ))}
            <p className="pt-1 text-xs text-muted-foreground">Livraison express dans la journée possible, sans supplément automatique.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export function PriceSimulator() {
  const { data: config } = usePublicConfig();
  const [pages, setPages] = useState(10);
  const [options, setOptions] = useState<PrintOptions>({ colorMode: "BW", sides: "SINGLE", paperFormat: "A4", finishingCode: "NONE", copies: 1 });
  const payload = useDebounced(useMemo(() => ({ items: [{ pageCount: Math.max(1, pages || 1), options }] }), [pages, options]));
  const { data, isFetching } = useQuery({
    queryKey: ["simulate", payload],
    queryFn: () => api<EstimateResponse>("/pricing/estimate", { body: payload }),
    placeholderData: (prev) => prev,
  });
  const item = data?.items[0];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calculator className="size-5 text-primary" /> Simulateur de prix
        </CardTitle>
        <CardDescription>Le prix définitif est calculé par nos serveurs à partir du nombre réel de pages de vos fichiers.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6 md:grid-cols-[1fr_260px]">
        <div className="space-y-4">
          <div className="max-w-[200px] space-y-1.5">
            <Label htmlFor="sim-pages">Nombre de pages</Label>
            <Input id="sim-pages" type="number" min={1} max={5000} value={pages} onChange={(e) => setPages(Number(e.target.value))} />
          </div>
          {config && <PrintOptionsForm value={options} onChange={setOptions} config={config} compact />}
        </div>
        <div className="flex flex-col justify-center rounded-xl bg-accent/60 p-5 text-center" aria-live="polite">
          {item?.price ? (
            <>
              <p className="text-sm text-muted-foreground">Prix estimé</p>
              <p className={`text-3xl font-bold text-primary ${isFetching ? "opacity-60" : ""}`}>{fcfa(item.price.lineTotal)}</p>
              <p className="mt-2 text-xs text-muted-foreground">
                {item.price.sheets} feuille(s) · {item.price.faces} face(s) imprimée(s)
                {item.price.finishingCost > 0 && <> · {FINISHING_LABELS[item.price.finishingCode]}</>}
              </p>
            </>
          ) : item?.error ? (
            <p className="text-sm font-medium text-amber-800">{item.error.message}</p>
          ) : (
            <Skeleton className="mx-auto h-10 w-32" />
          )}
        </div>
      </CardContent>
    </Card>
  );
}
