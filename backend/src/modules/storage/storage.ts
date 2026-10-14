import type { Readable } from "node:stream";
import { env, isProduction, storageChoice } from "../../config/env";
import { DatabaseStorage } from "./database";
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
  readonly name: "local" | "s3" | "database";
  createUpload(key: string, options: { maxBytes: number; expiresInSec?: number }): Promise<UploadTarget>;
  head(key: string): Promise<{ size: number } | null>;
  getStream(key: string): Promise<Readable>;
  downloadToFile(key: string, destination: string): Promise<void>;
  putFile(key: string, sourcePath: string, contentType: string): Promise<void>;
  delete(key: string): Promise<void>;
  /** URL de téléchargement temporaire (quelques minutes). */
  getDownloadUrl(key: string, options: { filename: string; expiresInSec?: number; inline?: boolean }): Promise<string>;
}

/** Pilote servi par l'API elle-même via des liens signés (disque local ou base de données). */
export interface SignedUrlStorage extends StorageDriver {
  writeStream(key: string, stream: Readable): Promise<void>;
}

export function isSignedUrlStorage(driver: StorageDriver): driver is SignedUrlStorage {
  return typeof (driver as Partial<SignedUrlStorage>).writeStream === "function";
}

let storage: StorageDriver | null = null;

export function getStorage(): StorageDriver {
  storage ??=
    storageChoice.driver === "s3"
      ? new S3Storage()
      : storageChoice.driver === "database"
        ? // Les fichiers encore présents sur l'ancien disque local restent lisibles (import à la volée)
          new DatabaseStorage({ legacy: new LocalStorage() })
        : new LocalStorage();
  return storage;
}

/** Pour les tests : remplace le pilote de stockage. */
export function setStorage(driver: StorageDriver) {
  storage = driver;
}

/** État du stockage affiché à l'administration et dans les journaux de démarrage. */
export function storageStatus(): { driver: StorageDriver["name"]; label: string; persistent: boolean; warning: string | null } {
  const driver = getStorage().name;
  if (driver === "s3") return { driver, label: "stockage S3 (persistant)", persistent: true, warning: null };
  if (driver === "database") return { driver, label: "base de données PostgreSQL (persistant)", persistent: true, warning: null };
  if (!isProduction) return { driver, label: "disque local (développement)", persistent: true, warning: null };
  if (env.RAILWAY_VOLUME_MOUNT_PATH) return { driver, label: "volume Railway (persistant)", persistent: true, warning: null };
  return {
    driver,
    label: "disque local du serveur",
    persistent: false,
    warning:
      "Fichiers stockés sur le disque local du serveur : s'il n'est pas persistant, ils sont perdus à chaque redémarrage (« Fichier introuvable »). Retirez STORAGE_DRIVER=local pour utiliser la base de données, ou configurez S3.",
  };
}
