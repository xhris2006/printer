import { describe, expect, it } from "vitest";
import { computeTotals, priceItem, PricingError, sheetsPerCopy, type FinishingLike, type PriceRuleLike } from "../src/modules/pricing/pricing";

const rules: PriceRuleLike[] = [
  { colorMode: "BW", sides: "SINGLE", paperFormat: "A4", unitPrice: 20, unit: "PER_FACE", isActive: true },
  { colorMode: "COLOR", sides: "SINGLE", paperFormat: "A4", unitPrice: 25, unit: "PER_FACE", isActive: true },
  { colorMode: "BW", sides: "DOUBLE", paperFormat: "A4", unitPrice: 15, unit: "PER_FACE", isActive: true },
  { colorMode: "COLOR", sides: "DOUBLE", paperFormat: "A4", unitPrice: null, unit: "PER_FACE", isActive: false },
  { colorMode: "BW", sides: "SINGLE", paperFormat: "A3", unitPrice: 60, unit: "PER_SHEET", isActive: true },
];
const finishings: FinishingLike[] = [
  { code: "NONE", label: "Sans reliure", price: 0, isActive: true },
  { code: "STAPLE", label: "Agrafage", price: 50, isActive: true },
  { code: "SPIRAL", label: "Spirale", price: 250, isActive: true },
  { code: "HARDCOVER", label: "Hard cover", price: 2000, isActive: false },
];
const base = { colorMode: "BW", sides: "SINGLE", paperFormat: "A4", finishingCode: "NONE", copies: 1 } as const;

describe("Moteur de tarification", () => {
  it("noir et blanc recto : 20 FCFA par page", () => {
    const p = priceItem(12, base, rules, finishings);
    expect(p).toMatchObject({ pageCount: 12, faces: 12, sheets: 12, unitPrice: 20, printCost: 240, lineTotal: 240 });
  });

  it("couleur recto : 25 FCFA par page", () => {
    expect(priceItem(4, { ...base, colorMode: "COLOR" }, rules, finishings).lineTotal).toBe(100);
  });

  it("recto verso : règle distincte (15 FCFA/page), sans cumul avec le tarif N&B", () => {
    const p = priceItem(20, { ...base, sides: "DOUBLE" }, rules, finishings);
    expect(p.unitPrice).toBe(15);
    expect(p.printCost).toBe(300); // et non 20×20 + 15×20
    expect(p.sheets).toBe(10); // 20 pages → 10 feuilles A4
    expect(p.faces).toBe(20);
  });

  it("distingue pages, feuilles et faces pour un nombre impair de pages", () => {
    expect(sheetsPerCopy(7, "DOUBLE")).toBe(4);
    const p = priceItem(7, { ...base, sides: "DOUBLE", copies: 3 }, rules, finishings);
    expect(p).toMatchObject({ pageCount: 7, sheetsPerCopy: 4, sheets: 12, faces: 21, printCost: 315 });
  });

  it("multiplie l'impression et la reliure par le nombre d'exemplaires", () => {
    const p = priceItem(10, { ...base, finishingCode: "SPIRAL", copies: 2 }, rules, finishings);
    expect(p.printCost).toBe(400);
    expect(p.finishingCost).toBe(500);
    expect(p.lineTotal).toBe(900);
  });

  it("agrafage à 50 FCFA par exemplaire", () => {
    expect(priceItem(3, { ...base, finishingCode: "STAPLE" }, rules, finishings).lineTotal).toBe(60 + 50);
  });

  it("applique une tarification par feuille lorsque configurée", () => {
    const p = priceItem(5, { ...base, paperFormat: "A3" }, rules, finishings);
    expect(p.pricingUnit).toBe("PER_SHEET");
    expect(p.printCost).toBe(300);
  });

  it("refuse une combinaison non configurée au lieu d'inventer un prix", () => {
    expect(() => priceItem(5, { ...base, colorMode: "COLOR", sides: "DOUBLE" }, rules, finishings)).toThrow(PricingError);
    expect(() => priceItem(5, { ...base, colorMode: "COLOR", paperFormat: "A3" }, rules, finishings)).toThrow(/pas encore disponible/);
  });

  it("refuse une finition désactivée", () => {
    expect(() => priceItem(5, { ...base, finishingCode: "HARDCOVER" }, rules, finishings)).toThrow(/reliure/);
  });

  it("refuse des quantités invalides", () => {
    expect(() => priceItem(0, base, rules, finishings)).toThrow(PricingError);
    expect(() => priceItem(3, { ...base, copies: 0 }, rules, finishings)).toThrow(PricingError);
    expect(() => priceItem(2.5, base, rules, finishings)).toThrow(PricingError);
  });

  it("totalise un lot multi-documents et gère la livraison à confirmer", () => {
    const items = [priceItem(10, base, rules, finishings), priceItem(20, { ...base, sides: "DOUBLE" }, rules, finishings)];
    expect(computeTotals(items, { method: "PICKUP", deliveryFee: null })).toMatchObject({ subtotal: 500, deliveryFee: 0, total: 500, totalPages: 30, totalSheets: 20 });
    expect(computeTotals(items, { method: "DELIVERY", deliveryFee: 500 }).total).toBe(1000);
    expect(computeTotals(items, { method: "DELIVERY", deliveryFee: null }).total).toBeNull();
  });
});
