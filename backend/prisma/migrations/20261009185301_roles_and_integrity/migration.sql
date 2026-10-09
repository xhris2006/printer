-- Rôles applicatifs (données de référence indispensables au fonctionnement)
INSERT INTO "Role" ("code", "label", "description") VALUES
  ('CUSTOMER', 'Client', 'Passe des commandes d''impression et de secrétariat'),
  ('DELEGATE', 'Délégué de classe', 'Gère des commandes groupées pour sa classe'),
  ('OPERATOR', 'Opérateur', 'Prépare, imprime et remet les commandes'),
  ('ADMIN', 'Administrateur', 'Accès complet à l''administration')
ON CONFLICT ("code") DO NOTHING;

-- Options de finition (prix initiaux, modifiables dans l'administration)
INSERT INTO "FinishingOption" ("code", "label", "price", "isActive", "sortOrder", "updatedAt") VALUES
  ('NONE', 'Sans reliure', 0, true, 0, NOW()),
  ('STAPLE', 'Agrafage', 50, true, 1, NOW()),
  ('SPIRAL', 'Reliure spirale', 250, true, 2, NOW()),
  ('HARDCOVER', 'Reliure cartonnée rigide (Hard Cover)', 2000, true, 3, NOW())
ON CONFLICT ("code") DO NOTHING;

-- Un seul paiement réussi « appliqué » par commande (les doublons sont marqués isDuplicate)
CREATE UNIQUE INDEX "Payment_one_applied_success_per_order"
  ON "Payment" ("orderId")
  WHERE "status" = 'SUCCESSFUL' AND "isDuplicate" = false;

-- Intégrité des montants et quantités
ALTER TABLE "Order" ADD CONSTRAINT "Order_amounts_non_negative"
  CHECK ("subtotal" >= 0 AND ("deliveryFee" IS NULL OR "deliveryFee" >= 0) AND ("total" IS NULL OR "total" >= 0) AND "amountPaid" >= 0);
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_values_non_negative"
  CHECK ("pageCount" >= 0 AND "sheets" >= 0 AND "faces" >= 0 AND "copies" >= 1 AND "lineTotal" >= 0);
ALTER TABLE "PrintConfiguration" ADD CONSTRAINT "PrintConfiguration_copies_positive" CHECK ("copies" >= 1);
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "PriceRule" ADD CONSTRAINT "PriceRule_price_non_negative" CHECK ("unitPrice" IS NULL OR "unitPrice" >= 0);
ALTER TABLE "FinishingOption" ADD CONSTRAINT "FinishingOption_price_non_negative" CHECK ("price" >= 0);
ALTER TABLE "DeliveryZone" ADD CONSTRAINT "DeliveryZone_fee_non_negative" CHECK ("fee" >= 0);
ALTER TABLE "Document" ADD CONSTRAINT "Document_values_non_negative" CHECK ("sizeBytes" >= 0 AND ("pageCount" IS NULL OR "pageCount" >= 0));
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_amount_positive" CHECK ("amount" > 0);
