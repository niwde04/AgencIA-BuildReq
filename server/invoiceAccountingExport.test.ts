import { describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import { buildWorkbook } from "../client/src/lib/excel-export";
import {
  buildInvoiceAccountingWorksheets,
  collectInvoiceAccountingExport,
} from "../client/src/lib/invoice-accounting-export";

type Row = Parameters<typeof buildInvoiceAccountingWorksheets>[0][number];
const row: Row = {
  id: 1,
  document: "FT-017-00000547",
  project: "017 - Proyecto",
  supplier: "=SUM(1,2)",
  rtn: "08011999000123",
  number: "000-001-01-00000547",
  documentDate: new Date("2026-09-28T00:00:00.000Z"),
  currency: "HNL",
  subtotal: 1000.1234,
  tax: 190,
  taxes: [
    { code: "isv_15", label: "ISV 15%", ratePercent: 15, amount: 150 },
    { code: "isv_4", label: "Turismo", ratePercent: 4, amount: 40 },
  ],
  otherCharges: 0,
  total: 1190.1234,
  retentions: {
    one: 10,
    ten: 0,
    services: 0,
    fifteen: 0,
    twentyFive: 0,
    other: 5,
  },
  discount: 10,
  net: 1165.1234,
  appliedAdvance: 100,
  paid: 200,
  balance: 865.1234,
  status: "pendiente_contabilizar",
  accountingComment: null,
  rejectionComment: null,
};
function page(items: Row[], total: number, pageNumber = 1) {
  return {
    items,
    total,
    page: pageNumber,
    pageSize: 50,
    totalPages: Math.max(1, Math.ceil(total / 50)),
  };
}

describe("accounting queue Excel export", () => {
  it("loads every page starting at page 1 and reports progress", async () => {
    const items = Array.from({ length: 125 }, (_, index) => ({
      ...row,
      id: index + 1,
    }));
    const fetch = vi.fn(async (p: number, size: number) =>
      page(items.slice((p - 1) * size, p * size), items.length, p)
    );
    const progress = vi.fn();
    expect(await collectInvoiceAccountingExport(fetch, progress)).toEqual(
      items
    );
    expect(fetch.mock.calls).toEqual([
      [1, 50],
      [2, 50],
      [3, 50],
    ]);
    expect(progress.mock.calls).toEqual([
      [50, 125],
      [100, 125],
      [125, 125],
    ]);
  });
  it("refuses a partial file when a later page fails", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        page(
          Array.from({ length: 50 }, (_, i) => ({ ...row, id: i + 1 })),
          51
        )
      )
      .mockRejectedValueOnce(new Error("Sin conexión"));
    await expect(collectInvoiceAccountingExport(fetch)).rejects.toThrow(
      "Sin conexión"
    );
  });
  it.each(["total", "duplicate", "short"])(
    "refuses inconsistent pagination: %s",
    async scenario => {
      const first = Array.from({ length: 50 }, (_, i) => ({
        ...row,
        id: i + 1,
      }));
      const second =
        scenario === "short"
          ? []
          : [{ ...row, id: scenario === "duplicate" ? 1 : 51 }];
      const fetch = vi
        .fn()
        .mockResolvedValueOnce(page(first, 51))
        .mockResolvedValueOnce(page(second, scenario === "total" ? 52 : 51, 2));
      await expect(collectInvoiceAccountingExport(fetch)).rejects.toThrow(
        /nuevamente/
      );
    }
  );
  it("handles no matches and bounds large exports without truncation", async () => {
    expect(
      await collectInvoiceAccountingExport(async () => page([], 0))
    ).toEqual([]);
    const fetch = vi.fn(async () => page([], 10001));
    await expect(collectInvoiceAccountingExport(fetch)).rejects.toThrow(
      /Filtra/
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("writes real XLSX numbers, preserves fiscal text, and includes the saved ISV breakdown", () => {
    const workbook = buildWorkbook(
      XLSX,
      buildInvoiceAccountingWorksheets([
        row,
        {
          ...row,
          id: 2,
          currency: "USD",
          status: "rechazada",
          rejectionComment: "Corregir soporte",
        },
      ])
    );
    const result = XLSX.read(
      XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }),
      { type: "buffer", cellNF: true }
    );
    const sheet = result.Sheets["Facturas por contabilizar"];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);
    expect(rows[0]).toMatchObject({
      Documento: row.document,
      RTN: row.rtn,
      "Nro. Factura": row.number,
      "Fecha del Documento": "28/09/2026",
      Moneda: "HNL",
      Subtotal: 1000.1234,
      ISV: 190,
      "Neto a Pagar": 1165.1234,
      "Saldo Pendiente": 865.1234,
      "Estado de pago": "Parcial",
      Estatus: "Pendiente de contabilizar",
    });
    expect(rows[1]).toMatchObject({
      Moneda: "USD",
      Estatus: "Rechazada",
      "Motivo de rechazo": "Corregir soporte",
    });
    expect(sheet.D2).toMatchObject({ t: "s", v: row.rtn });
    expect(sheet.C2.t).toBe("s");
    expect(sheet.C2.f).toBeUndefined();
    expect(sheet.H2).toMatchObject({ t: "n", v: 1000.1234, z: "#,##0.00" });
    expect(Object.keys(rows[0])).not.toContain("Acciones");
    const taxes = XLSX.utils.sheet_to_json<Record<string, unknown>>(
      result.Sheets["Desglose ISV"]
    );
    expect(taxes).toHaveLength(4);
    expect(taxes[1]).toMatchObject({
      Documento: row.document,
      "Código impuesto": "isv_4",
      Descripción: "Turismo",
      "Tasa %": 4,
      Importe: 40,
    });
  });
});
