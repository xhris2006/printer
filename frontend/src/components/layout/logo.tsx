import Link from "next/link";
import { cn } from "@/lib/utils";

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={cn("size-10", className)} aria-hidden>
      <rect x="1" y="1" width="38" height="38" rx="9" className="fill-primary" />
      <path d="M13 9h11l6 6v16a2 2 0 0 1-2 2H13a2 2 0 0 1-2-2V11a2 2 0 0 1 2-2Z" fill="#fff" />
      <path d="M24 9v6h6" fill="#bfd3ff" />
      <path d="M15 19h10M15 23h10M15 27h6" stroke="#1d4ed8" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function Logo({ dark = false, compact = false, href = "/" }: { dark?: boolean; compact?: boolean; href?: string }) {
  return (
    <Link href={href} className="flex items-center gap-2.5" aria-label="Print & Secrétariat — accueil">
      <LogoMark className="size-9 sm:size-10" />
      {!compact && (
        <span className="leading-tight">
          <span className={cn("block text-base font-bold tracking-tight sm:text-lg", dark ? "text-white" : "text-slate-900")}>Print&amp;Secrétariat</span>
          <span className={cn("block text-[11px] sm:text-xs", dark ? "text-blue-200" : "text-muted-foreground")}>Vos documents, notre priorité</span>
        </span>
      )}
    </Link>
  );
}
