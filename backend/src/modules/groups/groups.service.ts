import type { GroupOrder, Prisma, User } from "@prisma/client";
import { z } from "zod";
import { prisma, type Tx } from "../../lib/prisma";
import { badRequest, conflict, forbidden, notFound } from "../../lib/errors";
import { groupCode, secureToken } from "../../lib/ids";
import { formatDateFr, formatFcfa } from "../../lib/format";
import { PdfBuilder } from "../../lib/pdf";
import { toCsv } from "../../lib/csv";
import { printOptionsSchema } from "../pricing/pricing.schemas";
import { getSettings } from "../settings/settings.service";
import { audit } from "../audit/audit";
import { notify } from "../notifications/notifications.service";
import { STATUS_LABELS } from "../orders/status";
import { lockOrder, transitionOrder } from "../orders/orders.service";
import { refreshGroupStatus } from "../orders/groupStatus";
import { isStaff } from "../../middleware/auth";

export const GROUP_STATUS_LABELS: Record<GroupOrder["status"], string> = {
  OPEN: "Collecte ouverte",
  CLOSED: "Collecte clôturée",
  IN_PRODUCTION: "En production",
  READY: "Prête",
  COMPLETED: "Terminée",
  CANCELLED: "Annulée",
};

export const delegateRequestSchema = z.object({
  institution: z.string().trim().min(2).max(160),
  field: z.string().trim().min(2).max(120),
  level: z.string().trim().min(1).max(60),
  className: z.string().trim().min(1).max(80),
  motivation: z.string().trim().max(500).optional(),
});

export const groupInputSchema = z.object({
  name: z.string().trim().min(3, "Nom du lot requis").max(120),
  institution: z.string().trim().min(2).max(160),
  field: z.string().trim().min(2).max(120),
  level: z.string().trim().min(1).max(60),
  className: z.string().trim().min(1).max(80),
  category: z.string().trim().max(120).optional(),
  instructions: z.string().trim().max(1500).optional(),
  mode: z.enum(["DELEGATE_COLLECT", "STUDENT_CONTRIBUTIONS"]),
  productionRule: z.enum(["FULL_PAYMENT", "PAID_ONLY"]).optional(),
  defaultOptions: printOptionsSchema,
  pickupPointId: z.string().max(64).optional(),
  deadline: z.coerce.date().optional(),
});

export const groupUpdateSchema = groupInputSchema
  .omit({ mode: true })
  .partial()
  .extend({ deadline: z.coerce.date().nullable().optional() });

const groupInclude = {
  defaultPrintConfig: true,
  pickupPoint: true,
  delegate: { select: { id: true, fullName: true } },
  contributions: {
    orderBy: { createdAt: "asc" },
    include: {
      contributor: { select: { id: true, fullName: true } },
      order: { include: { items: { select: { documentName: true, pageCount: true, copies: true, sheets: true } } } },
    },
  },
} satisfies Prisma.GroupOrderInclude;

type GroupDetail = Prisma.GroupOrderGetPayload<{ include: typeof groupInclude }>;

export async function requestDelegateStatus(user: User, input: z.infer<typeof delegateRequestSchema>) {
  const settings = await getSettings();
  const existing = await prisma.delegateProfile.findUnique({ where: { userId: user.id } });
  if (existing?.status === "APPROVED") throw conflict("Vous êtes déjà délégué de classe.");
  if (existing?.status === "SUSPENDED") throw forbidden("Votre accès délégué est suspendu. Contactez l'assistance.");
  const status = settings["delegates.autoApprove"] ? "APPROVED" : "PENDING";
  const profile = await prisma.delegateProfile.upsert({
    where: { userId: user.id },
    create: { userId: user.id, ...input, status },
    update: { ...input, status, reviewNote: null, reviewedAt: null, reviewedById: null },
  });
  if (status === "APPROVED" && user.roleCode === "CUSTOMER") {
    await prisma.user.update({ where: { id: user.id }, data: { roleCode: "DELEGATE" } });
  }
  return profile;
}

