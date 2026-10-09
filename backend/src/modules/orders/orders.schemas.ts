import { z } from "zod";
import { phoneSchema } from "../auth/auth.schemas";
import { printOptionsSchema } from "../pricing/pricing.schemas";

export const fulfillmentSchema = z.discriminatedUnion("method", [
  z.object({
    method: z.literal("PICKUP"),
    pickupPointId: z.string().max(64).optional(),
  }),
  z.object({
    method: z.literal("DELIVERY"),
    recipientName: z.string().trim().min(2, "Nom du destinataire requis").max(120),
    phone: phoneSchema,
    quarter: z.string().trim().min(2, "Quartier requis").max(120),
    directions: z.string().trim().max(500).optional(),
    zoneId: z.string().max(64).nullish(),
  }),
]);

export const orderItemInputSchema = z.object({
  documentId: z.string().min(1).max(64),
  options: printOptionsSchema,
});

export const orderInputSchema = z.object({
  items: z.array(orderItemInputSchema).min(1, "Ajoutez au moins un document").max(1000),
  fulfillment: fulfillmentSchema,
  notes: z.string().trim().max(1000).optional(),
  /** Groupe dont l'utilisateur est le délégué (mode A) */
  groupId: z.string().max(64).optional(),
  /** Lien de collecte partagé par un délégué (mode B) */
  groupShareToken: z.string().max(128).optional(),
});

export type OrderInput = z.infer<typeof orderInputSchema>;
export type FulfillmentInput = z.infer<typeof fulfillmentSchema>;
