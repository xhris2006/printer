import type { Document, FulfillmentMethod, GroupOrder, OrderStatus, Prisma, User } from "@prisma/client";
import { prisma, type Tx } from "../../lib/prisma";
import { badRequest, conflict, forbidden, notFound, unprocessable } from "../../lib/errors";
import { orderReference, pickupCode, secureToken } from "../../lib/ids";
import { formatFcfa } from "../../lib/format";
import { getSettings } from "../settings/settings.service";
import { computeTotals, priceItem, PricingError, type ItemPrice } from "../pricing/pricing";
import { buildSnapshot, loadPricing, resolveDeliveryFee, type DeliveryResolution } from "../pricing/pricing.service";
import { notify } from "../notifications/notifications.service";
import { audit } from "../audit/audit";
import { canTransition, IN_PRODUCTION_STATUSES, STATUS_LABELS } from "./status";
import type { OrderInput } from "./orders.schemas";
import { refreshGroupStatus } from "./groupStatus";

/** Montant minimal accepté par Fapshi pour un paiement (documentation officielle). */
export const MIN_ONLINE_PAYMENT = 100;

export const orderDetailInclude = {
  items: { include: { printConfig: true, document: true }, orderBy: { position: "asc" } },
  payments: { orderBy: { createdAt: "desc" } },
  delivery: { include: { zone: true } },
  pickup: true,
  pickupPoint: true,
  statusHistory: { orderBy: { createdAt: "asc" } },
  groupOrder: true,
  customer: true,
  refunds: { orderBy: { createdAt: "desc" } },
  quote: { include: { service: true } },
} satisfies Prisma.OrderInclude;

export type OrderDetail = Prisma.OrderGetPayload<{ include: typeof orderDetailInclude }>;

