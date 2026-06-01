CREATE TABLE IF NOT EXISTS "receiptOtherCharges" (
  "id" serial PRIMARY KEY,
  "receiptId" integer NOT NULL,
  "concept" varchar(255) NOT NULL,
  "amount" decimal(14, 4) DEFAULT '0.0000' NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "recoc_receipt_idx"
  ON "receiptOtherCharges" ("receiptId");

CREATE TABLE IF NOT EXISTS "invoiceOtherCharges" (
  "id" serial PRIMARY KEY,
  "invoiceId" integer NOT NULL,
  "receiptOtherChargeId" integer,
  "concept" varchar(255) NOT NULL,
  "amount" decimal(14, 4) DEFAULT '0.0000' NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "invoc_invoice_idx"
  ON "invoiceOtherCharges" ("invoiceId");

CREATE INDEX IF NOT EXISTS "invoc_receipt_other_charge_idx"
  ON "invoiceOtherCharges" ("receiptOtherChargeId");
