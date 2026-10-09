import { Router } from "express";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { badRequest, conflict, notFound } from "../../lib/errors";
import { currentUser, requireAdmin } from "../../middleware/auth";
import { audit } from "../audit/audit";
import { getSettings, settingsUpdateSchema, updateSettings } from "../settings/settings.service";
import { param } from "../../lib/http";

/** Paramétrage : tarifs, finitions, livraison, points de retrait, paramètres et prestations. */
export const adminConfigRouter = Router();
adminConfigRouter.use(requireAdmin);

const COMBINATIONS = (["A4", "A3"] as const).flatMap((paperFormat) =>
  (["BW", "COLOR"] as const).flatMap((colorMode) => (["SINGLE", "DOUBLE"] as const).map((sides) => ({ paperFormat, colorMode, sides }))),
);

adminConfigRouter.get("/pricing", async (_req, res) => {
  const [rules, finishings] = await Promise.all([prisma.priceRule.findMany(), prisma.finishingOption.findMany({ orderBy: { sortOrder: "asc" } })]);
  // Toutes les combinaisons sont présentées, y compris celles non encore configurées
  const grid = COMBINATIONS.map((c) => {
    const rule = rules.find((r) => r.paperFormat === c.paperFormat && r.colorMode === c.colorMode && r.sides === c.sides);
    return {
      ...c,
      id: rule?.id ?? null,
      unitPrice: rule?.unitPrice ?? null,
      unit: rule?.unit ?? "PER_FACE",
      isActive: rule?.isActive ?? false,
      updatedAt: rule?.updatedAt ?? null,
    };
  });
  res.json({ rules: grid, finishings });
});

adminConfigRouter.put("/pricing/rules", async (req, res) => {
  const me = currentUser(req);
  const { rules } = z
    .object({
      rules: z
        .array(
          z.object({
            colorMode: z.enum(["BW", "COLOR"]),
            sides: z.enum(["SINGLE", "DOUBLE"]),
            paperFormat: z.enum(["A4", "A3"]),
            unitPrice: z.number().int().min(0).max(100_000).nullable(),
            unit: z.enum(["PER_FACE", "PER_SHEET"]),
            isActive: z.boolean(),
          }),
        )
        .min(1)
        .max(8),
    })
    .parse(req.body);
  const before = await prisma.priceRule.findMany();
  await prisma.$transaction(
    rules.map((r) =>
      prisma.priceRule.upsert({
        where: { colorMode_sides_paperFormat: { colorMode: r.colorMode, sides: r.sides, paperFormat: r.paperFormat } },
        create: { ...r, updatedById: me.id },
        update: { unitPrice: r.unitPrice, unit: r.unit, isActive: r.isActive, updatedById: me.id },
      }),
    ),
  );
  await audit({
    actorId: me.id,
    action: "pricing.rules_updated",
    entityType: "PriceRule",
    metadata: {
      before: before.map((b) => ({ c: b.colorMode, s: b.sides, f: b.paperFormat, p: b.unitPrice, u: b.unit, a: b.isActive })),
      after: rules,
    } as unknown as Prisma.InputJsonValue,
    ip: req.ip,
  });
  res.json({ ok: true });
});

adminConfigRouter.put("/pricing/finishings", async (req, res) => {
  const me = currentUser(req);
  const { finishings } = z
    .object({
      finishings: z
        .array(
          z.object({
            code: z.enum(["NONE", "SPIRAL", "STAPLE", "HARDCOVER"]),
            label: z.string().trim().min(2).max(80),
            price: z.number().int().min(0).max(1_000_000),
            isActive: z.boolean(),
          }),
        )
        .min(1)
        .max(4),
    })
    .parse(req.body);
  await prisma.$transaction(
    finishings.map((f) =>
      prisma.finishingOption.update({
        where: { code: f.code },
        data: { label: f.label, price: f.code === "NONE" ? 0 : f.price, isActive: f.code === "NONE" ? true : f.isActive },
      }),
    ),
  );
  await audit({ actorId: me.id, action: "pricing.finishings_updated", entityType: "FinishingOption", metadata: { finishings }, ip: req.ip });
  res.json({ ok: true });
});

// ── Zones de livraison ──
const zoneSchema = z.object({ name: z.string().trim().min(2).max(120), fee: z.number().int().min(0).max(1_000_000), isActive: z.boolean().default(true) });

adminConfigRouter.get("/delivery-zones", async (_req, res) => {
  res.json({ items: await prisma.deliveryZone.findMany({ orderBy: { name: "asc" } }) });
});

adminConfigRouter.post("/delivery-zones", async (req, res) => {
  const input = zoneSchema.parse(req.body);
  const zone = await prisma.deliveryZone.create({ data: input });
  await audit({ actorId: currentUser(req).id, action: "delivery_zone.created", entityType: "DeliveryZone", entityId: zone.id, metadata: input, ip: req.ip });
  res.status(201).json({ zone });
});

