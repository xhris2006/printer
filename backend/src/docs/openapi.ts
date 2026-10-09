import { z } from "zod";
import { loginSchema, registerSchema, updateProfileSchema, changePasswordSchema, forgotPasswordSchema, resetPasswordSchema } from "../modules/auth/auth.schemas";
import { orderInputSchema } from "../modules/orders/orders.schemas";
import { orderPaymentSchema, cashDeclarationSchema } from "../modules/payments/payments.schemas";
import { groupInputSchema, groupUpdateSchema, delegateRequestSchema } from "../modules/groups/groups.service";
import { quoteRequestSchema, quoteLinesSchema } from "../modules/quotes/quotes.service";
import { settingsUpdateSchema } from "../modules/settings/settings.service";
import { apiPublicUrl } from "../config/env";

type Method = "get" | "post" | "put" | "patch" | "delete";
type Auth = "public" | "user" | "delegate" | "staff" | "admin" | "webhook";

interface RouteDoc {
  method: Method;
  path: string;
  tag: string;
  summary: string;
  auth: Auth;
  body?: z.ZodType;
}

const R = (method: Method, path: string, tag: string, summary: string, auth: Auth, body?: z.ZodType): RouteDoc => ({ method, path, tag, summary, auth, body });

const routes: RouteDoc[] = [
  R("get", "/api/health", "Système", "État du service", "public"),
  R("get", "/api/public/config", "Public", "Configuration publique (tarifs, points de retrait, limites, paiement)", "public"),
  R("get", "/api/public/groups/{token}", "Public", "Informations publiques d'un lien de collecte", "public"),
  R("get", "/api/tracking/{token}", "Public", "Suivi public d'une commande (sans données personnelles)", "public"),
  R("get", "/api/pricing", "Tarifs", "Grille tarifaire publique", "public"),
  R("post", "/api/pricing/estimate", "Tarifs", "Estimation calculée par le serveur", "public"),

  R("post", "/api/auth/register", "Authentification", "Créer un compte client", "public", registerSchema),
  R("post", "/api/auth/login", "Authentification", "Connexion (email ou téléphone)", "public", loginSchema),
  R("post", "/api/auth/logout", "Authentification", "Déconnexion", "user"),
  R("get", "/api/auth/me", "Authentification", "Utilisateur connecté", "public"),
  R("patch", "/api/auth/me", "Authentification", "Mettre à jour le profil", "user", updateProfileSchema),
  R("post", "/api/auth/change-password", "Authentification", "Changer de mot de passe", "user", changePasswordSchema),
  R("post", "/api/auth/forgot-password", "Authentification", "Demander un lien de réinitialisation", "public", forgotPasswordSchema),
  R("post", "/api/auth/reset-password", "Authentification", "Réinitialiser le mot de passe", "public", resetPasswordSchema),

  R("post", "/api/documents/uploads", "Documents", "Demander une URL de téléversement signée", "user", z.object({ fileName: z.string(), size: z.number(), mimeType: z.string().optional() })),
  R("post", "/api/documents/{id}/complete", "Documents", "Finaliser le téléversement et lancer l'analyse asynchrone", "user"),
  R("get", "/api/documents", "Documents", "Mes documents (ou ?ids=a,b pour un suivi d'analyse)", "user"),
  R("get", "/api/documents/{id}", "Documents", "Détail d'un document", "user"),
  R("post", "/api/documents/{id}/declare-pages", "Documents", "Indiquer le nombre de pages (analyse impossible)", "user", z.object({ pageCount: z.number().int() })),
  R("post", "/api/documents/{id}/retry", "Documents", "Relancer l'analyse", "user"),
  R("get", "/api/documents/{id}/download", "Documents", "URL de téléchargement temporaire", "user"),
  R("delete", "/api/documents/{id}", "Documents", "Supprimer un document non utilisé", "user"),

  R("get", "/api/orders", "Commandes", "Mes commandes", "user"),
  R("get", "/api/orders/stats", "Commandes", "Statistiques de l'espace client", "user"),
  R("post", "/api/orders", "Commandes", "Créer un brouillon (prix calculés côté serveur)", "user", orderInputSchema),
  R("get", "/api/orders/{id}", "Commandes", "Détail d'une commande", "user"),
  R("put", "/api/orders/{id}", "Commandes", "Modifier un brouillon", "user", orderInputSchema),
  R("post", "/api/orders/{id}/confirm", "Commandes", "Confirmer (tarifs figés) → en attente de paiement", "user"),
  R("post", "/api/orders/{id}/cancel", "Commandes", "Annuler avant paiement", "user"),
  R("post", "/api/orders/{id}/reorder", "Commandes", "Recommander avec les mêmes options", "user"),
  R("post", "/api/orders/{id}/payments", "Paiements", "Initier un paiement Fapshi", "user", orderPaymentSchema),
  R("get", "/api/orders/{id}/receipt.pdf", "Commandes", "Reçu / récapitulatif PDF", "user"),
  R("get", "/api/payments/{id}", "Paiements", "Statut d'un paiement (revérifié auprès du fournisseur)", "user"),
  R("post", "/api/payments/fapshi/webhook", "Paiements", "Webhook Fapshi (en-tête x-wh-secret)", "webhook"),

  R("post", "/api/delegate/request", "Délégués", "Demander l'espace délégué", "user", delegateRequestSchema),
  R("get", "/api/groups", "Délégués", "Mes commandes groupées (délégué)", "delegate"),
  R("post", "/api/groups", "Délégués", "Créer une commande groupée", "delegate", groupInputSchema),
  R("get", "/api/groups/participations", "Délégués", "Groupes auxquels je participe", "user"),
  R("get", "/api/groups/{id}", "Délégués", "Détail d'un groupe (délégué propriétaire ou équipe)", "delegate"),
  R("patch", "/api/groups/{id}", "Délégués", "Modifier un groupe ouvert", "delegate", groupUpdateSchema),
  R("post", "/api/groups/{id}/close", "Délégués", "Clôturer la collecte", "delegate"),
  R("post", "/api/groups/{id}/reopen", "Délégués", "Rouvrir la collecte", "delegate"),
  R("post", "/api/groups/{id}/cancel", "Délégués", "Annuler le groupe", "delegate"),
  R("post", "/api/groups/{id}/share-link", "Délégués", "Régénérer le lien de collecte", "delegate"),
  R("post", "/api/groups/{id}/orders/{orderId}/cash-declaration", "Délégués", "Signaler un paiement en espèces (à vérifier)", "delegate", cashDeclarationSchema),
  R("get", "/api/groups/{id}/summary.pdf", "Délégués", "Récapitulatif PDF", "delegate"),
  R("get", "/api/groups/{id}/summary.csv", "Délégués", "Récapitulatif CSV", "delegate"),

  R("get", "/api/quotes", "Devis", "Mes demandes de devis", "user"),
  R("post", "/api/quotes", "Devis", "Demander un devis", "user", quoteRequestSchema),
  R("get", "/api/quotes/{id}", "Devis", "Détail d'un devis", "user"),
  R("post", "/api/quotes/{id}/accept", "Devis", "Accepter → commande payable", "user"),
  R("post", "/api/quotes/{id}/reject", "Devis", "Refuser", "user"),

  R("get", "/api/notifications", "Notifications", "Mes notifications", "user"),
  R("post", "/api/notifications/{id}/read", "Notifications", "Marquer comme lue", "user"),
  R("post", "/api/notifications/read-all", "Notifications", "Tout marquer comme lu", "user"),

  R("get", "/api/admin/stats", "Administration", "Statistiques", "staff"),
  R("get", "/api/admin/orders", "Administration", "Commandes (filtres : status, type, paymentStatus, from, to, q)", "staff"),
  R("get", "/api/admin/orders/export.csv", "Administration", "Export CSV", "admin"),
  R("get", "/api/admin/production", "Production", "File de production", "staff"),
  R("get", "/api/admin/orders/{id}", "Administration", "Détail commande", "staff"),
  R("post", "/api/admin/orders/{id}/status", "Production", "Changer le statut de production", "staff", z.object({ status: z.string(), note: z.string().optional() })),
  R("post", "/api/admin/orders/{id}/handover", "Production", "Remise au retrait (preuve)", "staff", z.object({ code: z.string().optional(), recipientName: z.string(), note: z.string().optional() })),
  R("post", "/api/admin/orders/{id}/deliver", "Production", "Livraison effectuée (preuve)", "staff", z.object({ receivedBy: z.string(), note: z.string().optional() })),
  R("post", "/api/admin/orders/{id}/delivery-failed", "Production", "Livraison échouée", "staff"),
  R("post", "/api/admin/orders/{id}/pickup-reschedule", "Production", "Reporter le retrait", "staff"),
  R("post", "/api/admin/orders/{id}/remind", "Production", "Envoyer un rappel de retrait", "staff"),
  R("post", "/api/admin/orders/{id}/not-collected", "Administration", "Marquer comme non retirée", "admin"),
  R("post", "/api/admin/orders/{id}/items/{itemId}/verify-pages", "Production", "Vérifier/corriger le nombre de pages (avant paiement)", "staff"),
  R("post", "/api/admin/orders/{id}/credit", "Administration", "Exception : production sans paiement (journalisée)", "admin"),
  R("post", "/api/admin/orders/{id}/delivery-fee", "Administration", "Fixer les frais de livraison", "admin"),
  R("post", "/api/admin/orders/{id}/cancel", "Administration", "Annuler une commande", "admin"),
  R("post", "/api/admin/orders/{id}/refund", "Administration", "Consigner un remboursement", "admin"),
  R("post", "/api/admin/orders/{id}/cash-payment", "Administration", "Encaissement en espèces au comptoir", "admin"),
  R("get", "/api/admin/documents/{id}/download", "Production", "Télécharger un fichier autorisé (URL temporaire)", "staff"),
  R("get", "/api/admin/payments", "Administration", "Paiements", "admin"),
  R("get", "/api/admin/payments/{id}/events", "Administration", "Journal d'un paiement", "admin"),
  R("post", "/api/admin/payments/{id}/review", "Administration", "Valider/rejeter un paiement déclaré", "admin"),
  R("post", "/api/admin/payments/{id}/sync", "Administration", "Revérifier auprès du fournisseur", "admin"),
  R("get", "/api/admin/users", "Administration", "Utilisateurs", "admin"),
  R("post", "/api/admin/users", "Administration", "Créer un compte (opérateur…) avec lien d'activation", "admin"),
  R("patch", "/api/admin/users/{id}", "Administration", "Rôle / activation", "admin"),
  R("post", "/api/admin/users/{id}/reset-link", "Administration", "Lien de réinitialisation", "admin"),
  R("post", "/api/admin/delegates/{userId}/review", "Administration", "Valider une demande de délégué", "admin"),
  R("get", "/api/admin/groups", "Administration", "Commandes groupées", "staff"),
  R("get", "/api/admin/groups/{id}", "Administration", "Détail d'un groupe", "staff"),
  R("post", "/api/admin/groups/{id}/start-production", "Administration", "Lancer la production d'un groupe", "staff"),
  R("post", "/api/admin/groups/{id}/cancel", "Administration", "Annuler un groupe", "admin"),
  R("get", "/api/admin/quotes", "Administration", "Demandes de devis", "admin"),
  R("get", "/api/admin/quotes/{id}", "Administration", "Détail d'un devis", "admin"),
  R("post", "/api/admin/quotes/{id}/send", "Administration", "Établir et envoyer un devis", "admin", quoteLinesSchema),
  R("post", "/api/admin/quotes/{id}/cancel", "Administration", "Clôturer une demande", "admin"),
  R("get", "/api/admin/audit-logs", "Administration", "Journal d'audit", "admin"),
  R("get", "/api/admin/config/pricing", "Paramétrage", "Grille tarifaire complète", "admin"),
  R("put", "/api/admin/config/pricing/rules", "Paramétrage", "Mettre à jour les règles de prix", "admin"),
  R("put", "/api/admin/config/pricing/finishings", "Paramétrage", "Mettre à jour les finitions", "admin"),
  R("get", "/api/admin/config/delivery-zones", "Paramétrage", "Zones de livraison", "admin"),
  R("post", "/api/admin/config/delivery-zones", "Paramétrage", "Ajouter une zone", "admin"),
  R("patch", "/api/admin/config/delivery-zones/{id}", "Paramétrage", "Modifier une zone", "admin"),
  R("delete", "/api/admin/config/delivery-zones/{id}", "Paramétrage", "Supprimer une zone", "admin"),
  R("get", "/api/admin/config/pickup-points", "Paramétrage", "Points de retrait", "admin"),
  R("post", "/api/admin/config/pickup-points", "Paramétrage", "Ajouter un point de retrait", "admin"),
  R("patch", "/api/admin/config/pickup-points/{id}", "Paramétrage", "Modifier un point de retrait", "admin"),
  R("get", "/api/admin/config/settings", "Paramétrage", "Paramètres", "admin"),
  R("put", "/api/admin/config/settings", "Paramétrage", "Modifier les paramètres", "admin", settingsUpdateSchema),
  R("get", "/api/admin/config/services", "Paramétrage", "Prestations de secrétariat", "admin"),
  R("post", "/api/admin/config/services", "Paramétrage", "Ajouter une prestation", "admin"),
  R("patch", "/api/admin/config/services/{id}", "Paramétrage", "Modifier une prestation", "admin"),
];

