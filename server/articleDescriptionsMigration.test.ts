import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("uppercase article descriptions migration", () => {
  const sql = readFileSync(
    new URL(
      "../drizzle/0120_uppercase_article_descriptions.sql",
      import.meta.url
    ),
    "utf8"
  );

  it("backfills only catalog and inventory descriptions that need conversion", () => {
    expect(sql).toContain('UPDATE "sapCatalog"');
    expect(sql).toContain('WHERE "description" <> upper("description")');
    expect(sql).toContain('UPDATE "inventoryItems"');
    expect(sql).toContain('"name" = upper("name")');
    expect(sql).toContain('ELSE upper("description")');
    expect(sql).not.toContain('UPDATE "requestItems"');
    expect(sql).not.toContain('UPDATE "purchaseOrderItems"');
    expect(sql).not.toContain('"updatedAt"');
    expect(sql).not.toContain('"updatedById"');
  });

  it("enforces uppercase descriptions for future writes", () => {
    expect(sql).toContain(
      'CREATE TRIGGER "sap_catalog_description_uppercase_trigger"'
    );
    expect(sql).toContain(
      'CREATE TRIGGER "inventory_description_uppercase_trigger"'
    );
    expect(sql).toContain("SET search_path = ''");
    expect(sql).toContain('"sap_catalog_description_uppercase_check"');
    expect(sql).toContain('"inventory_name_uppercase_check"');
    expect(sql).toContain('"inventory_description_uppercase_check"');
  });
});
