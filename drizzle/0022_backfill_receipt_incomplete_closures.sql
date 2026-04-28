UPDATE "receipts"
SET "status" = 'cierre_incompleto'
WHERE EXISTS (
  SELECT 1
  FROM "receiptItems"
  WHERE "receiptItems"."receiptId" = "receipts"."id"
    AND "receiptItems"."notes" ILIKE '%Cierre incompleto%'
);
