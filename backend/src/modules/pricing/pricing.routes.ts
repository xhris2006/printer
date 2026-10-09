import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { publicLimiter } from "../../middleware/security";
import { getSettings } from "../settings/settings.service";
import { computeTotals, priceItem, PricingError, type ItemPrice } from "./pricing";
import { loadPricing, resolveDeliveryFee } from "./pricing.service";
import { printOptionsSchema } from "./pricing.schemas";

export const pricingRouter = Router();

pricingRouter.get("/", async (_req, res) => {
  const { rules, finishings } = await loadPricing();
  const [zones, settings] = await Promise.all([
    prisma.deliveryZone.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    getSettings(),
  ]);
  res.json({
    rules: rules.map((r) => ({ ...r, available: r.isActive && r.unitPrice !== null })),
    finishings: finishings.filter((f) => f.isActive),
    delivery: {
      enabled: settings["delivery.enabled"],
      defaultFee: settings["delivery.defaultFee"],
      zones: zones.map((z) => ({ id: z.id, name: z.name, fee: z.fee })),
    },
  });
});

const estimateSchema = z.object({
  items: z
    .array(
      z.object({
        key: z.string().max(100).optional(),
        documentId: z.string().max(64).optional(),
        pageCount: z.number().int().min(1).max(10_000).optional(),
        options: printOptionsSchema,
      }),
    )
    .min(1)
    .max(1000),
  fulfillment: z
    .object({ method: z.enum(["PICKUP", "DELIVERY"]), zoneId: z.string().max(64).nullish() })
    .default({ method: "PICKUP" }),
});

/** Estimation en temps réel calculée par le serveur (le client n'envoie jamais de montant). */
pricingRouter.post("/estimate", publicLimiter, async (req, res) => {
  const input = estimateSchema.parse(req.body);
  const { rules, finishings } = await loadPricing();
  const docIds = input.items.map((i) => i.documentId).filter((x): x is string => Boolean(x));
  const docs =
    docIds.length > 0 && req.user
      ? await prisma.document.findMany({ where: { id: { in: docIds }, ownerId: req.user.id } })
      : [];

  const priced: ItemPrice[] = [];
  const items = input.items.map((item) => {
    const doc = item.documentId ? docs.find((d) => d.id === item.documentId) : undefined;
    const pageCount = doc?.pageCount ?? item.pageCount;
    if (!pageCount) return { key: item.key, documentId: item.documentId, error: { code: "PAGES_UNKNOWN", message: "Nombre de pages inconnu." } };
    try {
      const price = priceItem(pageCount, item.options, rules, finishings);
      priced.push(price);
      return { key: item.key, documentId: item.documentId, price };
    } catch (error) {
      if (error instanceof PricingError) return { key: item.key, documentId: item.documentId, error: { code: error.code, message: error.message } };
      throw error;
    }
  });
  const delivery = await resolveDeliveryFee(input.fulfillment.method, input.fulfillment.zoneId);
  const totals = computeTotals(priced, { method: input.fulfillment.method, deliveryFee: delivery.fee });
  res.json({ items, totals, delivery, complete: priced.length === input.items.length });
});
