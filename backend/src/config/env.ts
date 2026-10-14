import "dotenv/config";
import { z } from "zod";
import { normalizeCameroonPhone } from "../lib/phone";

const bool = (def: boolean) =>
  z
    .enum(["true", "false", "1", "0", ""])
    .optional()
    .transform((v) => (v === undefined || v === "" ? def : v === "true" || v === "1"));

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== "" ? v.trim() : undefined));

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL est requis"),

  FRONTEND_URL: z.string().default("http://localhost:3000"),
  /** URL publique de l'API (liens signés du stockage local). Par défaut : domaine public Railway, sinon localhost. */
  API_PUBLIC_URL: optionalString,
  RAILWAY_PUBLIC_DOMAIN: optionalString,
  RAILWAY_VOLUME_MOUNT_PATH: optionalString,
  APP_SECRET: optionalString,
  TRUST_PROXY: z.string().default("1"),

  SESSION_COOKIE_NAME: z.string().default("ps_session"),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),
  COOKIE_SECURE: optionalString,

  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  /** Dossier du stockage local. Par défaut : volume Railway monté, sinon ./storage. */
  STORAGE_LOCAL_DIR: optionalString,
  S3_BUCKET: optionalString,
  S3_REGION: z.string().default("auto"),
  S3_ENDPOINT: optionalString,
  S3_ACCESS_KEY_ID: optionalString,
  S3_SECRET_ACCESS_KEY: optionalString,
  S3_FORCE_PATH_STYLE: bool(false),

  PAYMENT_PROVIDER: z.enum(["fapshi", "mock", "none"]).default("none"),
  FAPSHI_ENV: z.enum(["sandbox", "live"]).default("sandbox"),
  FAPSHI_API_USER: optionalString,
  FAPSHI_API_KEY: optionalString,
  FAPSHI_WEBHOOK_SECRET: optionalString,
  FAPSHI_BASE_URL: optionalString,
  FAPSHI_DIRECT_PAY_ENABLED: bool(false),
  ALLOW_SANDBOX_IN_PRODUCTION: bool(false),

  SMTP_HOST: optionalString,
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: bool(false),
  SMTP_USER: optionalString,
  SMTP_PASS: optionalString,
  EMAIL_FROM: z.string().default("Print & Secrétariat <no-reply@localhost>"),

  WHATSAPP_PROVIDER: z.enum(["none"]).default("none"),
  SUPPORT_WHATSAPP: z.string().default("+237694600007"),

  LIBREOFFICE_PATH: z.string().default("soffice"),
  CONVERSION_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  CLAMAV_HOST: optionalString,
  CLAMAV_PORT: z.coerce.number().int().positive().default(3310),

  /** Compte administrateur défini par variables (créé ou synchronisé au démarrage de l'API) */
  ADMIN_PHONE: optionalString,
  ADMIN_FULL_NAME: optionalString,
  ADMIN_PASSWORD: optionalString,
  ADMIN_EMAIL: optionalString,

  /** Désactive la limitation de débit (tests E2E locaux uniquement, ignoré en production) */
  DISABLE_RATE_LIMIT: bool(false),
  WORKER_INLINE: bool(true),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(2),
  WORKER_POLL_MS: z.coerce.number().int().min(100).default(1500),
});

export type Env = z.infer<typeof schema>;