export function computeGroupTotals(group: GroupDetail) {
  const orders = group.contributions.map((c) => c.order);
  const confirmed = orders.filter((o) => !["DRAFT", "CANCELLED", "REFUNDED"].includes(o.status));
  const paid = confirmed.filter((o) => o.paymentStatus === "PAID");
  return {
    contributionsCount: group.contributions.length,
    contributorsCount: new Set(group.contributions.map((c) => c.contributorId)).size,
    confirmedCount: confirmed.length,
    paidCount: paid.length,
    unpaidCount: confirmed.filter((o) => o.paymentStatus !== "PAID" && !o.creditApproved).length,
    documentsCount: confirmed.reduce((s, o) => s + o.items.length, 0),
    pagesCount: confirmed.reduce((s, o) => s + o.items.reduce((a, i) => a + i.pageCount, 0), 0),
    sheetsCount: confirmed.reduce((s, o) => s + o.items.reduce((a, i) => a + i.sheets, 0), 0),
    totalAmount: confirmed.reduce((s, o) => s + (o.total ?? 0), 0),
    paidAmount: paid.reduce((s, o) => s + o.amountPaid, 0),
    pendingDeliveryFee: confirmed.some((o) => o.total === null),
  };
}

/** Vérifie la règle de collecte avant la production. */
export function productionReadiness(group: GroupDetail) {
  const totals = computeGroupTotals(group);
  if (group.status === "CANCELLED") return { ready: false, reason: "Groupe annulé.", totals };
  if (group.mode === "STUDENT_CONTRIBUTIONS" && group.status === "OPEN") {
    return { ready: false, reason: "La collecte doit d'abord être clôturée par le délégué.", totals };
  }
  if (totals.confirmedCount === 0) return { ready: false, reason: "Aucune commande confirmée dans ce groupe.", totals };
  if (group.productionRule === "FULL_PAYMENT" && totals.unpaidCount > 0) {
    return { ready: false, reason: `${totals.unpaidCount} commande(s) non payée(s) : paiement intégral requis avant production.`, totals };
  }
  if (totals.paidCount === 0) return { ready: false, reason: "Aucune commande payée.", totals };
  return { ready: true, reason: null as string | null, totals };
}

type GroupViewer = "delegate" | "staff";

export function serializeGroup(group: GroupDetail, viewer: GroupViewer) {
  const readiness = productionReadiness(group);
  return {
    id: group.id,
    code: group.code,
    shareToken: group.shareToken,
    name: group.name,
    institution: group.institution,
    field: group.field,
    level: group.level,
    className: group.className,
    category: group.category,
    instructions: group.instructions,
    mode: group.mode,
    status: group.status,
    statusLabel: GROUP_STATUS_LABELS[group.status],
    productionRule: group.productionRule,
    productionOverride: group.productionOverride,
    deadline: group.deadline,
    closedAt: group.closedAt,
    productionStartedAt: group.productionStartedAt,
    createdAt: group.createdAt,
    delegate: { id: group.delegate.id, fullName: group.delegate.fullName },
    pickupPoint: group.pickupPoint ? { id: group.pickupPoint.id, name: group.pickupPoint.name, address: group.pickupPoint.address } : null,
    defaultOptions: group.defaultPrintConfig
      ? {
          colorMode: group.defaultPrintConfig.colorMode,
          sides: group.defaultPrintConfig.sides,
          paperFormat: group.defaultPrintConfig.paperFormat,
          finishingCode: group.defaultPrintConfig.finishingCode,
          copies: group.defaultPrintConfig.copies,
        }
      : null,
    totals: readiness.totals,
    productionReady: readiness.ready,
    productionBlockedReason: readiness.reason,
    contributions: group.contributions.map((c) => ({
      id: c.id,
      contributor: { id: viewer === "staff" ? c.contributor.id : undefined, fullName: c.contributor.fullName },
      isDelegate: c.contributorId === group.delegateId,
      order: {
        id: c.order.id,
        reference: c.order.reference,
        status: c.order.status,
        statusLabel: STATUS_LABELS[c.order.status],
        paymentStatus: c.order.paymentStatus,
        creditApproved: c.order.creditApproved,
        total: c.order.total,
        amountPaid: c.order.amountPaid,
        documents: c.order.items.map((i) => ({ name: i.documentName, pageCount: i.pageCount, copies: i.copies })),
      },
      createdAt: c.createdAt,
    })),
  };
}

