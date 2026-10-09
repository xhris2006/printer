/**
 * Création (ou promotion) sécurisée du premier administrateur.
 *
 *   ADMIN_FULL_NAME="Nom" ADMIN_PHONE="+2376XXXXXXXX" ADMIN_EMAIL="admin@exemple.cm" npm run create-admin
 *
 * Si ADMIN_PASSWORD n'est pas fourni, un mot de passe robuste est généré et affiché
 * une seule fois. Aucun mot de passe par défaut n'existe dans le code.
 */
import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/modules/auth/password";
import { passwordSchema, phoneSchema } from "../src/modules/auth/auth.schemas";

const prisma = new PrismaClient();

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const fullName = arg("name") ?? process.env.ADMIN_FULL_NAME;
  const phoneRaw = arg("phone") ?? process.env.ADMIN_PHONE;
  const email = (arg("email") ?? process.env.ADMIN_EMAIL)?.trim().toLowerCase();
  let password = process.env.ADMIN_PASSWORD;
  const resetPassword = process.env.ADMIN_RESET_PASSWORD === "true";

  if (!fullName || !phoneRaw) {
    console.error("ADMIN_FULL_NAME et ADMIN_PHONE sont requis (ou --name / --phone).");
    process.exit(1);
  }
  const phone = phoneSchema.parse(phoneRaw);
  let generated = false;
  if (!password) {
    password = `${randomBytes(12).toString("base64url")}9a`;
    generated = true;
  }
  passwordSchema.parse(password);

  const existing = await prisma.user.findFirst({ where: { OR: [{ phone }, ...(email ? [{ email }] : [])] } });
  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data: {
        roleCode: "ADMIN",
        isActive: true,
        ...(resetPassword ? { passwordHash: await hashPassword(password) } : {}),
      },
    });
    await prisma.auditLog.create({ data: { action: "user.promoted_admin_cli", entityType: "User", entityId: existing.id } });
    console.log(`Compte existant promu administrateur : ${existing.fullName} (${existing.phone}).`);
    if (resetPassword && generated) console.log(`Nouveau mot de passe (à changer après connexion) : ${password}`);
    if (!resetPassword) console.log("Mot de passe inchangé (définissez ADMIN_RESET_PASSWORD=true pour le remplacer).");
    return;
  }

  const user = await prisma.user.create({
    data: {
      fullName,
      phone,
      email: email || null,
      roleCode: "ADMIN",
      passwordHash: await hashPassword(password),
      customerProfile: { create: {} },
    },
  });
  await prisma.auditLog.create({ data: { action: "user.created_admin_cli", entityType: "User", entityId: user.id } });
  console.log(`Administrateur créé : ${user.fullName} (${user.phone}).`);
  if (generated) {
    console.log(`Mot de passe généré (affiché une seule fois, changez-le après connexion) : ${password}`);
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
