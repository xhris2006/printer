import { env } from "../../config/env";

/**
 * Point d'extension pour l'API WhatsApp Business officielle (Cloud API Meta ou BSP).
 * Aucun fournisseur n'est configuré par défaut : aucun message WhatsApp n'est envoyé
 * automatiquement. Les clients peuvent contacter l'assistance via un lien wa.me.
 */
export interface WhatsAppProvider {
  readonly name: string;
  sendTemplate(to: string, template: string, variables: Record<string, string>): Promise<void>;
}

export function getWhatsAppProvider(): WhatsAppProvider | null {
  switch (env.WHATSAPP_PROVIDER) {
    case "none":
    default:
      return null;
  }
}

/** Lien wa.me avec message prérempli (aucun envoi automatique). */
export function whatsappSupportLink(message: string): string {
  const number = env.SUPPORT_WHATSAPP.replace(/[^\d]/g, "");
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}