export async function loadGroupForViewer(user: User, groupId: string): Promise<{ group: GroupDetail; viewer: GroupViewer }> {
  const group = await prisma.groupOrder.findUnique({ where: { id: groupId }, include: groupInclude });
  if (!group) throw notFound("Commande groupée introuvable.");
  if (group.delegateId === user.id) return { group, viewer: "delegate" };
  if (isStaff(user)) return { group, viewer: "staff" };
  // Un délégué ne peut jamais consulter le groupe d'un autre délégué
  throw notFound("Commande groupée introuvable.");
}

export async function createGroup(user: User, input: z.infer<typeof groupInputSchema>) {
  const settings = await getSettings();
  const point = input.pickupPointId
    ? await prisma.pickupPoint.findFirst({ where: { id: input.pickupPointId, isActive: true } })
    : await prisma.pickupPoint.findFirst({ where: { isActive: true }, orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }] });
  if (!point) throw badRequest("Aucun point de retrait disponible.");
  if (input.deadline && input.deadline < new Date()) throw badRequest("La date limite doit être dans le futur.");
  const group = await prisma.groupOrder.create({
    data: {
      code: groupCode(),
      shareToken: secureToken(18),
      delegate: { connect: { id: user.id } },
      name: input.name,
      institution: input.institution,
      field: input.field,
      level: input.level,
      className: input.className,
      category: input.category,
      instructions: input.instructions,
      mode: input.mode,
      productionRule: input.productionRule ?? settings["groups.defaultProductionRule"],
      pickupPoint: { connect: { id: point.id } },
      deadline: input.deadline,
      defaultPrintConfig: { create: { ...input.defaultOptions } },
    },
    include: groupInclude,
  });
  await audit({ actorId: user.id, action: "group.created", entityType: "GroupOrder", entityId: group.id, metadata: { mode: group.mode } });
  return group;
}

export async function updateGroup(user: User, groupId: string, input: z.infer<typeof groupUpdateSchema>) {
  const { group } = await loadGroupForViewer(user, groupId);
  if (group.delegateId !== user.id) throw forbidden();
  if (group.status !== "OPEN") throw conflict("Seul un groupe ouvert peut être modifié.");
  if (input.deadline && input.deadline < new Date()) throw badRequest("La date limite doit être dans le futur.");
  if (input.pickupPointId) {
    const point = await prisma.pickupPoint.findFirst({ where: { id: input.pickupPointId, isActive: true } });
    if (!point) throw badRequest("Point de retrait invalide.");
  }
  await prisma.$transaction(async (tx) => {
    const { defaultOptions, ...rest } = input;
    await tx.groupOrder.update({ where: { id: groupId }, data: rest });
    if (defaultOptions) {
      if (group.defaultPrintConfigId) {
        await tx.printConfiguration.update({ where: { id: group.defaultPrintConfigId }, data: defaultOptions });
      } else {
        await tx.groupOrder.update({ where: { id: groupId }, data: { defaultPrintConfig: { create: defaultOptions } } });
      }
    }
  });
  return (await loadGroupForViewer(user, groupId)).group;
}

async function cancelUnpaidGroupOrders(tx: Tx, groupId: string, actorId: string, note: string) {
  const orders = await tx.order.findMany({
    where: { groupOrderId: groupId, status: { in: ["DRAFT", "PENDING_PAYMENT"] }, paymentStatus: { not: "PAID" }, creditApproved: false },
    include: { payments: true },
  });
  let cancelled = 0;
  for (const order of orders) {
    if (order.payments.some((p) => p.status === "PENDING_VERIFICATION")) continue;
    await lockOrder(tx, order.id);
    await tx.payment.updateMany({ where: { orderId: order.id, status: { in: ["CREATED", "PENDING"] } }, data: { status: "CANCELLED", failureReason: note } });
    await transitionOrder(tx, order.id, "CANCELLED", { actorId, note });
    cancelled++;
  }
  return cancelled;
}

