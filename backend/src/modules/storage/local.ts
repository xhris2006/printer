import { createReadStream, createWriteStream } from "node:fs";
import { copyFile, mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { apiPublicUrl, appSecret, env } from "../../config/env";
import { hmac, safeEqual } from "../../lib/ids";
import { assertSafeKey } from "./keys";
import type { StorageDriver, UploadTarget } from "./storage";

interface UploadClaims {
  k: string;
  m: number;
  e: number;
  t: "u";
}
interface DownloadClaims {
  k: string;
  f: string;
  e: number;
  i: boolean;
  t: "d";
}

export function signToken(claims: UploadClaims | DownloadClaims): string {
  const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${body}.${hmac(appSecret, `storage:${body}`)}`;
}

export function verifyToken<T extends UploadClaims | DownloadClaims>(token: string, type: T["t"]): T | null {
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;
  if (!safeEqual(signature, hmac(appSecret, `storage:${body}`))) return null;
  try {
    const claims = JSON.parse(Buffer.from(body, "base64url").toString()) as T;
    if (claims.t !== type || claims.e < Date.now()) return null;
    assertSafeKey(claims.k);
    return claims;
  } catch {
    return null;
  }
}

/**
 * Stockage sur disque (développement ou volume persistant Railway).
 * Les téléversements et téléchargements passent par des URL signées et expirantes.
 */
export class LocalStorage implements StorageDriver {
  readonly name = "local" as const;
  readonly root = path.resolve(env.STORAGE_LOCAL_DIR);

  pathFor(key: string) {
    assertSafeKey(key);
    const full = path.resolve(this.root, key);
    if (!full.startsWith(this.root + path.sep)) throw new Error("Chemin de stockage invalide");
    return full;
  }

  async createUpload(key: string, options: { maxBytes: number; expiresInSec?: number }): Promise<UploadTarget> {
    assertSafeKey(key);
    const expires = Date.now() + (options.expiresInSec ?? 900) * 1000;
    const token = signToken({ k: key, m: options.maxBytes, e: expires, t: "u" });
    return {
      method: "POST",
      url: `${apiPublicUrl}/api/storage/local/upload/${token}`,
      fields: {},
      expiresAt: new Date(expires).toISOString(),
    };
  }

  async head(key: string) {
    try {
      const s = await stat(this.pathFor(key));
      return s.isFile() ? { size: s.size } : null;
    } catch {
      return null;
    }
  }

  async getStream(key: string): Promise<Readable> {
    return createReadStream(this.pathFor(key));
  }

  async downloadToFile(key: string, destination: string) {
    await copyFile(this.pathFor(key), destination);
  }

  async putFile(key: string, sourcePath: string) {
    const target = this.pathFor(key);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(sourcePath, target);
  }

  /** Écrit un flux reçu vers la clé (via fichier temporaire puis renommage atomique). */
  async writeStream(key: string, stream: Readable) {
    const target = this.pathFor(key);
    await mkdir(path.dirname(target), { recursive: true });
    const tmp = `${target}.part-${process.pid}-${Date.now()}`;
    try {
      await pipeline(stream, createWriteStream(tmp, { mode: 0o600 }));
      await rename(tmp, target);
    } catch (error) {
      await rm(tmp, { force: true });
      throw error;
    }
  }

  async delete(key: string) {
    await rm(this.pathFor(key), { force: true });
  }

  async getDownloadUrl(key: string, options: { filename: string; expiresInSec?: number; inline?: boolean }) {
    const token = signToken({
      k: key,
      f: options.filename,
      e: Date.now() + (options.expiresInSec ?? 300) * 1000,
      i: Boolean(options.inline),
      t: "d",
    });
    return `${apiPublicUrl}/api/storage/local/download/${token}`;
  }
}

export type { UploadClaims, DownloadClaims };