export async function lockOrder(tx: Tx, orderId: string) {
  await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`;
}

export function paymentEligibility(order: { status: OrderStatus; paymentStatus: string; total: number | null; creditApproved: boolean }) {
  if (order.paymentStatus === "PAID") return { canPay: false, reason: "Cette commande est déjà payée." };
  if (order.status === "DRAFT") return { canPay: false, reason: "Confirmez d'abord la commande." };
  if (order.status !== "PENDING_PAYMENT") return { canPay: false, reason: "Cette commande n'est pas en attente de paiement." };
  if (order.total === null) {
    return { canPay: false, reason: "Les frais de livraison sont à confirmer par notre équipe avant le paiement." };
  }
  if (order.total < MIN_ONLINE_PAYMENT) {
    return {
      canPay: false,
      reason: `Le paiement en ligne nécessite un montant minimum de ${formatFcfa(MIN_ONLINE_PAYMENT)}. Ajoutez des documents ou des exemplaires.`,
    };
  }
  return { canPay: true, reason: null as string | null };
}

type Viewer = "owner" | "staff" | "delegate";

export function serializeOrder(order: OrderDetail, viewer: Viewer) {
  const eligibility = paymentEligibility(order);
  const showPrivate = viewer !== "delegate";
  return {
    id: order.id,
    reference: order.reference,
    type: order.type,
    status: order.status,
    statusLabel: STATUS_LABELS[order.status],
    paymentStatus: order.paymentStatus,
    fulfillmentMethod: order.fulfillmentMethod,
    subtotal: order.subtotal,
    deliveryFee: order.deliveryFee,
    total: order.total,
    amountPaid: order.amountPaid,
    currency: order.currency,
    notes: showPrivate ? order.notes : null,
    trackingToken: viewer === "owner" || viewer === "staff" ? order.trackingToken : undefined,
    pickupCode: viewer === "owner" && (order.paymentStatus === "PAID" || order.creditApproved) ? order.pickupCode : undefined,
    creditApproved: order.creditApproved,
    creditReason: viewer === "staff" ? order.creditReason : undefined,
    canPay: eligibility.canPay,
    paymentBlockedReason: eligibility.reason,
    customer:
      viewer === "staff"
        ? { id: order.customer.id, fullName: order.customer.fullName, phone: order.customer.phone, email: order.customer.email }
        : viewer === "delegate"
          ? { fullName: order.customer.fullName }
          : undefined,
    pickupPoint: order.pickupPoint
      ? { id: order.pickupPoint.id, name: order.pickupPoint.name, address: order.pickupPoint.address, hours: order.pickupPoint.hours }
      : null,
    delivery:
      order.delivery && showPrivate
        ? {
            recipientName: order.delivery.recipientName,
            phone: order.delivery.phone,
            quarter: order.delivery.quarter,
            directions: order.delivery.directions,
            zone: order.delivery.zone ? { id: order.delivery.zone.id, name: order.delivery.zone.name } : null,
            fee: order.delivery.fee,
            status: order.delivery.status,
            deliveredAt: order.delivery.deliveredAt,
            receivedBy: viewer === "staff" ? order.delivery.receivedBy : undefined,
            proofNote: viewer === "staff" ? order.delivery.proofNote : undefined,
          }
        : null,
    pickup: order.pickup
      ? {
          status: order.pickup.status,
          readyAt: order.pickup.readyAt,
          pickedUpAt: order.pickup.pickedUpAt,
          pickedUpBy: viewer === "staff" ? order.pickup.pickedUpBy : undefined,
          verifiedWithCode: order.pickup.verifiedWithCode,
          rescheduledTo: order.pickup.rescheduledTo,
          note: viewer === "staff" ? order.pickup.note : undefined,
        }
      : null,
    items: order.items.map((item) => ({
      id: item.id,
      kind: item.kind,
      documentId: showPrivate ? item.documentId : undefined,
      documentName: item.documentName,
      description: item.description,
      documentAvailable: Boolean(item.document && !item.document.purgedAt && item.document.status !== "DELETED"),
      pageCountSource: item.document?.pageCountSource ?? null,
      documentKind: item.document?.kind ?? null,
      pageCount: item.pageCount,
      sheets: item.sheets,
      faces: item.faces,
      copies: item.copies,
      options: item.printConfig
        ? {
            colorMode: item.printConfig.colorMode,
            sides: item.printConfig.sides,
            paperFormat: item.printConfig.paperFormat,
            finishingCode: item.printConfig.finishingCode,
            copies: item.printConfig.copies,
          }
        : null,
      unitPrice: item.unitPrice,
      pricingUnit: item.pricingUnit,
      printCost: item.printCost,
      finishingUnitPrice: item.finishingUnitPrice,
      finishingCost: item.finishingCost,
      lineTotal: item.lineTotal,
    })),
    payments: showPrivate
      ? order.payments.map((p) => ({
          id: p.id,
          provider: p.provider,
          method: p.method,
          environment: p.environment,
          status: p.status,
          amount: p.amount,
          isDuplicate: p.isDuplicate,
          medium: p.medium,
          providerTransId: viewer === "staff" ? p.providerTransId : undefined,
          failureReason: p.failureReason,
          declarationNote: viewer === "staff" ? p.declarationNote : undefined,
          createdAt: p.createdAt,
          confirmedAt: p.confirmedAt,
        }))
      : [],
    refunds:
      viewer === "staff"
        ? order.refunds.map((r) => ({ id: r.id, amount: r.amount, method: r.method, reference: r.reference, note: r.note, createdAt: r.createdAt }))
        : [],
    history: order.statusHistory.map((h) => ({
      status: h.toStatus,
      label: STATUS_LABELS[h.toStatus],
      note: viewer === "staff" ? h.note : undefined,
      createdAt: h.createdAt,
    })),
    group: order.groupOrder
      ? { id: order.groupOrder.id, code: order.groupOrder.code, name: order.groupOrder.name, mode: order.groupOrder.mode, status: order.groupOrder.status }
      : null,
    quote: order.quote ? { id: order.quote.id, reference: order.quote.reference, service: order.quote.service.name } : null,
    createdAt: order.createdAt,
    confirmedAt: order.confirmedAt,
    paidAt: order.paidAt,
    readyAt: order.readyAt,
    completedAt: order.completedAt,
    cancelledAt: order.cancelledAt,
    cancelReason: order.cancelReason,
    updatedAt: order.updatedAt,
  };
}

export async function getOrderDetail(orderId: string, db: Tx | typeof prisma = prisma) {
  const order = await db.order.findUnique({ where: { id: orderId }, include: orderDetailInclude });
  if (!order) throw notFound("Commande introuvable.");
  return order;
}

interface PreparedOrder {
  type: "STANDARD" | "GROUP";
  group: GroupOrder | null;
  method: FulfillmentMethod;
  pickupPointId: string | null;
  delivery: DeliveryResolution;
  deliveryData: { recipientName: string; phone: string; quarter: string; directions: string | null } | null;
  lines: { documentId: string; document: Document; options: OrderInput["items"][number]["options"]; price: ItemPrice }[];
  totals: ReturnType<typeof computeTotals>;
  snapshot: Prisma.InputJsonValue;
}

async function resolveGroupContext(tx: Tx, user: User, input: OrderInput, existingGroupId?: string | null) {
  if (existingGroupId !== undefined) {
    return existingGroupId ? tx.groupOrder.findUnique({ where: { id: existingGroupId } }) : null;
  }
  if (input.groupShareToken) {
    const group = await tx.groupOrder.findUnique({ where: { shareToken: input.groupShareToken } });
    if (!group) throw notFound("Lien de collecte invalide.");
    if (group.mode !== "STUDENT_CONTRIBUTIONS") throw badRequest("Ce groupe n'accepte pas de contributions individuelles.");
    return group;
  }
  if (input.groupId) {
    const group = await tx.groupOrder.findUnique({ where: { id: input.groupId } });
    if (!group) throw notFound("Commande groupée introuvable.");
    if (group.delegateId !== user.id) throw forbidden("Vous n'êtes pas le délégué de ce groupe.");
    return group;
  }
  return null;
}

function assertGroupOpen(group: GroupOrder) {
  if (group.status !== "OPEN") throw conflict("Cette commande groupée n'accepte plus de documents.", "GROUP_CLOSED");
  if (group.deadline && group.deadline < new Date()) throw conflict("La date limite de collecte est dépassée.", "GROUP_DEADLINE");
}

/** Valide les documents, le mode de remise et calcule les montants côté serveur. */
async function prepareOrder(tx: Tx, user: User, input: OrderInput, existingGroupId?: string | null): Promise<PreparedOrder> {
  const settings = await getSettings(tx);
  if (input.items.length > settings["uploads.maxFilesPerOrder"]) {
    throw badRequest(`Une commande peut contenir au maximum ${settings["uploads.maxFilesPerOrder"]} documents.`, "TOO_MANY_FILES");
  }

  const docIds = [...new Set(input.items.map((i) => i.documentId))];
  const docs = await tx.document.findMany({ where: { id: { in: docIds }, ownerId: user.id, status: { not: "DELETED" } } });
  const byId = new Map(docs.map((d) => [d.id, d]));
  for (const id of docIds) {
    const doc = byId.get(id);
    if (!doc) throw badRequest("Un des documents est introuvable ou ne vous appartient pas.", "DOCUMENT_NOT_FOUND");
    if (doc.status !== "READY" || doc.pageCount === null) {
      throw unprocessable(
        `Le document « ${doc.originalName} » n'est pas prêt (analyse en cours, à vérifier ou refusé).`,
        "DOCUMENT_NOT_READY",
        { documentId: doc.id },
      );
    }
  }
  const totalBytes = docs.reduce((s, d) => s + d.sizeBytes, 0);
  if (totalBytes > settings["uploads.maxTotalSizeMb"] * 1024 * 1024) {
    throw badRequest(`Taille totale maximale dépassée (${settings["uploads.maxTotalSizeMb"]} Mo par commande).`, "ORDER_TOO_LARGE");
  }

  const group = await resolveGroupContext(tx, user, input, existingGroupId);
  if (group) assertGroupOpen(group);

  let fulfillment = input.fulfillment;
  if (group?.mode === "STUDENT_CONTRIBUTIONS") {
    // Les contributions sont remises au délégué au point de retrait du groupe
    fulfillment = { method: "PICKUP", pickupPointId: group.pickupPointId ?? undefined };
  }

  let pickupPointId: string | null = null;
  let deliveryData: PreparedOrder["deliveryData"] = null;
  if (fulfillment.method === "PICKUP") {
    const point = fulfillment.pickupPointId
      ? await tx.pickupPoint.findFirst({ where: { id: fulfillment.pickupPointId, isActive: true } })
      : await tx.pickupPoint.findFirst({ where: { isActive: true }, orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }] });
    if (!point) throw badRequest("Aucun point de retrait disponible.", "NO_PICKUP_POINT");
    pickupPointId = point.id;
  } else {
    if (!settings["delivery.enabled"]) throw badRequest("La livraison est momentanément indisponible.", "DELIVERY_DISABLED");
    deliveryData = {
      recipientName: fulfillment.recipientName,
      phone: fulfillment.phone,
      quarter: fulfillment.quarter,
      directions: fulfillment.directions ?? null,
    };
  }
  const delivery = await resolveDeliveryFee(
    fulfillment.method,
    fulfillment.method === "DELIVERY" ? fulfillment.zoneId : null,
    tx,
  );

  const { rules, finishings } = await loadPricing(tx);
  const lines = input.items.map((item, index) => {
    const document = byId.get(item.documentId) as Document;
    try {
      return { documentId: document.id, document, options: item.options, price: priceItem(document.pageCount as number, item.options, rules, finishings) };
    } catch (error) {
      if (error instanceof PricingError) {
        throw unprocessable(`« ${document.originalName} » : ${error.message}`, error.code, { index, documentId: document.id });
      }
      throw error;
    }
  });
  const totals = computeTotals(
    lines.map((l) => l.price),
    { method: fulfillment.method, deliveryFee: delivery.fee },
  );
  const snapshot = buildSnapshot({ rules, finishings, delivery: { ...delivery, method: fulfillment.method } }) as unknown as Prisma.InputJsonValue;

  return {
    type: group ? "GROUP" : "STANDARD",
    group,
    method: fulfillment.method,
    pickupPointId,
    delivery,
    deliveryData,
    lines,
    totals,
    snapshot,
  };
}

