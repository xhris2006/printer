import type { FulfillmentMethod } from "@prisma/client";
import { prisma, type Db } from "../../lib/prisma";
import { getSettings } from "../settings/settings.service";
import type { FinishingLike, PriceRuleLike } from "./pricing";

export async function loadPricing(db: Db = prisma): Promise<{ rules: PriceRuleLike[]; finishings: FinishingLike[] }> {
  const [rules, finishings] = await Promise.all([
    db.priceRule.findMany({ orderBy: [{ paperFormat: "asc" }, { colorMode: "asc" }, { sides: "asc" }] }),
    db.finishingOption.findMany({ orderBy: { sortOrder: "asc" } }),
  ]);
  return { rules, finishings };
}

export interface DeliveryResolution {
  fee: number | null;
  zoneId: string | null;
  zoneName: string | null;
}

/** Détermine les frais de livraison : zone configurée, sinon tarif par défaut, sinon « à confirmer » (null). */
export async function resolveDeliveryFee(method: FulfillmentMethod, zoneId: string | null | undefined, db: Db = prisma): Promise<DeliveryResolution> {
  if (method !== "DELIVERY") return { fee: 0, zoneId: null, zoneName: null };
  if (zoneId) {
    const zone = await db.deliveryZone.findFirst({ where: { id: zoneId, isActive: true } });
    if (zone) return { fee: zone.fee, zoneId: zone.id, zoneName: zone.name };
  }
  const settings = await getSettings(db);
  return { fee: settings["delivery.defaultFee"], zoneId: null, zoneName: null };
}

export function buildSnapshot(input: {
  rules: PriceRuleLike[];
  finishings: FinishingLike[];
  delivery: DeliveryResolution & { method: FulfillmentMethod };
}) {
  return {
    computedAt: new Date().toISOString(),
    currency: "XAF",
    rules: input.rules.map((r) => ({
      colorMode: r.colorMode,
      sides: r.sides,
      paperFormat: r.paperFormat,
      unitPrice: r.unitPrice,
      unit: r.unit,
      isActive: r.isActive,
    })),
    finishings: input.finishings.map((f) => ({ code: f.code, label: f.label, price: f.price, isActive: f.isActive })),
    delivery: input.delivery,
  };
}
