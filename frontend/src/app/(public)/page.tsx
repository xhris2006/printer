import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Clock,
  CreditCard,
  FileText,
  Headphones,
  Layers,
  PenLine,
  Printer,
  ShieldCheck,
  Truck,
  Upload,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { HeroIllustration } from "@/components/layout/hero-illustration";
import { ImageSlot } from "@/components/marketing/image-slot";
import { PricingTable } from "@/components/marketing/pricing-table";
import { site } from "@/config/site";

const FEATURES = [
  { icon: Clock, title: "Gain de temps", text: "Commandez en quelques clics, où que vous soyez." },
  { icon: ShieldCheck, title: "Paiement sécurisé", text: "Mobile Money via Fapshi, transactions vérifiées." },
  { icon: Truck, title: "Livraison possible", text: "Recevez vos documents où vous le souhaitez." },
  { icon: Headphones, title: "Service client", text: "Une équipe à votre écoute sur WhatsApp." },
];

const CHECKLIST = [
  "Impression couleur / noir et blanc",
  "Recto verso / simple face",
  "Reliure / agrafage",
  "Mise en forme de documents",
  "Livraison à domicile ou sur site",
];

const STEPS = [
  { icon: Upload, title: "Téléversez vos documents", text: "PDF, Word ou images. Le nombre de pages est détecté automatiquement." },
  { icon: Layers, title: "Choisissez vos options", text: "Couleur, recto verso, format, reliure… appliquées à tous vos fichiers en un clic." },
  { icon: CreditCard, title: "Payez par Mobile Money", text: "Le prix est calculé en temps réel ; l'impression démarre après paiement confirmé." },
  { icon: CheckCircle2, title: "Retirez ou recevez", text: "Retrait au Centre de santé de Mvam-essakoe ou livraison, avec suivi en direct." },
];

const SERVICES = [
  { icon: Printer, title: "Impression", text: "Noir et blanc ou couleur, A4 ou A3, recto ou recto verso." },
  { icon: PenLine, title: "Mise en forme", text: "Mémoires, rapports, CV et dossiers administratifs soignés." },
  { icon: FileText, title: "Saisie", text: "Saisie de vos documents manuscrits ou scannés." },
  { icon: BookOpen, title: "Reliure et agrafage", text: "Spirale, agrafage ou reliure cartonnée rigide." },
];

