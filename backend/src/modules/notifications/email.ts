import nodemailer, { type Transporter } from "nodemailer";
import { env, emailConfigured } from "../../config/env";

let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  transporter ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
  });
  return transporter;
}

export function isEmailEnabled() {
  return emailConfigured;
}

export async function sendEmail(to: string, subject: string, text: string, html?: string) {
  if (!emailConfigured) throw new Error("Aucun fournisseur d'email n'est configuré (SMTP_HOST).");
  await getTransporter().sendMail({ from: env.EMAIL_FROM, to, subject, text, html });
}
