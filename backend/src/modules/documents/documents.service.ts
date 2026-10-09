import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Document, User } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { logger } from "../../lib/logger";
import { badRequest, forbidden, notFound } from "../../lib/errors";
import { enqueue, registerJobHandler } from "../../jobs/queue";
import { getStorage } from "../storage/storage";
import { getSettings } from "../settings/settings.service";
import { scanFile } from "./antivirus";
import { analyzeFile } from "./analyzer";
import { EXTENSION_KINDS, extensionOf, sanitizeFileName } from "./fileType";
import { isStaff } from "../../middleware/auth";

export function serializeDocument(doc: Document) {
  return {
    id: doc.id,
    originalName: doc.originalName,
    extension: doc.extension,
    kind: doc.kind ?? EXTENSION_KINDS[doc.extension] ?? null,
    sizeBytes: doc.sizeBytes,
    pageCount: doc.pageCount,
    pageCountSource: doc.pageCountSource,
    status: doc.status,
    analysisError: doc.analysisError,
    hasPdfVersion: Boolean(doc.pdfStorageKey),
    createdAt: doc.createdAt,
    analyzedAt: doc.analyzedAt,
  };
}

function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(filePath)
      .on("data", (c) => hash.update(c))
      .on("end", () => resolve(hash.digest("hex")))
      .on("error", reject);
  });
}

