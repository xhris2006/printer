import { createWriteStream, createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../../config/env";
import { assertSafeKey, contentDisposition } from "./keys";
import type { StorageDriver, UploadTarget } from "./storage";

/**
 * Stockage compatible S3 (AWS S3, Cloudflare R2, Backblaze B2, MinIO…).
 * Le bucket doit rester PRIVÉ ; l'accès se fait uniquement par URL présignées.
 */
export class S3Storage implements StorageDriver {
  readonly name = "s3" as const;
  private client = new S3Client({
    region: env.S3_REGION,
    endpoint: env.S3_ENDPOINT,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    credentials: { accessKeyId: env.S3_ACCESS_KEY_ID ?? "", secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? "" },
  });
  private bucket = env.S3_BUCKET ?? "";

  async createUpload(key: string, options: { maxBytes: number; expiresInSec?: number }): Promise<UploadTarget> {
    assertSafeKey(key);
    const expiresIn = options.expiresInSec ?? 900;
    const { url, fields } = await createPresignedPost(this.client, {
      Bucket: this.bucket,
      Key: key,
      Conditions: [["content-length-range", 1, options.maxBytes]],
      Fields: { "Content-Type": "application/octet-stream" },
      Expires: expiresIn,
    });
    return { method: "POST", url, fields, expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString() };
  }

  async head(key: string) {
    try {
      const out = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { size: Number(out.ContentLength ?? 0) };
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status === 404 || status === 403) return null;
      throw error;
    }
  }

  async getStream(key: string): Promise<Readable> {
    const out = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!out.Body) throw new Error("Objet vide");
    return out.Body as Readable;
  }

  async downloadToFile(key: string, destination: string) {
    const stream = await this.getStream(key);
    await pipeline(stream, createWriteStream(destination, { mode: 0o600 }));
  }

  async putFile(key: string, sourcePath: string, contentType: string) {
    assertSafeKey(key);
    const { size } = await stat(sourcePath);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: createReadStream(sourcePath),
        ContentLength: size,
        ContentType: contentType,
      }),
    );
  }

  async delete(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async getDownloadUrl(key: string, options: { filename: string; expiresInSec?: number; inline?: boolean }) {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentDisposition: contentDisposition(options.filename, options.inline),
      }),
      { expiresIn: options.expiresInSec ?? 300 },
    );
  }
}
