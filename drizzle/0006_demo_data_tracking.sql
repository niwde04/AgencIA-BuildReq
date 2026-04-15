ALTER TABLE "projects" ADD COLUMN "demoBatchKey" varchar(64);
CREATE INDEX "proj_demo_batch_idx" ON "projects" USING btree ("demoBatchKey");

ALTER TABLE "inventoryItems" ADD COLUMN "demoBatchKey" varchar(64);
CREATE INDEX "inv_demo_batch_idx" ON "inventoryItems" USING btree ("demoBatchKey");

ALTER TABLE "sapCatalog" ADD COLUMN "demoBatchKey" varchar(64);
CREATE INDEX "sap_cat_demo_batch_idx" ON "sapCatalog" USING btree ("demoBatchKey");

ALTER TABLE "suppliers" ADD COLUMN "demoBatchKey" varchar(64);
CREATE INDEX "sup_demo_batch_idx" ON "suppliers" USING btree ("demoBatchKey");