const AUTH_NOTE: Record<Auth, string> = {
  public: "Accès public",
  user: "Session requise",
  delegate: "Délégué approuvé (ou équipe)",
  staff: "Équipe (opérateur ou administrateur)",
  admin: "Administrateur uniquement",
  webhook: "Authentifié par l'en-tête x-wh-secret",
};

function jsonSchema(schema: z.ZodType) {
  try {
    return z.toJSONSchema(schema, { io: "input", unrepresentable: "any" });
  } catch {
    return { type: "object" };
  }
}

export function buildOpenApiDocument() {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const r of routes) {
    const parameters = [...r.path.matchAll(/\{(\w+)\}/g)].map((m) => ({ name: m[1], in: "path", required: true, schema: { type: "string" } }));
    paths[r.path] ??= {};
    paths[r.path][r.method] = {
      tags: [r.tag],
      summary: r.summary,
      description: AUTH_NOTE[r.auth],
      security: r.auth === "public" || r.auth === "webhook" ? [] : [{ sessionCookie: [] }],
      parameters,
      ...(r.body ? { requestBody: { required: true, content: { "application/json": { schema: jsonSchema(r.body) } } } } : {}),
      responses: {
        "200": { description: "Succès" },
        "400": { description: "Données invalides", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        "401": { description: "Non authentifié" },
        "403": { description: "Accès refusé" },
        "404": { description: "Introuvable" },
        "409": { description: "Conflit d'état" },
      },
    };
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "API Print & Secrétariat",
      version: "1.0.0",
      description:
        "API REST de la plateforme d'impression et de secrétariat. Montants en FCFA (entiers). Authentification par cookie de session httpOnly.",
    },
    servers: [{ url: apiPublicUrl }],
    components: {
      securitySchemes: { sessionCookie: { type: "apiKey", in: "cookie", name: "ps_session" } },
      schemas: {
        Error: {
          type: "object",
          properties: {
            error: {
              type: "object",
              properties: { code: { type: "string" }, message: { type: "string" }, fields: { type: "array", items: { type: "object" } } },
            },
          },
        },
      },
    },
    paths,
  };
}
