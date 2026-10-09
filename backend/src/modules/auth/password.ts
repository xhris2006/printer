import argon2 from "argon2";

// Argon2id avec paramètres recommandés OWASP (19 Mio, 2 itérations)
const OPTIONS = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (password: string) => argon2.hash(password, OPTIONS);

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

/** Hash factice utilisé pour égaliser le temps de réponse lorsqu'un compte n'existe pas. */
let dummyHash: Promise<string> | null = null;
export function getDummyHash() {
  dummyHash ??= hashPassword("compte-inexistant-temps-constant");
  return dummyHash;
}

export const passwordPolicy = {
  minLength: 8,
  maxLength: 128,
};
