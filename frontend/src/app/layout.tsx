import type { Metadata, Viewport } from "next";
import "@fontsource-variable/inter";
import "./globals.css";
import { Providers } from "./providers";
import { WhatsAppButton } from "@/components/layout/whatsapp-button";

export const metadata: Metadata = {
  title: { default: "Print & Secrétariat — Impression et secrétariat en ligne", template: "%s · Print & Secrétariat" },
  description:
    "Commandez vos impressions, mises en forme et services de secrétariat en ligne. Paiement Mobile Money, retrait au Centre de santé de Mvam-essakoe ou livraison.",
  applicationName: "Print & Secrétariat",
};

export const viewport: Viewport = {
  themeColor: "#1d4ed8",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>
        <Providers>
          {children}
          <WhatsAppButton />
        </Providers>
      </body>
    </html>
  );
}
