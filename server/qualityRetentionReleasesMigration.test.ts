import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("migraciones de liberación de retención de calidad", () => {
  it("separa las ampliaciones de enum del esquema dependiente", async () => {
    const enumMigration = await readFile(
      new URL(
        "../drizzle/0128_quality_retention_release_enums.sql",
        import.meta.url
      ),
      "utf8"
    );
    const schemaMigration = await readFile(
      new URL(
        "../drizzle/0129_quality_retention_releases.sql",
        import.meta.url
      ),
      "utf8"
    );

    expect(enumMigration).toContain("quality_retention_release");
    expect(schemaMigration).toContain(
      'CREATE TABLE IF NOT EXISTS "qualityRetentionReleases"'
    );
    expect(schemaMigration).toContain('"qrr_pending_adjustment_unique"');
    expect(schemaMigration).toContain(
      '"treasury_item_active_quality_release_unique"'
    );
    expect(schemaMigration).toContain("ENABLE ROW LEVEL SECURITY");
    expect(schemaMigration).toContain("guard_invoice_quality_release_void");
  });

  it("protege montos, estados, llaves y acceso directo", async () => {
    const migration = await readFile(
      new URL(
        "../drizzle/0129_quality_retention_releases.sql",
        import.meta.url
      ),
      "utf8"
    );

    expect(migration).toContain('"approvedAmount" <= "requestedAmount"');
    expect(migration).toContain("'partially_paid'");
    expect(migration).toContain(
      'REFERENCES "invoiceDocumentAdjustments"("id") ON DELETE RESTRICT'
    );
    expect(migration).toContain(
      'REVOKE ALL ON TABLE "qualityRetentionReleases"'
    );
    expect(migration).toContain("\"sourceType\" = 'quality_retention_release'");
  });
});
