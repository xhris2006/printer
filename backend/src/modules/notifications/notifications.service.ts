import { prisma, type Db } from "../../lib/prisma";
import { logger } from "../../lib/logger";
import { frontendUrl } from "../../config/env";
import { enqueue, registerJobHandler } from "../../jobs/queue";
import { isEmailEnabled, sendEmail } from "./email";
import { getWhatsAppProvider } from "./whatsapp";

export interface NotifyInput {
  userId: string;
  orderId?: string | null;
  type: string;
  title: string;
  body: string;
  /** Chemin relatif dans le frontend (ex. /espace/commandes/123) */
  link?: string;
  email?: boolean;
}

/**
 * Crée une notification dans l'espace client et, si un fournisseur d'email est
 * configuré et que l'utilisateur l'accepte, programme l'envoi d'un email.
 */
export async function notify(input: NotifyInput, db: Db = prisma) {
  await db.notification.create({
    data: {
      userId: input.userId,
      orderId: input.orderId ?? null,
      channel: "IN_APP",
      type: input.type,
      title: input.title,
      body: input.body,
      link: input.link,
      status: "SENT",
      sentAt: new Date(),
    },
  });

  if (input.email !== false && isEmailEnabled()) {
    const user = await db.user.findUnique({ where: { id: input.userId }, include: { customerProfile: true } });
    if (user?.email && user.customerProfile?.notifyByEmail !== false) {
      const notification = await db.notification.create({
        data: {
          userId: input.userId,
          orderId: input.orderId ?? null,
          channel: "EMAIL",
          type: input.type,
          title: input.title,
          body: input.body,
          link: input.link,
          status: "QUEUED",
        },
      });
      await enqueue("notification.email", { notificationId: notification.id }, { maxAttempts: 5 }, db);
    }
  }

  // WhatsApp : uniquement si un fournisseur officiel est branché (aucun par défaut).
  const whatsapp = getWhatsAppProvider();
  if (whatsapp) {
    logger.info({ type: input.type }, "Fournisseur WhatsApp configuré : envoi à implémenter selon les modèles approuvés");
  }
}

registerJobHandler("notification.email", async (payload) => {
  const { notificationId } = payload as { notificationId: string };
  const notification = await prisma.notification.findUnique({ where: { id: notificationId }, include: { user: true } });
  if (!notification || notification.status === "SENT") return;
  if (!notification.user.email) {
    await prisma.notification.update({ where: { id: notificationId }, data: { status: "SKIPPED", error: "Aucune adresse email" } });
    return;
  }
  const link = notification.link ? `${frontendUrl}${notification.link}` : frontendUrl;
  const text = `${notification.body}\n\n${link}\n\n— Print & Secrétariat`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#0f172a">
    <h2 style="color:#1d4ed8">${escapeHtml(notification.title)}</h2>
    <p style="font-size:15px;line-height:1.5">${escapeHtml(notification.body).replace(/\n/g, "<br>")}</p>
    <p><a href="${link}" style="display:inline-block;background:#1d4ed8;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Ouvrir mon espace</a></p>
    <p style="font-size:12px;color:#64748b">Print &amp; Secrétariat — Vos documents, notre priorité</p></div>`;
  try {
    await sendEmail(notification.user.email, notification.title, text, html);
    await prisma.notification.update({ where: { id: notificationId }, data: { status: "SENT", sentAt: new Date(), error: null } });
  } catch (error) {
    await prisma.notification.update({
      where: { id: notificationId },
      data: { status: "FAILED", error: error instanceof Error ? error.message.slice(0, 500) : "Erreur inconnue" },
    });
    throw error;
  }
});

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}
