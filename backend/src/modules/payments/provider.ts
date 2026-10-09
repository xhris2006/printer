/** Statuts documentés par Fapshi : CREATED, PENDING, SUCCESSFUL, FAILED, EXPIRED. */
export type ProviderStatus = "CREATED" | "PENDING" | "SUCCESSFUL" | "FAILED" | "EXPIRED";

export interface ProviderTransaction {
  transId: string;
  status: ProviderStatus;
  amount: number;
  externalId: string | null;
  medium: string | null;
  financialTransId: string | null;
  dateConfirmed: string | null;
}

export interface CheckoutRequest {
  amount: number;
  externalId: string;
  userId: string;
  email?: string | null;
  redirectUrl: string;
  message: string;
}

export interface DirectPayRequest {
  amount: number;
  /** Numéro national à 9 chiffres */
  phone: string;
  medium?: "mobile money" | "orange money";
  name?: string;
  email?: string | null;
  externalId: string;
  userId: string;
  message: string;
}

export interface PaymentProviderAdapter {
  readonly name: "FAPSHI" | "MOCK";
  readonly environment: "LIVE" | "SANDBOX";
  readonly supportsDirectPay: boolean;
  initiateCheckout(request: CheckoutRequest): Promise<{ transId: string; link: string }>;
  directPay(request: DirectPayRequest): Promise<{ transId: string }>;
  getStatus(transId: string): Promise<ProviderTransaction>;
  expire(transId: string): Promise<void>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly httpStatus?: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

const KNOWN: ProviderStatus[] = ["CREATED", "PENDING", "SUCCESSFUL", "FAILED", "EXPIRED"];

export function normalizeProviderStatus(value: unknown): ProviderStatus {
  const s = String(value ?? "").toUpperCase();
  return (KNOWN as string[]).includes(s) ? (s as ProviderStatus) : "PENDING";
}
