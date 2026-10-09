import type { Prisma, Quote, User } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { badRequest, conflict, notFound } from "../../lib/errors";
import { orderReference, pickupCode, quoteReference, secureToken, withUniqueRetry } from "../../lib/ids";
import { formatFcfa } from "../../lib/format";
import { audit } from "../audit/audit";
import { notify } from "../notifications/notifications.service";
import { serializeDocument } from "../documents/documents.service";

export const QUOTE_STATUS_LABELS: Record<Quote["status"], string> = {
  REQUESTED: "Demande envoyée",
  QUOTED: "Devis reçu",
  ACCEPTED: "Accepté",
  REJECTED: "Refusé",
  CANCELLED: "Annulé",
  EXPIRED: "Expiré",
};

export const quoteRequestSchema = z.object({
  serviceCode: z.string().min(1).max(60),
  description: z.string().trim().min(10, "Décrivez votre besoin (au moins 10 caractères)").max(3000),
  deadline: z.coerce.date().optional(),
  documentIds: z.array(z.string().max(64)).max(50).default([]),
});

export const quoteLinesSchema = z.object({
  lines: z
    .array(
      z.object({
        label: z.string().trim().min(2).max(200),
        quantity: z.number().int().min(1).max(100_000),
        unitPrice: z.number().int().min(0).max(10_000_000),
      }),
    )
    .min(1)
    .max(50),
  message: z.string().trim().max(1500).optional(),
  validUntil: z.coerce.date().optional(),
});

export type QuoteLine = z.infer<typeof quoteLinesSchema>["lines"][number];

export const quoteInclude = {
  service: true,
  documents: true,
  customer: { select: { id: true, fullName: true, phone: true, email: true } },
  order: { select: { id: true, reference: true, status: true, paymentStatus: true } },
} satisfies Prisma.QuoteInclude;

type QuoteDetail = Prisma.QuoteGetPayload<{ include: typeof quoteInclude }>;

export function serializeQuote(q: QuoteDetail, viewer: "owner" | "staff") {
  const expired = q.status === "QUOTED" && q.validUntil !== null && q.validUntil < new Date();
  return {
    id: q.id,
    reference: q.reference,
    service: { code: q.service.code, name: q.service.name },
    description: q.description,
    deadline: q.deadline,
    status: expired ? "EXPIRED" : q.status,
    statusLabel: QUOTE_STATUS_LABELS[expired ? "EXPIRED" : q.status],
    amount: q.amount,
    lines: (q.lines as QuoteLine[] | null) ?? [],
    adminMessage: q.adminMessage,
    validUntil: q.validUntil,
    quotedAt: q.quotedAt,
    respondedAt: q.respondedAt,
    documents: q.documents.map(serializeDocument),
    customer: viewer === "staff" ? q.customer : undefined,
    order: q.order,
    createdAt: q.createdAt,
  };
}

export async function createQuoteRequest(user: User, input: z.infer<typeof quoteRequestSchema>) {
  const service = await prisma.serviceOffering.findFirst({ where: { code: input.serviceCode, isActive: true } });
  if (!service) throw badRequest("Prestation inconnue.");
  const ids = [...new Set(input.documentIds)];
  if (ids.length > 0) {
    const docs = await prisma.document.findMany({
      where: { id: { in: ids }, ownerId: user.id, status: { in: ["READY", "NEEDS_REVIEW", "ANALYZING", "UPLOADED"] }, quoteId: null },
    });
    if (docs.length !== ids.length) throw badRequest("Un des documents joints est introuvable, refusé ou déjà utilisé.");
  }
  const quote = await withUniqueRetry(() =>
    prisma.quote.create({
      data: {
        reference: quoteReference(),
        customerId: user.id,
        serviceId: service.id,
        description: input.description,
        deadline: input.deadline,
        documents: ids.length > 0 ? { connect: ids.map((id) => ({ id })) } : undefined,
      },
      include: quoteInclude,
    }),
  );
  const admins = await prisma.user.findMany({ where: { roleCode: "ADMIN", isActive: true }, select: { id: true } });
  for (const a of admins) {
    await notify({
      userId: a.id,
      type: "QUOTE_REQUESTED",
      title: `Nouvelle demande de devis ${quote.reference}`,
      body: `${user.fullName} demande un devis : ${service.name}.`,
      link: `/admin/devis/${quote.id}`,
      email: false,
    });
  }
  return quote;
}

