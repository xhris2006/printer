import { createWriteStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";
import type { Prisma, User } from "@prisma/client";
import yazl from "yazl";
import { prisma } from "../../lib/prisma";
import { logger } from "../../lib/logger";
import { conflict, forbidden, notFound } from "../../lib/errors";
import { formatDateFr, formatFcfa } from "../../lib/format";
import { secureToken } from "../../lib/ids";
import { enqueue, registerJobHandler } from "../../jobs/queue";
import { audit } from "../audit/audit";
import { getStorage } from "../storage/storage";
import { STATUS_LABELS } from "../orders/status";

/**
 * Archives ZIP des fichiers à imprimer (commande ou commande groupée), avec une
 * fiche de production. L'archive est déposée dans le stockage privé puis servie
 * par un lien signé de courte durée ; elle est supprimée automatiquement.
 */

const EXPORT_PREFIX = "exports/";
const EXPORT_TTL_MS = 2 * 60 * 60 * 1000;
const DOWNLOAD_TTL_SEC = 600;
const MAX_ARCHIVE_BYTES = 2 * 1024 * 1024 * 1024;

const COLOR_LABELS = { BW: "Noir et blanc", COLOR: "Couleur" } as const;
const SIDES_LABELS = { SINGLE: "Recto", DOUBLE: "Recto verso" } as const;

const exportOrderInclude = {
  customer: { select: { fullName: true, phone: true } },
  pickupPoint: { select: { name: true } },
  delivery: { select: { recipientName: true, phone: true, quarter: true, directions: true } },
  groupOrder: { select: { code: true, name: true } },
  items: { orderBy: { position: "asc" }, include: { document: true, printConfig: { include: { finishing: true } } } },
  quote: { include: { documents: true } },
} satisfies Prisma.OrderInclude;

type ExportOrder = Prisma.OrderGetPayload<{ include: typeof exportOrderInclude }>;
type ExportDocument = ExportOrder["items"][number]["document"];

interface FileEntry {
  key: string;
  /** Chemin dans l'archive */
  name: string;
}

export interface ArchiveResult {
  url: string;
  filename: string;
  expiresInSec: number;
  fileCount: number;
  missingCount: number;
}

/** Nom de fichier lisible par tous les décompresseurs (ASCII, sans caractères réservés). */
export function archiveName(name: string, maxLength = 100) {
  const ascii = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, "_")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  return (ascii || "document").slice(0, maxLength).trim();
}

const pad = (n: number) => String(n).padStart(2, "0");
const isDownloadable = (doc: ExportDocument): doc is NonNullable<ExportDocument> =>
  Boolean(doc && doc.status !== "DELETED" && !doc.purgedAt);
const isPrintable = (o: { paymentStatus: string; creditApproved: boolean }) => o.paymentStatus === "PAID" || o.creditApproved;

function paymentLine(order: ExportOrder) {
  if (order.paymentStatus === "PAID") return `Payé (${formatFcfa(order.amountPaid)})`;
  if (order.creditApproved) return `Autorisé sans paiement${order.creditReason ? ` : ${order.creditReason}` : ""}`;
  return "NON PAYÉ — ne pas imprimer avant confirmation";
}

function fulfillmentLine(order: ExportOrder) {
  if (order.fulfillmentMethod === "DELIVERY" && order.delivery) {
    const d = order.delivery;
    return `Livraison — ${d.quarter}${d.directions ? ` (${d.directions})` : ""} — ${d.recipientName}, ${d.phone}`;
  }
  return `Retrait${order.pickupPoint ? ` — ${order.pickupPoint.name}` : ""}`;
}

