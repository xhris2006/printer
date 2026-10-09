"use client";

import { useState } from "react";
import { fcfa } from "@/lib/format";

/** Histogramme léger (SVG) des encaissements quotidiens. */
export function RevenueChart({ data }: { data: { date: string; revenue: number; payments: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.revenue));
  const total = data.reduce((s, d) => s + d.revenue, 0);
  const w = 600;
  const h = 180;
  const bw = w / data.length;
  const active = hover !== null ? data[hover] : null;
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between text-sm">
        <span className="text-muted-foreground">{active ? new Date(active.date).toLocaleDateString("fr-FR", { day: "2-digit", month: "long" }) : "Total 30 jours"}</span>
        <span className="font-bold text-slate-900">
          {fcfa(active ? active.revenue : total)}
          {active && <span className="ml-1 text-xs font-normal text-muted-foreground">({active.payments} paiement(s))</span>}
        </span>
      </div>
      <svg viewBox={`0 0 ${w} ${h + 20}`} className="h-48 w-full" role="img" aria-label="Encaissements quotidiens sur 30 jours" onMouseLeave={() => setHover(null)}>
        <line x1="0" x2={w} y1={h} y2={h} stroke="#e2e8f0" />
        {data.map((d, i) => {
          const bh = d.revenue === 0 ? 2 : Math.max(4, (d.revenue / max) * (h - 10));
          return (
            <g key={d.date} onMouseEnter={() => setHover(i)}>
              <rect x={i * bw} y={0} width={bw} height={h} fill="transparent" />
              <rect x={i * bw + bw * 0.18} y={h - bh} width={bw * 0.64} height={bh} rx={3} fill={hover === i ? "#1e40af" : d.revenue === 0 ? "#e2e8f0" : "#3b82f6"} />
            </g>
          );
        })}
        {[0, Math.floor(data.length / 2), data.length - 1].map((i) => (
          <text key={i} x={i * bw + bw / 2} y={h + 15} textAnchor="middle" fontSize="11" fill="#64748b">
            {data[i] ? new Date(data[i].date).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" }) : ""}
          </text>
        ))}
      </svg>
    </div>
  );
}
