import { Router } from "express";
import Busboy from "busboy";
import { badRequest, forbidden, notFound } from "../../lib/errors";
import { getStorage, contentDisposition } from "./storage";
import { LocalStorage, verifyToken, type DownloadClaims, type UploadClaims } from "./local";
import { param } from "../../lib/http";

/** Routes du pilote de stockage local (URL signées, sans cookie). */
export const storageRouter = Router();

storageRouter.post("/local/upload/:token", async (req, res, next) => {
  const storage = getStorage();
  if (!(storage instanceof LocalStorage)) throw notFound();
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
  if (!(storage instanceof LocalStorage)) throw notFound();
  const claims = verifyToken<DownloadClaims>(param(req, "token", 4096), "d");
  if (!claims) throw forbidden("Lien de téléchargement invalide ou expiré.");
  const head = await storage.head(claims.k);
  if (!head) throw notFound("Fichier introuvable.");
  res.setHeader("Content-Disposition", contentDisposition(claims.f, claims.i));
  res.setHeader("Content-Type", claims.f.toLowerCase().endsWith(".pdf") ? "application/pdf" : "application/octet-stream");
  res.setHeader("Content-Length", String(head.size));
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  (await storage.getStream(claims.k)).pipe(res);
});
