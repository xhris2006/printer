import type { ApiDocument, PrintOptions } from "@/lib/types";

export interface WizardDoc {
  key: string;
  name: string;
  size: number;
  file?: File;
  progress: number;
  phase: "queued" | "uploading" | "processing" | "done" | "error";
  error?: string;
  document?: ApiDocument;
  /** true = paramètres propres à ce document ; false = paramètres communs */
  custom: boolean;
  options: PrintOptions;
}

export interface FulfillmentState {
  method: "PICKUP" | "DELIVERY";
  pickupPointId: string;
  recipientName: string;
  phone: string;
  quarter: string;
  zoneId: string;
  directions: string;
}

export type GroupContext =
  | { kind: "delegate"; groupId: string; name: string; code: string }
  | { kind: "contribution"; shareToken: string; name: string; code: string; pickupPointName: string | null };

export const DEFAULT_OPTIONS: PrintOptions = { colorMode: "BW", sides: "SINGLE", paperFormat: "A4", finishingCode: "NONE", copies: 1 };

export const effectiveOptions = (doc: WizardDoc, defaults: PrintOptions) => (doc.custom ? doc.options : defaults);