export async function requestUpload(user: User, input: { fileName: string; size: number; mimeType?: string }) {
  const settings = await getSettings();
  const fileName = sanitizeFileName(input.fileName);
  const extension = extensionOf(fileName);
  const kind = EXTENSION_KINDS[extension];
  if (!kind) throw badRequest("Format non accepté. Formats acceptés : PDF, DOC, DOCX, JPG, JPEG, PNG.", "UNSUPPORTED_FORMAT");
  const maxBytes = settings["uploads.maxFileSizeMb"] * 1024 * 1024;
  if (input.size <= 0) throw badRequest("Le fichier est vide.", "EMPTY_FILE");
  if (input.size > maxBytes) {
    throw badRequest(`Fichier trop volumineux (maximum ${settings["uploads.maxFileSizeMb"]} Mo).`, "FILE_TOO_LARGE");
  }
  // Limite anti-abus : documents en attente non rattachés
  const pending = await prisma.document.count({
    where: { ownerId: user.id, status: { in: ["PENDING_UPLOAD", "UPLOADED", "ANALYZING"] } },
  });
  if (pending >= settings["uploads.maxFilesPerOrder"] * 2) {
    throw badRequest("Trop de fichiers en cours de traitement. Patientez quelques instants.", "TOO_MANY_PENDING");
  }

  const id = randomUUID();
  const storageKey = `documents/${user.id}/${id}/original.${extension}`;
  const document = await prisma.document.create({
    data: {
      id,
      ownerId: user.id,
      originalName: fileName,
      extension,
      declaredMime: input.mimeType?.slice(0, 120),
      kind,
      sizeBytes: input.size,
      storageKey,
      status: "PENDING_UPLOAD",
      uploadExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  const upload = await getStorage().createUpload(storageKey, { maxBytes, expiresInSec: 30 * 60 });
  return { document: serializeDocument(document), upload };
}

export async function completeUpload(user: User, documentId: string) {
  const doc = await getOwnedDocument(user, documentId);
  if (doc.status !== "PENDING_UPLOAD") return serializeDocument(doc);
  const head = await getStorage().head(doc.storageKey);
  if (!head) throw badRequest("Le fichier n'a pas été reçu. Relancez le téléversement.", "UPLOAD_MISSING");
  const settings = await getSettings();
  if (head.size > settings["uploads.maxFileSizeMb"] * 1024 * 1024 || head.size === 0) {
    await getStorage().delete(doc.storageKey);
    const updated = await prisma.document.update({
      where: { id: doc.id },
      data: { status: "REJECTED", analysisError: "Taille de fichier invalide." },
    });
    return serializeDocument(updated);
  }
  const updated = await prisma.$transaction(async (tx) => {
    const d = await tx.document.update({
      where: { id: doc.id },
      data: { status: "ANALYZING", sizeBytes: head.size, uploadExpiresAt: null },
    });
    await enqueue("document.analyze", { documentId: doc.id }, { maxAttempts: 2 }, tx);
    return d;
  });
  return serializeDocument(updated);
}

export async function getOwnedDocument(user: User, documentId: string) {
  const doc = await prisma.document.findUnique({ where: { id: documentId } });
  if (!doc || doc.status === "DELETED") throw notFound("Document introuvable.");
  if (doc.ownerId !== user.id) throw notFound("Document introuvable.");
  return doc;
}

/**
 * Contrôle d'accès aux fichiers :
 * - le propriétaire ;
 * - l'équipe (admin/opérateur) uniquement pour les documents rattachés à une commande
 *   confirmée ou à une demande de devis.
 * Les délégués n'ont jamais accès aux fichiers des autres utilisateurs.
 */
export async function assertCanDownload(user: User, doc: Document) {
  if (doc.ownerId === user.id) return;
  if (isStaff(user)) {
    const linked = await prisma.orderItem.findFirst({
      where: { documentId: doc.id, order: { status: { notIn: ["DRAFT"] } } },
      select: { id: true },
    });
    if (linked || doc.quoteId) return;
  }
  throw forbidden("Vous n'avez pas accès à ce document.");
}

export async function deleteDocumentFiles(doc: Pick<Document, "storageKey" | "pdfStorageKey">) {
  const storage = getStorage();
  await storage.delete(doc.storageKey).catch((e) => logger.warn({ err: e }, "Suppression du fichier original échouée"));
  if (doc.pdfStorageKey) {
    await storage.delete(doc.pdfStorageKey).catch((e) => logger.warn({ err: e }, "Suppression du PDF converti échouée"));
  }
}

export async function analyzeDocument(documentId: string) {
  const doc = await prisma.document.findUnique({ where: { id: documentId } });
  if (!doc || !["ANALYZING", "UPLOADED"].includes(doc.status)) return;
  const expectedKind = EXTENSION_KINDS[doc.extension];
  const workDir = await mkdtemp(path.join(tmpdir(), "ps-doc-"));
  const storage = getStorage();
  try {
    await prisma.document.update({ where: { id: doc.id }, data: { analysisAttempts: { increment: 1 } } });
    const inputPath = path.join(workDir, `input.${doc.extension}`);
    await storage.downloadToFile(doc.storageKey, inputPath);
    const { size } = await stat(inputPath);
    const checksum = await sha256File(inputPath);

    const scan = await scanFile(inputPath);
    if (scan.status === "infected") {
      await storage.delete(doc.storageKey);
      await prisma.document.update({
        where: { id: doc.id },
        data: { status: "REJECTED", analysisError: "Fichier refusé : menace détectée par l'antivirus.", analyzedAt: new Date() },
      });
      logger.warn({ documentId: doc.id, signature: scan.signature }, "Fichier infecté rejeté");
      return;
    }

    const outcome = await analyzeFile(inputPath, expectedKind, workDir);
    const base = { sizeBytes: size, checksumSha256: checksum, analyzedAt: new Date() };

    if (outcome.status === "REJECTED") {
      await storage.delete(doc.storageKey);
      await prisma.document.update({ where: { id: doc.id }, data: { ...base, status: "REJECTED", analysisError: outcome.reason } });
      return;
    }
    if (outcome.status === "FAILED") {
      await prisma.document.update({ where: { id: doc.id }, data: { ...base, status: "FAILED", analysisError: outcome.reason } });
      return;
    }

    let pdfStorageKey: string | undefined;
    if ("pdfPath" in outcome && outcome.pdfPath && (doc.extension === "doc" || doc.extension === "docx")) {
      pdfStorageKey = `documents/${doc.ownerId}/${doc.id}/converted.pdf`;
      await storage.putFile(pdfStorageKey, outcome.pdfPath, "application/pdf");
    }

    if (outcome.status === "READY") {
      await prisma.document.update({
        where: { id: doc.id },
        data: {
          ...base,
          kind: outcome.kind,
          status: "READY",
          pageCount: outcome.pageCount,
          pageCountSource: outcome.source,
          analysisError: outcome.note ?? null,
          pdfStorageKey,
        },
      });
    } else {
      await prisma.document.update({
        where: { id: doc.id },
        data: { ...base, kind: outcome.kind, status: "NEEDS_REVIEW", analysisError: outcome.reason, pdfStorageKey },
      });
    }
  } catch (error) {
    logger.error({ err: error, documentId: doc.id }, "Analyse du document échouée");
    await prisma.document.update({
      where: { id: doc.id },
      data: { status: "FAILED", analysisError: "L'analyse a échoué. Réessayez ou contactez l'assistance.", analyzedAt: new Date() },
    });
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

registerJobHandler("document.analyze", async (payload) => {
  const { documentId } = payload as { documentId: string };
  await analyzeDocument(documentId);
});
