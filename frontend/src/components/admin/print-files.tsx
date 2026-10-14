"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, FileText, FileWarning, FolderDown, Printer } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { formatBytes, plural, whatsappLink } from "@/lib/format";
import { optionsSummary } from "@/lib/labels";
import type { Order, Role } from "@/lib/types";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert } from "@/components/ui/feedback";
import { WhatsAppIcon } from "@/components/layout/whatsapp-button";

/**
 * Lien direct de téléchargement : l'API répond par une redirection vers un lien
 * signé de quelques minutes. Un simple <a href> fonctionne partout (pas de pop-up
 * bloqué sur mobile, appui long « ouvrir dans un nouvel onglet », etc.).
 */
export function adminDocumentHref(documentId: string, variant: "original" | "pdf") {
  return `/api/admin/documents/${documentId}/download?variant=${variant}&redirect=1`;
}

interface ArchiveResponse {
  url: string;
  filename: string;
  fileCount: number;
  missingCount: number;
}

/** Prépare l'archive ZIP (fichiers + fiche de production) puis lance le téléchargement. */
export function ArchiveButton({ path, label = "Tout télécharger (ZIP)", ...props }: { path: string; label?: string } & Omit<ButtonProps, "onClick">) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const archive = await api<ArchiveResponse>(path);
      if (archive.missingCount > 0) {
        toast.warning(`${plural(archive.missingCount, "fichier")} introuvable(s) : voir la fiche de production dans l'archive.`);
      } else {
        toast.success(`Archive prête : ${plural(archive.fileCount, "fichier")} + fiche de production.`);
      }
      // Navigation dans la page courante (et non window.open) : jamais bloquée
      window.location.assign(archive.url);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button onClick={run} loading={busy} {...props}>
      {!busy && <FolderDown />}
      {busy ? "Préparation de l'archive…" : label}
    </Button>
  );
}

/** Fichiers du client à télécharger et imprimer, en tête de la fiche commande. */
export function PrintFilesCard({ order, role }: { order: Order; role?: Role }) {
  const files = order.items.filter((i) => i.documentId);
  const printable = order.paymentStatus === "PAID" || order.creditApproved;
  const locked = role === "OPERATOR" && !printable;
  // Vérifie que chaque fichier existe encore dans le stockage (fichiers perdus avec un ancien disque non persistant)
  const { data: check } = useQuery({
    queryKey: ["admin", "order", order.id, "files-check"],
    queryFn: () => api<{ checked: number; missing: string[] }>(`/admin/orders/${order.id}/files-check`),
    enabled: files.length > 0 && !locked,
    staleTime: 60_000,
  });
  const missing = new Set(check?.missing ?? []);
  const available = files.filter((i) => i.documentAvailable && !missing.has(i.documentId!));
  if (files.length === 0) return null;
  const askAgain = (name: string | null) =>
    order.customer?.phone
      ? whatsappLink(
          order.customer.phone,
          `Bonjour ${order.customer.fullName}, le fichier « ${name ?? "document"} » de votre commande ${order.reference} n'a pas pu être récupéré sur notre serveur. Pouvez-vous nous le renvoyer ici ? Merci.`,
        )
      : null;

  return (
    <Card className="border-primary/30" data-testid="print-files">
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle className="flex items-center gap-2">
          <Printer className="size-5 text-primary" aria-hidden /> Fichiers à imprimer
          <span className="text-sm font-normal text-muted-foreground">({files.length})</span>
        </CardTitle>
        {!locked && available.length > 0 && <ArchiveButton path={`/admin/orders/${order.id}/archive`} className="w-full sm:w-auto" />}
      </CardHeader>
      <CardContent className="space-y-3">
        {locked && <Alert variant="info">Les fichiers seront accessibles dès que le paiement sera confirmé.</Alert>}
        {!locked && !printable && order.status !== "CANCELLED" && (
          <Alert variant="warning">Commande non payée : consultez les fichiers si besoin, mais n&apos;imprimez pas avant la confirmation du paiement.</Alert>
        )}
        {missing.size > 0 && (
          <Alert variant="error" title={missing.size > 1 ? `${missing.size} fichiers introuvables sur le serveur` : "1 fichier introuvable sur le serveur"}>
            {missing.size > 1 ? "Ces fichiers ont été perdus" : "Ce fichier a été perdu"} (ancien stockage non persistant). Demandez au client de{" "}
            {missing.size > 1 ? "les" : "le"} renvoyer, par exemple sur WhatsApp.
          </Alert>
        )}
        <ul className="divide-y rounded-lg border">
          {files.map((item, index) => (
            <li key={item.id} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-start gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-accent text-xs font-bold text-primary">{String(index + 1).padStart(2, "0")}</span>
                <div className="min-w-0">
                  <p className="font-medium break-words">{item.documentName}</p>
                  <p className="text-xs text-muted-foreground">
                    {item.pageCount} p. · {plural(item.copies, "exemplaire")}
                    {item.options ? ` · ${optionsSummary(item.options)}` : ""}
                    {item.documentSizeBytes ? ` · ${formatBytes(item.documentSizeBytes)}` : ""}
                  </p>
                </div>
              </div>
              {!item.documentAvailable ? (
                <span className="text-xs text-muted-foreground sm:text-right">Fichier supprimé (politique de conservation)</span>
              ) : missing.has(item.documentId!) ? (
                <div className="flex flex-col gap-2 sm:items-end">
                  <span className="flex items-center gap-1 text-xs font-semibold text-red-700">
                    <FileWarning className="size-4" aria-hidden /> Fichier introuvable sur le serveur
                  </span>
                  {askAgain(item.documentName) && (
                    <Button variant="outline" size="sm" asChild>
                      <a href={askAgain(item.documentName)!} target="_blank" rel="noopener noreferrer">
                        <WhatsAppIcon className="text-green-600" /> Demander au client
                      </a>
                    </Button>
                  )}
                </div>
              ) : locked ? null : (
                <div className="grid grid-cols-2 gap-2 sm:flex sm:shrink-0">
                  <Button variant="outline" size="sm" asChild>
                    <a href={adminDocumentHref(item.documentId!, "pdf")} target="_blank" rel="noopener" aria-label={`Ouvrir pour imprimer : ${item.documentName}`}>
                      <FileText /> {item.documentHasPdf ? "Ouvrir le PDF" : "Ouvrir"}
                    </a>
                  </Button>
                  <Button variant="secondary" size="sm" asChild>
                    <a href={adminDocumentHref(item.documentId!, "original")} aria-label={`Télécharger : ${item.documentName}`}>
                      <Download /> Télécharger
                    </a>
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
        {!locked && available.length > 0 && (
          <p className="text-xs text-muted-foreground">
            « Ouvrir » affiche le fichier (version PDF pour les documents Word) pour l&apos;imprimer directement ; l&apos;archive ZIP contient tous les fichiers et une fiche de production.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
