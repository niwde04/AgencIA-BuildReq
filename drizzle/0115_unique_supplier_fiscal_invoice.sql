CREATE INDEX IF NOT EXISTS "inv_supplier_fiscal_number_key_idx"
  ON "invoices" (
    "supplierId",
    (regexp_replace(coalesce("invoiceNumber", ''), '[^0-9]', '', 'g'))
  )
  WHERE "isFiscalDocument" = true
    AND "status" <> 'anulada';

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
    WHERE other_invoice."supplierId" = supplier_id
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

DROP TRIGGER IF EXISTS "receipt_supplier_fiscal_invoice_number_unique"
  ON "receipts";

CREATE TRIGGER "receipt_supplier_fiscal_invoice_number_unique"
BEFORE INSERT OR UPDATE OF
  "sourceType", "sourceId", "status", "isFiscalDocument", "invoiceNumber"
ON "receipts"
FOR EACH ROW
EXECUTE FUNCTION enforce_supplier_fiscal_invoice_number_on_receipt();

CREATE OR REPLACE FUNCTION enforce_supplier_fiscal_invoice_number_on_invoice()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  invoice_number_key text;
BEGIN
  IF NEW."supplierId" IS NULL
    OR NEW."isFiscalDocument" IS NOT TRUE
    OR NEW."status" = 'anulada'
    OR nullif(trim(NEW."invoiceNumber"), '') IS NULL THEN
    RETURN NEW;
  END IF;

  invoice_number_key := regexp_replace(NEW."invoiceNumber", '[^0-9]', '', 'g');
  IF invoice_number_key = '' THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(NEW."supplierId"::text || ':' || invoice_number_key, 0)
  );

  IF EXISTS (
    SELECT 1
    FROM "invoices" AS other_invoice
    WHERE other_invoice."id" <> NEW."id"
      AND other_invoice."supplierId" = NEW."supplierId"
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

DROP TRIGGER IF EXISTS "invoice_supplier_fiscal_invoice_number_unique"
  ON "invoices";

CREATE TRIGGER "invoice_supplier_fiscal_invoice_number_unique"
BEFORE INSERT OR UPDATE OF
  "supplierId", "isFiscalDocument", "invoiceNumber", "status"
ON "invoices"
FOR EACH ROW
EXECUTE FUNCTION enforce_supplier_fiscal_invoice_number_on_invoice();