function itemCreateData(p: PreparedOrder) {
  return p.lines.map((line, index) => ({
    position: index,
    kind: "PRINT" as const,
    document: { connect: { id: line.documentId } },
    documentName: line.document.originalName,
    printConfig: {
      create: {
        colorMode: line.options.colorMode,
        sides: line.options.sides,
        paperFormat: line.options.paperFormat,
        finishingCode: line.options.finishingCode,
        copies: line.options.copies,
      },
    },
    pageCount: line.price.pageCount,
    sheets: line.price.sheets,
    faces: line.price.faces,
    copies: line.price.copies,
    unitPrice: line.price.unitPrice,
    pricingUnit: line.price.pricingUnit,
    printCost: line.price.printCost,
    finishingUnitPrice: line.price.finishingUnitPrice,
    finishingCost: line.price.finishingCost,
    lineTotal: line.price.lineTotal,
  }));
}

export async function createDraftOrder(user: User, input: OrderInput) {
  return prisma.$transaction(async (tx) => {
    const p = await prepareOrder(tx, user, input);
    const order = await tx.order.create({
      data: {
        reference: orderReference(),
        trackingToken: secureToken(24),
        pickupCode: pickupCode(),
        customerId: user.id,
        type: p.type,
        status: "DRAFT",
        fulfillmentMethod: p.method,
        pickupPointId: p.pickupPointId,
        groupOrderId: p.group?.id ?? null,
        subtotal: p.totals.subtotal,
        deliveryFee: p.totals.deliveryFee,
        total: p.totals.total,
        notes: input.notes,
        items: { create: itemCreateData(p) },
        delivery: p.deliveryData ? { create: { ...p.deliveryData, zoneId: p.delivery.zoneId, fee: p.delivery.fee } } : undefined,
        pickup: p.method === "PICKUP" ? { create: { pickupPointId: p.pickupPointId } } : undefined,
        statusHistory: { create: { toStatus: "DRAFT", actorId: user.id } },
      },
    });
    if (p.group) {
      await tx.groupContribution.create({ data: { groupOrderId: p.group.id, contributorId: user.id, orderId: order.id } });
    }
    return getOrderDetail(order.id, tx);
  });
}

