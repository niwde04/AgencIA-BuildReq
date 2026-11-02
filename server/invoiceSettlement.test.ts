import { describe, expect, it } from "vitest";
import {
  assertInvoiceSettlementOriginals,
  calculateInvoiceSettlement,
  DOCUMENT_CENTS_POLICY,
} from "../shared/invoice-settlement";
const invoice = {
  total: "57492.2200",
  retentionTotal: "14373.0550",
  otherRetentionTotal: "0.0000",
  documentDiscountTotal: "0.0000",
  creditNoteTotal: "0.0000",
  debitNoteTotal: "0.0000",
  netPayable: "43119.1650",
};
describe("versioned invoice settlement", () => {
  it("keeps the existing final-net rule unless the document is explicitly enrolled", () => {
    expect(calculateInvoiceSettlement(invoice)).toEqual({
      policy: "legacy",
      amount: 43119.17,
      originalNetPayable: 43119.165,
      difference: 0,
    });
  });
  it("calculates GEOVIAL from official rounded header amounts without altering originals", () => {
    const before = structuredClone(invoice);
    expect(
      calculateInvoiceSettlement({ ...invoice, policy: DOCUMENT_CENTS_POLICY })
    ).toEqual({
      policy: DOCUMENT_CENTS_POLICY,
      amount: 43119.16,
      originalNetPayable: 43119.165,
      difference: -0.01,
    });
    expect(invoice).toEqual(before);
    assertInvoiceSettlementOriginals(invoice);
  });
  it("also handles a positive cent difference instead of adding a payment tolerance", () => {
    const source = {
      ...invoice,
      total: "100.0049",
      retentionTotal: "0.0050",
      netPayable: "99.9999",
    };
    expect(
      calculateInvoiceSettlement({ ...source, policy: DOCUMENT_CENTS_POLICY })
        .amount
    ).toBe(99.99);
    const positive = {
      ...invoice,
      total: "140211.8870",
      retentionTotal: "3434.6835",
      netPayable: "136777.2035",
    };
    expect(
      calculateInvoiceSettlement({ ...positive, policy: DOCUMENT_CENTS_POLICY })
    ).toMatchObject({ amount: 136777.21, difference: 0.01 });
  });
  it("uses all monetary concepts in cents, with credits and debits on their correct sides", () => {
    const source = {
      total: "100.1250",
      retentionTotal: "1.0050",
      otherRetentionTotal: "2.0050",
      documentDiscountTotal: "3.0050",
      creditNoteTotal: "4.0050",
      debitNoteTotal: "5.0050",
      netPayable: "95.1100",
      policy: DOCUMENT_CENTS_POLICY,
    };
    assertInvoiceSettlementOriginals(source);
    expect(calculateInvoiceSettlement(source).amount).toBe(95.1);
  });
  it("a full original-precision credit leaves zero cash payable", () => {
    const source = {
      ...invoice,
      creditNoteTotal: "43119.1650",
      netPayable: "0.0000",
      policy: DOCUMENT_CENTS_POLICY,
    };
    assertInvoiceSettlementOriginals(source);
    expect(calculateInvoiceSettlement(source).amount).toBe(0);
  });
  it("preserves the earlier 216733.1055 payment regression", () => {
    const source = {
      ...invoice,
      total: "216733.1055",
      retentionTotal: "0",
      netPayable: "216733.1055",
    };
    expect(calculateInvoiceSettlement(source).amount).toBe(216733.11);
    expect(
      calculateInvoiceSettlement({ ...source, policy: DOCUMENT_CENTS_POLICY })
        .amount
    ).toBe(216733.11);
  });
  it.each([
    { ...invoice, netPayable: "43119.1600" },
    { ...invoice, creditNoteTotal: "43119.1700", netPayable: "-0.0050" },
    { ...invoice, total: "invalid" },
  ])("refuses activation of inconsistent originals", source => {
    expect(() => assertInvoiceSettlementOriginals(source)).toThrow();
  });
});