export async function sendQuote(admin: User, quoteId: string, input: z.infer<typeof quoteLinesSchema>, ip?: string) {
  const quote = await prisma.quote.findUnique({ where: { id: quoteId } });
  if (!quote) throw notFound("Devis introuvable.");
  if (!["REQUESTED", "QUOTED"].includes(quote.status)) throw conflict("Ce devis ne peut plus être modifié.");
  const amount = input.lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0);
  if (amount <= 0) throw badRequest("Le montant du devis doit être positif.");
  const validUntil = input.validUntil ?? new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
  const updated = await prisma.quote.update({
    where: { id: quoteId },
    data: {
      status: "QUOTED",
      lines: input.lines as unknown as Prisma.InputJsonValue,
      amount,
      adminMessage: input.message,
      validUntil,
      quotedById: admin.id,
      quotedAt: new Date(),
    },
    include: quoteInclude,
  });
  await audit({ actorId: admin.id, action: "quote.sent", entityType: "Quote", entityId: quoteId, metadata: { amount }, ip });
  await notify({
    userId: quote.customerId,
    type: "QUOTE_SENT",
    title: `Votre devis ${quote.reference} est prêt`,
    body: `Montant proposé : ${formatFcfa(amount)}. Consultez le détail et acceptez-le pour passer au paiement.`,
    link: `/espace/devis/${quote.id}`,
  });
  return updated;
}

/** Acceptation : transforme le devis en commande payable (montants figés). */
export async function acceptQuote(user: User, quoteId: string) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Quote" WHERE "id" = ${quoteId} FOR UPDATE`;
    const quote = await tx.quote.findUnique({ where: { id: quoteId }, include: { service: true } });
    if (!quote || quote.customerId !== user.id) throw notFound("Devis introuvable.");
    if (quote.status !== "QUOTED" || quote.amount === null) throw conflict("Ce devis ne peut pas être accepté.");
    if (quote.validUntil && quote.validUntil < new Date()) {
      await tx.quote.update({ where: { id: quoteId }, data: { status: "EXPIRED" } });
      throw conflict("Ce devis a expiré. Demandez une mise à jour.");
    }
    const point = await tx.pickupPoint.findFirst({ where: { isActive: true }, orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }] });
    const lines = (quote.lines as QuoteLine[] | null) ?? [];
    const order = await tx.order.create({
      data: {
        reference: orderReference(),
        trackingToken: secureToken(24),
        pickupCode: pickupCode(),
        customerId: user.id,
        type: "SERVICE",
        status: "PENDING_PAYMENT",
        fulfillmentMethod: "PICKUP",
        pickupPointId: point?.id ?? null,
        quoteId: quote.id,
        subtotal: quote.amount,
        deliveryFee: 0,
        total: quote.amount,
        confirmedAt: new Date(),
        pricingSnapshot: { source: "quote", quoteReference: quote.reference, lines, amount: quote.amount } as unknown as Prisma.InputJsonValue,
        items: {
          create: lines.map((l, index) => ({
            kind: "SERVICE" as const,
            position: index,
            description: l.label,
            documentName: l.label,
            copies: l.quantity,
            unitPrice: l.unitPrice,
            lineTotal: l.quantity * l.unitPrice,
          })),
        },
        pickup: { create: { pickupPointId: point?.id ?? null } },
        statusHistory: { create: [{ toStatus: "PENDING_PAYMENT", actorId: user.id, note: `Devis ${quote.reference} accepté` }] },
      },
    });
    await tx.quote.update({ where: { id: quoteId }, data: { status: "ACCEPTED", respondedAt: new Date() } });
    return order;
  });
}

export async function rejectQuote(user: User, quoteId: string) {
  const quote = await prisma.quote.findUnique({ where: { id: quoteId } });
  if (!quote || quote.customerId !== user.id) throw notFound("Devis introuvable.");
  if (!["REQUESTED", "QUOTED"].includes(quote.status)) throw conflict("Ce devis ne peut plus être refusé.");
  return prisma.quote.update({
    where: { id: quoteId },
    data: { status: quote.status === "REQUESTED" ? "CANCELLED" : "REJECTED", respondedAt: new Date() },
    include: quoteInclude,
  });
}
