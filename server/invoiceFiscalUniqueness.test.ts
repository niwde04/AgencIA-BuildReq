import { describe, expect, it } from "vitest";
import {
  DuplicateSupplierFiscalInvoiceError,
  isDuplicateSupplierFiscalInvoiceError,
} from "./db";

describe("supplier fiscal invoice conflicts", () => {
  it("recognizes application validation errors", () => {
    expect(
      isDuplicateSupplierFiscalInvoiceError(
        new DuplicateSupplierFiscalInvoiceError()
      )
    ).toBe(true);
  });

  it("recognizes database trigger conflicts through wrapped errors", () => {
    expect(
      isDuplicateSupplierFiscalInvoiceError({
        cause: {
          code: "23505",
          constraint: "supplier_fiscal_invoice_number_unique",
        },
      })
    ).toBe(true);
  });

  it("does not relabel unrelated unique violations", () => {
    expect(
      isDuplicateSupplierFiscalInvoiceError({
        code: "23505",
        constraint: "invoices_receiptId_unique",
      })
    ).toBe(false);
  });
});
