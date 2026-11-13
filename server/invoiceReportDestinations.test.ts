import { afterEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import * as XLSX from "xlsx";
import * as db from "./db";
import { buildSystemWorkbookPayload } from "../shared/system-workbook-report";
import {
  buildSystemInvoicesWorkbook,
  buildSystemWorkbook,
} from "../client/src/lib/dmc-export";

const { database } = vi.hoisted(() => ({ database: { select: vi.fn() } }));
vi.mock("drizzle-orm/node-postgres", () => ({ drizzle: () => database }));
vi.mock("pg", () => ({
  Pool: class {
    query() {}
    on() {}
  },
}));

const expectedDestinations = [
  "SP-01 - Cimentación",
  "SP-02 - Estructura",
  "SP-03 - Acabados",
  "",
  "Subproyecto #99",
  "",
  "",
  "SP-04 - Iluminación",
  "SP-B - Bodega",
];

function mockReportDatabase() {
  const sourceRows = [
    {
      invoiceTargetType: "subproyecto",
      invoiceSubprojectId: 1,
      invoiceSubprojectCode: "SP-01",
      invoiceSubprojectName: "Cimentación",
      directTargetType: "subproyecto",
      directSubprojectId: 2,
      directSubprojectCode: "ANTERIOR",
      directSubprojectName: "Destino anterior",
    },
    {
      directTargetType: "subproyecto",
      directSubprojectId: 2,
      directSubprojectCode: "SP-02",
      directSubprojectName: "Estructura",
      invoiceTargetType: "subproyecto",
    },
    {
      directTargetType: "subproyecto",
      directSubprojectId: 2,
      directSubprojectCode: "ANTERIOR",
      directSubprojectName: "Destino anterior",
      purchaseRequestTargetType: "subproyecto",
      purchaseRequestSubprojectId: 3,
      purchaseRequestSubprojectCode: "SP-03",
      purchaseRequestSubprojectName: "Acabados",
    },
    {
      invoiceTargetType: "activo_fijo",
      directTargetType: "subproyecto",
      directSubprojectId: 2,
      directSubprojectCode: "SP-02",
      directSubprojectName: "Estructura",
    },
    {
      invoiceTargetType: "subproyecto",
      invoiceSubprojectId: 99,
      directTargetType: "subproyecto",
      directSubprojectId: 2,
      directSubprojectCode: "SP-02",
      directSubprojectName: "Estructura",
    },
    {
      purchaseRequestTargetType: "activo_fijo",
      directTargetType: "subproyecto",
      directSubprojectId: 2,
      directSubprojectCode: "SP-02",
      directSubprojectName: "Estructura",
    },
    {},
    {
      purchaseRequestSourceTargetType: "subproyecto",
      purchaseRequestSourceSubprojectId: 5,
      purchaseRequestSourceSubprojectCode: "SP-04",
      purchaseRequestSourceSubprojectName: "Iluminación",
    },
    {
      invoiceTargetType: "subproyecto",
      invoiceSubprojectId: 4,
      invoiceSubprojectCode: "SP-B",
      invoiceSubprojectName: "Bodega",
    },
  ].map((row, index) => ({
    invoiceId: index === 8 ? 102 : 101,
    invoiceItemId: index + 1,
    invoiceTargetType: null,
    invoiceSubprojectId: null,
    invoiceSubprojectCode: null,
    invoiceSubprojectName: null,
    directTargetType: null,
    directSubprojectId: null,
    directSubprojectCode: null,
    directSubprojectName: null,
    purchaseRequestTargetType: null,
    purchaseRequestSubprojectId: null,
    purchaseRequestSubprojectCode: null,
    purchaseRequestSubprojectName: null,
    directRequestId: null,
    directRequestNumber: null,
    purchaseRequestRequestId: null,
    purchaseRequestRequestNumber: null,
    ...row,
  }));
  const results: unknown[][] = [
    [101, 102].map(id => ({
      invoice: {
        id,
        invoiceDocumentNumber: "FT-001-" + id,
        invoiceNumber: "000-001-01-" + String(id).padStart(8, "0"),
        status: "registrada",
        currency: "HNL",
        notes: id === 101 ? "Compra de materiales" : null,
        subtotal: id === 101 ? "800" : "100",
        taxAmount: "0",
        total: id === 101 ? "800" : "100",
        netPayable: id === 101 ? "800" : "100",
      },
      project: { id: 1, code: "001", name: "Proyecto" },
      supplier: { id: 1, name: "Proveedor" },
      receipt: null,
      purchaseOrder: null,
    })),
    sourceRows.map(row => ({
      item: {
        id: row.invoiceItemId,
        invoiceId: row.invoiceId,
        itemName: "Artículo " + row.invoiceItemId,
        targetType: row.invoiceTargetType,
        subProjectId: row.invoiceSubprojectId,
        subtotal: "100",
        taxAmount: "0",
        total: "100",
        taxBreakdown: [],
      },
      articleDescription: null,
      financialGroupCode: null,
      financialGroupDescription: null,
    })),
    [],
    [],
    [],
    sourceRows,
  ];
  const queries: any[] = [];
  database.select.mockImplementation(() => {
    const rows = results[queries.length];
    if (!rows) throw new Error("Unexpected query");
    const query: any = {
      from: vi.fn(() => query),
      leftJoin: vi.fn(() => query),
      where: vi.fn(() => query),
      orderBy: vi.fn(() => query),
      then: (resolve: any, reject: any) =>
        Promise.resolve(rows).then(resolve, reject),
    };
    queries.push(query);
    return query;
  });
  vi.stubEnv("DATABASE_URL", "postgresql://mock:mock@127.0.0.1/mock");
  return queries;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  database.select.mockReset();
});

