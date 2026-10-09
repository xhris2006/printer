/**
 * Normalise un numéro camerounais au format E.164 (+2376XXXXXXXX / +2372XXXXXXXX).
 * Retourne null si le numéro est invalide.
 */
export function normalizeCameroonPhone(input: string): string | null {
  const digits = input.replace(/[^\d+]/g, "");
  let national = digits;
  if (national.startsWith("+237")) national = national.slice(4);
  else if (national.startsWith("00237")) national = national.slice(5);
  else if (national.startsWith("237") && national.length === 12) national = national.slice(3);
  if (!/^[26]\d{8}$/.test(national)) return null;
  return `+237${national}`;
}

/** Numéro national à 9 chiffres (format attendu par les opérateurs Mobile Money). */
export function nationalNumber(e164: string): string {
  return e164.replace(/^\+237/, "");
}

export function maskPhone(e164: string): string {
  const n = nationalNumber(e164);
  return `${n.slice(0, 2)}•••••${n.slice(-2)}`;
}
