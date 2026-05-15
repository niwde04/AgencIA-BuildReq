DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'invoice_status') THEN
    CREATE TYPE "invoice_status" AS ENUM ('borrador', 'registrada', 'anulada');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'invoice_retention_type') THEN
    CREATE TYPE "invoice_retention_type" AS ENUM ('percentage', 'amount');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "invoices" (
  "id" serial PRIMARY KEY,
  "invoiceDocumentNumber" varchar(20) NOT NULL UNIQUE,
  "receiptId" integer NOT NULL UNIQUE,
  "purchaseOrderId" integer NOT NULL,
  "projectId" integer NOT NULL,
  "supplierId" integer,
  "status" "invoice_status" DEFAULT 'borrador' NOT NULL,
  "cai" varchar(100),
  "invoiceNumber" varchar(100),
  "documentDate" timestamp,
  "postingDate" timestamp NOT NULL,
  "receiptDate" timestamp NOT NULL,
  "emissionDeadline" timestamp NOT NULL,
  "notes" text,
  "subtotal" decimal(12,2) DEFAULT '0.00' NOT NULL,
  "taxAmount" decimal(12,2) DEFAULT '0.00' NOT NULL,
  "total" decimal(12,2) DEFAULT '0.00' NOT NULL,
  "retentionTotal" decimal(12,2) DEFAULT '0.00' NOT NULL,
  "netPayable" decimal(12,2) DEFAULT '0.00' NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "inv_receipt_idx" ON "invoices" ("receiptId");
CREATE INDEX IF NOT EXISTS "inv_purchase_order_idx" ON "invoices" ("purchaseOrderId");
CREATE INDEX IF NOT EXISTS "inv_project_idx" ON "invoices" ("projectId");
CREATE INDEX IF NOT EXISTS "inv_supplier_idx" ON "invoices" ("supplierId");
CREATE INDEX IF NOT EXISTS "inv_status_idx" ON "invoices" ("status");

CREATE TABLE IF NOT EXISTS "invoiceItems" (
  "id" serial PRIMARY KEY,
  "invoiceId" integer NOT NULL,
  "receiptItemId" integer NOT NULL,
  "purchaseOrderItemId" integer NOT NULL,
  "itemName" varchar(500) NOT NULL,
  "currentSapItemCode" varchar(50),
  "originalSapItemCode" varchar(50),
  "quantity" decimal(12,2) NOT NULL,
  "unit" varchar(50),
  "unitPrice" decimal(12,2) DEFAULT '0.00' NOT NULL,
  "taxCode" "purchase_order_tax_code" DEFAULT 'exe' NOT NULL,
  "subtotal" decimal(12,2) DEFAULT '0.00' NOT NULL,
  "taxAmount" decimal(12,2) DEFAULT '0.00' NOT NULL,
  "total" decimal(12,2) DEFAULT '0.00' NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "invi_invoice_idx" ON "invoiceItems" ("invoiceId");
CREATE UNIQUE INDEX IF NOT EXISTS "invi_receipt_item_idx" ON "invoiceItems" ("receiptItemId");
CREATE INDEX IF NOT EXISTS "invi_purchase_order_item_idx" ON "invoiceItems" ("purchaseOrderItemId");

CREATE TABLE IF NOT EXISTS "invoiceRetentions" (
  "id" serial PRIMARY KEY,
  "invoiceId" integer NOT NULL,
  "retentionType" "invoice_retention_type" NOT NULL,
  "description" varchar(200) NOT NULL,
  "baseAmount" decimal(12,2) DEFAULT '0.00' NOT NULL,
  "percentage" decimal(8,4),
  "amount" decimal(12,2) NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "invr_invoice_idx" ON "invoiceRetentions" ("invoiceId");

WITH invoice_source AS (
  SELECT
    r.*,
    po."supplierId",
    row_number() OVER (
      PARTITION BY EXTRACT(YEAR FROM r."createdAt")
      ORDER BY r."createdAt", r."id"
    ) AS year_sequence
  FROM "receipts" r
  INNER JOIN "purchaseOrders" po
    ON r."sourceType" = 'purchase_order'
   AND r."sourceId" = po."id"
  WHERE NOT EXISTS (
    SELECT 1 FROM "invoices" existing WHERE existing."receiptId" = r."id"
  )
),
line_amounts AS (
  SELECT
    source."id" AS "receiptId",
    COALESCE(SUM((ri."quantityReceived"::numeric * COALESCE(poi."unitPrice"::numeric, 0))), 0) AS "subtotal",
    COALESCE(SUM(
      CASE
        WHEN poi."taxCode" = 'isv_15' THEN ROUND((ri."quantityReceived"::numeric * COALESCE(poi."unitPrice"::numeric, 0)) * 0.15, 2)
        ELSE 0
      END
    ), 0) AS "taxAmount"
  FROM invoice_source source
  INNER JOIN "receiptItems" ri ON ri."receiptId" = source."id"
  INNER JOIN "purchaseOrderItems" poi ON poi."id" = ri."sourceItemId"
  GROUP BY source."id"
)
INSERT INTO "invoices" (
  "invoiceDocumentNumber",
  "receiptId",
  "purchaseOrderId",
  "projectId",
  "supplierId",
  "status",
  "cai",
  "invoiceNumber",
  "documentDate",
  "postingDate",
  "receiptDate",
  "emissionDeadline",
  "notes",
  "subtotal",
  "taxAmount",
  "total",
  "retentionTotal",
  "netPayable",
  "createdAt",
  "updatedAt"
)
SELECT
  'FT-' || EXTRACT(YEAR FROM source."createdAt")::int || '-' || lpad(source.year_sequence::text, 4, '0'),
  source."id",
  source."sourceId",
  source."projectId",
  source."supplierId",
  'borrador',
  source."cai",
  source."invoiceNumber",
  source."documentDate",
  source."postingDate",
  source."receiptDate",
  COALESCE(source."documentDate", source."receiptDate", source."createdAt"),
  source."notes",
  ROUND(COALESCE(line_amounts."subtotal", 0), 2),
  ROUND(COALESCE(line_amounts."taxAmount", 0), 2),
  ROUND(COALESCE(line_amounts."subtotal", 0) + COALESCE(line_amounts."taxAmount", 0), 2),
  0,
  ROUND(COALESCE(line_amounts."subtotal", 0) + COALESCE(line_amounts."taxAmount", 0), 2),
  source."createdAt",
  now()
FROM invoice_source source
LEFT JOIN line_amounts ON line_amounts."receiptId" = source."id";

INSERT INTO "invoiceItems" (
  "invoiceId",
  "receiptItemId",
  "purchaseOrderItemId",
  "itemName",
  "currentSapItemCode",
  "originalSapItemCode",
  "quantity",
  "unit",
  "unitPrice",
  "taxCode",
  "subtotal",
  "taxAmount",
  "total",
  "createdAt"
)
SELECT
  inv."id",
  ri."id",
  poi."id",
  ri."itemName",
  poi."currentSapItemCode",
  poi."originalSapItemCode",
  ri."quantityReceived",
  ri."unit",
  COALESCE(poi."unitPrice", '0.00'),
  poi."taxCode",
  ROUND((ri."quantityReceived"::numeric * COALESCE(poi."unitPrice"::numeric, 0)), 2),
  CASE
    WHEN poi."taxCode" = 'isv_15' THEN ROUND((ri."quantityReceived"::numeric * COALESCE(poi."unitPrice"::numeric, 0)) * 0.15, 2)
    ELSE 0
  END,
  ROUND(
    (ri."quantityReceived"::numeric * COALESCE(poi."unitPrice"::numeric, 0)) +
    CASE
      WHEN poi."taxCode" = 'isv_15' THEN ROUND((ri."quantityReceived"::numeric * COALESCE(poi."unitPrice"::numeric, 0)) * 0.15, 2)
      ELSE 0
    END,
    2
  ),
  ri."createdAt"
FROM "invoices" inv
INNER JOIN "receipts" r ON r."id" = inv."receiptId"
INNER JOIN "receiptItems" ri ON ri."receiptId" = r."id"
INNER JOIN "purchaseOrderItems" poi ON poi."id" = ri."sourceItemId"
WHERE r."sourceType" = 'purchase_order'
  AND NOT EXISTS (
    SELECT 1 FROM "invoiceItems" existing WHERE existing."receiptItemId" = ri."id"
  );
