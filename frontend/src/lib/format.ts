const numberFormat = new Intl.NumberFormat("fr-FR");

export function fcfa(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return "À confirmer";
  return `${numberFormat.format(amount)} FCFA`;
}

export function formatDate(value: string | Date | null | undefined, withTime = false): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  return d.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} Mo`;
}

export function plural(n: number, singular: string, pluralForm?: string) {
  return `${n} ${n > 1 ? (pluralForm ?? `${singular}s`) : singular}`;
}

export function formatPhone(e164: string): string {
  const n = e164.replace(/^\+237/, "");
  return `+237 ${n.replace(/(\d)(\d{2})(\d{2})(\d{2})(\d{2})/, "$1 $2 $3 $4 $5")}`;
}

export function whatsappLink(phoneE164: string, message: string) {
  return `https://wa.me/${phoneE164.replace(/[^\d]/g, "")}?text=${encodeURIComponent(message)}`;
}
