import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import helmet from "helmet";
import swaggerUi from "swagger-ui-express";
import { env, frontendOrigins, isProduction } from "./config/env";
import { prisma } from "./lib/prisma";
import { loadSession } from "./middleware/auth";
import { apiLimiter, originCheck } from "./middleware/security";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import { authRouter } from "./modules/auth/auth.routes";
import { documentsRouter } from "./modules/documents/documents.routes";
import { storageRouter } from "./modules/storage/storage.routes";
import { pricingRouter } from "./modules/pricing/pricing.routes";
import { ordersRouter } from "./modules/orders/orders.routes";
import { paymentsRouter } from "./modules/payments/payments.routes";
import { delegateRouter, groupsRouter, publicGroupsRouter } from "./modules/groups/groups.routes";
import { trackingRouter } from "./modules/tracking/tracking.routes";
import { quotesRouter } from "./modules/quotes/quotes.routes";
import { notificationsRouter } from "./modules/notifications/notifications.routes";
import { publicRouter } from "./modules/public/public.routes";
import { adminRouter } from "./modules/admin/admin.routes";
import { buildOpenApiDocument } from "./docs/openapi";
// Enregistrement des gestionnaires de jobs asynchrones
import "./jobs/maintenance";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  const trust = env.TRUST_PROXY;
  app.set("trust proxy", /^\d+$/.test(trust) ? Number(trust) : trust === "true" ? true : trust === "false" ? false : trust);

  app.use(
    helmet({
      contentSecurityPolicy: false, // API JSON ; la CSP de l'interface est gérée par le frontend
      crossOriginResourcePolicy: { policy: "same-site" },
    }),
  );
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || frontendOrigins.includes(origin.replace(/\/$/, ""))),
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      maxAge: 600,
    }),
  );
  app.use(cookieParser());
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/health", async (_req, res) => {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: "ok", time: new Date().toISOString() });
  });

  // Routes authentifiées par jeton signé (sans cookie) : avant le contrôle d'origine
  app.use("/api/storage", storageRouter);

  app.use("/api", apiLimiter, originCheck, loadSession);
  app.use("/api/public", publicRouter);
  app.use("/api/public/groups", publicGroupsRouter);
  app.use("/api/auth", authRouter);
  app.use("/api/documents", documentsRouter);
  app.use("/api/pricing", pricingRouter);
  app.use("/api/orders", ordersRouter);
  app.use("/api/payments", paymentsRouter);
  app.use("/api/delegate", delegateRouter);
  app.use("/api/groups", groupsRouter);
  app.use("/api/tracking", trackingRouter);
  app.use("/api/quotes", quotesRouter);
  app.use("/api/notifications", notificationsRouter);
  app.use("/api/admin", adminRouter);

  const openapi = buildOpenApiDocument();
  app.get("/api/openapi.json", (_req, res) => {
    res.json(openapi);
  });
  if (!isProduction || process.env.ENABLE_API_DOCS === "true") {
    app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(openapi, { customSiteTitle: "API Print & Secrétariat" }));
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