/** Fichiers d'une commande (originaux + PDF convertis) et lignes de la fiche correspondantes. */
function orderSection(order: ExportOrder, folder: string) {
  const files: FileEntry[] = [];
  const lines: string[] = [];
  const printItems = order.items.filter((i) => i.kind === "PRINT" || i.document);
  order.items.forEach((item, index) => {
    const n = pad(index + 1);
    const doc = item.document;
    const title = item.documentName ?? doc?.originalName ?? item.description ?? "Prestation";
    lines.push(`${n}. ${title}`);
    if (doc) {
      if (isDownloadable(doc)) {
        const base = archiveName(doc.originalName.replace(/\.[^.]+$/, ""));
        const originalName = `${folder}${n}_${base}.${archiveName(doc.extension, 10).toLowerCase()}`;
        files.push({ key: doc.storageKey, name: originalName });
        let pdfName: string | null = null;
        if (doc.pdfStorageKey && doc.pdfStorageKey !== doc.storageKey && doc.extension.toLowerCase() !== "pdf") {
          pdfName = `${folder}${n}_${base}.pdf`;
          files.push({ key: doc.pdfStorageKey, name: pdfName });
        }
        lines.push(`    Fichier : ${originalName.slice(folder.length)}${pdfName ? `  |  PDF à imprimer : ${pdfName.slice(folder.length)}` : ""}`);
      } else {
        lines.push("    Fichier : indisponible (supprimé selon la politique de conservation)");
      }
    }
    const c = item.printConfig;
    if (c) {
      lines.push(
        `    ${item.pageCount} page(s) · ${item.copies} exemplaire(s) · ${COLOR_LABELS[c.colorMode]} · ${SIDES_LABELS[c.sides]} · ${c.paperFormat}` +
          (c.finishingCode !== "NONE" ? ` · Finition : ${c.finishing.label}` : ""),
      );
      lines.push(`    Feuilles : ${item.sheets} · Faces imprimées : ${item.faces}`);
    } else if (item.description) {
      lines.push(`    ${item.description}`);
    }
  });
  if (order.quote) {
    order.quote.documents.filter(isDownloadable).forEach((doc, index) => {
      const name = `${folder}devis_${pad(index + 1)}_${archiveName(doc.originalName)}`;
      files.push({ key: doc.storageKey, name });
      lines.push(`Pièce jointe du devis : ${name.slice(folder.length)}`);
    });
  }
  const faces = printItems.reduce((s, i) => s + i.faces, 0);
  const sheets = printItems.reduce((s, i) => s + i.sheets, 0);
  return { files, lines, faces, sheets };
}

function orderHeader(order: ExportOrder) {
  return [
    `Commande     : ${order.reference}`,
    `Client       : ${order.customer.fullName} (${order.customer.phone})`,
    `Statut       : ${STATUS_LABELS[order.status]}`,
    `Paiement     : ${paymentLine(order)}`,
    `Remise       : ${fulfillmentLine(order)}`,
    ...(order.groupOrder ? [`Groupe       : ${order.groupOrder.code} — ${order.groupOrder.name}`] : []),
    ...(order.notes ? [`Note client  : ${order.notes}`] : []),
  ];
}

/** Télécharge les fichiers, construit le ZIP puis le dépose dans le stockage privé. */
async function buildArchive(files: FileEntry[], sheet: (missing: string[]) => string, downloadName: string): Promise<ArchiveResult> {
  const storage = getStorage();
  const workDir = await mkdtemp(path.join(tmpdir(), "ps-export-"));
  try {
    const zip = new yazl.ZipFile();
    const missing: string[] = [];
    let total = 0;
    let added = 0;
    for (const [index, file] of files.entries()) {
      const local = path.join(workDir, `f${index}`);
      try {
        await storage.downloadToFile(file.key, local);
      } catch (error) {
        logger.warn({ err: error, key: file.key }, "Fichier absent du stockage lors de l'export");
        missing.push(file.name);
        continue;
      }
      total += (await stat(local)).size;
      if (total > MAX_ARCHIVE_BYTES) {
        throw conflict("Archive trop volumineuse (plus de 2 Go) : téléchargez les fichiers un par un.", "ARCHIVE_TOO_LARGE");
      }
      // PDF, images et DOCX sont déjà compressés : stockage sans recompression (plus rapide)
      zip.addFile(local, file.name, { compress: false });
      added++;
    }
    if (added === 0) throw conflict("Aucun fichier disponible pour cette sélection (fichiers supprimés ou introuvables).", "NO_FILES");
    zip.addBuffer(Buffer.from(`\uFEFF${sheet(missing).replace(/\n/g, "\r\n")}`, "utf8"), "00_FICHE_PRODUCTION.txt");
    zip.end();
    const zipPath = path.join(workDir, "archive.zip");
    await pipeline(zip.outputStream as Readable, createWriteStream(zipPath, { mode: 0o600 }));

    const key = `${EXPORT_PREFIX}${new Date().toISOString().slice(0, 10)}/${secureToken(16)}.zip`;
    await storage.putFile(key, zipPath, "application/zip");
    await enqueue("storage.deleteExport", { key }, { runAt: new Date(Date.now() + EXPORT_TTL_MS), maxAttempts: 5 });
    const url = await storage.getDownloadUrl(key, { filename: downloadName, expiresInSec: DOWNLOAD_TTL_SEC });
    return { url, filename: downloadName, expiresInSec: DOWNLOAD_TTL_SEC, fileCount: added, missingCount: missing.length };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

function sheetFooter(missing: string[]) {
  return [
    ...(missing.length > 0 ? ["", "ATTENTION — fichiers introuvables dans le stockage :", ...missing.map((m) => `  - ${m}`)] : []),
    "",
    `Généré le ${formatDateFr(new Date())} — Print & Secrétariat`,
  ];
}

/**
 * Archive des fichiers d'une commande. L'administrateur y accède dès la
 * confirmation ; l'opérateur uniquement pour une commande payée ou autorisée.
 */
export async function createOrderArchive(user: User, orderId: string, ip?: string): Promise<ArchiveResult> {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: exportOrderInclude });
  if (!order || order.status === "DRAFT") throw notFound("Commande introuvable.");
  if (user.roleCode === "OPERATOR" && !isPrintable(order)) throw forbidden("Fichiers accessibles après confirmation du paiement.");
  const section = orderSection(order, "");
  if (section.files.length === 0) throw conflict("Aucun fichier disponible pour cette commande (fichiers supprimés selon la politique de conservation).", "NO_FILES");

  const result = await buildArchive(
    section.files,
    (missing) =>
      [
        "PRINT & SECRÉTARIAT — FICHE DE PRODUCTION",
        "=========================================",
        ...orderHeader(order),
        "",
        `DOCUMENTS (${order.items.length})`,
        "---------",
        ...section.lines,
        "",
        `Total : ${section.faces} face(s) imprimée(s) · ${section.sheets} feuille(s)`,
        ...sheetFooter(missing),
      ].join("\n"),
    `${order.reference}-fichiers.zip`,
  );
  await audit({ actorId: user.id, action: "order.files_exported", entityType: "Order", entityId: order.id, metadata: { files: result.fileCount, missing: result.missingCount }, ip });
  return result;
}

