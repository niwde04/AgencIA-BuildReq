import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import * as db from "./db";
import * as treasury from "./treasury";
import { getInvoiceReportPaymentMetadata } from "./invoiceReportPayments";

vi.mock("./db", () => ({ getDb: vi.fn() }));
vi.mock("./treasury", () => ({ getTreasuryInvoiceReportPayments: vi.fn() }));

type AdvancePayment = {
  invoiceId: number;
  batchNumber: string;
  bankReference: string | null;
  paidDate: Date | string | null;
};

const bankDate = new Date("2026-09-10T00:00:00");
const advancePayment: AdvancePayment = {
  invoiceId: 1938,
  batchNumber: "TES-2026-000240",
  bankReference: "FT26253PPMML",
  paidDate: bankDate,
};

function databaseRows(rows: AdvancePayment[] = []) {
  const chain = {
    innerJoin: vi.fn(() => chain),
    where: vi.fn().mockResolvedValue(rows),
  };
  const from = vi.fn(() => chain);
  const select = vi.fn(() => ({ from }));
  vi.mocked(db.getDb).mockResolvedValue({ select } as any);
  return { select, from, ...chain };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(treasury.getTreasuryInvoiceReportPayments).mockResolvedValue(
    new Map()
  );
});

describe("invoice report payment metadata", () => {
  it("does not read payments or database for an empty authorized invoice set", async () => {
    expect(await getInvoiceReportPaymentMetadata([])).toEqual(new Map());
    expect(db.getDb).not.toHaveBeenCalled();
    expect(treasury.getTreasuryInvoiceReportPayments).not.toHaveBeenCalled();
  });

  it("keeps the existing unavailable-database behavior without inventing payments", async () => {
    vi.mocked(db.getDb).mockResolvedValue(null);
    expect(await getInvoiceReportPaymentMetadata([1938])).toEqual(new Map());
    expect(treasury.getTreasuryInvoiceReportPayments).not.toHaveBeenCalled();
  });

  it("keeps direct payment metadata and excludes its monetary amount", async () => {
    databaseRows();
    const direct = {
      batchId: 12,
      batchNumber: "TES-DIRECT",
      bankReference: "DIRECT-REF",
      paidDate: bankDate,
      amount: 90898.27,
    };
    vi.mocked(treasury.getTreasuryInvoiceReportPayments).mockResolvedValue(
      new Map([[1938, [direct]]])
    );
    const original = structuredClone(direct);
    const result = await getInvoiceReportPaymentMetadata([1938]);
    expect(result.get(1938)).toEqual([
      {
        batchNumber: "TES-DIRECT",
        bankReference: "DIRECT-REF",
        paidDate: "2026-09-10",
      },
    ]);
    expect(result.get(1938)?.[0]).not.toHaveProperty("amount");
    expect(direct).toEqual(original);
  });

  it("recovers Cesar's applied advance bank trace without creating a second payment amount", async () => {
    databaseRows([advancePayment]);
    const result = await getInvoiceReportPaymentMetadata([1938]);
    expect(result.get(1938)).toEqual([
      {
        batchNumber: "TES-2026-000240",
        bankReference: "FT26253PPMML",
        paidDate: "2026-09-10",
      },
    ]);
    expect(Object.keys(result.get(1938)![0]).sort()).toEqual([
      "bankReference",
      "batchNumber",
      "paidDate",
    ]);
  });

  it("merges mixed payments by bank date rather than append order", async () => {
    databaseRows([advancePayment]);
    const later = new Date("2026-09-25T00:00:00");
    vi.mocked(treasury.getTreasuryInvoiceReportPayments).mockResolvedValue(
      new Map([
        [
          1938,
          [
            {
              batchId: 99,
              batchNumber: "TES-DIRECT",
              bankReference: "DIRECT",
              paidDate: later,
              amount: 20,
            },
          ],
        ],
      ])
    );
    const result = await getInvoiceReportPaymentMetadata([1938]);
    expect(result.get(1938)?.map(payment => payment.paidDate)).toEqual([
      "2026-09-10",
      "2026-09-25",
    ]);
    expect(result.get(1938)?.every(payment => !("amount" in payment))).toBe(
      true
    );
  });

  it("deduplicates the same trace reached through multiple applied advances", async () => {
    databaseRows([
      advancePayment,
      { ...advancePayment },
      {
        ...advancePayment,
        batchNumber: " TES-2026-000240 ",
        bankReference: " FT26253PPMML ",
      },
    ]);
    const result = await getInvoiceReportPaymentMetadata([1938]);
    expect(result.get(1938)).toHaveLength(1);
  });

  it("retains different references from separate disbursements in a shared batch", async () => {
    databaseRows([
      advancePayment,
      { ...advancePayment, bankReference: "SECOND-DISBURSEMENT" },
    ]);
    const result = await getInvoiceReportPaymentMetadata([1938]);
    expect(result.get(1938)?.map(payment => payment.bankReference)).toEqual([
      "FT26253PPMML",
      "SECOND-DISBURSEMENT",
    ]);
  });

  it("keeps all posted disbursements of the applied advance in chronological order", async () => {
    const laterDate = new Date("2026-09-25T00:00:00");
    databaseRows([
      {
        ...advancePayment,
        batchNumber: "TES-LATER",
        bankReference: "LATER",
        paidDate: laterDate,
      },
      advancePayment,
    ]);
    const result = await getInvoiceReportPaymentMetadata([1938]);
    expect(result.get(1938)?.map(payment => payment.batchNumber)).toEqual([
      "TES-2026-000240",
      "TES-LATER",
    ]);
    expect(result.get(1938)?.at(-1)?.paidDate).toBe("2026-09-25");
    expect(result.get(1938)?.every(payment => !("amount" in payment))).toBe(
      true
    );
  });

  it("shares trace information across invoices funded by the same advance without distributing its full amount", async () => {
    databaseRows([advancePayment, { ...advancePayment, invoiceId: 1939 }]);
    const result = await getInvoiceReportPaymentMetadata([1938, 1939]);
    expect(result.get(1938)).toEqual(result.get(1939));
    expect(result.get(1938)).not.toBe(result.get(1939));
    for (const payments of result.values()) {
      expect(payments[0]).not.toHaveProperty("amount");
      expect(payments[0]).not.toHaveProperty("bankPaidAmount");
    }
  });

  it("uses only authorized distinct invoice IDs in both data sources", async () => {
    const query = databaseRows([
      advancePayment,
      { ...advancePayment, invoiceId: 9999 },
    ]);
    const result = await getInvoiceReportPaymentMetadata([1938, 1938, 1939]);
    expect(treasury.getTreasuryInvoiceReportPayments).toHaveBeenCalledWith([
      1938, 1939,
    ]);
    const compiled = new PgDialect().sqlToQuery(query.where.mock.calls[0][0]);
    expect(compiled.params).toEqual(expect.arrayContaining([1938, 1939]));
    expect(compiled.params).not.toContain(9999);
    expect(result.has(9999)).toBe(false);
  });

  it("queries only real direct applications and positive posted payments of uncancelled advances", async () => {
    const query = databaseRows();
    await getInvoiceReportPaymentMetadata([1938]);
    const compiled = new PgDialect().sqlToQuery(query.where.mock.calls[0][0]);
    expect(compiled.sql).toContain(
      '"purchaseOrderAdvanceApplications"."invoiceId" in'
    );
    expect(compiled.sql).toContain(
      '"purchaseOrderAdvanceApplications"."applicationMode" ='
    );
    expect(compiled.sql).toContain(
      '"purchaseOrderAdvances"."cancelledAt" is null'
    );
    expect(compiled.sql).toContain('"treasuryPaymentItems"."sourceType" =');
    expect(compiled.sql).toContain('"treasuryPaymentItems"."status" =');
    expect(compiled.sql).toContain('"treasuryPaymentItems"."bankPaidAmount" >');
    expect(compiled.params).toEqual([
      1938,
      "direct",
      "purchase_order_advance",
      "contabilizada",
      "0",
    ]);
    expect(query.innerJoin).toHaveBeenCalledTimes(3);
    const joins = query.innerJoin.mock.calls.map(
      call => new PgDialect().sqlToQuery(call[1]).sql
    );
    expect(joins[0]).toContain(
      '"purchaseOrderAdvanceApplications"."purchaseOrderAdvanceId"'
    );
    expect(joins[1]).toContain(
      '"treasuryPaymentItems"."purchaseOrderAdvanceId"'
    );
    expect(joins[2]).toContain('"treasuryPaymentItems"."batchId"');
    expect(Object.keys(query.select.mock.calls[0][0])).not.toContain("amount");
  });

  it("does not substitute the application date for a missing bank payment date", async () => {
    databaseRows([{ ...advancePayment, paidDate: null }]);
    const result = await getInvoiceReportPaymentMetadata([1938]);
    expect(result.get(1938)?.[0].paidDate).toBeNull();
  });

  it("preserves the PostgreSQL DATE calendar day when Drizzle returns midnight UTC", async () => {
    databaseRows([{ ...advancePayment, paidDate: "2026-09-10" }]);
    vi.mocked(treasury.getTreasuryInvoiceReportPayments).mockResolvedValue(
      new Map([
        [
          1938,
          [
            {
              batchId: 12,
              batchNumber: "TES-DIRECT",
              bankReference: "DIRECT",
              paidDate: new Date("2026-09-10T00:00:00.000Z"),
              amount: 20,
            },
          ],
        ],
      ])
    );
    const result = await getInvoiceReportPaymentMetadata([1938]);
    expect(result.get(1938)?.map(payment => payment.paidDate)).toEqual([
      "2026-09-10",
      "2026-09-10",
    ]);
    expect(
      JSON.parse(JSON.stringify(result.get(1938))).every(
        (payment: { paidDate: string }) => payment.paidDate === "2026-09-10"
      )
    ).toBe(true);
  });

  it("propagates a payment metadata query failure instead of silently exporting incomplete data", async () => {
    const query = databaseRows();
    query.where.mockRejectedValue(new Error("Metadata query failed"));
    await expect(getInvoiceReportPaymentMetadata([1938])).rejects.toThrow(
      "Metadata query failed"
    );
  });
});
