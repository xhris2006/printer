import { Router } from "express";
import { prisma } from "../../lib/prisma";
import { notFound } from "../../lib/errors";
import { currentUser, requireAuth, requireDelegate } from "../../middleware/auth";
import { paymentLimiter, publicLimiter } from "../../middleware/security";
import { cashDeclarationSchema } from "../payments/payments.schemas";
import { declareCashPayment, serializePayment } from "../payments/payments.service";
import { STATUS_LABELS } from "../orders/status";
import { publicUser } from "../auth/auth.service";
import {
  buildGroupSummaryCsv,
  buildGroupSummaryPdf,
  cancelGroup,
  closeGroup,
  createGroup,
  delegateRequestSchema,
  GROUP_STATUS_LABELS,
  groupInputSchema,
  groupUpdateSchema,
  loadGroupForViewer,
  regenerateShareToken,
  reopenGroup,
  requestDelegateStatus,
  serializeGroup,
  updateGroup,
} from "./groups.service";
import { param } from "../../lib/http";

export const delegateRouter = Router();
delegateRouter.use(requireAuth);

delegateRouter.post("/request", async (req, res) => {
  const input = delegateRequestSchema.parse(req.body);
  await requestDelegateStatus(currentUser(req), input);
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: currentUser(req).id },
    include: { delegateProfile: true, customerProfile: true },
  });
  res.status(201).json({ user: publicUser(user) });
});

export const groupsRouter = Router();
groupsRouter.use(requireAuth);