adminConfigRouter.patch("/delivery-zones/:id", async (req, res) => {
  const input = zoneSchema.partial().parse(req.body);
  const zone = await prisma.deliveryZone.update({ where: { id: param(req, "id") }, data: input });
  await audit({ actorId: currentUser(req).id, action: "delivery_zone.updated", entityType: "DeliveryZone", entityId: zone.id, metadata: input, ip: req.ip });
  res.json({ zone });
});

adminConfigRouter.delete("/delivery-zones/:id", async (req, res) => {
  const used = await prisma.delivery.count({ where: { zoneId: param(req, "id") } });
  if (used > 0) {
    await prisma.deliveryZone.update({ where: { id: param(req, "id") }, data: { isActive: false } });
  } else {
    await prisma.deliveryZone.delete({ where: { id: param(req, "id") } });
  }
  await audit({ actorId: currentUser(req).id, action: "delivery_zone.deleted", entityType: "DeliveryZone", entityId: param(req, "id"), ip: req.ip });
  res.json({ ok: true, deactivated: used > 0 });
});

// ── Points de retrait ──
const pickupSchema = z.object({
  name: z.string().trim().min(2).max(120),
  address: z.string().trim().min(2).max(300),
  hours: z.string().trim().max(200).optional().nullable(),
  phone: z.string().trim().max(30).optional().nullable(),
  isActive: z.boolean().default(true),
  isDefault: z.boolean().default(false),
});

adminConfigRouter.get("/pickup-points", async (_req, res) => {
  res.json({ items: await prisma.pickupPoint.findMany({ orderBy: [{ isDefault: "desc" }, { name: "asc" }] }) });
});

adminConfigRouter.post("/pickup-points", async (req, res) => {
  const input = pickupSchema.parse(req.body);
  const point = await prisma.$transaction(async (tx) => {
    if (input.isDefault) await tx.pickupPoint.updateMany({ data: { isDefault: false } });
    return tx.pickupPoint.create({ data: input });
  });
  await audit({ actorId: currentUser(req).id, action: "pickup_point.created", entityType: "PickupPoint", entityId: point.id, metadata: input, ip: req.ip });
  res.status(201).json({ point });
});

adminConfigRouter.patch("/pickup-points/:id", async (req, res) => {
  const input = pickupSchema.partial().parse(req.body);
  const point = await prisma.$transaction(async (tx) => {
    const existing = await tx.pickupPoint.findUnique({ where: { id: param(req, "id") } });
    if (!existing) throw notFound("Point de retrait introuvable.");
    if (input.isActive === false) {
      const others = await tx.pickupPoint.count({ where: { isActive: true, id: { not: existing.id } } });
      if (others === 0) throw conflict("Au moins un point de retrait doit rester actif.");
    }
    if (input.isDefault) await tx.pickupPoint.updateMany({ data: { isDefault: false } });
    return tx.pickupPoint.update({ where: { id: existing.id }, data: input });
  });
  await audit({ actorId: currentUser(req).id, action: "pickup_point.updated", entityType: "PickupPoint", entityId: point.id, metadata: input, ip: req.ip });
  res.json({ point });
});

// ── Paramètres ──
adminConfigRouter.get("/settings", async (_req, res) => {
  res.json({ settings: await getSettings() });
});

adminConfigRouter.put("/settings", async (req, res) => {
  const me = currentUser(req);
  const input = settingsUpdateSchema.parse(req.body);
  if (Object.keys(input).length === 0) throw badRequest("Aucun paramètre fourni.");
  const settings = await updateSettings(input, me.id);
  await audit({ actorId: me.id, action: "settings.updated", entityType: "AppSetting", metadata: input as Prisma.InputJsonValue, ip: req.ip });
  res.json({ settings });
});

// ── Prestations de secrétariat ──
const serviceSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2)
    .max(60)
    .regex(/^[A-Z0-9_]+$/, "Code en majuscules (A-Z, 0-9, _)"),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().min(5).max(600),
  pricingMode: z.enum(["QUOTE", "PRINT_FLOW"]).default("QUOTE"),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(1000).default(0),
});

adminConfigRouter.get("/services", async (_req, res) => {
  res.json({ items: await prisma.serviceOffering.findMany({ orderBy: { sortOrder: "asc" } }) });
});

adminConfigRouter.post("/services", async (req, res) => {
  const input = serviceSchema.parse(req.body);
  const service = await prisma.serviceOffering.create({ data: input });
  await audit({ actorId: currentUser(req).id, action: "service.created", entityType: "ServiceOffering", entityId: service.id, metadata: input, ip: req.ip });
  res.status(201).json({ service });
});

adminConfigRouter.patch("/services/:id", async (req, res) => {
  const input = serviceSchema.partial().parse(req.body);
  const service = await prisma.serviceOffering.update({ where: { id: param(req, "id") }, data: input });
  await audit({ actorId: currentUser(req).id, action: "service.updated", entityType: "ServiceOffering", entityId: service.id, metadata: input, ip: req.ip });
  res.json({ service });
});
