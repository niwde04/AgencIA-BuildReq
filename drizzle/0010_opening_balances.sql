CREATE TABLE IF NOT EXISTS "openingBalances" (
  "id" serial PRIMARY KEY NOT NULL,
  "balanceNumber" varchar(20) NOT NULL UNIQUE,
  "projectId" integer NOT NULL,
  "warehouseId" integer NOT NULL UNIQUE,
  "createdById" integer NOT NULL,
  "openingDate" timestamp DEFAULT now() NOT NULL,
  "notes" text,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "ob_project_idx" ON "openingBalances" USING btree ("projectId");
CREATE INDEX IF NOT EXISTS "ob_warehouse_idx" ON "openingBalances" USING btree ("warehouseId");
CREATE INDEX IF NOT EXISTS "ob_created_by_idx" ON "openingBalances" USING btree ("createdById");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'openingBalances_projectId_projects_id_fk'
  ) THEN
    ALTER TABLE "openingBalances"
      ADD CONSTRAINT "openingBalances_projectId_projects_id_fk"
      FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id")
      ON DELETE restrict ON UPDATE no action;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'openingBalances_warehouseId_warehouses_id_fk'
  ) THEN
    ALTER TABLE "openingBalances"
      ADD CONSTRAINT "openingBalances_warehouseId_warehouses_id_fk"
      FOREIGN KEY ("warehouseId") REFERENCES "public"."warehouses"("id")
      ON DELETE restrict ON UPDATE no action;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'openingBalances_createdById_users_id_fk'
  ) THEN
    ALTER TABLE "openingBalances"
      ADD CONSTRAINT "openingBalances_createdById_users_id_fk"
      FOREIGN KEY ("createdById") REFERENCES "public"."users"("id")
      ON DELETE restrict ON UPDATE no action;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "openingBalanceItems" (
  "id" serial PRIMARY KEY NOT NULL,
  "openingBalanceId" integer NOT NULL,
  "sapItemCode" varchar(50) NOT NULL,
  "itemName" varchar(500) NOT NULL,
  "quantity" decimal(12,2) NOT NULL,
  "unit" varchar(50),
  "notes" text,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "obi_opening_balance_idx" ON "openingBalanceItems" USING btree ("openingBalanceId");
CREATE INDEX IF NOT EXISTS "obi_sap_code_idx" ON "openingBalanceItems" USING btree ("sapItemCode");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'openingBalanceItems_openingBalanceId_openingBalances_id_fk'
  ) THEN
    ALTER TABLE "openingBalanceItems"
      ADD CONSTRAINT "openingBalanceItems_openingBalanceId_openingBalances_id_fk"
      FOREIGN KEY ("openingBalanceId") REFERENCES "public"."openingBalances"("id")
      ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