/** Clôture de la collecte par le délégué. Avec la règle PAID_ONLY, les contributions non payées sont annulées. */
export async function closeGroup(user: User, groupId: string) {
  const { group } = await loadGroupForViewer(user, groupId);
  if (group.delegateId !== user.id) throw forbidden();
  if (group.status !== "OPEN") throw conflict("La collecte est déjà clôturée.");
  return prisma.$transaction(async (tx) => {
    let cancelled = 0;
    // Les brouillons jamais confirmés sont abandonnés à la clôture
    const drafts = await tx.order.findMany({ where: { groupOrderId: groupId, status: "DRAFT" } });
    for (const d of drafts) {
      await transitionOrder(tx, d.id, "CANCELLED", { actorId: user.id, note: "Brouillon non confirmé à la clôture de la collecte" });
    }
    if (group.productionRule === "PAID_ONLY") {
      cancelled = await cancelUnpaidGroupOrders(tx, groupId, user.id, "Non payée à la clôture de la collecte (règle : seules les contributions payées sont imprimées)");
    }
    await tx.groupOrder.update({ where: { id: groupId }, data: { status: "CLOSED", closedAt: new Date() } });
    await audit({ actorId: user.id, action: "group.closed", entityType: "GroupOrder", entityId: groupId, metadata: { cancelled } }, tx);
    return { cancelled };
  });
}

export async function reopenGroup(user: User, groupId: string) {
  const { group } = await loadGroupForViewer(user, groupId);
  if (group.delegateId !== user.id) throw forbidden();
  if (group.status !== "CLOSED") throw conflict("Seule une collecte clôturée (non lancée en production) peut être rouverte.");
  await prisma.groupOrder.update({ where: { id: groupId }, data: { status: "OPEN", closedAt: null } });
}

export async function cancelGroup(user: User, groupId: string) {
  const { group } = await loadGroupForViewer(user, groupId);
  if (group.delegateId !== user.id && user.roleCode !== "ADMIN") throw forbidden();
  if (!["OPEN", "CLOSED"].includes(group.status)) throw conflict("Ce groupe est déjà en production ou terminé.");
  const paid = group.contributions.some((c) => c.order.paymentStatus === "PAID");
  if (paid && user.roleCode !== "ADMIN") {
    throw conflict("Des contributions sont déjà payées : contactez l'administration pour annuler et organiser les remboursements.");
  }
  await prisma.$transaction(async (tx) => {
    await cancelUnpaidGroupOrders(tx, groupId, user.id, "Commande groupée annulée");
    const drafts = await tx.order.findMany({ where: { groupOrderId: groupId, status: "DRAFT" } });
    for (const d of drafts) await transitionOrder(tx, d.id, "CANCELLED", { actorId: user.id, note: "Commande groupée annulée" });
    await tx.groupOrder.update({ where: { id: groupId }, data: { status: "CANCELLED" } });
    await audit({ actorId: user.id, action: "group.cancelled", entityType: "GroupOrder", entityId: groupId }, tx);
  });
}

export async function regenerateShareToken(user: User, groupId: string) {
  const { group } = await loadGroupForViewer(user, groupId);
  if (group.delegateId !== user.id) throw forbidden();
  return prisma.groupOrder.update({ where: { id: groupId }, data: { shareToken: secureToken(18) } });
}

/**
 * Lancement en production d'une commande groupée par l'administration, selon la
 * règle de collecte. Une dérogation (commandes non payées) est possible pour un
 * administrateur, avec motif obligatoire et journalisation.
 */
