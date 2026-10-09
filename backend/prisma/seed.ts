/**
 * Données de référence initiales (idempotent : n'écrase jamais les modifications
 * faites ensuite dans l'administration). Aucun compte utilisateur n'est créé ici :
 * utilisez `npm run create-admin` pour le premier administrateur.
 */
import { PrismaClient, type ColorMode, type PaperFormat, type PricingUnit, type Sides } from "@prisma/client";

const prisma = new PrismaClient();

// Tarifs communiqués. Les combinaisons sans tarif annoncé restent « non configurées »
// (non commandables) jusqu'à leur paramétrage par l'administrateur.
const PRICE_RULES: { colorMode: ColorMode; sides: Sides; paperFormat: PaperFormat; unitPrice: number | null; unit: PricingUnit; isActive: boolean }[] = [
  { colorMode: "BW", sides: "SINGLE", paperFormat: "A4", unitPrice: 20, unit: "PER_FACE", isActive: true },
  { colorMode: "COLOR", sides: "SINGLE", paperFormat: "A4", unitPrice: 25, unit: "PER_FACE", isActive: true },
  { colorMode: "BW", sides: "DOUBLE", paperFormat: "A4", unitPrice: 15, unit: "PER_FACE", isActive: true },
  { colorMode: "COLOR", sides: "DOUBLE", paperFormat: "A4", unitPrice: null, unit: "PER_FACE", isActive: false },
  { colorMode: "BW", sides: "SINGLE", paperFormat: "A3", unitPrice: null, unit: "PER_FACE", isActive: false },
  { colorMode: "COLOR", sides: "SINGLE", paperFormat: "A3", unitPrice: null, unit: "PER_FACE", isActive: false },
  { colorMode: "BW", sides: "DOUBLE", paperFormat: "A3", unitPrice: null, unit: "PER_FACE", isActive: false },
  { colorMode: "COLOR", sides: "DOUBLE", paperFormat: "A3", unitPrice: null, unit: "PER_FACE", isActive: false },
];

const SERVICES = [
  { code: "IMPRESSION", name: "Impression de documents", description: "Impression noir et blanc ou couleur, recto ou recto verso, A4 ou A3, avec calcul automatique du prix.", pricingMode: "PRINT_FLOW" as const, sortOrder: 0 },
  { code: "MISE_EN_FORME", name: "Mise en forme de documents", description: "Mise en page de mémoires, rapports, CV, lettres et documents administratifs.", pricingMode: "QUOTE" as const, sortOrder: 1 },
  { code: "SAISIE", name: "Saisie de documents", description: "Saisie de textes manuscrits ou scannés, tableaux et formulaires.", pricingMode: "QUOTE" as const, sortOrder: 2 },
  { code: "PHOTOCOPIES", name: "Photocopies", description: "Photocopies de documents papier déposés au point de retrait.", pricingMode: "QUOTE" as const, sortOrder: 3 },
  { code: "RELIURE_AGRAFAGE", name: "Reliure et agrafage", description: "Reliure spirale, agrafage ou reliure cartonnée rigide de vos documents déjà imprimés.", pricingMode: "QUOTE" as const, sortOrder: 4 },
  { code: "AUTRE", name: "Autre prestation", description: "Toute autre demande de secrétariat : décrivez votre besoin, nous vous proposons un devis.", pricingMode: "QUOTE" as const, sortOrder: 5 },
];

async function main() {
  for (const rule of PRICE_RULES) {
    await prisma.priceRule.upsert({
      where: { colorMode_sides_paperFormat: { colorMode: rule.colorMode, sides: rule.sides, paperFormat: rule.paperFormat } },
      create: rule,
      update: {},
    });
  }

  const pickupCount = await prisma.pickupPoint.count();
  if (pickupCount === 0) {
    await prisma.pickupPoint.create({
      data: { name: "Centre de santé de Mvam-essakoe", address: "Mvam-essakoe", isActive: true, isDefault: true },
    });
  }

  for (const service of SERVICES) {
    await prisma.serviceOffering.upsert({ where: { code: service.code }, create: service, update: {} });
  }

  console.log("Données de référence initialisées (tarifs, point de retrait, prestations).");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
