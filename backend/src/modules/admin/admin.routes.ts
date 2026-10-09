import { Router } from "express";
import { requireStaff } from "../../middleware/auth";
import { adminOrdersRouter } from "./orders.admin";
import { adminConfigRouter } from "./config.admin";
import { adminMiscRouter } from "./misc.admin";

/** Administration : réservée à l'équipe (admin et opérateur, avec restrictions par route). */
export const adminRouter = Router();
adminRouter.use(requireStaff);
adminRouter.use(adminOrdersRouter);
adminRouter.use(adminMiscRouter);
adminRouter.use("/config", adminConfigRouter);
