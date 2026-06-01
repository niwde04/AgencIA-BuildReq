ALTER TABLE "purchaseOrderItems"
  ALTER COLUMN "unitPrice" TYPE decimal(14, 4) USING "unitPrice"::numeric(14, 4),
  ALTER COLUMN "unitPrice" SET DEFAULT '0.0000';

ALTER TABLE "receiptItems"
  ALTER COLUMN "unitPrice" TYPE decimal(14, 4) USING "unitPrice"::numeric(14, 4),
  ALTER COLUMN "unitPrice" SET DEFAULT '0.0000',
  ALTER COLUMN "subtotal" TYPE decimal(14, 4) USING "subtotal"::numeric(14, 4),
  ALTER COLUMN "subtotal" SET DEFAULT '0.0000',
  ALTER COLUMN "taxAmount" TYPE decimal(14, 4) USING "taxAmount"::numeric(14, 4),
  ALTER COLUMN "taxAmount" SET DEFAULT '0.0000',
  ALTER COLUMN "total" TYPE decimal(14, 4) USING "total"::numeric(14, 4),
  ALTER COLUMN "total" SET DEFAULT '0.0000';

ALTER TABLE "invoices"
  ALTER COLUMN "subtotal" TYPE decimal(14, 4) USING "subtotal"::numeric(14, 4),
  ALTER COLUMN "subtotal" SET DEFAULT '0.0000',
  ALTER COLUMN "taxAmount" TYPE decimal(14, 4) USING "taxAmount"::numeric(14, 4),
  ALTER COLUMN "taxAmount" SET DEFAULT '0.0000',
  ALTER COLUMN "total" TYPE decimal(14, 4) USING "total"::numeric(14, 4),
  ALTER COLUMN "total" SET DEFAULT '0.0000',
  ALTER COLUMN "retentionTotal" TYPE decimal(14, 4) USING "retentionTotal"::numeric(14, 4),
  ALTER COLUMN "retentionTotal" SET DEFAULT '0.0000',
  ALTER COLUMN "netPayable" TYPE decimal(14, 4) USING "netPayable"::numeric(14, 4),
  ALTER COLUMN "netPayable" SET DEFAULT '0.0000';

ALTER TABLE "invoiceItems"
  ALTER COLUMN "unitPrice" TYPE decimal(14, 4) USING "unitPrice"::numeric(14, 4),
  ALTER COLUMN "unitPrice" SET DEFAULT '0.0000',
  ALTER COLUMN "subtotal" TYPE decimal(14, 4) USING "subtotal"::numeric(14, 4),
  ALTER COLUMN "subtotal" SET DEFAULT '0.0000',
  ALTER COLUMN "taxAmount" TYPE decimal(14, 4) USING "taxAmount"::numeric(14, 4),
  ALTER COLUMN "taxAmount" SET DEFAULT '0.0000',
  ALTER COLUMN "total" TYPE decimal(14, 4) USING "total"::numeric(14, 4),
  ALTER COLUMN "total" SET DEFAULT '0.0000';

ALTER TABLE "invoiceRetentions"
  ALTER COLUMN "baseAmount" TYPE decimal(14, 4) USING "baseAmount"::numeric(14, 4),
  ALTER COLUMN "baseAmount" SET DEFAULT '0.0000',
  ALTER COLUMN "amount" TYPE decimal(14, 4) USING "amount"::numeric(14, 4);
