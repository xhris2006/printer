import type { Readable } from "node:stream";
import { env } from "../../config/env";
import { LocalStorage } from "./local";
import { S3Storage } from "./s3";

export { assertSafeKey, contentDisposition } from "./keys";

export interface UploadTarget {
  method: "POST";
  url: string;
  /** Champs à joindre au formulaire multipart avant le fichier (champ « file »). */
  fields: Record<string, string>;
  expiresAt: string;
}

/** Stockage privé des documents. Aucun objet n'est jamais public. */
export interface StorageDriver {
  readonly name: "local" | "s3";
  createUpload(key: string, options: { maxBytes: number; expiresInSec?: number }): Promise<UploadTarget>;
  head(key: string): Promise<{ size: number } | null>;
  getStream(key: string): Promise<Readable>;
  downloadToFile(key: string, destination: string): Promise<void>;
  putFile(key: string, sourcePath: string, contentType: string): Promise<void>;
  delete(key: string): Promise<void>;
  /** URL de téléchargement temporaire (quelques minutes). */
  getDownloadUrl(key: string, options: { filename: string; expiresInSec?: number; inline?: boolean }): Promise<string>;
}

let storage: StorageDriver | null = null;

export function getStorage(): StorageDriver {
  storage ??= env.STORAGE_DRIVER === "s3" ? new S3Storage() : new LocalStorage();
  return storage;
}

/** Pour les tests : remplace le pilote de stockage. */
export function setStorage(driver: StorageDriver) {
  storage = driver;
}

