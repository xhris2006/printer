import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, CreditCard, Layers, MapPin, Search, Upload, Users } from "lucide-react";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Comment ça marche" };

const STEPS = [
  { icon: Upload, title: "1. Documents", text: "Sélectionnez ou glissez-déposez un ou plusieurs fichiers (PDF, DOC, DOCX, JPG, PNG). Le nombre de pages est détecté automatiquement ; un fichier illisible vous est signalé au lieu d'être estimé au hasard." },
  { icon: Layers, title: "2. Impression", text: "Choisissez couleur, recto verso, format A4/A3 et reliure. Appliquez les mêmes paramètres à tous vos fichiers, puis personnalisez un document si besoin." },
  { icon: MapPin, title: "3. Retrait ou livraison", text: "Retrait gratuit au Centre de santé de Mvam-essakoe, ou livraison (frais affichés ou confirmés par notre équipe avant paiement). Livraison express dans la journée possible." },
  { icon: CreditCard, title: "4. Récapitulatif et paiement", text: "Vérifiez le détail et payez via Fapshi (Mobile Money). Votre commande part en impression uniquement après la confirmation du paiement." },
  { icon: Search, title: "Suivi en temps réel", text: "Suivez chaque étape : paiement confirmé, impression, finition, prête à retirer ou en livraison. Un code de retrait vous est remis." },
  { icon: Users, title: "Commandes groupées", text: "Les délégués de classe créent un lot et un lien de collecte : chaque étudiant envoie ses documents et paie sa part, ou le délégué rassemble tout en une seule commande." },
];

export default function HowItWorksPage() {
  return (
    <div className="container-page py-12">
      <div className="mb-10 max-w-2xl space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Comment ça marche</h1>
        <p className="text-slate-600">Quatre étapes simples, depuis votre téléphone ou votre ordinateur.</p>
      </div>
      <div className="grid gap-5 md:grid-cols-2">
        {STEPS.map((s) => (
          <div key={s.title} className="flex gap-4 rounded-xl border bg-white p-5 shadow-[var(--shadow-soft)]">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-accent text-primary">
              <s.icon className="size-5" />
            </div>
            <div>
              <h2 className="font-semibold">{s.title}</h2>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{s.text}</p>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-10 flex flex-col items-start gap-3 rounded-2xl bg-accent/60 p-6 sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-center gap-2 font-medium text-slate-800">
          <CheckCircle2 className="size-5 text-primary" /> Prêt à commander ? Cela prend moins de deux minutes.
        </p>
        <Button asChild>
          <Link href="/espace/commandes/nouvelle">Passer une commande</Link>
        </Button>
      </div>
    </div>
  );
}
