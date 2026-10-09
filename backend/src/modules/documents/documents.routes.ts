import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { badRequest, conflict } from "../../lib/errors";
import { currentUser, requireAuth } from "../../middleware/auth";
import { uploadLimiter } from "../../middleware/security";
import { paginate, pageResult, paginationSchema } from "../../lib/pagination";
import { enqueue } from "../../jobs/queue";
import { getStorage } from "../storage/storage";
import {
  assertCanDownload,
  completeUpload,
  deleteDocumentFiles,
  getOwnedDocument,
  requestUpload,
  serializeDocument,
} from "./documents.service";
import { param } from "../../lib/http";

export const documentsRouter = Router();
documentsRouter.use(requireAuth);

const uploadSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  size: z.number().int().positive(),
  mimeType: z.string().max(200).optional(),
});

documentsRouter.post("/uploads", uploadLimiter, async (req, res) => {
  const input = uploadSchema.parse(req.body);
  res.status(201).json(await requestUpload(currentUser(req), input));
});

documentsRouter.post("/:id/complete", uploadLimiter, async (req, res) => {
  res.json({ document: await completeUpload(currentUser(req), param(req, "id")) });
});

const listSchema = paginationSchema.extend({
  ids: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(",").filter(Boolean).slice(0, 200) : undefined)),
});

documentsRouter.get("/", async (req, res) => {
  const me = currentUser(req);
  const q = listSchema.parse(req.query);
  const where = {
    ownerId: me.id,
    status: { notIn: ["DELETED" as const, "PENDING_UPLOAD" as const] },
    ...(q.ids ? { id: { in: q.ids } } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.document.findMany({ where, orderBy: { createdAt: "desc" }, ...(q.ids ? {} : paginate(q.page, q.pageSize)) }),
    prisma.document.count({ where }),
  ]);
  res.json(pageResult(items.map(serializeDocument), total, q.page, q.pageSize));
});

documentsRouter.get("/:id", async (req, res) => {
  const doc = await getOwnedDocument(currentUser(req), param(req, "id"));
  res.json({ document: serializeDocument(doc) });
});

/** Le client indique le nombre de pages lorsque l'analyse automatique n'a pas abouti. */
documentsRouter.post("/:id/declare-pages", async (req, res) => {
  const { pageCount } = z.object({ pageCount: z.number().int().min(1).max(5000) }).parse(req.body);
  const doc = await getOwnedDocument(currentUser(req), param(req, "id"));
  if (doc.status !== "NEEDS_REVIEW") throw badRequest("Le nombre de pages a déjà été déterminé pour ce document.");
  const updated = await prisma.document.update({
    where: { id: doc.id },
    data: {
      status: "READY",
      pageCount,
      pageCountSource: "CUSTOMER_DECLARED",
      analysisError: "Nombre de pages indiqué par le client : il sera vérifié avant impression.",
    },
  });
  res.json({ document: serializeDocument(updated) });
});

documentsRouter.post("/:id/retry", uploadLimiter, async (req, res) => {
  const doc = await getOwnedDocument(currentUser(req), param(req, "id"));
  if (doc.status !== "FAILED") throw badRequest("Seuls les documents en échec peuvent être réanalysés.");
  if (doc.analysisAttempts >= 5) throw badRequest("Nombre maximal de tentatives atteint. Téléversez à nouveau le fichier.");
  const updated = await prisma.$transaction(async (tx) => {
    const d = await tx.document.update({ where: { id: doc.id }, data: { status: "ANALYZING", analysisError: null } });
    await enqueue("document.analyze", { documentId: doc.id }, { maxAttempts: 2 }, tx);
    return d;
  });
  res.json({ document: serializeDocument(updated) });
});

documentsRouter.get("/:id/download", async (req, res) => {
  const me = currentUser(req);
  const doc = await getOwnedDocument(me, param(req, "id"));
  await assertCanDownload(me, doc);
  if (doc.purgedAt) throw badRequest("Ce document a été supprimé conformément à la politique de conservation.");
  const url = await getStorage().getDownloadUrl(doc.storageKey, { filename: doc.originalName, expiresInSec: 300 });
  res.json({ url, expiresInSec: 300 });
});

documentsRouter.delete("/:id", async (req, res) => {
  const doc = await getOwnedDocument(currentUser(req), param(req, "id"));
  const used = await prisma.orderItem.findFirst({
    where: { documentId: doc.id, order: { status: { notIn: ["DRAFT", "CANCELLED"] } } },
  });
  if (used || doc.quoteId) throw conflict("Ce document est rattaché à une commande ou un devis et ne peut pas être supprimé.");
  await deleteDocumentFiles(doc);
  await prisma.$transaction([
    prisma.orderItem.deleteMany({ where: { documentId: doc.id, order: { status: "DRAFT" } } }),
    prisma.document.update({ where: { id: doc.id }, data: { status: "DELETED", purgedAt: new Date() } }),
  ]);
  res.json({ ok: true });
});
