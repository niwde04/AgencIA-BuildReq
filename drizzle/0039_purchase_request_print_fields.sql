ALTER TABLE "purchaseRequests"
ADD COLUMN IF NOT EXISTS "printDestination" varchar(500);

ALTER TABLE "purchaseRequestItems"
ADD COLUMN IF NOT EXISTS "brand" varchar(255);

ALTER TABLE "purchaseRequestItems"
ADD COLUMN IF NOT EXISTS "costResponsible" varchar(255);
