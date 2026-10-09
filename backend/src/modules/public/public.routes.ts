import { Router } from "express";
import { prisma } from "../../lib/prisma";
import { env } from "../../config/env";
import { getSettings } from "../settings/settings.service";
import { paymentsPublicConfig } from "../payments/payments.service";
import { isEmailEnabled } from "../notifications/email";
import { whatsappSupportLink } from "../notifications/whatsapp";
import { loadPricing } from "../pricing/pricing.service";

export const publicRouter = Router();

/** Configuration publique utilisée par le frontend (aucune donnée sensible). */
publicRouter.get("/config", async (_req, res) => {
  const [settings, pickupPoints, zones, services, pricing] = await Promise.all([
    getSettings(),
    prisma.pickupPoint.findMany({ where: { isActive: true }, orderBy: [{ isDefault: "desc" }, { name: "asc" }] }),
    prisma.deliveryZone.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    prisma.serviceOffering.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } }),
    loadPricing(),
  ]);
  res.json({
    uploads: {
      maxFileSizeMb: settings["uploads.maxFileSizeMb"],
      maxFilesPerOrder: settings["uploads.maxFilesPerOrder"],
      maxTotalSizeMb: settings["uploads.maxTotalSizeMb"],
      acceptedExtensions: ["pdf", "doc", "docx", "jpg", "jpeg", "png"],
    },
    pickupPoints: pickupPoints.map((p) => ({ id: p.id, name: p.name, address: p.address, hours: p.hours, phone: p.phone, isDefault: p.isDefault })),
    delivery: {
      enabled: settings["delivery.enabled"],
      defaultFee: settings["delivery.defaultFee"],
      zones: zones.map((z) => ({ id: z.id, name: z.name, fee: z.fee })),
    },
    pricing: {
      rules: pricing.rules.map((r) => ({
        colorMode: r.colorMode,
        sides: r.sides,
        paperFormat: r.paperFormat,
        unitPrice: r.unitPrice,
        unit: r.unit,
        available: r.isActive && r.unitPrice !== null,
      })),
      finishings: pricing.finishings.filter((f) => f.isActive).map((f) => ({ code: f.code, label: f.label, price: f.price })),
    },
    services: services.map((s) => ({ id: s.id, code: s.code, name: s.name, description: s.description, pricingMode: s.pricingMode })),
    payments: paymentsPublicConfig(),
    pickupPolicy: settings["pickup.policyText"],
    support: {
      whatsapp: env.SUPPORT_WHATSAPP,
      whatsappLink: whatsappSupportLink("Bonjour Print & Secrétariat, j'ai une question."),
    },
    features: { email: isEmailEnabled(), whatsappNotifications: false },
  });
});
