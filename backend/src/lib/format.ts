/** Formate un montant FCFA avec des espaces simples (compatible polices PDF WinAnsi). */
export function formatFcfa(amount: number): string {
  const sign = amount < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(amount)).toString();
  return `${sign}${abs.replace(/\B(?=(\d{3})+(?!\d))/g, " ")} FCFA`;
}

export function formatDateFr(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