describe("invoice report destinations", () => {
  it("resolves each invoice line before its origins, without mixing subprojects or fixed assets", async () => {
    const queries = mockReportDatabase();
    const sources = await db.listDmcReportSourceInvoices({
      invoiceIds: [101, 102],
      projectIds: [1],
    });
    expect(
      sources.flatMap(invoice =>
        invoice.items.map(item => item.subProjectLabel)
      )
    ).toEqual(expectedDestinations);
    expect(
      new PgDialect().sqlToQuery(queries[0].where.mock.calls[0][0]).params
    ).toEqual([101, 102, 1]);
    expect(
      new PgDialect().sqlToQuery(queries[5].where.mock.calls[0][0]).params
    ).toEqual([101, 102]);
  });

  it("exports each destination beside Notes in both XLSX files while preserving money and invoice metadata", async () => {
    mockReportDatabase();
    const sources = await db.listDmcReportSourceInvoices({
      invoiceIds: [101, 102],
      projectIds: [1],
    });
    const params = { generatedAt: new Date("2026-11-13T12:00:00.000Z") };
    const payload = buildSystemWorkbookPayload(sources, [], params);
    const withoutDestinations = buildSystemWorkbookPayload(
      sources.map(invoice => ({
        ...invoice,
        items: invoice.items.map(item => ({
          ...item,
          subProjectLabel: undefined,
        })),
      })),
      [],
      params
    );
    expect(payload.summary).toEqual(withoutDestinations.summary);
    const stripDestination = (rows: typeof payload.invoices) =>
      rows.map(row =>
        Object.fromEntries(
          Object.entries(row).filter(([key]) => key !== "Destino (Subproyecto)")
        )
      );
    expect(stripDestination(payload.invoices)).toEqual(
      stripDestination(withoutDestinations.invoices)
    );
    expect(payload.invoices.map(row => row["Destino (Subproyecto)"])).toEqual(
      expectedDestinations
    );
    for (const build of [buildSystemInvoicesWorkbook, buildSystemWorkbook]) {
      const workbook = build(XLSX, JSON.parse(JSON.stringify(payload)));
      const restored = XLSX.read(
        XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }),
        { type: "buffer" }
      );
      const sheet = restored.Sheets["Registro Facturacion"];
      const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
        header: 1,
        defval: "",
      });
      const column = rows[1].indexOf("Destino (Subproyecto)");
      expect(rows[1].slice(-2)).toEqual(["Notas", "Destino (Subproyecto)"]);
      expect(rows.slice(2, 11).map(row => row[column])).toEqual(
        expectedDestinations
      );
      expect(rows[11][column]).toBe("");
      expect(rows.slice(2, 10).map(row => row[column - 1])).toEqual(
        Array(8).fill("Compra de materiales")
      );
      expect(rows[10][column - 1]).toBe("");
      expect(
        workbook.Sheets["Registro Facturacion"]["!cols"]?.[column]?.wch
      ).toBe(42);
      expect(sheet[XLSX.utils.encode_cell({ r: 2, c: column })]).toMatchObject({
        t: "s",
        v: expectedDestinations[0],
      });
    }
  });

  it("retains the known subprojects for an invoice without article lines", async () => {
    mockReportDatabase();
    const [source] = await db.listDmcReportSourceInvoices({
      invoiceIds: [101, 102],
    });
    const payload = buildSystemWorkbookPayload(
      [
        {
          ...source,
          items: [],
          subProjectLabels: [
            "SP-01 - Cimentación",
            "SP-01 - Cimentación",
            "SP-02 - Estructura",
          ],
        },
      ],
      []
    );
    expect(payload.invoices).toHaveLength(1);
    expect(payload.invoices[0]["Destino (Subproyecto)"]).toBe(
      "SP-01 - Cimentación; SP-02 - Estructura"
    );
  });
});
