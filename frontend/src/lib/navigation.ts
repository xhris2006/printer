/** N'autorise que des chemins internes (évite les redirections ouvertes). */
export function safeNext(next: string | null | undefined, fallback = "/espace"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  return next;
}
