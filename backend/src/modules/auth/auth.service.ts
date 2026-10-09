import type { CustomerProfile, DelegateProfile, User } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { normalizeCameroonPhone } from "../../lib/phone";
import { secureToken, sha256 } from "../../lib/ids";

export function findUserByIdentifier(identifier: string) {
  const value = identifier.trim();
  if (value.includes("@")) return prisma.user.findUnique({ where: { email: value.toLowerCase() } });
  const phone = normalizeCameroonPhone(value);
  if (!phone) return Promise.resolve(null);
  return prisma.user.findUnique({ where: { phone } });
}

export function publicUser(
  user: User & { delegateProfile?: DelegateProfile | null; customerProfile?: CustomerProfile | null },
) {
  return {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    phone: user.phone,
    role: user.roleCode,
    isActive: user.isActive,
    createdAt: user.createdAt,
    delegate: user.delegateProfile
      ? {
          status: user.delegateProfile.status,
          institution: user.delegateProfile.institution,
          field: user.delegateProfile.field,
          level: user.delegateProfile.level,
          className: user.delegateProfile.className,
          reviewNote: user.delegateProfile.reviewNote,
        }
      : null,
    profile: user.customerProfile
      ? {
          quarter: user.customerProfile.quarter,
          addressDetails: user.customerProfile.addressDetails,
          notifyByEmail: user.customerProfile.notifyByEmail,
        }
      : null,
  };
}

/** Crée un jeton de réinitialisation à usage unique (1 heure). Retourne le jeton en clair. */
export async function createPasswordResetToken(userId: string, ttlMs = 60 * 60 * 1000) {
  const token = secureToken(32);
  await prisma.passwordResetToken.create({
    data: { userId, tokenHash: sha256(token), expiresAt: new Date(Date.now() + ttlMs) },
  });
  return token;
}
