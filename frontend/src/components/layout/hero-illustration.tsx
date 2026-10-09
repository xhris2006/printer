/** Illustration vectorielle par défaut (remplaçable par une photo via config/site.ts). */
export function HeroIllustration({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 560 420" className={className} role="img" aria-label="Imprimante et documents imprimés">
      <defs>
        <linearGradient id="hi-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#e7efff" />
          <stop offset="1" stopColor="#f8fbff" />
        </linearGradient>
        <linearGradient id="hi-printer" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#334155" />
          <stop offset="1" stopColor="#0f172a" />
        </linearGradient>
        <linearGradient id="hi-screen" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1e293b" />
          <stop offset="1" stopColor="#0b1220" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="560" height="420" rx="28" fill="url(#hi-bg)" />
      <ellipse cx="280" cy="372" rx="230" ry="18" fill="#c7d6f5" opacity="0.6" />
      {/* Écran d'ordinateur */}
      <rect x="300" y="54" width="200" height="140" rx="10" fill="url(#hi-screen)" />
      <rect x="312" y="66" width="176" height="114" rx="4" fill="#f8fafc" />
      <rect x="326" y="80" width="92" height="8" rx="4" fill="#1d4ed8" />
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <rect key={i} x="326" y={98 + i * 12} width={i % 2 ? 120 : 148} height="5" rx="2.5" fill="#cbd5e1" />
      ))}
      <rect x="388" y="194" width="24" height="26" fill="#1e293b" />
      <rect x="360" y="218" width="80" height="8" rx="4" fill="#1e293b" />
      {/* Imprimante */}
      <rect x="70" y="150" width="250" height="40" rx="10" fill="#475569" />
      <rect x="90" y="138" width="210" height="22" rx="6" fill="#64748b" />
      <rect x="60" y="182" width="270" height="120" rx="16" fill="url(#hi-printer)" />
      <rect x="84" y="200" width="88" height="34" rx="6" fill="#0b1220" />
      <rect x="92" y="208" width="52" height="18" rx="3" fill="#38bdf8" opacity="0.85" />
      <circle cx="158" cy="217" r="6" fill="#22c55e" />
      <rect x="196" y="206" width="110" height="8" rx="4" fill="#1f2937" />
      <rect x="196" y="222" width="80" height="8" rx="4" fill="#1f2937" />
      <rect x="92" y="262" width="206" height="16" rx="8" fill="#0b1220" />
      {/* Feuille qui sort */}
      <path d="M108 270 h174 l18 70 h-210 z" fill="#ffffff" stroke="#e2e8f0" />
      {[0, 1, 2, 3].map((i) => (
        <rect key={i} x={118 + i * 2} y={290 + i * 11} width={150 - i * 10} height="5" rx="2.5" fill="#cbd5e1" />
      ))}
      <rect x="118" y="282" width="70" height="6" rx="3" fill="#1d4ed8" />
      {/* Pile de documents */}
      {[0, 1, 2, 3, 4].map((i) => (
        <rect key={i} x={360 - i} y={300 - i * 9} width="150" height="52" rx="4" fill="#ffffff" stroke="#dbe3ef" />
      ))}
      <rect x="372" y="268" width="90" height="6" rx="3" fill="#94a3b8" />
      <rect x="372" y="280" width="120" height="5" rx="2.5" fill="#cbd5e1" />
      {/* Badge validé */}
      <circle cx="486" cy="250" r="22" fill="#1d4ed8" />
      <path d="M476 250 l7 7 l13 -14" stroke="#fff" strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
