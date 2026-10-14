import { createWriteStream } from "node:fs";
import { mkdtemp, open, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { apiPublicUrl } from "../../config/env";
import { prisma } from "../../lib/prisma";
import { logger } from "../../lib/logger";
import { assertSafeKey } from "./keys";
import { signToken, type LocalStorage } from "./local";
import type { SignedUrlStorage, UploadTarget } from "./storage";

const DEFAULT_CHUNK_SIZE = 4 * 1024 * 1024;

/**
 * Stockage des fichiers dans PostgreSQL, découpés en blocs de 4 Mo.
 * - persistant : rien n'est écrit sur le disque du conteneur (effacé à chaque redémarrage) ;
 * - partagé : toutes les instances de l'API et tous les appareils voient les mêmes fichiers ;
 * - privé : accès uniquement par liens signés et expirants, comme le stockage local.
 * Les fichiers encore présents sur l'ancien disque local sont importés à la première lecture.
 */
export class DatabaseStorage implements SignedUrlStorage {
  readonly name = "database" as const;
  private readonly chunkSize: number;
  private readonly legacy: LocalStorage | null;

  constructor(options: { chunkSize?: number; legacy?: LocalStorage | null } = {}) {
    this.chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
    this.legacy = options.legacy ?? null;
  }

  async createUpload(key: string, options: { maxBytes: number; expiresInSec?: number }): Promise<UploadTarget> {
    assertSafeKey(key);
    const expires = Date.now() + (options.expiresInSec ?? 900) * 1000;
    const token = signToken({ k: key, m: options.maxBytes, e: expires, t: "u" });
    return { method: "POST", url: `${apiPublicUrl}/api/storage/local/upload/${token}`, fields: {}, expiresAt: new Date(expires).toISOString() };
  }

  /** Métadonnées du fichier (après import éventuel depuis l'ancien disque local). */
  private async find(key: string) {
    assertSafeKey(key);
    const file = await prisma.storedFile.findUnique({ where: { key }, select: { size: true, chunkCount: true } });
    if (file || !(await this.importLegacy(key))) return file;
    return prisma.storedFile.findUnique({ where: { key }, select: { size: true, chunkCount: true } });
  }

  private async importLegacy(key: string): Promise<boolean> {
    if (!this.legacy || !(await this.legacy.head(key))) return false;
    try {
      await this.putFile(key, this.legacy.pathFor(key));
      logger.info({ key }, "Fichier importé du disque local vers la base de données");
      return true;
    } catch (error) {
      logger.warn({ err: error, key }, "Import du fichier local vers la base impossible");
      return false;
    }
  }

  async head(key: string) {
    const file = await this.find(key);
    return file ? { size: file.size } : null;
  }

  async getStream(key: string): Promise<Readable> {
    const file = await this.find(key);
    if (!file) throw new Error(`Fichier absent du stockage : ${key}`);
    const { chunkCount } = file;
    // Lecture bloc par bloc : la mémoire utilisée reste limitée à un bloc à la fois
    async function* chunks() {
      for (let index = 0; index < chunkCount; index++) {
        const chunk = await prisma.storedFileChunk.findUnique({ where: { fileKey_index: { fileKey: key, index } }, select: { data: true } });
        if (!chunk) throw new Error(`Bloc ${index} manquant pour ${key}`);
        yield Buffer.from(chunk.data.buffer, chunk.data.byteOffset, chunk.data.byteLength);
      }
    }
    return Readable.from(chunks(), { objectMode: false, highWaterMark: this.chunkSize });
  }

  async downloadToFile(key: string, destination: string) {
    await pipeline(await this.getStream(key), createWriteStream(destination, { mode: 0o600 }));
  }

  /** Enregistre un fichier (remplace l'existant) dans une transaction : jamais de fichier partiel. */
  async putFile(key: string, sourcePath: string, contentType?: string) {
    assertSafeKey(key);
    const { size } = await stat(sourcePath);
    const chunkCount = Math.ceil(size / this.chunkSize);
    const handle = await open(sourcePath, "r");
    try {
      await prisma.$transaction(
        async (tx) => {
          await tx.storedFile.deleteMany({ where: { key } });
          await tx.storedFile.create({ data: { key, size, contentType: contentType ?? null, chunkCount } });
          for (let index = 0; index < chunkCount; index++) {
            const offset = index * this.chunkSize;
            const buffer = Buffer.alloc(Math.min(this.chunkSize, size - offset));
            await handle.read(buffer, 0, buffer.length, offset);
            await tx.storedFileChunk.create({ data: { fileKey: key, index, data: buffer } });
          }
        },
        { maxWait: 30_000, timeout: 10 * 60_000 },
      );
    } finally {
      await handle.close();
    }
  }

  /** Réception d'un téléversement : fichier temporaire puis enregistrement en base. */
  async writeStream(key: string, stream: Readable) {
    assertSafeKey(key);
    const dir = await mkdtemp(path.join(tmpdir(), "ps-upload-"));
    try {
      const tmp = path.join(dir, "file");
      await pipeline(stream, createWriteStream(tmp, { mode: 0o600 }));
      await this.putFile(key, tmp);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  async delete(key: string) {
    assertSafeKey(key);
    await prisma.storedFile.deleteMany({ where: { key } });
    await this.legacy?.delete(key).catch(() => undefined);
  }

  async getDownloadUrl(key: string, options: { filename: string; expiresInSec?: number; inline?: boolean }) {
    assertSafeKey(key);
    const token = signToken({ k: key, f: options.filename, e: Date.now() + (options.expiresInSec ?? 300) * 1000, i: Boolean(options.inline), t: "d" });
    return `${apiPublicUrl}/api/storage/local/download/${token}`;
  }
}
