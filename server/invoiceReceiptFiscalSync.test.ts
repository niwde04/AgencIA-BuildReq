import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { getInvoiceReceiptFiscalDifferences } from "../shared/invoice-receipt-fiscal";

describe("invoice and receipt fiscal synchronization", () => {
  it("ignores formatting differences in fiscal identifiers", () => {
    expect(
      getInvoiceReceiptFiscalDifferences(
        {
          isFiscalDocument: true,
          invoiceNumber: "000-001-01-00010680",
          cai: "451139-F1FC23-927BE0-63BE03-090963-6B",
          documentRangeStart: "000-001-01-00009751",
          documentRangeEnd: "000-001-01-00010750",
          documentDate: "2026-07-27",
          documentDueDate: "2026-08-25",
          postingDate: "2026-08-06",
          receiptDate: "2026-08-06",
          emissionDeadline: "2026-12-03",
        },
        {
          isFiscalDocument: true,
          invoiceNumber: "0000010100010680",
          cai: "451139f1fc23927be063be030909636b",
          documentRangeStart: "0000010100009751",
          documentRangeEnd: "0000010100010750",
          documentDate: new Date("2026-07-27T18:00:00.000Z"),
          documentDueDate: new Date("2026-08-25T18:00:00.000Z"),
          postingDate: new Date("2026-08-06T18:00:00.000Z"),
          receiptDate: new Date("2026-08-06T18:00:00.000Z"),
          emissionDeadline: new Date("2026-12-03T18:00:00.000Z"),
        }
      )
    ).toEqual([]);
  });

  it("reports every differing fiscal field with both values", () => {
    expect(
      getInvoiceReceiptFiscalDifferences(
        {
          invoiceNumber: "000-001-01-00010680",
          documentDate: "2026-07-27",
          documentDueDate: "2026-08-25",
        },
        {
          invoiceNumber: "000-001-01-00010589",
          documentDate: "2026-07-08",
          documentDueDate: "2026-08-06",
        }
      )
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: "invoiceNumber",
          receiptValue: "000-001-01-00010589",
          invoiceValue: "000-001-01-00010680",
        }),
        expect.objectContaining({
          field: "documentDate",
          receiptValue: "08/07/2026",
          invoiceValue: "27/07/2026",
        }),
        expect.objectContaining({
          field: "documentDueDate",
          receiptValue: "06/08/2026",
          invoiceValue: "25/08/2026",
        }),
      ])
    );
  });

  it("adds the receipt emission deadline and excludes its linked invoice from duplicate checks", async () => {
    const migration = await readFile(
      new URL("../drizzle/0136_receipt_fiscal_data_sync.sql", import.meta.url),
      "utf8"
    );

    expect(migration).toContain(
      'ADD COLUMN IF NOT EXISTS "emissionDeadline" timestamp'
    );
    expect(migration).toContain(
      'other_invoice."receiptId" <> NEW."id"'
    );
    expect(migration).toContain(
      'SET "emissionDeadline" = invoice."emissionDeadline"'
    );
  });
});
