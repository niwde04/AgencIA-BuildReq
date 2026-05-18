ALTER TABLE "materialRequests"
ALTER COLUMN "requestNumber" TYPE varchar(64);

ALTER TABLE "supplyFlowRecords"
ALTER COLUMN "purchaseOrderNumber" TYPE varchar(64),
ALTER COLUMN "sapDocumentNumber" TYPE varchar(64);

ALTER TABLE "purchaseRequests"
ALTER COLUMN "requestNumber" TYPE varchar(64),
ALTER COLUMN "sapDocumentNumber" TYPE varchar(64);

ALTER TABLE "purchaseOrders"
ALTER COLUMN "orderNumber" TYPE varchar(64),
ALTER COLUMN "sapDocumentNumber" TYPE varchar(64);

ALTER TABLE "transferRequests"
ALTER COLUMN "requestNumber" TYPE varchar(64);

ALTER TABLE "transfers"
ALTER COLUMN "transferNumber" TYPE varchar(64),
ALTER COLUMN "remissionGuideNumber" TYPE varchar(64),
ALTER COLUMN "sapCorrelative" TYPE varchar(80);

ALTER TABLE "remissionGuides"
ALTER COLUMN "guideNumber" TYPE varchar(64),
ALTER COLUMN "sapCorrelative" TYPE varchar(80);

ALTER TABLE "receipts"
ALTER COLUMN "receiptNumber" TYPE varchar(64);

ALTER TABLE "invoices"
ALTER COLUMN "invoiceDocumentNumber" TYPE varchar(64);

ALTER TABLE "warehouseExits"
ALTER COLUMN "exitNumber" TYPE varchar(64);

ALTER TABLE "openingBalances"
ALTER COLUMN "balanceNumber" TYPE varchar(64);

ALTER TABLE "reverseLogistics"
ALTER COLUMN "returnNumber" TYPE varchar(64),
ALTER COLUMN "sapDocumentNumber" TYPE varchar(64);

ALTER TABLE "inventoryItems"
ALTER COLUMN "sapDocumentNumber" TYPE varchar(64);
