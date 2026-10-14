import { pipeline } from "node:stream/promises";
import { Router } from "express";
import Busboy from "busboy";
import { badRequest, forbidden, notFound } from "../../lib/errors";
import { logger } from "../../lib/logger";
import { getStorage, contentDisposition, isSignedUrlStorage } from "./storage";
import { verifyToken, type DownloadClaims, type UploadClaims } from "./local";
import { param } from "../../lib/http";

const CONTENT_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  zip: "application/zip",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

function contentTypeFor(filename: string) {
  return CONTENT_TYPES[filename.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";
}

/** Routes des pilotes servis par l'API (disque local ou base de données) : URL signées, sans cookie. */
export const storageRouter = Router();

storageRouter.post("/local/upload/:token", async (req, res, next) => {
  const storage = getStorage();
  if (!isSignedUrlStorage(storage)) throw notFound();
  const claims = verifyToken<UploadClaims>(param(req, "token", 4096), "u");
  if (!claims) throw forbidden("Lien de téléversement invalide ou expiré.");

  const contentType = req.get("content-type") ?? "";
  if (!contentType.startsWith("multipart/form-data")) throw badRequest("Formulaire multipart attendu.");

  let handled = false;
  const busboy = Busboy({ headers: req.headers, limits: { files: 1, fileSize: claims.m, fields: 20 } });
  busboy.on("file", (_name, file) => {
    handled = true;
    let truncated = false;
    file.on("limit", () => {
      truncated = true;
    });
    storage
      .writeStream(claims.k, file)
      .then(async () => {
        if (truncated) {
          await storage.delete(claims.k);
          res.status(413).json({ error: { code: "FILE_TOO_LARGE", message: "Fichier trop volumineux." } });
          return;
        }
        res.status(204).end();
      })
      .catch(next);
  });
  busboy.on("error", () => next(badRequest("Téléversement interrompu.")));
  busboy.on("close", () => {
    if (!handled) next(badRequest("Aucun fichier reçu."));
  });
  req.pipe(busboy);
});

storageRouter.get("/local/download/:token", async (req, res) => {
  const storage = getStorage();
  if (!isSignedUrlStorage(storage)) throw notFound();
  const claims = verifyToken<DownloadClaims>(param(req, "token", 4096), "d");
  if (!claims) throw forbidden("Lien de téléchargement invalide ou expiré.");
  const head = await storage.head(claims.k);
  if (!head) {
    throw notFound("Ce fichier n'est plus disponible sur le serveur de stockage : il doit être envoyé à nouveau.");
  }
  res.setHeader("Content-Disposition", contentDisposition(claims.f, claims.i));
  res.setHeader("Content-Type", contentTypeFor(claims.f));
  res.setHeader("Content-Length", String(head.size));
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  // pipeline : une erreur de lecture en cours de transfert coupe proprement la réponse
  await pipeline(await storage.getStream(claims.k), res).catch((error) => {
    logger.warn({ err: error, key: claims.k }, "Téléchargement interrompu");
    res.destroy();
  });
});
