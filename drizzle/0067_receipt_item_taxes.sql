ALTER TABLE "receiptItems"
  ADD COLUMN IF NOT EXISTS "taxCode" varchar(50) DEFAULT 'exe' NOT NULL,
  ADD COLUMN IF NOT EXISTS "additionalTaxCodes" jsonb DEFAULT '[]'::jsonb NOT NULL,
  ADD COLUMN IF NOT EXISTS "taxBreakdown" jsonb DEFAULT '[]'::jsonb NOT NULL,
  ADD COLUMN IF NOT EXISTS "subtotal" decimal(12, 2) DEFAULT '0.00' NOT NULL,
  ADD COLUMN IF NOT EXISTS "taxAmount" decimal(12, 2) DEFAULT '0.00' NOT NULL,
  ADD COLUMN IF NOT EXISTS "total" decimal(12, 2) DEFAULT '0.00' NOT NULL;

WITH receipt_lines AS (
  SELECT
    receipt_item.id,
    lower(coalesce(order_item."taxCode", 'exe')) AS tax_code,
    coalesce(order_item."additionalTaxCodes", '[]'::jsonb) AS additional_tax_codes,
    round(
      coalesce(receipt_item."quantityReceived"::numeric, 0) *
      coalesce(receipt_item."unitPrice"::numeric, order_item."unitPrice"::numeric, 0),
      2
    ) AS subtotal
  FROM "receiptItems" AS receipt_item
  INNER JOIN "receipts" AS receipt
    ON receipt.id = receipt_item."receiptId"
  INNER JOIN "purchaseOrderItems" AS order_item
    ON order_item.id = receipt_item."sourceItemId"
  WHERE receipt."sourceType" = 'purchase_order'
),
line_taxes AS (
  SELECT
    line.id,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'taxCode', lower(tax."taxCode"),
          'label', coalesce(tax."description", tax."shortLabel", tax."taxCode"),
          'shortLabel', coalesce(tax."shortLabel", tax."description", tax."taxCode"),
          'taxType', tax."taxType",
          'fiscalCategory', tax."fiscalCategory",
          'ratePercent', coalesce(tax."ratePercent"::numeric, 0),
          'rate', coalesce(tax."ratePercent"::numeric, 0) / 100,
          'baseAmount', line.subtotal,
          'amount', round(line.subtotal * (coalesce(tax."ratePercent"::numeric, 0) / 100), 2),
          'displayOrder', coalesce(tax."displayOrder", 999)
        )
        ORDER BY coalesce(tax."displayOrder", 999), lower(tax."taxCode")
      ) FILTER (WHERE coalesce(tax."ratePercent"::numeric, 0) > 0),
      '[]'::jsonb
    ) AS tax_breakdown,
    round(
      coalesce(
        sum(round(line.subtotal * (coalesce(tax."ratePercent"::numeric, 0) / 100), 2))
          FILTER (WHERE coalesce(tax."ratePercent"::numeric, 0) > 0),
        0
      ),
      2
    ) AS tax_amount
  FROM receipt_lines AS line
  LEFT JOIN "salesTaxes" AS tax
    ON tax."isActive" = true
   AND (
      (tax."taxType" = 'base' AND lower(tax."taxCode") = line.tax_code)
      OR (tax."taxType" = 'additional' AND line.additional_tax_codes ? lower(tax."taxCode"))
    )
  GROUP BY line.id
)
UPDATE "receiptItems" AS receipt_item
SET
  "taxCode" = line.tax_code,
  "additionalTaxCodes" = line.additional_tax_codes,
  "taxBreakdown" = line_tax.tax_breakdown,
  "subtotal" = line.subtotal,
  "taxAmount" = line_tax.tax_amount,
  "total" = round(line.subtotal + line_tax.tax_amount, 2)
FROM receipt_lines AS line
INNER JOIN line_taxes AS line_tax
  ON line_tax.id = line.id
WHERE receipt_item.id = line.id;