function loadEnv(): Env {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Configuration invalide :\n${issues}`);
  }
  const env = parsed.data;
  const problems: string[] = [];

  if (env.NODE_ENV === "production") {
    if (!env.APP_SECRET || env.APP_SECRET.length < 32) {
      problems.push("APP_SECRET doit contenir au moins 32 caractères en production.");
    }
    if (env.PAYMENT_PROVIDER === "mock") {
      problems.push("PAYMENT_PROVIDER=mock est interdit en production (simulateur de développement).");
    }
    if (env.PAYMENT_PROVIDER === "fapshi" && env.FAPSHI_ENV === "sandbox" && !env.ALLOW_SANDBOX_IN_PRODUCTION) {
      problems.push("FAPSHI_ENV=sandbox en production : définissez FAPSHI_ENV=live ou ALLOW_SANDBOX_IN_PRODUCTION=true (préproduction).");
    }
    if (env.STORAGE_DRIVER === "local" && !env.API_PUBLIC_URL && !env.RAILWAY_PUBLIC_DOMAIN) {
      problems.push(
        "API_PUBLIC_URL est requis en production avec STORAGE_DRIVER=local (URL publique de l'API, ex. https://api.exemple.com) : sans elle, les liens de téléversement et de téléchargement des fichiers pointent vers localhost.",
      );
    }
    if (env.PAYMENT_PROVIDER === "fapshi" && !env.FAPSHI_WEBHOOK_SECRET) {
      problems.push("FAPSHI_WEBHOOK_SECRET est requis en production pour authentifier les webhooks.");
    }
  }
  if (env.ADMIN_PHONE || env.ADMIN_PASSWORD) {
    if (!env.ADMIN_PHONE || !env.ADMIN_PASSWORD) {
      problems.push("ADMIN_PHONE et ADMIN_PASSWORD doivent être définis ensemble (compte administrateur).");
    } else {
      if (!normalizeCameroonPhone(env.ADMIN_PHONE)) {
        problems.push("ADMIN_PHONE n'est pas un numéro camerounais valide (ex. +237694600007).");
      }
      if (env.ADMIN_PASSWORD.length < 8 || !/[A-Za-z]/.test(env.ADMIN_PASSWORD) || !/\d/.test(env.ADMIN_PASSWORD)) {
        problems.push("ADMIN_PASSWORD doit contenir au moins 8 caractères, avec des lettres et des chiffres.");
      }
      if (env.ADMIN_EMAIL && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.ADMIN_EMAIL)) {
        problems.push("ADMIN_EMAIL n'est pas une adresse email valide.");
      }
    }
  }
  if (env.PAYMENT_PROVIDER === "fapshi" && (!env.FAPSHI_API_USER || !env.FAPSHI_API_KEY)) {
    problems.push("PAYMENT_PROVIDER=fapshi nécessite FAPSHI_API_USER et FAPSHI_API_KEY.");
  }
  if (env.STORAGE_DRIVER === "s3" && (!env.S3_BUCKET || !env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY)) {
    problems.push("STORAGE_DRIVER=s3 nécessite S3_BUCKET, S3_ACCESS_KEY_ID et S3_SECRET_ACCESS_KEY.");
  }
  if (problems.length > 0) {
    throw new Error(`Configuration invalide :\n${problems.map((p) => `  - ${p}`).join("\n")}`);
  }
  return env;
}

export const env = loadEnv();

export const isProduction = env.NODE_ENV === "production";
export const isTest = env.NODE_ENV === "test";

/** Origines autorisées (CORS / contrôle Origin). La première sert à construire les liens. */
export const frontendOrigins = env.FRONTEND_URL.split(",")
  .map((o) => o.trim().replace(/\/$/, ""))
  .filter(Boolean);
export const frontendUrl = frontendOrigins[0] ?? "http://localhost:3000";
export const apiPublicUrl = (
  env.API_PUBLIC_URL ?? (env.RAILWAY_PUBLIC_DOMAIN ? `https://${env.RAILWAY_PUBLIC_DOMAIN}` : "http://localhost:4000")
).replace(/\/$/, "");

/** Dossier du stockage local (volume persistant recommandé en production). */
export const storageLocalDir = env.STORAGE_LOCAL_DIR ?? env.RAILWAY_VOLUME_MOUNT_PATH ?? "./storage";

/** Secret applicatif : obligatoire en production, dérivé localement sinon (jamais utilisé en prod). */
export const appSecret = env.APP_SECRET ?? "dev-only-insecure-secret-change-me-0123456789";

export const cookieSecure = env.COOKIE_SECURE ? env.COOKIE_SECURE === "true" : isProduction;

export const emailConfigured = Boolean(env.SMTP_HOST);

/** Numéro (E.164) du compte administrateur géré par les variables d'environnement, s'il existe. */
export const envAdminPhone = env.ADMIN_PHONE ? normalizeCameroonPhone(env.ADMIN_PHONE) : null;
