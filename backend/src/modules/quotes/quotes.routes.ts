import { Router } from "express";
import { prisma } from "../../lib/prisma";
import { notFound } from "../../lib/errors";
import { currentUser, requireAuth } from "../../middleware/auth";
import { acceptQuote, createQuoteRequest, quoteInclude, quoteRequestSchema, rejectQuote, serializeQuote } from "./quotes.service";
import { param } from "../../lib/http";

export const quotesRouter = Router();
quotesRouter.use(requireAuth);

quotesRouter.get("/", async (req, res) => {
  const me = currentUser(req);
  const quotes = await prisma.quote.findMany({ where: { customerId: me.id }, include: quoteInclude, orderBy: { createdAt: "desc" }, take: 100 });
  res.json({ items: quotes.map((q) => serializeQuote(q, "owner")) });
});

quotesRouter.post("/", async (req, res) => {
  const input = quoteRequestSchema.parse(req.body);
  const quote = await createQuoteRequest(currentUser(req), input);
  res.status(201).json({ quote: serializeQuote(quote, "owner") });
});

quotesRouter.get("/:id", async (req, res) => {
  const me = currentUser(req);
  const quote = await prisma.quote.findUnique({ where: { id: param(req, "id") }, include: quoteInclude });
  if (!quote || quote.customerId !== me.id) throw notFound("Devis introuvable.");
  res.json({ quote: serializeQuote(quote, "owner") });
});

quotesRouter.post("/:id/accept", async (req, res) => {
  const order = await acceptQuote(currentUser(req), param(req, "id"));
  res.status(201).json({ orderId: order.id, reference: order.reference });
});

quotesRouter.post("/:id/reject", async (req, res) => {
  const quote = await rejectQuote(currentUser(req), param(req, "id"));
  res.json({ quote: serializeQuote(quote, "owner") });
});