export default function HomePage() {
  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-br from-white via-[#f3f7ff] to-[#e9f0ff]">
        <div className="container-page grid items-center gap-10 py-12 lg:grid-cols-2 lg:py-20">
          <div className="animate-fade-up space-y-6">
            <span className="inline-flex flex-wrap items-center gap-x-2 rounded-full bg-accent px-3.5 py-1.5 text-sm font-semibold text-primary">
              Impression <span aria-hidden>•</span> Mise en forme <span aria-hidden>•</span> Secrétariat
            </span>
            <h1 className="text-balance text-3xl leading-tight font-extrabold tracking-tight text-slate-900 sm:text-4xl lg:text-5xl">
              Imprimez et faites traiter vos documents en toute simplicité
            </h1>
            <p className="max-w-xl text-base leading-relaxed text-slate-600 sm:text-lg">
              Commandez vos impressions, mises en forme et services de secrétariat en ligne. Rapide, sécurisé et accessible depuis partout.
            </p>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {FEATURES.map((f) => (
                <div key={f.title} className="space-y-1.5">
                  <f.icon className="size-6 text-primary" aria-hidden />
                  <p className="text-sm font-semibold text-slate-900">{f.title}</p>
                  <p className="text-xs leading-relaxed text-slate-600">{f.text}</p>
                </div>
              ))}
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button size="lg" asChild>
                <Link href="/espace/commandes/nouvelle">
                  Passer une commande <ArrowRight />
                </Link>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <Link href="/services">Découvrir nos services</Link>
              </Button>
            </div>
          </div>
          <div className="relative">
            <ImageSlot src={site.images.hero} alt="Imprimante professionnelle et documents imprimés" className="aspect-[4/3] w-full overflow-hidden rounded-3xl" priority>
              <HeroIllustration className="h-full w-full" />
            </ImageSlot>
            <div className="absolute -top-4 right-2 hidden rounded-2xl border bg-white/95 p-4 shadow-xl sm:block lg:-right-4">
              <ul className="space-y-2.5">
                {CHECKLIST.map((c) => (
                  <li key={c} className="flex items-center gap-2 text-sm text-slate-700">
                    <CheckCircle2 className="size-4 text-primary" aria-hidden /> {c}
                  </li>
                ))}
              </ul>
            </div>
            <p className="absolute right-6 -bottom-2 rotate-[-6deg] text-2xl font-semibold text-slate-800 italic sm:text-3xl" style={{ fontFamily: "'Brush Script MT', 'Segoe Script', cursive" }}>
              Simple. Rapide. <span className="text-primary">Efficace.</span>
            </p>
          </div>
        </div>
      </section>

      {/* Services */}
      <section className="container-page py-16" aria-labelledby="services-title">
        <div className="mb-8 max-w-2xl space-y-2">
          <h2 id="services-title" className="text-2xl font-bold tracking-tight sm:text-3xl">Tout pour vos documents</h2>
          <p className="text-slate-600">Des impressions de cours aux mémoires reliés, en passant par la saisie et la mise en forme.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {SERVICES.map((s) => (
            <div key={s.title} className="rounded-xl border bg-white p-5 shadow-[var(--shadow-soft)] transition hover:-translate-y-0.5 hover:shadow-md">
              <div className="mb-4 flex size-11 items-center justify-center rounded-lg bg-accent text-primary">
                <s.icon className="size-5" aria-hidden />
              </div>
              <h3 className="font-semibold">{s.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{s.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Comment ça marche */}
      <section className="bg-white py-16" aria-labelledby="steps-title">
        <div className="container-page">
          <h2 id="steps-title" className="mb-8 text-2xl font-bold tracking-tight sm:text-3xl">Comment ça marche</h2>
          <ol className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s, i) => (
              <li key={s.title} className="relative rounded-xl bg-background p-5">
                <span className="absolute top-4 right-4 text-4xl font-extrabold text-primary/10">{i + 1}</span>
                <s.icon className="mb-3 size-7 text-primary" aria-hidden />
                <h3 className="font-semibold">{s.title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{s.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Délégués */}
      <section className="container-page py-16">
        <div className="grid items-center gap-8 overflow-hidden rounded-3xl bg-sidebar p-8 text-white sm:p-12 lg:grid-cols-[1.4fr_1fr]">
          <div className="space-y-4">
            <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-blue-100">
              <Users className="size-4" /> Délégués de classe
            </span>
            <h2 className="text-2xl font-bold sm:text-3xl">Commandes groupées pour toute la classe</h2>
            <p className="text-blue-100">
              Créez un lot, partagez un lien de collecte sécurisé : chaque étudiant envoie ses fichiers et paie sa part. Vous suivez les contributions, les paiements et la remise en temps réel.
            </p>
            <Button size="lg" className="bg-white text-primary hover:bg-blue-50" asChild>
              <Link href="/espace/delegue">Ouvrir l&apos;espace délégué</Link>
            </Button>
          </div>
          <ul className="space-y-3 text-sm text-blue-50">
            {["Paramètres communs avec exceptions par fichier", "Lien de collecte partageable", "Total calculé sur les paiements confirmés", "Récapitulatif PDF / CSV téléchargeable"].map((t) => (
              <li key={t} className="flex items-center gap-2">
                <CheckCircle2 className="size-4 text-blue-300" /> {t}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Tarifs */}
      <section className="container-page pb-8" aria-labelledby="tarifs-title">
        <div className="mb-8 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
          <div className="space-y-2">
            <h2 id="tarifs-title" className="text-2xl font-bold tracking-tight sm:text-3xl">Des tarifs clairs</h2>
            <p className="text-slate-600">Le prix exact s&apos;affiche avant le paiement, document par document.</p>
          </div>
          <Button variant="outline" asChild>
            <Link href="/tarifs">Simuler un prix</Link>
          </Button>
        </div>
        <PricingTable />
      </section>
    </>
  );
}
