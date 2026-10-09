"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Paperclip, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { formatBytes } from "@/lib/format";
import { usePublicConfig } from "@/lib/hooks";
import { uploadFile } from "@/lib/upload";
import type { ApiDocument, Quote } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Alert, PageHeader, Progress, Spinner } from "@/components/ui/feedback";

function QuoteForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { data: config } = usePublicConfig();
  const services = config?.services.filter((s) => s.pricingMode === "QUOTE") ?? [];
  const [serviceCode, setServiceCode] = useState(params.get("service") ?? "");
  const [description, setDescription] = useState("");
  const [deadline, setDeadline] = useState("");
  const [files, setFiles] = useState<{ name: string; progress: number; doc?: ApiDocument; error?: string }[]>([]);
  const [submitting, setSubmitting] = useState(false);

  if (!config) return <Spinner />;
  const code = serviceCode || services[0]?.code || "";

  const addFiles = async (list: FileList | null) => {
    if (!list) return;
    for (const file of Array.from(list)) {
      const index = files.length;
      setFiles((f) => [...f, { name: file.name, progress: 0 }]);
      try {
        const doc = await uploadFile(file, (p) => setFiles((f) => f.map((x, i) => (i === index ? { ...x, progress: p } : x))));
        setFiles((f) => f.map((x, i) => (i === index ? { ...x, doc, progress: 100 } : x)));
      } catch (e) {
        setFiles((f) => f.map((x, i) => (i === index ? { ...x, error: errorMessage(e) } : x)));
      }
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const { quote } = await api<{ quote: Quote }>("/quotes", {
        body: {
          serviceCode: code,
          description,
          deadline: deadline ? new Date(deadline).toISOString() : undefined,
          documentIds: files.filter((f) => f.doc).map((f) => f.doc!.id),
        },
      });
      toast.success("Demande envoyée. Nous revenons vers vous avec un devis.");
      router.push(`/espace/devis/${quote.id}`);
    } catch (err) {
      toast.error(errorMessage(err));
      setSubmitting(false);
    }
  };

  const uploading = files.some((f) => !f.doc && !f.error);
  return (
    <div className="space-y-6">
      <PageHeader title="Demande de devis" description="Aucun tarif fictif : notre équipe étudie votre demande et vous propose un prix ferme." />
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Votre besoin</CardTitle>
          <CardDescription>Pour l&apos;impression simple, utilisez plutôt la commande en ligne avec prix immédiat.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <Field label="Prestation" htmlFor="svc">
              <NativeSelect id="svc" value={code} onChange={(e) => setServiceCode(e.target.value)}>
                {services.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Description" htmlFor="desc" hint="Nombre de pages, mise en page souhaitée, délai, quantité…">
              <Textarea id="desc" rows={5} value={description} onChange={(e) => setDescription(e.target.value)} required minLength={10} maxLength={3000} />
            </Field>
            <Field label="Date souhaitée (facultatif)" htmlFor="dl">
              <Input id="dl" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
            </Field>
            <div className="space-y-2">
              <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium text-primary hover:underline">
                <Paperclip className="size-4" /> Joindre des documents (PDF, Word, images)
                <input type="file" multiple className="sr-only" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" onChange={(e) => addFiles(e.target.files)} />
              </label>
              {files.map((f, i) => (
                <div key={i} className="rounded-lg border p-2 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate">{f.name}</span>
                    <span className="flex items-center gap-2 text-xs text-muted-foreground">
                      {f.doc && formatBytes(f.doc.sizeBytes)}
                      <button type="button" onClick={() => setFiles((list) => list.filter((_, j) => j !== i))} aria-label="Retirer">
                        <Trash2 className="size-4 text-slate-400 hover:text-red-600" />
                      </button>
                    </span>
                  </div>
                  {!f.doc && !f.error && <Progress value={f.progress} className="mt-2" />}
                  {f.error && <p className="mt-1 text-xs text-red-700">{f.error}</p>}
                </div>
              ))}
            </div>
            {services.length === 0 && <Alert variant="warning">Aucune prestation sur devis n&apos;est disponible actuellement.</Alert>}
            <Button type="submit" loading={submitting} disabled={uploading || services.length === 0}>
              Envoyer la demande
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<Spinner />}>
      <QuoteForm />
    </Suspense>
  );
}
