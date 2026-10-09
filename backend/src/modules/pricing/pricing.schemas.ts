import { z } from "zod";

export const printOptionsSchema = z.object({
  colorMode: z.enum(["BW", "COLOR"]),
  sides: z.enum(["SINGLE", "DOUBLE"]),
  paperFormat: z.enum(["A4", "A3"]),
  finishingCode: z.enum(["NONE", "SPIRAL", "STAPLE", "HARDCOVER"]),
  copies: z.number().int().min(1).max(1000),
});

export type PrintOptionsInput = z.infer<typeof printOptionsSchema>;
