import { readFile } from "node:fs/promises";
import { imageSize } from "image-size";
import { PDFDict, PDFDocument, PDFName } from "pdf-lib";
import type { DocumentKind } from "@prisma/client";
import { readHeader, signatureMatchesKind, sniffSignature } from "./fileType";
import { inspectZip } from "./zip";
import { convertToPdf, isConverterAvailable } from "./converter";

export type AnalysisOutcome =
  | { status: "READY"; kind: DocumentKind; pageCount: number; source: "DETECTED" | "IMAGE_DEFAULT"; pdfPath?: string; note?: string }
  | { status: "NEEDS_REVIEW"; kind: DocumentKind; reason: string; pdfPath?: string }
  | { status: "REJECTED"; reason: string }
  | { status: "FAILED"; kind?: DocumentKind; reason: string };

const MAX_IMAGE_DIMENSION = 30_000;

/** Détecte le contenu actif d'un PDF (JavaScript, actions de lancement). */
function findActiveContent(doc: PDFDocument, raw: Buffer): string | null {
  const keys = [PDFName.of("JavaScript"), PDFName.of("JS"), PDFName.of("Launch")];
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFDict) {
      for (const key of keys) {
        if (obj.has(key)) return key.asString();
      }
      const s = obj.get(PDFName.of("S"));
      if (s instanceof PDFName && (s.asString() === "/JavaScript" || s.asString() === "/Launch")) return s.asString();
    }
  }
  // Vérification complémentaire sur le contenu brut (objets non référencés)
  for (const marker of ["/JavaScript", "/Launch"]) {
    if (raw.includes(Buffer.from(marker))) return marker;
  }
  return null;
}

export async function countPdfPages(buffer: Buffer): Promise<{ pages: number; encrypted: boolean; activeContent: string | null }> {
  const doc = await PDFDocument.load(buffer, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
  return { pages: doc.getPageCount(), encrypted: doc.isEncrypted, activeContent: findActiveContent(doc, buffer) };
}

async function analyzePdf(filePath: string, kind: DocumentKind, pdfPath?: string): Promise<AnalysisOutcome> {
  const buffer = await readFile(filePath);
  let info: Awaited<ReturnType<typeof countPdfPages>>;
  try {
    info = await countPdfPages(buffer);
  } catch {
    return { status: "FAILED", kind, reason: "Le fichier PDF est corrompu ou illisible. Exportez-le à nouveau puis réessayez." };
  }
  if (info.activeContent) {
    return {
      status: "REJECTED",
      reason: "Ce PDF contient du contenu actif (JavaScript ou action de lancement) non autorisé. Exportez-le à nouveau en PDF standard.",
    };
  }
  if (info.pages < 1) {
    return { status: "NEEDS_REVIEW", kind, reason: "Aucune page détectée dans ce document. Vérifiez le fichier ou indiquez le nombre de pages.", pdfPath };
  }
  if (info.encrypted) {
    return {
      status: "NEEDS_REVIEW",
      kind,
      reason: `PDF protégé par mot de passe (${info.pages} page(s) détectée(s)). Retirez la protection ou confirmez le nombre de pages.`,
      pdfPath,
    };
  }
  return { status: "READY", kind, pageCount: info.pages, source: "DETECTED", pdfPath };
}

/**
 * Analyse un fichier téléversé : vérification du format réel, détection de contenu
 * dangereux, conversion des documents Word et comptage des pages.
 */
export async function analyzeFile(filePath: string, expectedKind: DocumentKind, workDir: string): Promise<AnalysisOutcome> {
  const header = await readHeader(filePath);
  const signature = sniffSignature(header);
  if (signature === "UNKNOWN") {
    return { status: "REJECTED", reason: "Format de fichier non reconnu. Formats acceptés : PDF, DOC, DOCX, JPG, JPEG, PNG." };
  }
  if (!signatureMatchesKind(signature, expectedKind)) {
    return { status: "REJECTED", reason: "Le contenu du fichier ne correspond pas à son extension (extension falsifiée ou fichier renommé)." };
  }

  switch (expectedKind) {
    case "PDF":
      return analyzePdf(filePath, "PDF");

    case "JPEG":
    case "PNG": {
      try {
        const dims = imageSize(await readFile(filePath));
        const expectedType = expectedKind === "JPEG" ? "jpg" : "png";
        if (dims.type !== expectedType) {
          return { status: "REJECTED", reason: "Le contenu de l'image ne correspond pas à son extension." };
        }
        if (!dims.width || !dims.height || dims.width > MAX_IMAGE_DIMENSION || dims.height > MAX_IMAGE_DIMENSION) {
          return { status: "FAILED", kind: expectedKind, reason: "Dimensions d'image invalides." };
        }
        return { status: "READY", kind: expectedKind, pageCount: 1, source: "IMAGE_DEFAULT" };
      } catch {
        return { status: "FAILED", kind: expectedKind, reason: "Image corrompue ou illisible." };
      }
    }

    case "DOCX":
    case "DOC": {
      if (expectedKind === "DOCX") {
        let entries: string[];
        try {
          entries = (await inspectZip(filePath)).entries;
        } catch {
          return { status: "FAILED", kind: "DOCX", reason: "Document Word corrompu ou illisible." };
        }
        if (!entries.includes("[Content_Types].xml") || !entries.includes("word/document.xml")) {
          return { status: "REJECTED", reason: "Ce fichier n'est pas un document Word (DOCX) valide." };
        }
        if (entries.some((e) => e.toLowerCase().endsWith("vbaproject.bin"))) {
          return { status: "REJECTED", reason: "Les documents contenant des macros ne sont pas acceptés. Enregistrez-le en DOCX standard ou en PDF." };
        }
      } else {
        const raw = await readFile(filePath);
        if (raw.includes(Buffer.from("_VBA_PROJECT", "utf16le")) || raw.includes(Buffer.from("Macros", "utf16le"))) {
          return { status: "REJECTED", reason: "Les documents contenant des macros ne sont pas acceptés. Enregistrez-le en DOCX standard ou en PDF." };
        }
      }
      if (!(await isConverterAvailable())) {
        return {
          status: "NEEDS_REVIEW",
          kind: expectedKind,
          reason: "La conversion automatique n'est pas disponible pour le moment. Indiquez le nombre de pages ou attendez la vérification de l'équipe.",
        };
      }
      let pdfPath: string;
      try {
        pdfPath = await convertToPdf(filePath, workDir);
      } catch {
        return {
          status: "NEEDS_REVIEW",
          kind: expectedKind,
          reason: "Le document n'a pas pu être converti automatiquement. Indiquez le nombre de pages ou envoyez une version PDF.",
        };
      }
      const outcome = await analyzePdf(pdfPath, expectedKind, pdfPath);
      if (outcome.status === "REJECTED" || outcome.status === "FAILED") {
        return { status: "NEEDS_REVIEW", kind: expectedKind, reason: "La version convertie n'a pas pu être analysée. Indiquez le nombre de pages." };
      }
      if (outcome.status === "READY") {
        return { ...outcome, note: "Pages comptées après conversion en PDF ; la mise en page peut légèrement varier selon les polices." };
      }
      return outcome;
    }
  }
}
