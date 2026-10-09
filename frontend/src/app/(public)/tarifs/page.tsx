import type { Metadata } from "next";
import { PriceSimulator, PricingTable } from "@/components/marketing/pricing-table";

export const metadata: Metadata = { title: "Tarifs" };

export default function TarifsPage() {
  return (
    <div className="container-page space-y-8 py-12">
      <div className="max-w-2xl space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Tarifs</h1>
        <p className="text-slate-600">
          Prix en FCFA. Pour un document recto verso, nous distinguons le nombre de pages du fichier, les faces imprimées et les feuilles utilisées (20 pages en recto verso = 10 feuilles).
        </p>
      </div>
      <PriceSimulator />
      <PricingTable />
    </div>
  );
}
