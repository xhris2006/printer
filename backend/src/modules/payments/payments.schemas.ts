import { z } from "zod";
import { phoneSchema } from "../auth/auth.schemas";

export const orderPaymentSchema = z.discriminatedUnion("method", [
  z.object({ method: z.literal("CHECKOUT") }),
  z.object({ method: z.literal("DIRECT"), phone: phoneSchema, medium: z.enum(["mobile money", "orange money"]).optional() }),
]);

export const cashDeclarationSchema = z.object({
  amount: z.number().int().positive(),
  note: z.string().trim().min(5, "Précisez les circonstances du paiement (date, personne, référence…)").max(500),
});
