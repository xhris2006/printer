import { env } from "../../config/env";
import {
  normalizeProviderStatus,
  ProviderError,
  type CheckoutRequest,
  type DirectPayRequest,
  type PaymentProviderAdapter,
  type ProviderTransaction,
} from "./provider";

/**
 * Adaptateur Fapshi (https://docs.fapshi.com).
 *  - Authentification : en-têtes `apiuser` et `apikey` (jamais exposés au frontend).
 *  - POST /initiate-pay      → { message, link, transId, dateInitiated }
 *  - POST /direct-pay        → { message, transId, dateInitiated } (à activer par le support Fapshi en production)
 *  - GET  /payment-status/:id→ { transId, status, medium, amount, externalId, financialTransId, dateConfirmed, … }
 *  - POST /expire-pay        → expire un lien de paiement non utilisé
 * Le webhook (configuré dans le tableau de bord Fapshi) envoie le même corps que
 * /payment-status ; l'en-tête `x-wh-secret` contient le secret défini sur le tableau de bord.
 */
export class FapshiAdapter implements PaymentProviderAdapter {
  readonly name = "FAPSHI" as const;
  readonly environment = env.FAPSHI_ENV === "live" ? ("LIVE" as const) : ("SANDBOX" as const);
  readonly supportsDirectPay = env.FAPSHI_DIRECT_PAY_ENABLED;
  private readonly baseUrl =
    env.FAPSHI_BASE_URL ?? (env.FAPSHI_ENV === "live" ? "https://live.fapshi.com" : "https://sandbox.fapshi.com");

  private async request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          apiuser: env.FAPSHI_API_USER ?? "",
          apikey: env.FAPSHI_API_KEY ?? "",
          "content-type": "application/json",
          accept: "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new ProviderError("Le service de paiement est injoignable. Réessayez dans un instant.");
    }
    const text = await response.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!response.ok) {
      const message = (data as { message?: string } | null)?.message;
      throw new ProviderError(message ? `Fapshi : ${message}` : `Fapshi a répondu ${response.status}`, response.status);
    }
    return data as T;
  }

  async initiateCheckout(r: CheckoutRequest) {
    const data = await this.request<{ link?: string; transId?: string }>("POST", "/initiate-pay", {
      amount: r.amount,
      email: r.email ?? undefined,
      redirectUrl: r.redirectUrl,
      userId: r.userId,
      externalId: r.externalId,
      message: r.message,
    });
    if (!data?.link || !data.transId) throw new ProviderError("Réponse Fapshi incomplète (lien ou transId manquant).");
    return { transId: data.transId, link: data.link };
  }

  async directPay(r: DirectPayRequest) {
    if (!this.supportsDirectPay) throw new ProviderError("Le paiement direct n'est pas activé.");
    const data = await this.request<{ transId?: string }>("POST", "/direct-pay", {
      amount: r.amount,
      phone: r.phone,
      medium: r.medium,
      name: r.name,
      email: r.email ?? undefined,
      userId: r.userId,
      externalId: r.externalId,
      message: r.message,
    });
    if (!data?.transId) throw new ProviderError("Réponse Fapshi incomplète (transId manquant).");
    return { transId: data.transId };
  }

  async getStatus(transId: string): Promise<ProviderTransaction> {
    const d = await this.request<Record<string, unknown>>("GET", `/payment-status/${encodeURIComponent(transId)}`);
    return mapFapshiTransaction(d);
  }

  async expire(transId: string) {
    await this.request("POST", "/expire-pay", { transId });
  }
}

export function mapFapshiTransaction(d: Record<string, unknown>): ProviderTransaction {
  return {
    transId: String(d.transId ?? ""),
    status: normalizeProviderStatus(d.status),
    amount: Number(d.amount ?? 0),
    externalId: d.externalId ? String(d.externalId) : null,
    medium: d.medium ? String(d.medium) : null,
    financialTransId: d.financialTransId ? String(d.financialTransId) : null,
    dateConfirmed: d.dateConfirmed ? String(d.dateConfirmed) : null,
  };
}
