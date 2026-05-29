ALTER TABLE "purchaseOrderItems"
  ADD COLUMN IF NOT EXISTS "isFixedAsset" boolean DEFAULT false NOT NULL,
  ADD COLUMN IF NOT EXISTS "isLeasing" boolean DEFAULT false NOT NULL,
  ADD COLUMN IF NOT EXISTS "assetDetails" jsonb DEFAULT '[]'::jsonb NOT NULL,
  ADD COLUMN IF NOT EXISTS "lineObservation" text,
  ADD COLUMN IF NOT EXISTS "fixedAssetArticleId" integer,
  ADD COLUMN IF NOT EXISTS "fixedAssetStatus" varchar(20);

ALTER TABLE "sapCatalog"
  ADD COLUMN IF NOT EXISTS "temporaryItemCode" varchar(50),
  ADD COLUMN IF NOT EXISTS "fixedAssetStatus" varchar(20),
  ADD COLUMN IF NOT EXISTS "fixedAssetSourcePurchaseOrderId" integer,
  ADD COLUMN IF NOT EXISTS "fixedAssetSourcePurchaseOrderItemId" integer,
  ADD COLUMN IF NOT EXISTS "fixedAssetSerialNumber" varchar(120),
  ADD COLUMN IF NOT EXISTS "fixedAssetCondition" "item_condition",
  ADD COLUMN IF NOT EXISTS "fixedAssetColor" varchar(120),
  ADD COLUMN IF NOT EXISTS "fixedAssetModel" varchar(120),
  ADD COLUMN IF NOT EXISTS "fixedAssetBrand" varchar(120),
  ADD COLUMN IF NOT EXISTS "fixedAssetChassisSeries" varchar(120),
  ADD COLUMN IF NOT EXISTS "fixedAssetMotorSeries" varchar(120),
  ADD COLUMN IF NOT EXISTS "fixedAssetPlateOrCode" varchar(120),
  ADD COLUMN IF NOT EXISTS "fixedAssetIsLeasing" boolean DEFAULT false NOT NULL,
  ADD COLUMN IF NOT EXISTS "fixedAssetObservation" text;

CREATE INDEX IF NOT EXISTS "sap_cat_fixed_asset_status_idx"
  ON "sapCatalog" ("fixedAssetStatus");

CREATE INDEX IF NOT EXISTS "poi_fixed_asset_status_idx"
  ON "purchaseOrderItems" ("fixedAssetStatus");
