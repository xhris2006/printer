import { z } from "zod";
import { prisma, type Db } from "../../lib/prisma";
import { Prisma } from "@prisma/client";

/**
 * Paramètres applicatifs modifiables dans l'administration.
 * Chaque clé possède un schéma de validation et une valeur par défaut.
 */
export const settingSchemas = {
  "uploads.maxFileSizeMb": z.number().int().min(1).max(500),
  "uploads.maxFilesPerOrder": z.number().int().min(1).max(1000),
  "uploads.maxTotalSizeMb": z.number().int().min(1).max(10_000),
  "delivery.enabled": z.boolean(),
  "delivery.defaultFee": z.number().int().min(0).nullable(),
  "pickup.reminderAfterDays": z.number().int().min(1).max(60),
  "pickup.reminderIntervalDays": z.number().int().min(1).max(60),
  "pickup.maxReminders": z.number().int().min(0).max(20),
  "pickup.holdDays": z.number().int().min(1).max(365),
  "pickup.policyText": z.string().max(2000),
  "documents.retentionDays": z.number().int().min(1).max(3650),
  "groups.defaultProductionRule": z.enum(["FULL_PAYMENT", "PAID_ONLY"]),
  "delegates.autoApprove": z.boolean(),
} as const;

export type SettingKey = keyof typeof settingSchemas;
export type SettingValue<K extends SettingKey> = z.infer<(typeof settingSchemas)[K]>;
export type Settings = { [K in SettingKey]: SettingValue<K> };

export const defaultSettings: Settings = {
  "uploads.maxFileSizeMb": 50,
  "uploads.maxFilesPerOrder": 100,
  "uploads.maxTotalSizeMb": 1000,
  "delivery.enabled": true,
  "delivery.defaultFee": null,
  "pickup.reminderAfterDays": 2,
  "pickup.reminderIntervalDays": 2,
  "pickup.maxReminders": 3,
  "pickup.holdDays": 30,
  "pickup.policyText":
    "Les commandes prêtes sont conservées 30 jours au point de retrait. Passé ce délai, nous vous contactons pour convenir d'une solution.",
  "documents.retentionDays": 30,
  "groups.defaultProductionRule": "FULL_PAYMENT",
  "delegates.autoApprove": false,
};

export const settingKeys = Object.keys(settingSchemas) as SettingKey[];

export async function getSettings(db: Db = prisma): Promise<Settings> {
  const rows = await db.appSetting.findMany({ where: { key: { in: settingKeys } } });
  const result = { ...defaultSettings } as Record<SettingKey, unknown>;
  for (const row of rows) {
    const key = row.key as SettingKey;
    const parsed = settingSchemas[key].safeParse(row.value);
    if (parsed.success) result[key] = parsed.data;
  }
  return result as Settings;
}

export async function getSetting<K extends SettingKey>(key: K, db: Db = prisma): Promise<SettingValue<K>> {
  const row = await db.appSetting.findUnique({ where: { key } });
  if (!row) return defaultSettings[key];
  const parsed = settingSchemas[key].safeParse(row.value);
  return (parsed.success ? parsed.data : defaultSettings[key]) as SettingValue<K>;
}

export const settingsUpdateSchema = z
  .object(Object.fromEntries(settingKeys.map((k) => [k, settingSchemas[k].optional()])) as {
    [K in SettingKey]: z.ZodOptional<(typeof settingSchemas)[K]>;
  })
  .strict();

export async function updateSettings(values: Partial<Settings>, actorId: string, db: Db = prisma) {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) continue;
    const json = (value === null ? Prisma.JsonNull : value) as Prisma.InputJsonValue;
    await db.appSetting.upsert({
      where: { key },
      create: { key, value: json, updatedById: actorId },
      update: { value: json, updatedById: actorId },
    });
  }
  return getSettings(db);
}
