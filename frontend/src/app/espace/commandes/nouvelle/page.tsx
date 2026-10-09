"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, CheckCircle2, FolderOpen, Layers, MapPin, Truck, Users, Zap } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError, errorMessage } from "@/lib/api";
import { fcfa, formatPhone, plural } from "@/lib/format";
import { useDebounced, useMe, usePublicConfig } from "@/lib/hooks";
import { optionsSummary } from "@/lib/labels";
import { ANALYZING_STATUSES, uploadFile } from "@/lib/upload";
import type { ApiDocument, EstimateResponse, Group, Order, Paginated, PrintOptions, PublicConfig } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, ErrorState, Spinner } from "@/components/ui/feedback";
import { Field, Input, NativeSelect, Textarea } from "@/components/ui/input";
import { ChoiceGroup } from "@/components/ui/choice";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PrintOptionsForm, isAvailable } from "@/components/order/print-options-form";
import { PaymentPanel } from "@/components/order/payment-panel";
import { Stepper } from "@/components/order/wizard/stepper";
import { Dropzone } from "@/components/order/wizard/dropzone";
import { DocumentRow } from "@/components/order/wizard/document-row";
import { DEFAULT_OPTIONS, effectiveOptions, type FulfillmentState, type GroupContext, type WizardDoc } from "@/components/order/wizard/types";

const UPLOAD_CONCURRENCY = 3;
let keyCounter = 0;
const newKey = () => `doc-${Date.now()}-${keyCounter++}`;

function docFromApi(d: ApiDocument, options: PrintOptions, custom = false): WizardDoc {
  return {
    key: newKey(),
    name: d.originalName,
    size: d.sizeBytes,
    progress: 100,
    phase: ANALYZING_STATUSES.has(d.status) ? "processing" : "done",
    document: d,
    custom,
    options,
  };
}

