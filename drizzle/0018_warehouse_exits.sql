DO $$
BEGIN
  CREATE TYPE "warehouse_exit_status" AS ENUM ('borrador', 'emitida', 'anulada');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "warehouseExits" (
  "id" serial PRIMARY KEY NOT NULL,
  "exitNumber" varchar(20) NOT NULL UNIQUE,
  "projectId" integer NOT NULL,
  "warehouseId" integer,
  "materialRequestId" integer,
  "createdById" integer NOT NULL,
  "emittedById" integer,
  "cancelledById" integer,
  "status" "warehouse_exit_status" DEFAULT 'borrador' NOT NULL,
  "exitDate" timestamp DEFAULT now() NOT NULL,
  "emittedAt" timestamp,
  "cancelledAt" timestamp,
  "cancellationReason" text,
  "notes" text,
  "printedDocumentName" varchar(255),
  "printedDocumentMimeType" varchar(100),
  "printedDocumentContent" text,
  "printedAt" timestamp,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "we_project_idx" ON "warehouseExits" USING btree ("projectId");
CREATE INDEX IF NOT EXISTS "we_warehouse_idx" ON "warehouseExits" USING btree ("warehouseId");
CREATE INDEX IF NOT EXISTS "we_material_request_idx" ON "warehouseExits" USING btree ("materialRequestId");
CREATE INDEX IF NOT EXISTS "we_status_idx" ON "warehouseExits" USING btree ("status");
CREATE INDEX IF NOT EXISTS "we_created_by_idx" ON "warehouseExits" USING btree ("createdById");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'warehouseExits_projectId_projects_id_fk'
  ) THEN
    ALTER TABLE "warehouseExits"
      ADD CONSTRAINT "warehouseExits_projectId_projects_id_fk"
      FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id")
      ON DELETE restrict ON UPDATE no action;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'warehouseExits_warehouseId_warehouses_id_fk'
  ) THEN
    ALTER TABLE "warehouseExits"
      ADD CONSTRAINT "warehouseExits_warehouseId_warehouses_id_fk"
      FOREIGN KEY ("warehouseId") REFERENCES "public"."warehouses"("id")
      ON DELETE set null ON UPDATE no action;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'warehouseExits_createdById_users_id_fk'
  ) THEN
    ALTER TABLE "warehouseExits"
      ADD CONSTRAINT "warehouseExits_createdById_users_id_fk"
      FOREIGN KEY ("createdById") REFERENCES "public"."users"("id")
      ON DELETE restrict ON UPDATE no action;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "warehouseExitItems" (
  "id" serial PRIMARY KEY NOT NULL,
  "warehouseExitId" integer NOT NULL,
  "materialRequestItemId" integer,
  "sapItemCode" varchar(50) NOT NULL,
  "itemName" varchar(500) NOT NULL,
  "quantity" decimal(12,2) NOT NULL,
  "unit" varchar(50),
  "notes" text,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "wei_warehouse_exit_idx" ON "warehouseExitItems" USING btree ("warehouseExitId");
CREATE INDEX IF NOT EXISTS "wei_request_item_idx" ON "warehouseExitItems" USING btree ("materialRequestItemId");
CREATE INDEX IF NOT EXISTS "wei_sap_code_idx" ON "warehouseExitItems" USING btree ("sapItemCode");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'warehouseExitItems_warehouseExitId_warehouseExits_id_fk'
  ) THEN
    ALTER TABLE "warehouseExitItems"
      ADD CONSTRAINT "warehouseExitItems_warehouseExitId_warehouseExits_id_fk"
      FOREIGN KEY ("warehouseExitId") REFERENCES "public"."warehouseExits"("id")
      ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
