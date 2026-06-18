DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'inventory_items_positive_stock_requires_project'
  ) THEN
    ALTER TABLE "inventoryItems"
      ADD CONSTRAINT "inventory_items_positive_stock_requires_project"
      CHECK (
        "projectId" IS NOT NULL
        OR coalesce("currentStock"::numeric, 0) <= 0
      ) NOT VALID;
  END IF;
END $$;