async function replaceOrderContent(tx: Tx, orderId: string, p: PreparedOrder, notes: string | undefined) {
  const oldItems = await tx.orderItem.findMany({ where: { orderId }, select: { printConfigId: true } });
  await tx.orderItem.deleteMany({ where: { orderId } });
  const configIds = oldItems.map((i) => i.printConfigId).filter((x): x is string => Boolean(x));
  if (configIds.length > 0) await tx.printConfiguration.deleteMany({ where: { id: { in: configIds } } });
  await tx.delivery.deleteMany({ where: { orderId } });
  await tx.pickup.deleteMany({ where: { orderId } });
  await tx.order.update({
    where: { id: orderId },
    data: {
      fulfillmentMethod: p.method,
      pickupPointId: p.pickupPointId,
      subtotal: p.totals.subtotal,
      deliveryFee: p.totals.deliveryFee,
      total: p.totals.total,
      notes,
      items: { create: itemCreateData(p) },
      delivery: p.deliveryData ? { create: { ...p.deliveryData, zoneId: p.delivery.zoneId, fee: p.delivery.fee } } : undefined,
      pickup: p.method === "PICKUP" ? { create: { pickupPointId: p.pickupPointId } } : undefined,
    },
  });
}

export async function updateDraftOrder(user: User, orderId: string, input: OrderInput) {
  return prisma.$transaction(async (tx) => {
    await lockOrder(tx, orderId);
    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (!order || order.customerId !== user.id) throw notFound("Commande introuvable.");
    if (order.status !== "DRAFT") throw conflict("Seul un brouillon peut être modifié.", "NOT_DRAFT");
    const p = await prepareOrder(tx, user, input, order.groupOrderId);
    await replaceOrderContent(tx, order.id, p, input.notes);
    return getOrderDetail(order.id, tx);
  });
}

