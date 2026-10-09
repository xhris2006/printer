import { open } from "node:fs/promises";
import type { DocumentKind } from "@prisma/client";

export const EXTENSION_KINDS: Record<string, DocumentKind> = {
  pdf: "PDF",
  doc: "DOC",
  docx: "DOCX",
  jpg: "JPEG",
  jpeg: "JPEG",
  png: "PNG",
};

export const ALLOWED_EXTENSIONS = Object.keys(EXTENSION_KINDS);

export type Signature = "PDF" | "OLE" | "ZIP" | "JPEG" | "PNG" | "UNKNOWN";

/** Identifie le format réel d'un fichier à partir de ses premiers octets (« magic numbers »). */
export function sniffSignature(header: Buffer): Signature {
  if (header.length >= 8 && header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "PNG";
  if (header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) return "JPEG";
  if (header.length >= 8 && header.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))) return "OLE";
  if (header.length >= 4 && header[0] === 0x50 && header[1] === 0x4b && header[2] === 0x03 && header[3] === 0x04) return "ZIP";
  // La spécification PDF tolère des octets parasites avant l'en-tête (1024 premiers octets)
  if (header.subarray(0, 1024).includes(Buffer.from("%PDF-"))) return "PDF";
  return "UNKNOWN";
}

const EXPECTED_SIGNATURE: Record<DocumentKind, Signature> = {
  PDF: "PDF",
  DOC: "OLE",
  DOCX: "ZIP",
  JPEG: "JPEG",
  PNG: "PNG",
};

export function signatureMatchesKind(signature: Signature, kind: DocumentKind) {
  return EXPECTED_SIGNATURE[kind] === signature;
}

export function extensionOf(fileName: string): string {
  const match = /\.([A-Za-z0-9]+)$/.exec(fileName.trim());
  return match ? match[1].toLowerCase() : "";
}

/** Nettoie un nom de fichier fourni par le client (pas de chemin, pas de caractères de contrôle). */
export function sanitizeFileName(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? "document";
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "_").replace(/\s+/g, " ").trim();
  return (cleaned || "document").slice(0, 180);
}

export async function readHeader(filePath: string, bytes = 1024): Promise<Buffer> {
  const handle = await open(filePath, "r");
  try {
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

export const MIME_BY_KIND: Record<DocumentKind, string> = {
  PDF: "application/pdf",
  DOC: "application/msword",
  DOCX: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  JPEG: "image/jpeg",
  PNG: "image/png",
};