/** Groupes auxquels l'utilisateur participe (contributions), hors groupes dont il est délégué. */
groupsRouter.get("/participations", async (req, res) => {
  const me = currentUser(req);
  const contributions = await prisma.groupContribution.findMany({
    where: { contributorId: me.id, groupOrder: { delegateId: { not: me.id } } },
    include: { groupOrder: true, order: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  res.json({
    items: contributions.map((c) => ({
      groupId: c.groupOrder.id,
      code: c.groupOrder.code,
      name: c.groupOrder.name,
      className: c.groupOrder.className,
      institution: c.groupOrder.institution,
      groupStatus: c.groupOrder.status,
      groupStatusLabel: GROUP_STATUS_LABELS[c.groupOrder.status],
      shareToken: c.groupOrder.status === "OPEN" ? c.groupOrder.shareToken : null,
      order: {
        id: c.order.id,
        reference: c.order.reference,
        status: c.order.status,
        statusLabel: STATUS_LABELS[c.order.status],
        paymentStatus: c.order.paymentStatus,
        total: c.order.total,
      },
      createdAt: c.createdAt,
    })),
  });
});

groupsRouter.get("/", requireDelegate, async (req, res) => {
  const me = currentUser(req);
  const groups = await prisma.groupOrder.findMany({
    where: { delegateId: me.id },
    orderBy: { createdAt: "desc" },
    include: { orders: { select: { status: true, paymentStatus: true, total: true, amountPaid: true } }, _count: { select: { contributions: true } } },
  });
  res.json({
    items: groups.map((g) => {
      const confirmed = g.orders.filter((o) => !["DRAFT", "CANCELLED", "REFUNDED"].includes(o.status));
      return {
        id: g.id,
        code: g.code,
        name: g.name,
        className: g.className,
        institution: g.institution,
        mode: g.mode,
        status: g.status,
        statusLabel: GROUP_STATUS_LABELS[g.status],
        deadline: g.deadline,
        contributionsCount: g._count.contributions,
        totalAmount: confirmed.reduce((s, o) => s + (o.total ?? 0), 0),
        paidAmount: confirmed.filter((o) => o.paymentStatus === "PAID").reduce((s, o) => s + o.amountPaid, 0),
        createdAt: g.createdAt,
      };
    }),
  });
});

groupsRouter.post("/", requireDelegate, async (req, res) => {
  const input = groupInputSchema.parse(req.body);
  const group = await createGroup(currentUser(req), input);
  res.status(201).json({ group: serializeGroup(group, "delegate") });
});

groupsRouter.get("/:id", async (req, res) => {
  const { group, viewer } = await loadGroupForViewer(currentUser(req), param(req, "id"));
  res.json({ group: serializeGroup(group, viewer) });
});

groupsRouter.patch("/:id", requireDelegate, async (req, res) => {
  const input = groupUpdateSchema.parse(req.body);
  const group = await updateGroup(currentUser(req), param(req, "id"), input);
  res.json({ group: serializeGroup(group, "delegate") });
});

groupsRouter.post("/:id/close", requireDelegate, async (req, res) => {
  const result = await closeGroup(currentUser(req), param(req, "id"));
  const { group } = await loadGroupForViewer(currentUser(req), param(req, "id"));
  res.json({ group: serializeGroup(group, "delegate"), ...result });
});

groupsRouter.post("/:id/reopen", requireDelegate, async (req, res) => {
  await reopenGroup(currentUser(req), param(req, "id"));
  const { group } = await loadGroupForViewer(currentUser(req), param(req, "id"));
  res.json({ group: serializeGroup(group, "delegate") });
});

groupsRouter.post("/:id/cancel", async (req, res) => {
  await cancelGroup(currentUser(req), param(req, "id"));
  const { group, viewer } = await loadGroupForViewer(currentUser(req), param(req, "id"));
  res.json({ group: serializeGroup(group, viewer) });
});

groupsRouter.post("/:id/share-link", requireDelegate, async (req, res) => {
  await regenerateShareToken(currentUser(req), param(req, "id"));
  const { group } = await loadGroupForViewer(currentUser(req), param(req, "id"));
  res.json({ group: serializeGroup(group, "delegate") });
});

groupsRouter.post("/:id/orders/:orderId/cash-declaration", requireDelegate, paymentLimiter, async (req, res) => {
  const { group } = await loadGroupForViewer(currentUser(req), param(req, "id"));
  if (!group.contributions.some((c) => c.orderId === param(req, "orderId"))) throw notFound("Commande introuvable dans ce groupe.");
  const input = cashDeclarationSchema.parse(req.body);
  const payment = await declareCashPayment(currentUser(req), param(req, "orderId"), input);
  res.status(201).json({ payment: serializePayment(payment) });
});

groupsRouter.get("/:id/summary.pdf", async (req, res) => {
  const { group } = await loadGroupForViewer(currentUser(req), param(req, "id"));
  const pdf = await buildGroupSummaryPdf(group);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${group.code}.pdf"`);
  res.setHeader("Cache-Control", "private, no-store");
  res.send(pdf);
});

groupsRouter.get("/:id/summary.csv", async (req, res) => {
  const { group } = await loadGroupForViewer(currentUser(req), param(req, "id"));
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${group.code}.csv"`);
  res.setHeader("Cache-Control", "private, no-store");
  res.send(buildGroupSummaryCsv(group));
});

/** Page publique d'un lien de collecte (informations non sensibles uniquement). */
export const publicGroupsRouter = Router();
publicGroupsRouter.get("/:token", publicLimiter, async (req, res) => {
  const group = await prisma.groupOrder.findUnique({
    where: { shareToken: param(req, "token") },
    include: { delegate: { select: { fullName: true } }, defaultPrintConfig: true, pickupPoint: true },
  });
  if (!group || group.mode !== "STUDENT_CONTRIBUTIONS") throw notFound("Lien de collecte invalide ou expiré.");
  const accepting = group.status === "OPEN" && (!group.deadline || group.deadline > new Date());
  res.json({
    group: {
      code: group.code,
      name: group.name,
      institution: group.institution,
      field: group.field,
      level: group.level,
      className: group.className,
      category: group.category,
      instructions: group.instructions,
      delegateName: group.delegate.fullName.split(" ")[0],
      deadline: group.deadline,
      status: group.status,
      statusLabel: GROUP_STATUS_LABELS[group.status],
      acceptingContributions: accepting,
      defaultOptions: group.defaultPrintConfig
        ? {
            colorMode: group.defaultPrintConfig.colorMode,
            sides: group.defaultPrintConfig.sides,
            paperFormat: group.defaultPrintConfig.paperFormat,
            finishingCode: group.defaultPrintConfig.finishingCode,
            copies: group.defaultPrintConfig.copies,
          }
        : null,
      pickupPoint: group.pickupPoint ? { name: group.pickupPoint.name, address: group.pickupPoint.address } : null,
    },
  });
});
