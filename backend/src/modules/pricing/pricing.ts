import type { ColorMode, FinishingCode, PaperFormat, PricingUnit, Sides } from "@prisma/client";

/**
 * Moteur de tarification (fonctions pures, sans accès base de données).
 *
 * Distinction des quantités :
 *  - pageCount : pages du fichier ;
 *  - faces     : faces imprimées = pages × exemplaires ;
 *  - sheets    : feuilles physiques = (recto verso ? ⌈pages / 2⌉ : pages) × exemplaires.
 *
 * Chaque combinaison couleur / faces / format possède sa propre règle : le tarif
 * recto verso n'est JAMAIS cumulé avec le tarif noir & blanc ou couleur.
 */
export interface PriceRuleLike {
  colorMode: ColorMode;
  sides: Sides;
  paperFormat: PaperFormat;
  unitPrice: number | null;
  unit: PricingUnit;
  isActive: boolean;
}

export interface FinishingLike {
  code: FinishingCode;
  label: string;
  price: number;
  isActive: boolean;
}

export interface PrintOptions {
  colorMode: ColorMode;
  sides: Sides;
  paperFormat: PaperFormat;
  finishingCode: FinishingCode;
  copies: number;
}

export interface ItemPrice {
  pageCount: number;
  copies: number;
  sheetsPerCopy: number;
  sheets: number;
  faces: number;
  unitPrice: number;
  pricingUnit: PricingUnit;
  printCost: number;
  finishingCode: FinishingCode;
  finishingLabel: string;
  finishingUnitPrice: number;
  finishingCost: number;
  lineTotal: number;
}

export class PricingError extends Error {
  constructor(
    public readonly code: "PRICE_NOT_CONFIGURED" | "FINISHING_UNAVAILABLE" | "INVALID_QUANTITY",
    message: string,
  ) {
    super(message);
    this.name = "PricingError";
  }
}

export const COLOR_LABELS: Record<ColorMode, string> = { BW: "Noir et blanc", COLOR: "Couleur" };
export const SIDES_LABELS: Record<Sides, string> = { SINGLE: "Recto simple", DOUBLE: "Recto verso" };

export function sheetsPerCopy(pageCount: number, sides: Sides): number {
  return sides === "DOUBLE" ? Math.ceil(pageCount / 2) : pageCount;
}

export function findRule(rules: PriceRuleLike[], o: Pick<PrintOptions, "colorMode" | "sides" | "paperFormat">) {
  return rules.find((r) => r.colorMode === o.colorMode && r.sides === o.sides && r.paperFormat === o.paperFormat);
}

export function isCombinationAvailable(rules: PriceRuleLike[], o: Pick<PrintOptions, "colorMode" | "sides" | "paperFormat">) {
  const rule = findRule(rules, o);
  return Boolean(rule && rule.isActive && rule.unitPrice !== null);
}

export function priceItem(pageCount: number, options: PrintOptions, rules: PriceRuleLike[], finishings: FinishingLike[]): ItemPrice {
  if (!Number.isInteger(pageCount) || pageCount < 1) {
    throw new PricingError("INVALID_QUANTITY", "Le nombre de pages doit être un entier positif.");
  }
  if (!Number.isInteger(options.copies) || options.copies < 1) {
    throw new PricingError("INVALID_QUANTITY", "Le nombre d'exemplaires doit être un entier positif.");
  }
  const rule = findRule(rules, options);
  if (!rule || !rule.isActive || rule.unitPrice === null) {
    throw new PricingError(
      "PRICE_NOT_CONFIGURED",
      `Le tarif « ${COLOR_LABELS[options.colorMode]} · ${SIDES_LABELS[options.sides]} · ${options.paperFormat} » n'est pas encore disponible.`,
    );
  }
  const finishing = finishings.find((f) => f.code === options.finishingCode);
  if (!finishing || (!finishing.isActive && finishing.code !== "NONE")) {
    throw new PricingError("FINISHING_UNAVAILABLE", "Cette option de reliure n'est pas disponible.");
  }

  const perCopy = sheetsPerCopy(pageCount, options.sides);
  const sheets = perCopy * options.copies;
  const faces = pageCount * options.copies;
  const printCost = rule.unit === "PER_SHEET" ? sheets * rule.unitPrice : faces * rule.unitPrice;
  const finishingUnitPrice = finishing.code === "NONE" ? 0 : finishing.price;
  const finishingCost = finishingUnitPrice * options.copies;

  return {
    pageCount,
    copies: options.copies,
    sheetsPerCopy: perCopy,
    sheets,
    faces,
    unitPrice: rule.unitPrice,
    pricingUnit: rule.unit,
    printCost,
    finishingCode: finishing.code,
    finishingLabel: finishing.label,
    finishingUnitPrice,
    finishingCost,
    lineTotal: printCost + finishingCost,
  };
}

export interface OrderTotals {
  subtotal: number;
  deliveryFee: number | null;
  total: number | null;
  totalPages: number;
  totalSheets: number;
  totalFaces: number;
}

/** Totaux d'une commande. Si la livraison est demandée sans tarif connu, le total reste indéterminé. */
export function computeTotals(items: ItemPrice[], fulfillment: { method: "PICKUP" | "DELIVERY"; deliveryFee: number | null }): OrderTotals {
  const subtotal = items.reduce((s, i) => s + i.lineTotal, 0);
  const deliveryFee = fulfillment.method === "DELIVERY" ? fulfillment.deliveryFee : 0;
  return {
    subtotal,
    deliveryFee,
    total: deliveryFee === null ? null : subtotal + deliveryFee,
    totalPages: items.reduce((s, i) => s + i.pageCount, 0),
    totalSheets: items.reduce((s, i) => s + i.sheets, 0),
    totalFaces: items.reduce((s, i) => s + i.faces, 0),
  };
}
