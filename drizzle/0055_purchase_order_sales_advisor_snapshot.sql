ALTER TABLE "purchaseOrders"
ADD COLUMN IF NOT EXISTS "supplierContactId" integer,
ADD COLUMN IF NOT EXISTS "salesAdvisorName" varchar(255),
ADD COLUMN IF NOT EXISTS "salesAdvisorPhone" varchar(80),
ADD COLUMN IF NOT EXISTS "salesAdvisorEmail" varchar(320);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'po_supplier_contact_fk'
  ) THEN
    ALTER TABLE "purchaseOrders"
    ADD CONSTRAINT "po_supplier_contact_fk"
    FOREIGN KEY ("supplierContactId")
    REFERENCES "supplierContacts"("id")
    ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "po_supplier_contact_idx"
ON "purchaseOrders" ("supplierContactId");

UPDATE "purchaseOrders" po
SET
  "supplierContactId" = preferred."id",
  "salesAdvisorName" = preferred."name",
  "salesAdvisorPhone" = preferred."phone",
  "salesAdvisorEmail" = preferred."email"
FROM (
  SELECT DISTINCT ON (po2."id")
    po2."id" AS "purchaseOrderId",
    sc."id",
    sc."name",
    sc."phone",
    sc."email"
  FROM "purchaseOrders" po2
  INNER JOIN "supplierContacts" sc
    ON sc."supplierId" = po2."supplierId"
  WHERE
    po2."supplierId" IS NOT NULL
    AND sc."isActive" = true
    AND (
      sc."projectId" = po2."projectId"
      OR NOT EXISTS (
        SELECT 1
        FROM "supplierContacts" project_sc
        WHERE
          project_sc."supplierId" = po2."supplierId"
          AND project_sc."projectId" = po2."projectId"
          AND project_sc."isActive" = true
      )
    )
  ORDER BY
    po2."id",
    CASE WHEN sc."projectId" = po2."projectId" THEN 0 ELSE 1 END,
    CASE WHEN sc."contactType" = 'ventas' THEN 0 ELSE 1 END,
    sc."name"
) preferred
WHERE
  po."id" = preferred."purchaseOrderId"
  AND po."supplierContactId" IS NULL
  AND po."salesAdvisorName" IS NULL;
