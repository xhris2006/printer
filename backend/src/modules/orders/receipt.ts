import { PdfBuilder } from "../../lib/pdf";
import { formatDateFr, formatFcfa } from "../../lib/format";
import { COLOR_LABELS, SIDES_LABELS } from "../pricing/pricing";
import { STATUS_LABELS } from "./status";
import type { OrderDetail } from "./orders.service";

const FINISHING_LABELS: Record<string, string> = {
  NONE: "Sans reliure",
  STAPLE: "Agrafage",
  SPIRAL: "Spirale",
  HARDCOVER: "Hard cover",
};

/** Reçu de paiement (commande payée) ou récapitulatif (commande non payée). */
export async function buildOrderReceipt(order: OrderDetail): Promise<Buffer> {
  const paid = order.paymentStatus === "PAID" || order.paymentStatus === "REFUNDED";
  const pdf = await PdfBuilder.create(`${paid ? "Reçu" : "Récapitulatif"} ${order.reference}`);
  pdf.header(paid ? "Reçu de paiement" : "Récapitulatif de commande", `Commande ${order.reference} — ${formatDateFr(order.createdAt)}`);

  pdf.keyValue("Client", order.customer.fullName);
  pdf.keyValue("Téléphone", order.customer.phone);
  pdf.keyValue("Statut", STATUS_LABELS[order.status]);
  pdf.keyValue(
    "Remise",
    order.fulfillmentMethod === "DELIVERY"
      ? `Livraison — ${order.delivery?.quarter ?? ""}`
      : `Retrait — ${order.pickupPoint?.name ?? "Point de retrait"}`,
  );
  pdf.separator();

  pdf.table(
    [
      { header: "Document", width: 34 },
      { header: "Options", width: 30 },
      { header: "Pages", width: 8, align: "right" },
      { header: "Ex.", width: 6, align: "right" },
      { header: "Feuilles", width: 9, align: "right" },
      { header: "Montant", width: 14, align: "right" },
    ],
    order.items.map((item) => [
      item.documentName ?? item.description ?? "Prestation",
      item.printConfig
        ? `${COLOR_LABELS[item.printConfig.colorMode]}, ${SIDES_LABELS[item.printConfig.sides]}, ${item.printConfig.paperFormat}, ${FINISHING_LABELS[item.printConfig.finishingCode]}`
        : item.description ?? "",
      item.kind === "PRINT" ? String(item.pageCount) : "-",
      String(item.copies),
      item.kind === "PRINT" ? String(item.sheets) : "-",
      formatFcfa(item.lineTotal),
    ]),
  );

  pdf.keyValue("Sous-total", formatFcfa(order.subtotal));
  if (order.fulfillmentMethod === "DELIVERY") {
    pdf.keyValue("Livraison", order.deliveryFee === null ? "À confirmer" : formatFcfa(order.deliveryFee));
  }
  pdf.keyValue("Total", order.total === null ? "À confirmer" : formatFcfa(order.total));
  pdf.separator();

  const success = order.payments.find((p) => p.status === "SUCCESSFUL" && !p.isDuplicate);
  if (paid && success) {
    const method = success.provider === "CASH" ? "Espèces (vérifié)" : success.environment === "LIVE" ? "Fapshi" : "Fapshi (mode test)";
    pdf.keyValue("Mode de paiement", method);
    pdf.keyValue("Payé le", formatDateFr(success.confirmedAt ?? success.updatedAt));
    if (success.providerTransId) pdf.keyValue("Transaction", `…${success.providerTransId.slice(-8)}`);
    pdf.keyValue("Montant payé", formatFcfa(success.amount));
    pdf.space(6);
    pdf.text(`Code de retrait : ${order.pickupCode}`, { bold: true, size: 12 });
  } else if (order.creditApproved) {
    pdf.text("Commande autorisée par l'administration (paiement différé).", { bold: true });
  } else {
    pdf.text("Paiement non confirmé : l'impression démarre uniquement après confirmation du paiement.", { bold: true });
  }
  pdf.space(10);
  pdf.text("Merci pour votre confiance. Conservez ce document comme justificatif.", { size: 9 });
  return pdf.save();
}
