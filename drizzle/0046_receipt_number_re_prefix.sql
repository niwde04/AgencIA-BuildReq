WITH candidates AS (
  SELECT
    id,
    regexp_replace("receiptNumber", '^(OC|REC|RC)-', 'RE-') AS next_number
  FROM "receipts"
  WHERE "receiptNumber" ~ '^(OC|REC|RC)-'
)
UPDATE "receipts" AS receipt
SET
  "receiptNumber" = candidates.next_number,
  "updatedAt" = now()
FROM candidates
WHERE receipt.id = candidates.id
  AND NOT EXISTS (
    SELECT 1
    FROM "receipts" AS other_receipt
    WHERE other_receipt."receiptNumber" = candidates.next_number
      AND other_receipt.id <> receipt.id
  );
