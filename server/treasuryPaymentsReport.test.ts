import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { buildWorkbook } from "../client/src/lib/excel-export";
import { buildTreasuryPaymentsWorksheets } from "../client/src/lib/treasury-payments-export";
import {
  TREASURY_PAYMENTS_HEADERS,
  buildTreasuryPaymentPurchaseDescription,
  type TreasuryPaymentsReportRow,
} from "../shared/treasury-payments-report";

describe("treasury Payments report", () => {
  it("concatenates invoice items with their quantities", () => {
    expect(
      buildTreasuryPaymentPurchaseDescription([
        { quantity: "1.00", itemName: "BITACORA" },
        { quantity: "2.50", itemName: "TABLA PLASTICA" },
      ])
    ).toBe("(1) BITACORA / (2.5) TABLA PLASTICA");
  });

  it("builds both sheets and keeps COD FINANCIERO empty", () => {
    const payments: TreasuryPaymentsReportRow[] = [
      {
        batchNumber: "TES-2026-000121",
        bankReference: "FT262128BSXF",
        invoiceDate: new Date("2026-07-27T12:00:00.000Z"),
        invoiceNumber: "000-002-01-00035576",
        supplierName: "PROVEEDOR DE PRUEBA",
        purchaseDescription: "(1) BITACORA",
        jobCode: "018_003",
        financialCode: "",
        invoiceTotal: 3_000,
        advances: 0,
        totalRetentions: 30,
        netPayable: 2_970,
        currency: "HNL",
      },
    ];
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
    expect(paymentRows[1]?.[7]).toBe("");
    expect(paymentRows[1]?.[8]).toBe(3_000);
    expect(paymentRows[1]?.[11]).toBe(2_970);
    expect(roundTrip.Sheets.Payments?.I2?.z).toBe("#,##0.00");
  });
});
