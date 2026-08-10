import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { buildWorkbook } from "../client/src/lib/excel-export";
import { buildTreasuryPaymentsWorksheets } from "../client/src/lib/treasury-payments-export";
import {
  TREASURY_PAYMENTS_HEADERS,
  buildTreasuryPaymentsReportRows,
  resolveTreasuryPaymentFinancialGroup,
  type TreasuryPaymentsReportRow,
  type TreasuryPaymentsSourcePayment,
} from "../shared/treasury-payments-report";

const payment: TreasuryPaymentsSourcePayment = {
  paymentItemId: 91,
  batchNumber: "TES-2026-000121",
  bankReference: "FT262128BSXF",
  invoiceId: 501,
  invoiceDate: new Date("2026-07-27T12:00:00.000Z"),
  invoiceNumber: "000-002-01-00035576",
  supplierName: "PROVEEDOR DE PRUEBA",
  jobCode: "018_003",
  currency: "HNL",
  invoiceSubtotal: 140,
  invoiceTaxAmount: 10,
  invoiceTotal: 150,
  fiscalRetentionTotal: 5,
  otherRetentionTotal: 3,
  documentDiscountTotal: 2,
  invoiceNetPayable: 140,
  appliedAdvanceAmount: 5,
  bankPaidAmount: 60,
  hasOceExemption: false,
  oceExemptAmount: 0,
};

