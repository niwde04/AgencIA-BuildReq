import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("purchase order digital seals migration", () => {
  const migration = readFileSync(
    new URL(
      "../drizzle/0133_purchase_order_digital_seals.sql",
      import.meta.url
    ),
    "utf8"
  );

  it("creates one permanent seal record per purchase order", () => {
    expect(migration).toContain(
      'CREATE TABLE IF NOT EXISTS "purchaseOrderDigitalSeals"'
    );
    expect(migration).toContain('"po_digital_seal_order_uidx"');
    expect(migration).toContain(
      'ON "purchaseOrderDigitalSeals" ("purchaseOrderId")'
    );
    expect(migration).toContain("ON DELETE RESTRICT");
    expect(migration).toContain('"verificationTokenHash" varchar(64) NOT NULL');
    expect(migration).toContain('"payloadHash" varchar(64) NOT NULL');
    expect(migration).toContain('"officialPdfHash" varchar(64) NOT NULL');
    expect(migration).not.toMatch(
      /INSERT\s+INTO\s+"purchaseOrderDigitalSeals"/i
    );
  });

  it("supports approval, no-approval, and later invalidation metadata", () => {
    expect(migration).toContain(
      `CHECK ("sealType" IN ('approval', 'issued_without_approval'))`
    );
    for (const column of [
      "signerUserId",
      "signerName",
      "signerRole",
      "signedAt",
      "sealedAt",
      "invalidatedAt",
      "invalidatedByUserId",
      "invalidationReason",
    ]) {
      expect(migration).toContain(`"${column}"`);
    }
  });

  it("keeps verification tokens hashed and the table private", () => {
    expect(migration).not.toMatch(/"verificationToken"\s/);
    expect(migration).toContain(
      'ALTER TABLE "purchaseOrderDigitalSeals" ENABLE ROW LEVEL SECURITY'
    );
    expect(migration).toContain(
      'REVOKE ALL ON TABLE "purchaseOrderDigitalSeals" FROM anon'
    );
    expect(migration).toContain(
      'REVOKE ALL ON TABLE "purchaseOrderDigitalSeals" FROM authenticated'
    );
  });

  it("prevents deletion and mutation after the one-way invalidation transition", () => {
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION "protectPurchaseOrderDigitalSeal"()'
    );
    expect(migration).toContain("IF TG_OP = 'DELETE'");
    expect(migration).toContain(
      'CREATE TRIGGER "purchase_order_digital_seal_immutable"'
    );
    expect(migration).toContain('IF OLD."invalidatedAt" IS NOT NULL THEN');
    expect(migration).toContain(
      "La anulación del sello requiere usuario y motivo"
    );
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION "protectSealedPurchaseOrderPdf"()'
    );
    expect(migration).toContain(
      'CREATE TRIGGER "purchase_order_official_pdf_immutable"'
    );
    expect(migration).toContain(
      "El PDF oficial sellado de la orden de compra es inmutable"
    );
  });
});
