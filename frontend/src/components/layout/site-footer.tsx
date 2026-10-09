import Link from "next/link";
import { MapPin, Phone } from "lucide-react";
import { site } from "@/config/site";
import { whatsappLink } from "@/lib/format";
import { Logo } from "./logo";
import { WhatsAppIcon } from "./whatsapp-button";

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t bg-white">
      <div className="container-page grid gap-8 py-10 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-3 lg:col-span-2">
          <Logo />
          <p className="max-w-md text-sm text-muted-foreground">
            Impression, mise en forme et secrétariat à distance. Envoyez vos documents en ligne, payez par Mobile Money et récupérez-les au point de retrait ou faites-vous livrer.
          </p>
        </div>
        <div>
          <p className="mb-3 text-sm font-semibold">Plateforme</p>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li><Link href="/services" className="hover:text-primary">Nos services</Link></li>
            <li><Link href="/tarifs" className="hover:text-primary">Tarifs</Link></li>
            <li><Link href="/comment-ca-marche" className="hover:text-primary">Comment ça marche</Link></li>
            <li><Link href="/espace/delegue" className="hover:text-primary">Espace délégués</Link></li>
          </ul>
        </div>
        <div>
          <p className="mb-3 text-sm font-semibold">Contact</p>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li className="flex items-start gap-2"><MapPin className="mt-0.5 size-4 shrink-0 text-primary" /> {site.pickupPointName}</li>
            <li className="flex items-center gap-2"><Phone className="size-4 text-primary" /> +237 694 600 007</li>
            <li>
              <a className="inline-flex items-center gap-2 font-medium text-green-700 hover:underline" href={whatsappLink(site.whatsapp, "Bonjour Print & Secrétariat !")} target="_blank" rel="noopener noreferrer">
                <WhatsAppIcon className="size-4" /> Écrire sur WhatsApp
              </a>
            </li>
          </ul>
        </div>
      </div>
      <div className="border-t py-4 text-center text-xs text-muted-foreground">© {new Date().getFullYear()} Print &amp; Secrétariat — Tous droits réservés.</div>
    </footer>
  );
}
