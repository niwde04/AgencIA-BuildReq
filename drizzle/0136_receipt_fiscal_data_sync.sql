BEGIN;

ALTER TABLE "receipts"
  ADD COLUMN IF NOT EXISTS "emissionDeadline" timestamp;

UPDATE "receipts" AS receipt
SET "emissionDeadline" = invoice."emissionDeadline"
FROM "invoices" AS invoice
WHERE invoice."receiptId" = receipt."id"
  AND receipt."emissionDeadline" IS DISTINCT FROM invoice."emissionDeadline";

-- A receipt and its linked invoice represent the same fiscal document. Exclude
-- that linked invoice from the duplicate check while keeping protection against
-- every other active receipt and invoice for the supplier.
CREATE OR REPLACE FUNCTION enforce_supplier_fiscal_invoice_number_on_receipt()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  supplier_id integer;
  invoice_number_key text;
BEGIN
  IF NEW."sourceType" <> 'purchase_order'
    OR NEW."isFiscalDocument" IS NOT TRUE
    OR NEW."status" IN ('borrador', 'anulada')
    OR nullif(trim(NEW."invoiceNumber"), '') IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT purchase_order."supplierId"
  INTO supplier_id
  FROM "purchaseOrders" AS purchase_order
  WHERE purchase_order."id" = NEW."sourceId";

  IF supplier_id IS NULL THEN
    RETURN NEW;
  END IF;

  invoice_number_key := regexp_replace(NEW."invoiceNumber", '[^0-9]', '', 'g');
  IF invoice_number_key = '' THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(supplier_id::text || ':' || invoice_number_key, 0)
  );

  IF EXISTS (
    SELECT 1
    FROM "receipts" AS other_receipt
    INNER JOIN "purchaseOrders" AS other_order
      ON other_order."id" = other_receipt."sourceId"
    WHERE other_receipt."id" <> NEW."id"
      AND other_receipt."sourceType" = 'purchase_order'
      AND other_receipt."isFiscalDocument" = true
      AND other_receipt."status" NOT IN ('borrador', 'anulada')
      AND other_order."supplierId" = supplier_id
      AND regexp_replace(
        coalesce(other_receipt."invoiceNumber", ''),
        '[^0-9]',
        '',
        'g'
      ) = invoice_number_key
  ) OR EXISTS (
    SELECT 1
    FROM "invoices" AS other_invoice
    WHERE other_invoice."receiptId" <> NEW."id"
      AND other_invoice."supplierId" = supplier_id
      AND other_invoice."isFiscalDocument" = true
      AND other_invoice."status" <> 'anulada'
      AND regexp_replace(
        coalesce(other_invoice."invoiceNumber", ''),
        '[^0-9]',
        '',
        'g'
      ) = invoice_number_key
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23505',
      CONSTRAINT = 'supplier_fiscal_invoice_number_unique',
      MESSAGE = 'El número de factura fiscal ya está registrado para este proveedor';
  END IF;

  RETURN NEW;
END;
$$;

COMMIT;
