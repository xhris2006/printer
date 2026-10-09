import type { Metadata } from "next";
import { Clock, MapPin, MessageCircle, Phone } from "lucide-react";
import { site } from "@/config/site";
import { whatsappLink } from "@/lib/format";
import { WhatsAppIcon } from "@/components/layout/whatsapp-button";

export const metadata: Metadata = { title: "Contact" };

export default function ContactPage() {
  return (
    <div className="container-page py-12">
      <div className="mb-10 max-w-2xl space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Contact</h1>
        <p className="text-slate-600">Une question sur une commande, un devis ou une commande groupée ? Écrivez-nous.</p>
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <a
          href={whatsappLink(site.whatsapp, "Bonjour Print & Secrétariat, j'ai une question.")}
          target="_blank"
          rel="noopener noreferrer"
          className="group flex items-start gap-4 rounded-2xl border border-green-200 bg-green-50 p-6 transition hover:shadow-md"
        >
          <div className="flex size-12 items-center justify-center rounded-full bg-[#25D366] text-white">
            <WhatsAppIcon className="size-6" />
          </div>
          <div>
            <h2 className="font-semibold text-green-900">WhatsApp</h2>
            <p className="text-lg font-bold text-green-800">+237 694 600 007</p>
            <p className="mt-1 text-sm text-green-800/80">Réponse rapide. Indiquez votre numéro de commande (ex. PS-XXXXXXX) pour un suivi efficace.</p>
          </div>
        </a>
        <div className="space-y-4 rounded-2xl border bg-white p-6 shadow-[var(--shadow-soft)]">
          <div className="flex items-start gap-3">
            <MapPin className="mt-0.5 size-5 text-primary" />
            <div>
              <p className="font-semibold">Point de retrait</p>
              <p className="text-sm text-muted-foreground">{site.pickupPointName}</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Phone className="mt-0.5 size-5 text-primary" />
            <div>
              <p className="font-semibold">Téléphone</p>
              <a href="tel:+237694600007" className="text-sm text-primary hover:underline">+237 694 600 007</a>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Clock className="mt-0.5 size-5 text-primary" />
            <div>
              <p className="font-semibold">Suivi de commande</p>
              <p className="text-sm text-muted-foreground">Chaque commande dispose d&apos;un lien de suivi sécurisé, disponible dans votre espace client.</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <MessageCircle className="mt-0.5 size-5 text-primary" />
            <div>
              <p className="font-semibold">Notifications</p>
              <p className="text-sm text-muted-foreground">Vous êtes informé dans votre espace (et par email si renseigné) à chaque étape importante.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