/** Reconstitue la saisie d'une commande à partir de son contenu enregistré. */
function inputFromOrder(order: OrderDetail): OrderInput {
  return {
    items: order.items
      .filter((i) => i.documentId && i.printConfig)
      .map((i) => ({
        documentId: i.documentId as string,
        options: {
          colorMode: i.printConfig!.colorMode,
          sides: i.printConfig!.sides,
          paperFormat: i.printConfig!.paperFormat,
          finishingCode: i.printConfig!.finishingCode,
          copies: i.printConfig!.copies,
        },
      })),
    fulfillment:
      order.fulfillmentMethod === "DELIVERY" && order.delivery
        ? {
            method: "DELIVERY",
            recipientName: order.delivery.recipientName,
            phone: order.delivery.phone,
            quarter: order.delivery.quarter,
            directions: order.delivery.directions ?? undefined,
            zoneId: order.delivery.zoneId,
          }
        : { method: "PICKUP", pickupPointId: order.pickupPointId ?? undefined },
    notes: order.notes ?? undefined,
  };
}

/**
 * Confirmation : les prix sont recalculés avec la grille en vigueur puis figés
 * (instantané) dans la commande, qui passe en attente de paiement.
 */
export async function confirmOrder(user: User, orderId: string) {
  const result = await prisma.$transaction(async (tx) => {
    await lockOrder(tx, orderId);
    const order = await getOrderDetail(orderId, tx);
    if (order.customerId !== user.id) throw notFound("Commande introuvable.");
    if (order.status !== "DRAFT") throw conflict("Cette commande est déjà confirmée.", "ALREADY_CONFIRMED");
    const input = inputFromOrder(order);
    if (input.items.length === 0) throw badRequest("La commande ne contient aucun document.");
    const p = await prepareOrder(tx, user, input, order.groupOrderId);
    await replaceOrderContent(tx, order.id, p, order.notes ?? undefined);
    await tx.order.update({
      where: { id: order.id },
      data: { status: "PENDING_PAYMENT", confirmedAt: new Date(), pricingSnapshot: p.snapshot },
    });
    await tx.orderStatusHistory.create({
      data: { orderId: order.id, fromStatus: "DRAFT", toStatus: "PENDING_PAYMENT", actorId: user.id },
    });
    await notify(
      {
        userId: user.id,
        orderId: order.id,
        type: "ORDER_CONFIRMED",
        title: `Commande ${order.reference} enregistrée`,
        body:
          p.totals.total === null
            ? "Votre commande est enregistrée. Les frais de livraison seront confirmés par notre équipe avant le paiement."
            : `Votre commande est enregistrée. Montant à régler : ${formatFcfa(p.totals.total)}. L'impression démarre après confirmation du paiement.`,
        link: `/espace/commandes/${order.id}`,
      },
      tx,
    );
    return getOrderDetail(order.id, tx);
  });
  return result;
}

