import { describe, expect, it } from "vitest";
import {
  getEffectiveSupplierFiscalProfile,
  getSupplierAccountPaymentCertificateStatus,
  getSupplierRetentionPolicy,
  isAccountPaymentAllowedRetention,
  isMissingCpcRequiredRetention,
  isSupplierAccountPaymentCertificateCode,
  normalizeSupplierDocumentTypeCode,
  requiresMissingCpcRetention,
  resolveInvoiceItemAllowsTaxWithholding,
} from "../shared/supplier-documents";

describe("supplier account payment certificates", () => {
  it("recognizes the seeded and generated document type codes", () => {
    expect(
      isSupplierAccountPaymentCertificateCode("constancia_pago_a_cuenta")
    ).toBe(true);
    expect(
      isSupplierAccountPaymentCertificateCode("Constancia de pagos a cuenta")
    ).toBe(true);
    expect(isSupplierAccountPaymentCertificateCode("rtn")).toBe(false);
    expect(
      normalizeSupplierDocumentTypeCode("Constancia de Pagos a Cuenta")
    ).toBe("constancia_de_pagos_a_cuenta");
  });

  it("uses inclusive document and expiration dates for validity", () => {
    const referenceDate = "2026-07-11";

    expect(
      getSupplierAccountPaymentCertificateStatus(
        {
          documentDate: "2026-07-01",
          expirationDate: "2026-07-11",
        },
        referenceDate
      )
    ).toBe("vigente");
    expect(
      getSupplierAccountPaymentCertificateStatus(
        {
          documentDate: "2026-07-12",
          expirationDate: "2026-12-31",
        },
        referenceDate
      )
    ).toBe("futuro");
    expect(
      getSupplierAccountPaymentCertificateStatus(
        {
          documentDate: "2026-01-01",
          expirationDate: "2026-07-10",
        },
        referenceDate
      )
    ).toBe("vencido");
  });

  it("allows only the RT15 catalog entry with the exact 15 percent rate", () => {
    expect(
      isAccountPaymentAllowedRetention({
        taxCode: "rt15",
        ratePercent: "15.0000",
      })
    ).toBe(true);
    expect(
      isAccountPaymentAllowedRetention({
        taxCode: "RT01",
        ratePercent: "15.0000",
      })
    ).toBe(false);
    expect(
      isAccountPaymentAllowedRetention({
        taxCode: "RT15",
        ratePercent: "10.0000",
      })
    ).toBe(false);
  });

  it("recognizes RT01 and the legacy RT1 code at one percent as the required retention without CPC", () => {
    expect(
      isMissingCpcRequiredRetention({
        taxCode: "rt01",
        ratePercent: "1.0000",
      })
    ).toBe(true);
    expect(
      isMissingCpcRequiredRetention({
        taxCode: "rt1",
        ratePercent: "1.0000",
      })
    ).toBe(true);
    expect(
      isMissingCpcRequiredRetention({
        taxCode: "RT15",
        ratePercent: "1.0000",
      })
    ).toBe(false);
    expect(
      isMissingCpcRequiredRetention({
        taxCode: "RT01",
        ratePercent: "15.0000",
      })
    ).toBe(false);
  });

  it("requires RT01 only for fiscal invoices without a valid CPC under the manual policy and with an eligible base", () => {
    expect(
      requiresMissingCpcRetention({
        isFiscalDocument: true,
        certificateStatus: null,
        retentionPolicy: "manual",
        withholdingBase: 100,
      })
    ).toBe(true);

    expect(
      requiresMissingCpcRetention({
        isFiscalDocument: true,
        certificateStatus: null,
        retentionPolicy: "none",
        withholdingBase: 100,
      })
    ).toBe(false);
    expect(
      requiresMissingCpcRetention({
        isFiscalDocument: true,
        certificateStatus: null,
        retentionPolicy: "rt15_only",
        withholdingBase: 100,
      })
    ).toBe(false);
    expect(
      requiresMissingCpcRetention({
        isFiscalDocument: true,
        certificateStatus: null,
        retentionPolicy: "manual",
        withholdingBase: 0,
      })
    ).toBe(false);
    expect(
      requiresMissingCpcRetention({
        isFiscalDocument: true,
        certificateStatus: "vigente",
        retentionPolicy: "manual",
        withholdingBase: 100,
      })
    ).toBe(false);
    expect(
      requiresMissingCpcRetention({
        isFiscalDocument: false,
        certificateStatus: null,
        retentionPolicy: "manual",
        withholdingBase: 100,
      })
    ).toBe(false);
  });

  it("uses the current catalog retention flag only while the invoice remains editable", () => {
    expect(
      resolveInvoiceItemAllowsTaxWithholding({
        invoiceStatus: "borrador",
        snapshotAllowsTaxWithholding: true,
        catalogAllowsTaxWithholding: false,
      })
    ).toBe(false);
    expect(
      resolveInvoiceItemAllowsTaxWithholding({
        invoiceStatus: "rechazada",
        snapshotAllowsTaxWithholding: true,
        catalogAllowsTaxWithholding: false,
      })
    ).toBe(false);
    expect(
      resolveInvoiceItemAllowsTaxWithholding({
        invoiceStatus: "revisada",
        snapshotAllowsTaxWithholding: true,
        catalogAllowsTaxWithholding: false,
      })
    ).toBe(true);
    expect(
      resolveInvoiceItemAllowsTaxWithholding({
        invoiceStatus: "registrada",
        snapshotAllowsTaxWithholding: false,
        catalogAllowsTaxWithholding: true,
      })
    ).toBe(false);
  });

  it("returns to the stored manual profile when the certificate is not valid", () => {
    expect(
      getSupplierRetentionPolicy({
        certificateStatus: "vigente",
        allowsTaxWithholding: false,
      })
    ).toBe("rt15_only");
    expect(
      getSupplierRetentionPolicy({
        certificateStatus: "vencido",
        allowsTaxWithholding: true,
      })
    ).toBe("manual");
    expect(
      getSupplierRetentionPolicy({
        certificateStatus: "vencido",
        allowsTaxWithholding: false,
      })
    ).toBe("none");
  });

  it("uses the valid certificate as the effective supplier fiscal profile", () => {
    expect(
      getEffectiveSupplierFiscalProfile({
        certificateStatus: "vigente",
        allowsTaxWithholding: true,
        subjectToAccountPayments: false,
      })
    ).toEqual({
      allowsTaxWithholding: false,
      subjectToAccountPayments: true,
    });

    expect(
      getEffectiveSupplierFiscalProfile({
        certificateStatus: "vencido",
        allowsTaxWithholding: true,
        subjectToAccountPayments: false,
      })
    ).toEqual({
      allowsTaxWithholding: true,
      subjectToAccountPayments: false,
    });
  });
});
