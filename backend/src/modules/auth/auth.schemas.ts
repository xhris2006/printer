import { z } from "zod";
import { normalizeCameroonPhone } from "../../lib/phone";
import { passwordPolicy } from "./password";

export const phoneSchema = z
  .string()
  .trim()
  .min(6, "Numéro de téléphone requis")
  .max(25)
  .transform((v, ctx) => {
    const n = normalizeCameroonPhone(v);
    if (!n) {
      ctx.addIssue({ code: "custom", message: "Numéro camerounais invalide (ex. 6 94 60 00 07)" });
      return z.NEVER;
    }
    return n;
  });

export const passwordSchema = z
  .string()
  .min(passwordPolicy.minLength, `Au moins ${passwordPolicy.minLength} caractères`)
  .max(passwordPolicy.maxLength)
  .refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), "Le mot de passe doit contenir des lettres et des chiffres");

const emailSchema = z.string().trim().toLowerCase().email("Adresse email invalide").max(254);

export const registerSchema = z.object({
  fullName: z.string().trim().min(2, "Nom requis").max(120),
  phone: phoneSchema,
  email: z
    .union([emailSchema, z.literal("")])
    .optional()
    .transform((v) => (v ? v : undefined)),
  password: passwordSchema,
});

export const loginSchema = z.object({
  identifier: z.string().trim().min(3, "Email ou téléphone requis").max(254),
  password: z.string().min(1, "Mot de passe requis").max(128),
});

export const updateProfileSchema = z.object({
  fullName: z.string().trim().min(2).max(120).optional(),
  email: z
    .union([emailSchema, z.literal("")])
    .optional()
    .transform((v) => (v === "" ? null : v)),
  quarter: z.string().trim().max(120).optional(),
  addressDetails: z.string().trim().max(500).optional(),
  notifyByEmail: z.boolean().optional(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
});

export const forgotPasswordSchema = z.object({ identifier: z.string().trim().min(3).max(254) });
export const resetPasswordSchema = z.object({ token: z.string().min(20).max(200), password: passwordSchema });