describe("treasury Payments report", () => {
  it("keeps the complete 48-column Payments layout", () => {
    expect(TREASURY_PAYMENTS_HEADERS).toEqual([
      "Lote",
      "Referencia Bancaria",
      "Fecha emisión",
      "Nro. Factura",
      "Razón Social",
      "Tipo detalle",
      "Código artículo",
      "Descripción",
      "Cantidad",
      "Unidad",
      "Costo unitario",
      "Subtotal",
      "Impuesto",
      "Total producto/cargo",
      "Base ISV 15%",
      "Base ISV 18%",
      "Base ISV 4%",
      "Base ISV 0%",
      "Total base",
      "ISV 15%",
      "ISV 18%",
      "Turismo 4%",
      "Total ISV",
      "Ret ISR 1%",
      "Ret ISR 12.5%",
      "Ret ISR 25%",
      "Ret ISV 15%",
      "Total retención fiscal",
      "Neto a pagar línea",
      "COD DE JOB",
      "COD FINANCIERO",
      "GRUPO FINANCIERO",
      "Moneda",
      "Total factura",
      "Anticipos",
      "Retención calidad %",
      "Retención calidad",
      "Amortización anticipo %",
      "Amortización anticipo",
      "Pronto pago %",
      "Pronto pago",
      "TC %",
      "TC",
      "Otras retenciones",
      "Descuentos documento",
      "Total retenciones",
      "Neto factura",
      "Pago efectuado en lote",
    ]);
  });

  it("uses the original SAP code when the current code has no financial group", () => {
    const catalog = new Map([
      [
        "SAP-ANTERIOR",
        {
          itemCode: "SAP-ANTERIOR",
          financialCode: "02019901",
          financialGroupDescription: "Materiales de construcción",
        },
      ],
    ]);

    expect(
      resolveTreasuryPaymentFinancialGroup(
        {
          currentSapItemCode: "SAP-NUEVO",
          originalSapItemCode: "SAP-ANTERIOR",
        },
        catalog
      )
    ).toEqual({
      itemCode: "SAP-NUEVO",
      financialCode: "02019901",
      financialGroupDescription: "Materiales de construcción",
    });
  });

  it("creates product and other-charge rows without duplicating invoice totals", () => {
    const rows = buildTreasuryPaymentsReportRows({
      payments: [payment],
      products: [
        {
          id: 1,
          invoiceId: 501,
          currentSapItemCode: "SAP-001",
          originalSapItemCode: "SAP-001",
          itemName: "BITACORA",
          quantity: 2,
          unit: "UND",
          unitPrice: 50,
          subtotal: 90,
          taxAmount: 10,
          total: 100,
          taxCode: "isv_15",
          taxBreakdown: null,
          financialCode: "02019901",
          financialGroupDescription: "Materiales de construcción",
        },
        {
          id: 2,
          invoiceId: 501,
          currentSapItemCode: "SAP-002",
          originalSapItemCode: "SAP-002",
          itemName: "TABLA PLASTICA",
          quantity: 1,
          unit: "UND",
          unitPrice: 35,
          subtotal: 35,
          taxAmount: 0,
          total: 35,
          taxCode: "exe",
          taxBreakdown: null,
          financialCode: "",
          financialGroupDescription: "SIN ASIGNAR",
        },
      ],
      otherCharges: [{ id: 1, invoiceId: 501, concept: "FLETE", amount: 15 }],
      retentions: [
        {
          id: 81,
          invoiceId: 501,
          invoiceItemId: null,
          retentionCode: "RET ISR 1%",
          retentionErpCode: "ISR1",
          description: "Retención ISR 1%",
          percentage: 1,
          baseAmount: 500,
          amount: 5,
        },
      ],
      documentAdjustments: [
        {
          invoiceId: 501,
          adjustmentType: "quality_retention",
          percentage: 2,
          baseAmount: 150,
          amount: 3,
        },
        {
          invoiceId: 501,
          adjustmentType: "prompt_payment_discount",
          percentage: 1.5,
          baseAmount: 150,
          amount: 2,
        },
      ],
    });

    expect(rows).toHaveLength(3);
    expect(rows.map(row => row.detailType)).toEqual([
      "PRODUCTO",
      "PRODUCTO",
      "OTRO CARGO",
    ]);
    expect(rows.reduce((sum, row) => sum + Number(row.itemTotal ?? 0), 0)).toBe(
      150
    );
    expect(rows.reduce((sum, row) => sum + row.baseIsv15, 0)).toBe(90);
    expect(rows.reduce((sum, row) => sum + row.baseIsv0, 0)).toBe(50);
    expect(rows.reduce((sum, row) => sum + row.isv15, 0)).toBe(10);
    expect(rows.reduce((sum, row) => sum + row.retIsr1, 0)).toBe(5);
    expect(rows.reduce((sum, row) => sum + row.lineNetPayable, 0)).toBe(140);
    expect(rows[0]).toMatchObject({
      financialCode: "02019901",
      baseIsv15: 90,
      isv15: 10,
      qualityRetentionPercentage: 2,
      qualityRetentionAmount: 3,
      promptPaymentPercentage: 1.5,
      promptPaymentAmount: 2,
      invoiceTotal: 150,
      advances: 5,
      otherRetentionTotal: 3,
      documentDiscountTotal: 2,
      totalRetentions: 8,
      invoiceNetPayable: 135,
      paidAmount: 60,
    });
    expect(rows[1]).toMatchObject({
      financialCode: "",
      financialGroupDescription: "SIN ASIGNAR",
      invoiceTotal: null,
      qualityRetentionAmount: null,
      paidAmount: null,
    });
    expect(rows[2]).toMatchObject({
      description: "FLETE",
      quantity: 1,
      itemTotal: 15,
      financialGroupDescription: "NO APLICA",
      invoiceTotal: null,
      paidAmount: null,
    });
    expect(
      rows.reduce((sum, row) => sum + Number(row.paidAmount ?? 0), 0)
    ).toBe(60);
  });

  it("keeps a paid invoice that has no stored detail", () => {
    const [row] = buildTreasuryPaymentsReportRows({
      payments: [payment],
      products: [],
      otherCharges: [],
    });

    expect(row).toMatchObject({
      detailType: "SIN DETALLE",
      description: "FACTURA SIN DETALLE",
      itemTotal: 150,
      paidAmount: 60,
    });
  });

  it("builds both sheets with typed costs and the complete Payments headers", () => {
    const payments: TreasuryPaymentsReportRow[] =
      buildTreasuryPaymentsReportRows({
        payments: [payment],
        products: [
          {
            id: 1,
            invoiceId: 501,
            currentSapItemCode: "SAP-001",
            originalSapItemCode: "SAP-001",
            itemName: "BITACORA",
            quantity: 2,
            unit: "UND",
            unitPrice: 50,
            subtotal: 90,
            taxAmount: 10,
            total: 100,
            taxCode: "isv_15",
            taxBreakdown: null,
            financialCode: "02019901",
            financialGroupDescription: "Materiales de construcción",
          },
        ],
        otherCharges: [],
      });
    const worksheets = buildTreasuryPaymentsWorksheets({
      batchColumns: [
        {
          header: "Lote",
          value: (row: { batchNumber: string }) => row.batchNumber,
        },
      ],
      batches: [{ batchNumber: "TES-2026-000121" }],
      payments,
    });
    const workbook = buildWorkbook(XLSX, worksheets);
    const roundTrip = XLSX.read(
      XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }),
      { cellDates: true, cellNF: true }
    );

    expect(roundTrip.SheetNames).toEqual(["Lotes de pago", "Payments"]);
    const paymentRows = XLSX.utils.sheet_to_json<unknown[]>(
      roundTrip.Sheets.Payments!,
      { header: 1, defval: "" }
    );
    expect(paymentRows[0]).toEqual([...TREASURY_PAYMENTS_HEADERS]);
    expect(paymentRows[0]).toHaveLength(48);
    expect(paymentRows[1]?.[6]).toBe("SAP-001");
    expect(paymentRows[1]?.[10]).toBe(50);
    expect(paymentRows[1]?.[14]).toBe(90);
    expect(paymentRows[1]?.[19]).toBe(10);
    expect(paymentRows[1]?.[28]).toBe(140);
    expect(paymentRows[1]?.[30]).toBe("02019901");
    expect(paymentRows[1]?.[31]).toBe("Materiales de construcción");
    expect(paymentRows[1]?.[47]).toBe(60);
    expect(roundTrip.Sheets.Payments?.C2?.z).toBe("dd/mm/yyyy");
    expect(roundTrip.Sheets.Payments?.K2?.z).toBe("#,##0.00");
    expect(roundTrip.Sheets.Payments?.O2?.z).toBe("#,##0.00");
    expect(roundTrip.Sheets.Payments?.AC2?.z).toBe("#,##0.00");
    expect(roundTrip.Sheets.Payments?.AV2?.z).toBe("#,##0.00");
  });
});