export async function startGroupProduction(admin: User, groupId: string, input: { override: boolean; reason?: string }, ip?: string) {
  const group = await prisma.groupOrder.findUnique({ where: { id: groupId }, include: groupInclude });
  if (!group) throw notFound("Commande groupée introuvable.");
  if (group.status === "IN_PRODUCTION" || group.status === "READY" || group.status === "COMPLETED") throw conflict("Production déjà lancée.");
  if (group.status === "CANCELLED") throw conflict("Groupe annulé.");
  const readiness = productionReadiness(group);
  if (!readiness.ready && !input.override) throw conflict(readiness.reason ?? "Conditions de production non remplies.", "GROUP_NOT_READY");
  if (input.override && (!input.reason || input.reason.trim().length < 5)) throw badRequest("Motif de dérogation obligatoire.");
  if (input.override && admin.roleCode !== "ADMIN") throw forbidden("Seul un administrateur peut accorder une dérogation.");

  return prisma.$transaction(async (tx) => {
    let released = 0;
    // Le groupe passe d'abord en production pour autoriser l'entrée des commandes en préparation
    await tx.groupOrder.update({ where: { id: groupId }, data: { status: "IN_PRODUCTION", productionStartedAt: new Date() } });
    for (const c of group.contributions) {
      const order = c.order;
      if (!["PAID", "PENDING_PAYMENT"].includes(order.status)) continue;
      await lockOrder(tx, order.id);
      if (order.paymentStatus !== "PAID" && !order.creditApproved) {
        if (!input.override) continue;
        if (order.status !== "PENDING_PAYMENT") continue;
        await tx.order.update({
          where: { id: order.id },
          data: { creditApproved: true, creditApprovedById: admin.id, creditReason: `Dérogation groupe : ${input.reason}`, creditApprovedAt: new Date() },
        });
      }
      await transitionOrder(tx, order.id, "TO_PREPARE", { actorId: admin.id, note: `Production du groupe ${group.code}` });
      released++;
    }
    if (released === 0) throw conflict("Aucune commande éligible à la production.");
    await tx.groupOrder.update({
      where: { id: groupId },
      data: {
        status: "IN_PRODUCTION",
        productionStartedAt: new Date(),
        productionOverride: input.override,
        productionOverrideReason: input.override ? input.reason : null,
      },
    });
    await refreshGroupStatus(tx, groupId);
    await audit(
      { actorId: admin.id, action: input.override ? "group.production_override" : "group.production_started", entityType: "GroupOrder", entityId: groupId, metadata: { released, reason: input.reason ?? null }, ip },
      tx,
    );
    await notify(
      {
        userId: group.delegateId,
        type: "GROUP_IN_PRODUCTION",
        title: `Lot « ${group.name} » en production`,
        body: `${released} commande(s) du groupe ${group.code} sont en cours de préparation.`,
        link: `/espace/delegue/groupes/${group.id}`,
      },
      tx,
    );
    return { released };
  });
}

export async function buildGroupSummaryPdf(group: GroupDetail) {
  const totals = computeGroupTotals(group);
  const pdf = await PdfBuilder.create(`Récapitulatif ${group.code}`);
  pdf.header("Récapitulatif de commande groupée", `${group.code} — ${group.name} — édité le ${formatDateFr(new Date())}`);
  pdf.keyValue("Établissement", group.institution);
  pdf.keyValue("Filière / niveau / classe", `${group.field} — ${group.level} — ${group.className}`);
  if (group.category) pdf.keyValue("Matière / catégorie", group.category);
  pdf.keyValue("Délégué", group.delegate.fullName);
  pdf.keyValue("Mode", group.mode === "DELEGATE_COLLECT" ? "Collecte par le délégué" : "Contributions des étudiants");
  pdf.keyValue("Statut", GROUP_STATUS_LABELS[group.status]);
  pdf.separator();
  pdf.table(
    [
      { header: "Participant", width: 24 },
      { header: "Commande", width: 16 },
      { header: "Docs", width: 7, align: "right" },
      { header: "Pages", width: 8, align: "right" },
      { header: "Statut", width: 18 },
      { header: "Paiement", width: 12 },
      { header: "Montant", width: 15, align: "right" },
    ],
    group.contributions.map((c) => [
      c.contributor.fullName,
      c.order.reference,
      String(c.order.items.length),
      String(c.order.items.reduce((s, i) => s + i.pageCount, 0)),
      STATUS_LABELS[c.order.status],
      c.order.paymentStatus === "PAID" ? "Payé" : c.order.creditApproved ? "Dérogation" : "Non payé",
      c.order.total === null ? "À confirmer" : formatFcfa(c.order.total),
    ]),
  );
  pdf.keyValue("Commandes confirmées", String(totals.confirmedCount));
  pdf.keyValue("Documents / pages", `${totals.documentsCount} / ${totals.pagesCount}`);
  pdf.keyValue("Montant total", formatFcfa(totals.totalAmount));
  pdf.keyValue("Montant payé (confirmé)", formatFcfa(totals.paidAmount));
  return pdf.save();
}

export function buildGroupSummaryCsv(group: GroupDetail) {
  return toCsv(
    ["Participant", "Commande", "Documents", "Pages", "Statut", "Paiement", "Montant (FCFA)", "Payé (FCFA)"],
    group.contributions.map((c) => [
      c.contributor.fullName,
      c.order.reference,
      c.order.items.length,
      c.order.items.reduce((s, i) => s + i.pageCount, 0),
      STATUS_LABELS[c.order.status],
      c.order.paymentStatus === "PAID" ? "Payé" : "Non payé",
      c.order.total ?? "",
      c.order.amountPaid,
    ]),
  );
}

export { groupInclude };
export type { GroupDetail };
