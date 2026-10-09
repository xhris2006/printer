"use client";

import Link from "next/link";
import { useState } from "react";
import { useParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { fcfa, formatBytes, formatDate } from "@/lib/format";
import { QUOTE_VARIANT } from "@/lib/labels";
import type { Quote } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ErrorState, Spinner } from "@/components/ui/feedback";
import { Field, Input, Textarea } from "@/components/ui/input";

type Line = { label: string; quantity: string; unitPrice: string };

export default function AdminQuotePage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { data: quote, isLoading, error } = useQuery({ queryKey: ["admin", "quote", id], queryFn: () => api<{ quote: Quote }>(`/admin/quotes/${id}`).then((r) => r.quote) });
  const [lines, setLines] = useState<Line[] | null>(null);
  const [message, setMessage] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [sending, setSending] = useState(false);
  if (isLoading) return <Spinner />;
  if (error || !quote) return <ErrorState message={errorMessage(error)} />;

  const current: Line[] = lines ?? (quote.lines.length > 0 ? quote.lines.map((l) => ({ label: l.label, quantity: String(l.quantity), unitPrice: String(l.unitPrice) })) : [{ label: quote.service.name, quantity: "1", unitPrice: "" }]);
  const total = current.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0), 0);
  const editable = ["REQUESTED", "QUOTED"].includes(quote.status);
  const setLine = (i: number, patch: Partial<Line>) => setLines(current.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const send = async () => {
    setSending(true);
    try {
      const r = await api<{ quote: Quote }>(`/admin/quotes/${id}/send`, {
        body: {
          lines: current.map((l) => ({ label: l.label, quantity: Number(l.quantity), unitPrice: Number(l.unitPrice) })),
          message: message || undefined,
          validUntil: validUntil ? new Date(validUntil).toISOString() : undefined,
        },
      });
      qc.setQueryData(["admin", "quote", id], r.quote);
      toast.success("Devis envoyé au client.");
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSending(false);
    }
  };
  const download = async (docId: string) => {
    try {
      const { url } = await api<{ url: string }>(`/admin/documents/${docId}/download`);
      window.open(url, "_blank", "noopener");
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <p className="text-sm text-muted-foreground">
          <Link href="/admin/devis" className="hover:underline">
            Devis
          </Link>{" "}
          / {quote.reference}
        </p>
        <h1 className="mt-1 flex flex-wrap items-center gap-2 text-2xl font-bold">
          {quote.service.name} <Badge variant={QUOTE_VARIANT[quote.status]}>{quote.statusLabel}</Badge>
        </h1>
        <p className="text-sm text-muted-foreground">
          {quote.customer?.fullName} · {quote.customer?.phone} · demandé le {formatDate(quote.createdAt)}
          {quote.deadline ? ` · souhaité pour le ${formatDate(quote.deadline)}` : ""}
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Besoin du client</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="whitespace-pre-line">{quote.description}</p>
          {quote.documents.map((d) => (
            <div key={d.id} className="flex items-center justify-between rounded-lg border px-3 py-2">
              <span className="truncate">
                {d.originalName} <span className="text-xs text-muted-foreground">({d.pageCount ?? "?"} p. · {formatBytes(d.sizeBytes)})</span>
              </span>
              <Button size="icon" variant="ghost" onClick={() => download(d.id)} aria-label="Télécharger">
                <Download />
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Devis</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {current.map((l, i) => (
            <div key={i} className="grid grid-cols-[1fr_80px_120px_auto] items-end gap-2">
              <Field label={i === 0 ? "Désignation" : ""} htmlFor={`l${i}`}>
                <Input id={`l${i}`} value={l.label} onChange={(e) => setLine(i, { label: e.target.value })} disabled={!editable} />
              </Field>
              <Field label={i === 0 ? "Qté" : ""} htmlFor={`q${i}`}>
                <Input id={`q${i}`} type="number" min={1} value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} disabled={!editable} />
              </Field>
              <Field label={i === 0 ? "Prix unitaire" : ""} htmlFor={`p${i}`}>
                <Input id={`p${i}`} type="number" min={0} value={l.unitPrice} onChange={(e) => setLine(i, { unitPrice: e.target.value })} disabled={!editable} />
              </Field>
              <Button variant="ghost" size="icon" disabled={!editable || current.length === 1} onClick={() => setLines(current.filter((_, j) => j !== i))} aria-label="Supprimer la ligne">
                <Trash2 />
              </Button>
            </div>
          ))}
          {editable && (
            <Button variant="ghost" size="sm" onClick={() => setLines([...current, { label: "", quantity: "1", unitPrice: "" }])}>
              <Plus /> Ajouter une ligne
            </Button>
          )}
          <div className="flex justify-between border-t pt-3 text-lg font-bold">
            <span>Total</span>
            <span className="text-primary">{fcfa(total)}</span>
          </div>
          {editable && (
            <>
              <Field label="Message au client (facultatif)" htmlFor="msg">
                <Textarea id="msg" value={message} onChange={(e) => setMessage(e.target.value)} />
              </Field>
              <Field label="Valable jusqu'au (par défaut 14 jours)" htmlFor="vu">
                <Input id="vu" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
              </Field>
              <Button onClick={send} loading={sending} disabled={total <= 0 || current.some((l) => l.label.trim().length < 2)}>
                {quote.status === "QUOTED" ? "Mettre à jour le devis" : "Envoyer le devis"}
              </Button>
            </>
          )}
          {quote.order && (
            <Button variant="outline" asChild>
              <Link href={`/admin/commandes/${quote.order.id}`}>Commande {quote.order.reference}</Link>
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
