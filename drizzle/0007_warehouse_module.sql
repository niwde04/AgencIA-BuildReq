CREATE TABLE "warehouses" (
  "id" serial PRIMARY KEY NOT NULL,
  "code" varchar(20) NOT NULL,
  "name" varchar(255) NOT NULL,
  "displayName" varchar(300) NOT NULL,
  "description" text,
  "isActive" boolean DEFAULT true NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "warehouses_code_unique" UNIQUE("code"),
  CONSTRAINT "warehouses_displayName_unique" UNIQUE("displayName")
);

CREATE INDEX "wh_code_idx" ON "warehouses" USING btree ("code");
CREATE INDEX "wh_display_name_idx" ON "warehouses" USING btree ("displayName");

ALTER TABLE "inventoryItems" ADD COLUMN "warehouseId" integer;
CREATE INDEX "inv_warehouse_idx" ON "inventoryItems" USING btree ("warehouseId");
ALTER TABLE "inventoryItems"
  ADD CONSTRAINT "inventoryItems_warehouseId_warehouses_id_fk"
  FOREIGN KEY ("warehouseId") REFERENCES "public"."warehouses"("id")
  ON DELETE set null ON UPDATE no action;

INSERT INTO "warehouses" ("code", "name", "displayName", "description")
VALUES
  ('006', 'La Barca', '006 - LA BARCA', 'Almacén principal de La Barca'),
  ('010', 'San Jose', '010 - SAN JOSE', 'Almacén principal de San Jose')
ON CONFLICT ("code") DO NOTHING;

UPDATE "inventoryItems" AS "inventory"
SET
  "warehouseId" = "warehouse"."id",
  "warehouseLocation" = "warehouse"."displayName",
  "updatedAt" = now()
FROM "warehouses" AS "warehouse"
WHERE upper(regexp_replace(coalesce("inventory"."warehouseLocation", ''), '\s+', ' ', 'g')) =
  upper(regexp_replace("warehouse"."displayName", '\s+', ' ', 'g'))
  AND ("inventory"."warehouseId" IS DISTINCT FROM "warehouse"."id");