const STATUS_TIMESTAMPS: Partial<Record<OrderStatus, keyof Prisma.OrderUpdateInput>> = {
  READY_FOR_PICKUP: "readyAt",
  COMPLETED: "completedAt",
  CANCELLED: "cancelledAt",
};

/**
 * Vérifie qu'une commande peut entrer en production :
 * paiement confirmé (ou exception administrateur journalisée) et, pour les
 * collectes de groupe, collecte clôturée selon la règle du groupe.
 */
export async function assertProductionAllowed(tx: Tx, order: { id: string; paymentStatus: string; creditApproved: boolean; groupOrderId: string | null }) {
  if (order.paymentStatus !== "PAID" && !order.creditApproved) {
    throw conflict(
      "Paiement non confirmé : la commande ne peut pas être envoyée en production sans exception administrateur.",
      "PAYMENT_REQUIRED",
    );
  }
  if (order.groupOrderId) {
    const group = await tx.groupOrder.findUnique({ where: { id: order.groupOrderId } });
    if (group?.mode === "STUDENT_CONTRIBUTIONS" && !["IN_PRODUCTION", "READY", "COMPLETED"].includes(group.status)) {
      throw conflict("La collecte du groupe doit être clôturée et lancée en production par l'administration.", "GROUP_NOT_RELEASED");
    }
  }
}

export interface TransitionOptions {
  actorId: string | null;
  note?: string;
  /** Ignore la vérification des transitions (usage interne contrôlé). */
  force?: boolean;
}

/** Applique un changement de statut avec historique, horodatage, effets et notifications. */
export async function transitionOrder(tx: Tx, orderId: string, to: OrderStatus, options: TransitionOptions) {
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { pickupPoint: true } });
  if (order.status === to) return order;
  if (!options.force && !canTransition(order.status, to)) {
    throw conflict(`Transition impossible : ${STATUS_LABELS[order.status]} → ${STATUS_LABELS[to]}.`, "INVALID_TRANSITION");
  }
  if (to === "TO_PREPARE") await assertProductionAllowed(tx, order);

  const timestampField = STATUS_TIMESTAMPS[to];
  const updated = await tx.order.update({
    where: { id: orderId },
    data: {
      status: to,
      ...(timestampField ? { [timestampField]: new Date() } : {}),
      ...(to === "CANCELLED" && options.note ? { cancelReason: options.note } : {}),
    },
  });
  await tx.orderStatusHistory.create({
    data: { orderId, fromStatus: order.status, toStatus: to, actorId: options.actorId, note: options.note },
  });

  if (to === "READY_FOR_PICKUP") {
    await tx.pickup.upsert({
      where: { orderId },
      create: { orderId, pickupPointId: order.pickupPointId, status: "READY", readyAt: new Date() },
      update: { status: "READY", readyAt: new Date() },
    });
  }
  if (to === "OUT_FOR_DELIVERY") {
    await tx.delivery.updateMany({ where: { orderId }, data: { status: "OUT_FOR_DELIVERY", dispatchedAt: new Date(), handledById: options.actorId } });
  }

  const link = `/espace/commandes/${orderId}`;
  const messages: Partial<Record<OrderStatus, { title: string; body: string }>> = {
    PRINTING: { title: `Commande ${order.reference} en impression`, body: "Vos documents sont en cours d'impression." },
    READY_FOR_PICKUP: {
      title: `Commande ${order.reference} prête à retirer`,
      body: `Votre commande est prête${order.pickupPoint ? ` au point de retrait « ${order.pickupPoint.name} »` : ""}. Présentez votre code de retrait ${order.pickupCode} lors du retrait.`,
    },
    OUT_FOR_DELIVERY: { title: `Commande ${order.reference} en livraison`, body: "Votre commande est en route. Gardez votre téléphone à portée de main." },
    COMPLETED: { title: `Commande ${order.reference} remise`, body: "Votre commande a été remise. Merci pour votre confiance !" },
    CANCELLED: {
      title: `Commande ${order.reference} annulée`,
      body: options.note ? `Votre commande a été annulée : ${options.note}` : "Votre commande a été annulée.",
    },
    REFUNDED: { title: `Commande ${order.reference} remboursée`, body: "Le remboursement de votre commande a été enregistré." },
  };
  const message = messages[to];
  if (message) await notify({ userId: order.customerId, orderId, type: `ORDER_${to}`, title: message.title, body: message.body, link }, tx);

  if (order.groupOrderId) await refreshGroupStatus(tx, order.groupOrderId);
  return updated;
}

