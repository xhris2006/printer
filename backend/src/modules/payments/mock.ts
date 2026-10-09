import { randomUUID } from "node:crypto";
import { frontendUrl } from "../../config/env";
import type { CheckoutRequest, DirectPayRequest, PaymentProviderAdapter, ProviderStatus, ProviderTransaction } from "./provider";

/**
 * SIMULATEUR DE DÉVELOPPEMENT — n'encaisse aucun argent réel.
 * Interdit en production (vérifié au démarrage). Les paiements créés avec ce
 * simulateur sont marqués environnement SANDBOX et le frontend affiche un
 * bandeau « Mode test ». Le résultat (réussi/échoué) est choisi manuellement.
 */
export class MockPaymentAdapter implements PaymentProviderAdapter {
  readonly name = "MOCK" as const;
  readonly environment = "SANDBOX" as const;
  readonly supportsDirectPay = true;
  private transactions = new Map<string, ProviderTransaction>();

  async initiateCheckout(r: CheckoutRequest) {
    const transId = `MOCK-${randomUUID()}`;
    this.transactions.set(transId, this.tx(transId, r.amount, r.externalId, "CREATED"));
    return { transId, link: `${frontendUrl}/paiement/simulateur?payment=${encodeURIComponent(r.externalId)}` };
  }

  async directPay(r: DirectPayRequest) {
    const transId = `MOCK-${randomUUID()}`;
    this.transactions.set(transId, this.tx(transId, r.amount, r.externalId, "PENDING", "mobile money"));
    return { transId };
  }

  async getStatus(transId: string) {
    const t = this.transactions.get(transId);
    if (!t) return this.tx(transId, 0, null, "EXPIRED");
    return t;
  }

  async expire(transId: string) {
    const t = this.transactions.get(transId);
    if (t && t.status !== "SUCCESSFUL") t.status = "EXPIRED";
  }

  /** Choix manuel du résultat (page simulateur ou tests). */
  setOutcome(transId: string, status: ProviderStatus, overrides: Partial<ProviderTransaction> = {}) {
    const t = this.transactions.get(transId);
    if (!t) return false;
    Object.assign(t, { status, dateConfirmed: status === "SUCCESSFUL" ? new Date().toISOString() : null }, overrides);
    return true;
  }

  private tx(transId: string, amount: number, externalId: string | null, status: ProviderStatus, medium: string | null = null): ProviderTransaction {
    return { transId, status, amount, externalId, medium, financialTransId: null, dateConfirmed: null };
  }
}
