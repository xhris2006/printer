import { env, envAdminPhone } from "../../config/env";
import { prisma } from "../../lib/prisma";
import { logger } from "../../lib/logger";
import { normalizeCameroonPhone } from "../../lib/phone";
import { audit } from "../audit/audit";
import { hashPassword, verifyPassword } from "./password";
import { destroyUserSessions } from "./session";

export interface EnvAdminConfig {
  phone: string;
  fullName: string;
  password: string;
  email?: string | null;
}

export type BootstrapResult = { status: "skipped" } | { status: "created" | "updated" | "unchanged"; userId: string; changes: string[] };

/** Configuration lue dans ADMIN_PHONE / ADMIN_FULL_NAME / ADMIN_PASSWORD / ADMIN_EMAIL. */
export function envAdminConfig(): EnvAdminConfig | null {
  if (!env.ADMIN_PHONE || !env.ADMIN_PASSWORD) return null;
  return {
    phone: env.ADMIN_PHONE,
    fullName: env.ADMIN_FULL_NAME ?? "Administrateur",
    password: env.ADMIN_PASSWORD,
    email: env.ADMIN_EMAIL ?? null,
  };
}

/** Le compte est-il géré par les variables d'environnement (mot de passe, rôle et nom imposés) ? */
export function isEnvManagedAdmin(user: { phone: string }) {
  return envAdminPhone !== null && user.phone === envAdminPhone;
}

/**
 * Crée ou synchronise le compte administrateur défini par les variables d'environnement.
 * Les variables font foi : nom, rôle ADMIN, compte actif et mot de passe sont réappliqués
 * à chaque démarrage. Le mot de passe n'est jamais journalisé.
 */
export async function ensureEnvAdmin(config: EnvAdminConfig | null = envAdminConfig(), attempt = 0): Promise<BootstrapResult> {
  if (!config) return { status: "skipped" };
  const phone = normalizeCameroonPhone(config.phone);
  if (!phone) throw new Error("ADMIN_PHONE invalide");
  const email = config.email ? config.email.trim().toLowerCase() : null;
  const emailFree = async (userId?: string) => {
    if (!email) return false;
    const other = await prisma.user.findUnique({ where: { email } });
    return !other || other.id === userId;
  };

  const existing = await prisma.user.findUnique({ where: { phone } });
  if (!existing) {
    try {
      const user = await prisma.user.create({
        data: {
          fullName: config.fullName,
          phone,
          email: (await emailFree()) ? email : null,
          roleCode: "ADMIN",
          passwordHash: await hashPassword(config.password),
          customerProfile: { create: {} },
        },
      });
      await audit({ action: "user.admin_env_created", entityType: "User", entityId: user.id });
      return { status: "created", userId: user.id, changes: ["création"] };
    } catch (error) {
      // Plusieurs instances démarrées en même temps : on repasse par la mise à jour
      if ((error as { code?: string }).code === "P2002" && attempt === 0) return ensureEnvAdmin(config, 1);
      throw error;
    }
  }

  const data: { roleCode?: "ADMIN"; isActive?: boolean; fullName?: string; email?: string; passwordHash?: string } = {};
  const changes: string[] = [];
  if (existing.roleCode !== "ADMIN") {
    data.roleCode = "ADMIN";
    changes.push("rôle");
  }
  if (!existing.isActive) {
    data.isActive = true;
    changes.push("réactivation");
  }
  if (existing.fullName !== config.fullName) {
    data.fullName = config.fullName;
    changes.push("nom");
  }
  if (email && existing.email !== email && (await emailFree(existing.id))) {
    data.email = email;
    changes.push("email");
  }
  const passwordChanged = !(await verifyPassword(existing.passwordHash, config.password));
  if (passwordChanged) {
    data.passwordHash = await hashPassword(config.password);
    changes.push("mot de passe");
  }
  if (changes.length === 0) return { status: "unchanged", userId: existing.id, changes };

  await prisma.user.update({ where: { id: existing.id }, data });
  if (passwordChanged) await destroyUserSessions(existing.id);
  await audit({ action: "user.admin_env_synced", entityType: "User", entityId: existing.id, metadata: { changes } });
  return { status: "updated", userId: existing.id, changes };
}

export async function bootstrapEnvAdmin() {
  const result = await ensureEnvAdmin();
  if (result.status === "skipped") {
    const admins = await prisma.user.count({ where: { roleCode: "ADMIN", isActive: true } });
    if (admins === 0) {
      logger.warn("Aucun administrateur : définissez ADMIN_PHONE, ADMIN_FULL_NAME et ADMIN_PASSWORD (ou lancez npm run create-admin).");
    }
    return result;
  }
  logger.info({ status: result.status, changes: result.changes }, "Compte administrateur synchronisé depuis les variables d'environnement");
  return result;
}