function WizardInner({ config }: { config: PublicConfig }) {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const { data: me } = useMe();

  const [step, setStep] = useState(0);
  const [docs, setDocs] = useState<WizardDoc[]>([]);
  const [defaults, setDefaults] = useState<PrintOptions>(DEFAULT_OPTIONS);
  const [notes, setNotes] = useState("");
  const [group, setGroup] = useState<GroupContext | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [order, setOrder] = useState<Order | null>(null);
  const [busy, setBusy] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const defaultPoint = config.pickupPoints.find((p) => p.isDefault) ?? config.pickupPoints[0];
  const [fulfillment, setFulfillment] = useState<FulfillmentState>({
    method: "PICKUP",
    pickupPointId: defaultPoint?.id ?? "",
    recipientName: "",
    phone: "",
    quarter: "",
    zoneId: "",
    directions: "",
  });
  const uploading = useRef(0);

  // ── Initialisation : brouillon, lot de délégué ou lien de collecte ──
  useEffect(() => {
    const draft = params.get("brouillon");
    const groupId = params.get("groupe");
    const collecte = params.get("collecte");
    (async () => {
      try {
        if (draft) {
          const { order: o } = await api<{ order: Order }>(`/orders/${draft}`);
          if (o.status !== "DRAFT") {
            router.replace(`/espace/commandes/${o.id}`);
            return;
          }
          const ids = o.items.map((i) => i.documentId).filter(Boolean).join(",");
          const docsRes = ids ? await api<Paginated<ApiDocument>>(`/documents?ids=${ids}`) : { items: [] };
          const first = o.items[0]?.options ?? DEFAULT_OPTIONS;
          setDefaults(first);
          setDocs(
            o.items
              .map((item) => {
                const d = docsRes.items.find((x) => x.id === item.documentId);
                if (!d || !item.options) return null;
                const same = JSON.stringify(item.options) === JSON.stringify(first);
                return docFromApi(d, item.options, !same);
              })
              .filter((x): x is WizardDoc => x !== null),
          );
          setNotes(o.notes ?? "");
          if (o.delivery) {
            setFulfillment((f) => ({
              ...f,
              method: "DELIVERY",
              recipientName: o.delivery!.recipientName,
              phone: o.delivery!.phone,
              quarter: o.delivery!.quarter,
              zoneId: o.delivery!.zone?.id ?? "",
              directions: o.delivery!.directions ?? "",
            }));
          } else if (o.pickupPoint) {
            setFulfillment((f) => ({ ...f, method: "PICKUP", pickupPointId: o.pickupPoint!.id }));
          }
          if (o.group) setGroup({ kind: "delegate", groupId: o.group.id, name: o.group.name, code: o.group.code });
          setDraftId(o.id);
          setOrder(o);
          setStep(3);
        } else if (groupId) {
          const { group: g } = await api<{ group: Group }>(`/groups/${groupId}`);
          setGroup({ kind: "delegate", groupId: g.id, name: g.name, code: g.code });
          if (g.defaultOptions) setDefaults(g.defaultOptions);
          if (g.pickupPoint) setFulfillment((f) => ({ ...f, pickupPointId: g.pickupPoint!.id }));
        } else if (collecte) {
          const { group: g } = await api<{ group: { name: string; code: string; acceptingContributions: boolean; defaultOptions: PrintOptions | null; pickupPoint: { name: string } | null } }>(
            `/public/groups/${encodeURIComponent(collecte)}`,
          );
          if (!g.acceptingContributions) {
            toast.error("Cette collecte n'accepte plus de contributions.");
            router.replace(`/g/${collecte}`);
            return;
          }
          setGroup({ kind: "contribution", shareToken: collecte, name: g.name, code: g.code, pickupPointName: g.pickupPoint?.name ?? null });
          if (g.defaultOptions) setDefaults(g.defaultOptions);
        }
      } catch (error) {
        toast.error(errorMessage(error));
      } finally {
        setInitializing(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pré-remplissage des coordonnées de livraison (ajustement d'état pendant le rendu)
  const [prefilled, setPrefilled] = useState(false);
  if (me && !prefilled) {
    setPrefilled(true);
    if (!fulfillment.recipientName && !fulfillment.phone) {
      setFulfillment((f) => ({ ...f, recipientName: me.fullName, phone: formatPhone(me.phone), quarter: me.profile?.quarter ?? "" }));
    }
  }

  const updateDoc = useCallback((key: string, patch: Partial<WizardDoc>) => {
    setDocs((list) => list.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  }, []);

  // ── Téléversements (file d'attente, 3 en parallèle) ──
  const started = useRef(new Set<string>());
  useEffect(() => {
    const available = UPLOAD_CONCURRENCY - uploading.current;
    if (available <= 0) return;
    const queued = docs.filter((d) => d.phase === "queued" && d.file && !started.current.has(d.key)).slice(0, available);
    for (const doc of queued) {
      started.current.add(doc.key);
      uploading.current++;
      const file = doc.file as File;
      updateDoc(doc.key, { phase: "uploading", progress: 0 });
      // Le compteur est décrémenté AVANT la mise à jour d'état pour que l'effet relance la file
      uploadFile(file, (p) => updateDoc(doc.key, { progress: p })).then(
        (d) => {
          uploading.current--;
          updateDoc(doc.key, { document: d, phase: ANALYZING_STATUSES.has(d.status) ? "processing" : "done", file: undefined });
        },
        (e) => {
          uploading.current--;
          updateDoc(doc.key, { phase: "error", error: errorMessage(e) });
        },
      );
    }
  }, [docs, updateDoc]);

  const addFiles = (files: File[]) => {
    const max = config.uploads.maxFilesPerOrder;
    const room = max - docs.length;
    if (room <= 0) return toast.error(`Maximum ${max} documents par commande.`);
    const accepted: WizardDoc[] = [];
    for (const file of files.slice(0, room)) {
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
      const base = { key: newKey(), name: file.name, size: file.size, progress: 0, custom: false, options: defaults };
      if (!config.uploads.acceptedExtensions.includes(ext)) {
        accepted.push({ ...base, phase: "error", error: "Format non accepté (PDF, DOC, DOCX, JPG, JPEG, PNG)." });
      } else if (file.size > config.uploads.maxFileSizeMb * 1024 * 1024) {
        accepted.push({ ...base, phase: "error", error: `Fichier trop volumineux (max ${config.uploads.maxFileSizeMb} Mo).` });
      } else if (file.size === 0) {
        accepted.push({ ...base, phase: "error", error: "Fichier vide." });
      } else {
        accepted.push({ ...base, file, phase: "queued" });
      }
    }
    if (files.length > room) toast.warning(`Seuls ${room} fichier(s) ont été ajoutés (limite de ${max} par commande).`);
    setDocs((list) => [...list, ...accepted]);
    setOrder(null);
  };

  // ── Suivi de l'analyse asynchrone ──
  const processingIds = docs.filter((d) => d.phase === "processing" && d.document).map((d) => d.document!.id);
  useQuery({
    queryKey: ["documents", "analysis", processingIds.join(",")],
    queryFn: async () => {
      const res = await api<Paginated<ApiDocument>>(`/documents?ids=${processingIds.join(",")}`);
      setDocs((list) =>
        list.map((d) => {
          const fresh = res.items.find((x) => x.id === d.document?.id);
          if (!fresh || d.phase !== "processing") return d;
          return { ...d, document: fresh, phase: ANALYZING_STATUSES.has(fresh.status) ? "processing" : "done" };
        }),
      );
      return res;
    },
    enabled: processingIds.length > 0,
    refetchInterval: 1500,
  });

  // ── Estimation serveur en temps réel ──
  const readyDocs = docs.filter((d) => d.document?.status === "READY" && d.document.pageCount);
  // La clé est une chaîne : la temporisation reste stable entre deux rendus identiques
  const estimateKey = useDebounced(
    JSON.stringify({
      items: readyDocs.map((d) => ({ key: d.key, documentId: d.document!.id, options: effectiveOptions(d, defaults) })),
      fulfillment:
        group?.kind === "contribution"
          ? { method: "PICKUP" }
          : { method: fulfillment.method, zoneId: fulfillment.method === "DELIVERY" && fulfillment.zoneId ? fulfillment.zoneId : null },
    }),
    250,
  );
  const estimatePayload = useMemo(() => JSON.parse(estimateKey) as { items: unknown[] }, [estimateKey]);
  const estimate = useQuery({
    queryKey: ["estimate", estimateKey],
    queryFn: () => api<EstimateResponse>("/pricing/estimate", { body: estimatePayload }),
    enabled: estimatePayload.items.length > 0,
    placeholderData: (prev) => prev,
  });
  const priceFor = (key: string) => estimate.data?.items.find((i) => i.key === key);

  // ── Règles de progression ──
  const pendingDocs = docs.filter((d) => d.phase === "queued" || d.phase === "uploading" || d.phase === "processing");
  const blockingDocs = docs.filter((d) => d.phase === "error" || (d.document && d.document.status !== "READY" && !ANALYZING_STATUSES.has(d.document.status)));
  const pricingErrors = estimate.data?.items.filter((i) => i.error) ?? [];
  const step1Ok = docs.length > 0 && pendingDocs.length === 0 && blockingDocs.length === 0 && readyDocs.length === docs.length;
  const step2Ok = step1Ok && pricingErrors.length === 0 && Boolean(estimate.data?.complete);
  const deliveryOk =
    fulfillment.method === "PICKUP"
      ? Boolean(fulfillment.pickupPointId) || group?.kind === "contribution"
      : fulfillment.recipientName.trim().length >= 2 && fulfillment.phone.trim().length >= 9 && fulfillment.quarter.trim().length >= 2;
  const step3Ok = step2Ok && deliveryOk;
  const maxReachable = order ? 3 : step3Ok ? 3 : step2Ok ? 2 : step1Ok ? 1 : 0;

  const orderInput = () => ({
    items: docs.map((d) => ({ documentId: d.document!.id, options: effectiveOptions(d, defaults) })),
    fulfillment:
      group?.kind === "contribution" || fulfillment.method === "PICKUP"
        ? { method: "PICKUP" as const, pickupPointId: fulfillment.pickupPointId || undefined }
        : {
            method: "DELIVERY" as const,
            recipientName: fulfillment.recipientName,
            phone: fulfillment.phone,
            quarter: fulfillment.quarter,
            directions: fulfillment.directions || undefined,
            zoneId: fulfillment.zoneId || null,
          },
    notes: notes.trim() || undefined,
    ...(group?.kind === "delegate" && !draftId ? { groupId: group.groupId } : {}),
    ...(group?.kind === "contribution" && !draftId ? { groupShareToken: group.shareToken } : {}),
  });

  /** Enregistre le brouillon côté serveur : les montants affichés à l'étape 4 sont ceux du serveur. */
  const goToReview = async () => {
    setBusy(true);
    try {
      const res = draftId
        ? await api<{ order: Order }>(`/orders/${draftId}`, { method: "PUT", body: orderInput() })
        : await api<{ order: Order }>("/orders", { body: orderInput() });
      setDraftId(res.order.id);
      setOrder(res.order);
      setStep(3);
    } catch (error) {
      toast.error(errorMessage(error));
      if (error instanceof ApiError && error.code === "DOCUMENT_NOT_READY") setStep(0);
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!order) return;
    setBusy(true);
    try {
      const res = await api<{ order: Order }>(`/orders/${order.id}/confirm`, { body: {} });
      setOrder(res.order);
      qc.invalidateQueries({ queryKey: ["orders"] });
      toast.success(`Commande ${res.order.reference} enregistrée.`);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const goTo = (i: number) => {
    if (i === 3 && !order) return void goToReview();
    if (order && order.status === "DRAFT" && i < 3) setOrder(null);
    setStep(i);
  };

  const removeDoc = (key: string) => {
    setDocs((list) => list.filter((d) => d.key !== key));
    setOrder(null);
  };

  if (initializing) return <Spinner label="Préparation de votre commande…" />;

  const confirmed = order && order.status !== "DRAFT";
  const totals = estimate.data?.totals;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Nouvelle commande</h1>
          <p className="text-sm text-muted-foreground">Impression de documents — prix calculé en temps réel.</p>
        </div>
        {group && (
          <Alert variant="info" title={group.kind === "delegate" ? `Commande pour le lot « ${group.name} »` : `Contribution à la collecte « ${group.name} »`}>
            {group.kind === "delegate"
              ? `Les paramètres du lot ${group.code} sont appliqués par défaut ; vous pouvez faire des exceptions par fichier.`
              : `Vos documents seront remis au délégué${group.pickupPointName ? ` (${group.pickupPointName})` : ""}. Vous payez uniquement votre part.`}
          </Alert>
        )}
        {!confirmed && <Stepper current={step} onSelect={goTo} maxReachable={maxReachable} />}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-6">
          {/* Étape 1 : documents */}
          {step === 0 && (
            <Card>
              <CardHeader>
                <CardTitle>1. Téléversez vos documents</CardTitle>
                <CardDescription>Ajoutez autant de fichiers que nécessaire (jusqu&apos;à {config.uploads.maxFilesPerOrder}). Le nombre de pages est détecté automatiquement.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Dropzone onFiles={addFiles} accept={config.uploads.acceptedExtensions} maxSizeMb={config.uploads.maxFileSizeMb} />
                <div className="flex justify-end">
                  <Button variant="ghost" size="sm" onClick={() => setLibraryOpen(true)}>
                    <FolderOpen /> Ajouter depuis mes documents
                  </Button>
                </div>
                {docs.length > 0 && (
                  <ul className="space-y-2">
                    {docs.map((d) => (
                      <DocumentRow
                        key={d.key}
                        doc={d}
                        options={effectiveOptions(d, defaults)}
                        price={priceFor(d.key)?.price}
                        priceError={priceFor(d.key)?.error?.message}
                        config={config}
                        mode="documents"
                        onRemove={() => removeDoc(d.key)}
                        onRetry={async () => {
                          try {
                            const r = await api<{ document: ApiDocument }>(`/documents/${d.document!.id}/retry`, { body: {} });
                            updateDoc(d.key, { document: r.document, phase: "processing", error: undefined });
                          } catch (e) {
                            toast.error(errorMessage(e));
                          }
                        }}
                        onDeclarePages={async (pages) => {
                          try {
                            const r = await api<{ document: ApiDocument }>(`/documents/${d.document!.id}/declare-pages`, { body: { pageCount: pages } });
                            updateDoc(d.key, { document: r.document });
                          } catch (e) {
                            toast.error(errorMessage(e));
                          }
                        }}
                        onCustomize={() => undefined}
                        onChangeOptions={() => undefined}
                        onCopyToAll={() => undefined}
                      />
                    ))}
                  </ul>
                )}
                {blockingDocs.length > 0 && (
                  <Alert variant="warning">
                    {plural(blockingDocs.length, "document")} à corriger ou retirer avant de continuer (fichier refusé, en échec ou nombre de pages à confirmer).
                  </Alert>
                )}
              </CardContent>
            </Card>
          )}

          {/* Étape 2 : options d'impression */}
          {step === 1 && (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Layers className="size-5 text-primary" /> 2. Options d&apos;impression communes
                  </CardTitle>
                  <CardDescription>Ces paramètres s&apos;appliquent à tous les documents, sauf ceux que vous personnalisez.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <PrintOptionsForm value={defaults} onChange={setDefaults} config={config} />
                  {!isAvailable(config, defaults) && <Alert variant="warning">Cette combinaison n&apos;est pas encore disponible. Choisissez d&apos;autres options.</Alert>}
                  {docs.some((d) => d.custom) && (
                    <Button
                      variant="outline"
                      onClick={() => {
                        setDocs((list) => list.map((d) => ({ ...d, custom: false })));
                        toast.success("Paramètres appliqués à tous les documents.");
                      }}
                    >
                      <CheckCircle2 /> Appliquer à tous les documents
                    </Button>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Documents ({docs.length})</CardTitle>
                  <CardDescription>Modifiez un document particulier si besoin, ou dupliquez ses paramètres vers tous les autres.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <ul className="space-y-2">
                    {docs.map((d) => (
                      <DocumentRow
                        key={d.key}
                        doc={d}
                        options={effectiveOptions(d, defaults)}
                        price={priceFor(d.key)?.price}
                        priceError={priceFor(d.key)?.error?.message}
                        config={config}
                        mode="options"
                        onRemove={() => removeDoc(d.key)}
                        onRetry={() => undefined}
                        onDeclarePages={async () => undefined}
                        onCustomize={(custom) => updateDoc(d.key, { custom, options: custom ? effectiveOptions(d, defaults) : d.options })}
                        onChangeOptions={(o) => updateDoc(d.key, { options: o, custom: true })}
                        onCopyToAll={() => {
                          setDefaults(d.options);
                          setDocs((list) => list.map((x) => ({ ...x, custom: false })));
                          toast.success("Paramètres dupliqués sur tous les documents.");
                        }}
                      />
                    ))}
                  </ul>
                  <Field label="Remarques (optionnel)" htmlFor="notes">
                    <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} placeholder="Ex. : pages à agrafer, ordre particulier…" />
                  </Field>
                </CardContent>
              </Card>
            </>
          )}

          {/* Étape 3 : retrait ou livraison */}
          {step === 2 && (
            <Card>
              <CardHeader>
                <CardTitle>3. Retrait ou livraison</CardTitle>
                <CardDescription>Choisissez comment récupérer vos documents.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                {group?.kind === "contribution" ? (
                  <Alert variant="info" title="Remise groupée">
                    Les documents de la collecte sont remis au délégué{group.pickupPointName ? ` au point de retrait « ${group.pickupPointName} »` : ""}.
                  </Alert>
                ) : (
                  <>
                    <ChoiceGroup
                      ariaLabel="Mode de remise"
                      value={fulfillment.method}
                      onChange={(method) => setFulfillment((f) => ({ ...f, method }))}
                      options={[
                        { value: "PICKUP", label: "Retrait sur place", description: "Gratuit", icon: <MapPin className="size-4 text-primary" /> },
                        {
                          value: "DELIVERY",
                          label: "Livraison",
                          description: config.delivery.enabled ? "Frais selon le quartier" : "Momentanément indisponible",
                          icon: <Truck className="size-4 text-primary" />,
                          disabled: !config.delivery.enabled,
                        },
                      ]}
                    />
                    {fulfillment.method === "PICKUP" ? (
                      <ChoiceGroup
                        ariaLabel="Point de retrait"
                        value={fulfillment.pickupPointId}
                        onChange={(pickupPointId) => setFulfillment((f) => ({ ...f, pickupPointId }))}
                        columns={2}
                        options={config.pickupPoints.map((p) => ({ value: p.id, label: p.name, description: [p.address, p.hours].filter(Boolean).join(" · ") }))}
                      />
                    ) : (
                      <div className="grid gap-4 sm:grid-cols-2">
                        <Field label="Nom du destinataire" htmlFor="rn">
                          <Input id="rn" value={fulfillment.recipientName} onChange={(e) => setFulfillment((f) => ({ ...f, recipientName: e.target.value }))} />
                        </Field>
                        <Field label="Téléphone" htmlFor="rp">
                          <Input id="rp" type="tel" value={fulfillment.phone} onChange={(e) => setFulfillment((f) => ({ ...f, phone: e.target.value }))} />
                        </Field>
                        <Field label="Quartier" htmlFor="rz">
                          <NativeSelect
                            id="rz"
                            value={fulfillment.zoneId || "__other"}
                            onChange={(e) => {
                              const zone = config.delivery.zones.find((z) => z.id === e.target.value);
                              setFulfillment((f) => ({ ...f, zoneId: zone?.id ?? "", quarter: zone?.name ?? (f.zoneId ? "" : f.quarter) }));
                            }}
                          >
                            {config.delivery.zones.map((z) => (
                              <option key={z.id} value={z.id}>
                                {z.name} — {fcfa(z.fee)}
                              </option>
                            ))}
                            <option value="__other">Autre quartier{config.delivery.defaultFee === null ? " (frais à confirmer)" : ""}</option>
                          </NativeSelect>
                        </Field>
                        {!fulfillment.zoneId && (
                          <Field label="Nom du quartier" htmlFor="rq">
                            <Input id="rq" value={fulfillment.quarter} onChange={(e) => setFulfillment((f) => ({ ...f, quarter: e.target.value }))} placeholder="Ex. Mvog-Ada" />
                          </Field>
                        )}
                        <Field label="Indications (repères, horaires…)" htmlFor="rd" className="sm:col-span-2">
                          <Textarea id="rd" value={fulfillment.directions} onChange={(e) => setFulfillment((f) => ({ ...f, directions: e.target.value }))} maxLength={500} placeholder="Ex. Yaoundé, Mvog-Ada, près de la pharmacie, BP 1234…" />
                        </Field>
                        <div className="sm:col-span-2">
                          <Alert variant="info">
                            <span className="inline-flex items-center gap-1.5">
                              <Zap className="size-3.5" /> Livraison express dans la journée possible, sans supplément automatique.
                            </span>
                            {estimate.data?.delivery.fee === null && <span className="mt-1 block font-medium">Frais de livraison à confirmer par notre équipe : le paiement sera possible dès leur validation.</span>}
                          </Alert>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          )}

          {/* Étape 4 : récapitulatif et paiement */}
          {step === 3 && order && (
            <>
              {confirmed ? (
                <Card className="border-green-200">
                  <CardContent className="flex flex-col items-center gap-3 pt-6 text-center">
                    <div className="flex size-14 items-center justify-center rounded-full bg-green-100 text-green-600">
                      <CheckCircle2 className="size-8" />
                    </div>
                    <h2 className="text-xl font-bold">Commande {order.reference} enregistrée !</h2>
                    <p className="max-w-md text-sm text-muted-foreground">
                      Votre commande est en attente de paiement. L&apos;impression démarre dès que le paiement est confirmé.
                    </p>
                    <Button variant="outline" asChild>
                      <Link href={`/espace/commandes/${order.id}`}>Voir le détail de la commande</Link>
                    </Button>
                  </CardContent>
                </Card>
              ) : (
                <Card>
                  <CardHeader>
                    <CardTitle>4. Récapitulatif</CardTitle>
                    <CardDescription>Montants calculés par nos serveurs. Ils seront figés à la confirmation.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <ul className="divide-y rounded-lg border">
                      {order.items.map((i) => (
                        <li key={i.id} className="flex items-start justify-between gap-3 p-3 text-sm">
                          <div className="min-w-0">
                            <p className="truncate font-medium">{i.documentName}</p>
                            <p className="text-xs text-muted-foreground">
                              {i.pageCount} p. · {i.sheets} feuille(s) · {i.options ? optionsSummary(i.options) : ""}
                            </p>
                          </div>
                          <span className="font-semibold whitespace-nowrap">{fcfa(i.lineTotal)}</span>
                        </li>
                      ))}
                    </ul>
                    <div className="grid gap-2 text-sm sm:grid-cols-2">
                      <div className="rounded-lg bg-slate-50 p-3">
                        <p className="text-xs text-muted-foreground">Remise</p>
                        <p className="font-medium">
                          {order.fulfillmentMethod === "DELIVERY" ? `Livraison — ${order.delivery?.quarter}` : `Retrait — ${order.pickupPoint?.name ?? ""}`}
                        </p>
                      </div>
                      <div className="rounded-lg bg-slate-50 p-3">
                        <p className="text-xs text-muted-foreground">Mode de paiement</p>
                        <p className="font-medium">{config.payments.enabled ? "Fapshi — Mobile Money / Orange Money" : "Paiement en ligne indisponible"}</p>
                      </div>
                    </div>
                    {order.notes && <p className="text-sm text-muted-foreground">Remarques : {order.notes}</p>}
                    {order.total === null && <Alert variant="warning">Les frais de livraison seront confirmés par notre équipe. Vous pourrez payer dès leur validation.</Alert>}
                    <Alert variant="info">Statut du paiement : non payé. La commande ne sera imprimée qu&apos;après confirmation du paiement.</Alert>
                  </CardContent>
                </Card>
              )}
              {confirmed && order.status === "PENDING_PAYMENT" && <PaymentPanel order={order} />}
            </>
          )}

          {!confirmed && (
            <div className="flex items-center justify-between gap-3">
              <Button variant="ghost" onClick={() => goTo(step - 1)} disabled={step === 0 || busy}>
                <ArrowLeft /> Retour
              </Button>
              {step < 2 && (
                <Button onClick={() => goTo(step + 1)} disabled={step === 0 ? !step1Ok : !step2Ok}>
                  Continuer <ArrowRight />
                </Button>
              )}
              {step === 2 && (
                <Button onClick={goToReview} disabled={!step3Ok} loading={busy}>
                  Voir le récapitulatif <ArrowRight />
                </Button>
              )}
              {step === 3 && order && (
                <Button size="lg" onClick={confirm} loading={busy}>
                  Confirmer la commande
                </Button>
              )}
            </div>
          )}
        </div>

        {/* Récapitulatif latéral */}
        <aside className="lg:sticky lg:top-20 lg:self-start">
          <Card>
            <CardHeader>
              <CardTitle>Récapitulatif de la commande</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Documents</span>
                <span className="font-medium">{docs.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Pages</span>
                <span className="font-medium">{totals?.totalPages ?? readyDocs.reduce((s, d) => s + (d.document?.pageCount ?? 0), 0)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Feuilles</span>
                <span className="font-medium">{totals?.totalSheets ?? "—"}</span>
              </div>
              <div className="rounded-lg bg-slate-50 p-2.5 text-xs text-slate-600">{optionsSummary(defaults)}</div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Remise</span>
                <span className="font-medium">{group?.kind === "contribution" || fulfillment.method === "PICKUP" ? "Retrait" : "Livraison"}</span>
              </div>
              {fulfillment.method === "DELIVERY" && group?.kind !== "contribution" && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Livraison</span>
                  <span className="font-medium">{fcfa(order ? order.deliveryFee : (estimate.data?.delivery.fee ?? null))}</span>
                </div>
              )}
              <div className="flex items-baseline justify-between border-t pt-3">
                <span className="font-semibold text-primary">{order ? "Total" : "Total estimé"}</span>
                <span className={`text-xl font-bold text-primary ${estimate.isFetching ? "opacity-60" : ""}`}>
                  {order ? fcfa(order.total) : totals ? fcfa(totals.total) : fcfa(0)}
                </span>
              </div>
              {pendingDocs.length > 0 && <p className="text-xs text-muted-foreground">{plural(pendingDocs.length, "document")} en cours de traitement…</p>}
            </CardContent>
          </Card>
          {group?.kind === "delegate" && (
            <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
              <Users className="size-4" /> Lot {group.code}
            </p>
          )}
        </aside>
      </div>

      <LibraryDialog
        open={libraryOpen}
        onOpenChange={setLibraryOpen}
        exclude={docs.map((d) => d.document?.id).filter((x): x is string => Boolean(x))}
        onPick={(picked) => {
          setDocs((list) => [...list, ...picked.map((d) => docFromApi(d, defaults))]);
          setOrder(null);
        }}
      />
    </div>
  );
}

function LibraryDialog({ open, onOpenChange, exclude, onPick }: { open: boolean; onOpenChange: (o: boolean) => void; exclude: string[]; onPick: (docs: ApiDocument[]) => void }) {
  const [selected, setSelected] = useState<string[]>([]);
  const { data, isLoading } = useQuery({
    queryKey: ["documents", "library"],
    queryFn: () => api<Paginated<ApiDocument>>("/documents?pageSize=50"),
    enabled: open,
  });
  const items = (data?.items ?? []).filter((d) => d.status === "READY" && !exclude.includes(d.id));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Mes documents</DialogTitle>
          <DialogDescription>Réutilisez un fichier déjà téléversé (conservé selon notre politique de conservation).</DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <Spinner />
        ) : items.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Aucun document disponible.</p>
        ) : (
          <ul className="max-h-80 space-y-1 overflow-y-auto">
            {items.map((d) => (
              <li key={d.id}>
                <label className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 hover:bg-slate-50">
                  <input
                    type="checkbox"
                    className="size-4 accent-[var(--primary)]"
                    checked={selected.includes(d.id)}
                    onChange={(e) => setSelected((s) => (e.target.checked ? [...s, d.id] : s.filter((x) => x !== d.id)))}
                  />
                  <span className="min-w-0 flex-1 truncate text-sm">{d.originalName}</span>
                  <span className="text-xs text-muted-foreground">{d.pageCount} p.</span>
                </label>
              </li>
            ))}
          </ul>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button
            disabled={selected.length === 0}
            onClick={() => {
              onPick(items.filter((d) => selected.includes(d.id)));
              setSelected([]);
              onOpenChange(false);
            }}
          >
            Ajouter {selected.length > 0 ? `(${selected.length})` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NewOrderPage() {
  const { data: config, isLoading, error, refetch } = usePublicConfig();
  if (isLoading) return <Spinner />;
  if (error || !config) return <ErrorState message="Configuration indisponible." onRetry={() => refetch()} />;
  return <WizardInner config={config} />;
}

export default function Page() {
  return (
    <Suspense fallback={<Spinner />}>
      <NewOrderPage />
    </Suspense>
  );
}
