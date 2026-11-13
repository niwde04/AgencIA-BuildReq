import { afterEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import * as db from "./db";
import { listTreasuryBatches } from "./treasury";
import { matchesTreasuryBatchSearch } from "../shared/treasury";

function mockBatchDatabase() {
  const batch = (id: number, projectId: number, paymentKind: string) => ({
    batch: {
      id,
      projectId,
      paymentKind,
      batchNumber: "TES-2026-" + id,
      status: "cerrado",
    },
    project: {
      id: projectId,
      code: String(projectId),
      name: "Proyecto " + projectId,
    },
  });
  const item = (
    batchId: number,
    sourceType: string,
    bankReference: string | null,
    status = "contabilizada"
  ) => ({
    batchId,
    sourceType,
    bankReference,
    status,
    invoiceDocumentNumber: "FT-001-00000128",
    invoiceNumber: "G190599253",
    supplierId: 1,
    requestedAmount: "10.00",
    approvedAmount: "10.00",
    bankPaidAmount: "10.00",
    bankPaidDate: "2026-11-05",
  });
  const results: unknown[][] = [
    [
      batch(754, 1, "invoice"),
      batch(755, 1, "purchase_order_advance"),
      batch(756, 1, "quality_retention_release"),
      batch(757, 2, "invoice"),
    ],
    [
      { batchId: 754, id: 1, code: "001", name: "Oficina Central" },
      { batchId: 757, id: 2, code: "002", name: "Otro proyecto" },
    ],
    [{ batchId: 755, id: 1, code: "001", name: "Oficina Central" }],
    [
      item(754, "invoice", "  FT263033PW74  "),
      item(754, "invoice", "FT263033PW74"),
      item(754, "invoice", null),
      item(754, "invoice", "   "),
      item(754, "invoice", "EXCLUDED-REF", "excluida"),
      item(755, "purchase_order_advance", "ANT-REF"),
      item(756, "quality_retention_release", "CAL-REF"),
      item(757, "invoice", "OTHER-PROJECT-REF"),
    ],
    [],
  ];
  const queries: any[] = [];
  const select = vi.fn(() => {
    const rows = results[queries.length];
    if (!rows) throw new Error("Unexpected database query");
    const query: any = {
      from: vi.fn(() => query),
      innerJoin: vi.fn(() => query),
      where: vi.fn(() => query),
      orderBy: vi.fn(() => query),
      then: (resolve: any, reject: any) =>
        Promise.resolve(rows).then(resolve, reject),
    };
    queries.push(query);
    return query;
  });
  vi.spyOn(db, "getDb").mockResolvedValue({ select } as any);
  return queries;
}

afterEach(() => vi.restoreAllMocks());

describe("treasury batch bank reference metadata", () => {
  it("includes unique saved references for invoice, advance and quality payments", async () => {
    mockBatchDatabase();
    const rows = await listTreasuryBatches({ projectIds: [1] });
    expect(rows.map(row => row.bankReferences)).toEqual([
      ["FT263033PW74"],
      ["ANT-REF"],
      ["CAL-REF"],
    ]);
    expect(rows[0]).toMatchObject({
      itemCount: 4,
      requestedTotal: 40,
      approvedTotal: 40,
      paidTotal: 40,
    });
    expect(
      rows
        .filter(row =>
          matchesTreasuryBatchSearch({
            search: "ft263033",
            values: [],
            bankReferences: row.bankReferences,
          })
        )
        .map(row => row.batch.id)
    ).toEqual([754]);
    expect(
      rows.some(row =>
        matchesTreasuryBatchSearch({
          search: "EXCLUDED-REF",
          values: [],
          bankReferences: row.bankReferences,
        })
      )
    ).toBe(false);
  });

  it("only reads and exposes bank references from batches within the project scope", async () => {
    const queries = mockBatchDatabase();
    const rows = await listTreasuryBatches({ projectIds: [1] });
    expect(rows.map(row => row.batch.id)).toEqual([754, 755, 756]);
    expect(rows.flatMap(row => row.bankReferences)).not.toContain(
      "OTHER-PROJECT-REF"
    );
    const itemFilter = new PgDialect().sqlToQuery(
      queries[3].where.mock.calls[0][0]
    );
    expect(itemFilter.params).toEqual([754, 755, 756]);
  });
});
