import { prisma } from "../../src/lib/prisma";

const KEEP = new Set(["_prisma_migrations", "Role", "FinishingOption"]);

/** Vide la base de test puis recharge les données de référence. */
export async function resetDb() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`;
  const names = tables.map((t) => t.tablename).filter((t) => !KEEP.has(t));
  if (names.length > 0) {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${names.map((n) => `"${n}"`).join(", ")} RESTART IDENTITY CASCADE`);
  }
  await prisma.finishingOption.updateMany({ data: { isActive: true } });
  await prisma.finishingOption.update({ where: { code: "NONE" }, data: { price: 0 } });
  await prisma.finishingOption.update({ where: { code: "STAPLE" }, data: { price: 50 } });
  await prisma.finishingOption.update({ where: { code: "SPIRAL" }, data: { price: 250 } });
  await prisma.finishingOption.update({ where: { code: "HARDCOVER" }, data: { price: 2000 } });
  await prisma.priceRule.createMany({
    data: [
      { colorMode: "BW", sides: "SINGLE", paperFormat: "A4", unitPrice: 20, unit: "PER_FACE" },
      { colorMode: "COLOR", sides: "SINGLE", paperFormat: "A4", unitPrice: 25, unit: "PER_FACE" },
      { colorMode: "BW", sides: "DOUBLE", paperFormat: "A4", unitPrice: 15, unit: "PER_FACE" },
      { colorMode: "COLOR", sides: "DOUBLE", paperFormat: "A4", unitPrice: null, unit: "PER_FACE", isActive: false },
    ],
  });
  await prisma.pickupPoint.create({ data: { name: "Centre de santé de Mvam-essakoe", address: "Mvam-essakoe", isDefault: true } });
  await prisma.serviceOffering.create({
    data: { code: "MISE_EN_FORME", name: "Mise en forme", description: "Mise en forme de documents", pricingMode: "QUOTE" },
  });
}
