import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  buildTreasuryMoneySummary,
  getTreasuryPaymentStatus,
  roundTreasuryMoney,
} from "../shared/treasury";
import {
  getTreasuryReopenTargetStatus,
  parseTreasuryBankWorkbook,
  TreasuryRuleError,
} from "./treasury";

function bankWorkbook(rows: Array<Record<string, unknown>>) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(rows),
    "Pagos"
  );
  return Buffer.from(
    XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer
  );
}

describe("treasury partial-payment math", () => {
  it("keeps the whole invoice available before the first payment", () => {
    expect(
      buildTreasuryMoneySummary({
        currency: "HNL",
        invoiceNetPayable: "1250.5000",
      })
    ).toEqual({
      currency: "HNL",
      invoiceNetPayable: 1250.5,
      paidAmount: 0,
      reservedAmount: 0,
      availableAmount: 1250.5,
      paymentStatus: "sin_pago",
    });
  });

  it("subtracts prior payments and an active reservation from the available balance", () => {
    expect(
      buildTreasuryMoneySummary({
        currency: "USD",
        invoiceNetPayable: 1000,
        paidAmount: 325.25,
        reservedAmount: 125.5,
      })
    ).toMatchObject({
      paidAmount: 325.25,
      reservedAmount: 125.5,
      availableAmount: 549.25,
      paymentStatus: "parcialmente_pagada",
    });
  });

  it("never exposes a negative balance after the invoice is fully paid", () => {
    expect(
      buildTreasuryMoneySummary({
        currency: "HNL",
        invoiceNetPayable: 500,
        paidAmount: 500,
        reservedAmount: 25,
      })
    ).toMatchObject({ availableAmount: 0, paymentStatus: "pagada" });
  });

  it("uses four-decimal precision for abonos", () => {
    expect(roundTreasuryMoney(10.123456)).toBe(10.1235);
    expect(getTreasuryPaymentStatus(100, 99.9999)).toBe("pagada");
    expect(getTreasuryPaymentStatus(100, 99.99)).toBe("parcialmente_pagada");
  });
});

describe("treasury bank workbook", () => {
  it("parses paid and rejected lines from the bank response", () => {
    const rows = parseTreasuryBankWorkbook(
      bankWorkbook([
        {
          LOTE: "TES-2026-000001",
          VERSION: 2,
          LINEA_ID: 10,
          ESTADO_BANCO: "PAGADO",
          MONTO_PAGADO: 250.125,
          FECHA_PAGO: "2026-07-20",
          REFERENCIA_BANCO: "REF-100",
          COMENTARIO_BANCO: "Aplicado",
        },
        {
          LOTE: "TES-2026-000001",
          VERSION: 2,
          LINEA_ID: 11,
          ESTADO_BANCO: "RECHAZADO",
          MONTO_PAGADO: "",
          FECHA_PAGO: "",
          REFERENCIA_BANCO: "",
          COMENTARIO_BANCO: "Cuenta inválida",
        },
      ])
    );

    expect(rows[0]).toMatchObject({
      itemId: 10,
      bankStatus: "PAGADO",
      paidAmount: 250.125,
      bankReference: "REF-100",
    });
    expect(rows[0]?.paidDate).toBeInstanceOf(Date);
    expect(rows[1]).toMatchObject({
      itemId: 11,
      bankStatus: "RECHAZADO",
      paidAmount: 0,
      paidDate: null,
    });
  });

  it("rejects an unknown bank status", () => {
    expect(() =>
      parseTreasuryBankWorkbook(
        bankWorkbook([
          {
            LOTE: "TES-2026-000001",
            VERSION: 1,
            LINEA_ID: 10,
            ESTADO_BANCO: "PENDIENTE",
          },
        ])
      )
    ).toThrow(TreasuryRuleError);
  });
});

describe("treasury closed batch reopening", () => {
  it("returns a fully rejected closed batch to the bank-response stage", () => {
    expect(
      getTreasuryReopenTargetStatus("cerrado", [
        "rechazada_banco",
        "excluida",
      ])
    ).toBe("enviado_banco");
  });

  it("does not reopen a batch with paid or accounted lines", () => {
    expect(() =>
      getTreasuryReopenTargetStatus("cerrado", [
        "rechazada_banco",
        "contabilizada",
      ])
    ).toThrow("tiene pagos realizados o contabilizados");
  });

  it("does not reopen a batch that is not closed", () => {
    expect(() =>
      getTreasuryReopenTargetStatus("enviado_banco", ["rechazada_banco"])
    ).toThrow("Solo se puede reabrir un lote cerrado");
  });
});