export async function cancelOrderByCustomer(user: User, orderId: string, reason?: string) {
  return prisma.$transaction(async (tx) => {
    await lockOrder(tx, orderId);
    const order = await tx.order.findUnique({ where: { id: orderId }, include: { payments: true } });
    if (!order || order.customerId !== user.id) throw notFound("Commande introuvable.");
    if (!["DRAFT", "PENDING_PAYMENT"].includes(order.status) || order.paymentStatus === "PAID") {
      throw conflict("Cette commande ne peut plus être annulée en ligne. Contactez l'assistance.", "CANNOT_CANCEL");
    }
    if (order.payments.some((p) => p.status === "PENDING_VERIFICATION")) {
      throw conflict("Un paiement est en cours de vérification pour cette commande. Contactez l'assistance.", "PAYMENT_IN_REVIEW");
    }
    await tx.payment.updateMany({
      where: { orderId, status: { in: ["CREATED", "PENDING"] } },
      data: { status: "CANCELLED", failureReason: "Commande annulée par le client" },
    });
    await transitionOrder(tx, orderId, "CANCELLED", { actorId: user.id, note: reason ?? "Annulée par le client" });
    return getOrderDetail(orderId, tx);
  });
}

/** Crée un nouveau brouillon reprenant les documents et options d'une commande précédente. */
export async function reorder(user: User, orderId: string) {
  const previous = await getOrderDetail(orderId);
  if (previous.customerId !== user.id) throw notFound("Commande introuvable.");
  const reusable = previous.items.filter(
    (i) => i.document && i.document.status === "READY" && !i.document.purgedAt && i.printConfig,
  );
  const skipped = previous.items.length - reusable.length;
  if (reusable.length === 0) {
    throw conflict("Les documents de cette commande ne sont plus disponibles (politique de conservation). Téléversez-les à nouveau.", "DOCUMENTS_PURGED");
  }
  const base = inputFromOrder(previous);
  const input: OrderInput = {
    ...base,
    items: base.items.filter((i) => reusable.some((r) => r.documentId === i.documentId)),
  };
  const draft = await createDraftOrder(user, input);
  return { draft, skipped };
}

export async function recordAdminCredit(actor: User, orderId: string, reason: string, ip?: string) {
  return prisma.$transaction(async (tx) => {
    await lockOrder(tx, orderId);
    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (!order) throw notFound("Commande introuvable.");
    if (order.paymentStatus === "PAID") throw conflict("Cette commande est déjà payée.");
    if (order.status !== "PENDING_PAYMENT") throw conflict("Exception possible uniquement pour une commande confirmée en attente de paiement.");
    await tx.order.update({
      where: { id: orderId },
      data: { creditApproved: true, creditApprovedById: actor.id, creditReason: reason, creditApprovedAt: new Date() },
    });
    await audit({ actorId: actor.id, action: "order.credit_approved", entityType: "Order", entityId: orderId, metadata: { reason }, ip }, tx);
    return getOrderDetail(orderId, tx);
  });
}

export { IN_PRODUCTION_STATUSES };
