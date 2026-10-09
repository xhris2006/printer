/**
 * Configuration éditoriale du site.
 * Pour utiliser vos propres photos, déposez-les dans `public/images/` et
 * renseignez leur chemin ci-dessous (voir public/images/README.md).
 */
export const site = {
  name: "Print & Secrétariat",
  tagline: "Vos documents, notre priorité",
  whatsapp: process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP ?? "+237694600007",
  pickupPointName: "Centre de santé de Mvam-essakoe",
  images: {
    /** Photo principale de la page d'accueil (ex. "/images/hero.jpg"), sinon illustration intégrée */
    hero: null as string | null,
    /** Visuels optionnels des services (impression, mise en forme, reliure) */
    printing: null as string | null,
    formatting: null as string | null,
    binding: null as string | null,
  },
};