/** Archive d'une commande groupée : un dossier par contribution payée (ou autorisée). */
export async function createGroupArchive(user: User, groupId: string, ip?: string): Promise<ArchiveResult> {
  const group = await prisma.groupOrder.findUnique({
    where: { id: groupId },
    include: {
      delegate: { select: { fullName: true, phone: true } },
      pickupPoint: { select: { name: true } },
      contributions: { orderBy: { createdAt: "asc" }, include: { order: { include: exportOrderInclude } } },
    },
  });
  if (!group) throw notFound("Commande groupée introuvable.");
  const eligible = group.contributions
    .map((c) => c.order)
    .filter((o) => !["DRAFT", "CANCELLED", "REFUNDED"].includes(o.status) && isPrintable(o));
  const unpaid = group.contributions.filter((c) => !["DRAFT", "CANCELLED", "REFUNDED"].includes(c.order.status) && !isPrintable(c.order)).length;
  if (eligible.length === 0) throw conflict("Aucune commande payée ou autorisée dans ce groupe.", "NO_FILES");

  const files: FileEntry[] = [];
  const lines: string[] = [];
  let faces = 0;
  let sheets = 0;
  eligible.forEach((order, index) => {
    const folder = `${pad(index + 1)}_${archiveName(order.customer.fullName, 40)}_${order.reference}/`;
    const section = orderSection(order, folder);
    files.push(...section.files);
    faces += section.faces;
    sheets += section.sheets;
    lines.push(`[${folder}]`, ...orderHeader(order).map((l) => `  ${l}`), ...section.lines.map((l) => `  ${l}`), "");
  });

  const result = await buildArchive(
    files,
    (missing) =>
      [
        "PRINT & SECRÉTARIAT — FICHE DE PRODUCTION (COMMANDE GROUPÉE)",
        "============================================================",
        `Groupe       : ${group.code} — ${group.name}`,
        `Classe       : ${group.institution} — ${group.field} — ${group.level} — ${group.className}`,
        ...(group.category ? [`Matière      : ${group.category}`] : []),
        `Délégué      : ${group.delegate.fullName} (${group.delegate.phone})`,
        `Retrait      : ${group.pickupPoint?.name ?? "—"}`,
        ...(group.instructions ? [`Consignes    : ${group.instructions}`] : []),
        `Commandes    : ${eligible.length} à imprimer${unpaid > 0 ? ` (${unpaid} non payée(s) exclue(s))` : ""}`,
        `Total        : ${faces} face(s) imprimée(s) · ${sheets} feuille(s)`,
        "",
        ...lines,
        ...sheetFooter(missing),
      ].join("\n"),
    `${group.code}-fichiers.zip`,
  );
  await audit({ actorId: user.id, action: "group.files_exported", entityType: "GroupOrder", entityId: group.id, metadata: { orders: eligible.length, files: result.fileCount, missing: result.missingCount }, ip });
  return result;
}

registerJobHandler("storage.deleteExport", async (payload) => {
  const { key } = payload as { key?: string };
  if (typeof key !== "string" || !key.startsWith(EXPORT_PREFIX)) return;
  await getStorage().delete(key);
});
