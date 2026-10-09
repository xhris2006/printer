import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

// Alphabet sans caractères ambigus (0/O, 1/I/L)
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

export function randomCode(length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

export const orderReference = () => `PS-${randomCode(7)}`;
export const groupCode = () => `GRP-${randomCode(6)}`;
export const quoteReference = () => `DV-${randomCode(6)}`;

/** Jeton opaque non devinable (256 bits). */
export const secureToken = (bytes = 32) => randomBytes(bytes).toString("base64url");

/** Code de retrait à 6 chiffres remis au client. */
export const pickupCode = () => String(randomInt(0, 1_000_000)).padStart(6, "0");

export const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

export function hmac(secret: string, value: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) {
    // Comparaison factice pour un temps constant
    timingSafeEqual(ba, ba);
    return false;
  }
  return timingSafeEqual(ba, bb);
}

/** Exécute fn avec de nouvelles tentatives si une contrainte d'unicité est violée (P2002). */
export async function withUniqueRetry<T>(fn: () => Promise<T>, attempts = 5): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (error) {
      if ((error as { code?: string }).code === "P2002") {
        lastError = error;
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}
