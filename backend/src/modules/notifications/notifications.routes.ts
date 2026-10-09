import { Router } from "express";
import { prisma } from "../../lib/prisma";
import { currentUser, requireAuth } from "../../middleware/auth";
import { paginate, pageResult, paginationSchema } from "../../lib/pagination";
import { param } from "../../lib/http";

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

notificationsRouter.get("/", async (req, res) => {
  const me = currentUser(req);
  const q = paginationSchema.parse(req.query);
  const where = { userId: me.id, channel: "IN_APP" as const };
  const [items, total, unread] = await Promise.all([
    prisma.notification.findMany({ where, orderBy: { createdAt: "desc" }, ...paginate(q.page, q.pageSize) }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { ...where, readAt: null } }),
  ]);
  res.json({
    ...pageResult(
      items.map((n) => ({ id: n.id, type: n.type, title: n.title, body: n.body, link: n.link, readAt: n.readAt, createdAt: n.createdAt })),
      total,
      q.page,
      q.pageSize,
    ),
    unread,
  });
});

notificationsRouter.post("/read-all", async (req, res) => {
  const me = currentUser(req);
  await prisma.notification.updateMany({ where: { userId: me.id, readAt: null }, data: { readAt: new Date() } });
  res.json({ ok: true });
});

notificationsRouter.post("/:id/read", async (req, res) => {
  const me = currentUser(req);
  await prisma.notification.updateMany({ where: { id: param(req, "id"), userId: me.id }, data: { readAt: new Date() } });
  res.json({ ok: true });
});
