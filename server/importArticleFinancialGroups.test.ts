import { describe, expect, it } from "vitest";
import {
  applyFinancialGroupImportPlan,
  buildFinancialGroupImportPlan,
  parseFinancialGroupSheetRows,
  type ExistingFinancialGroup,
  type ExistingFinancialGroupArticle,
} from "../scripts/import-article-financial-groups";

const headerRows = [
  ["Codigo de articulo (SAP)", null, null],
  ["CODIGO", "Descripcion", "CodN4"],
];

function article(
  id: number,
  itemCode: string,
  financialGroupCode: string | null
): ExistingFinancialGroupArticle {
  return {
    id,
    itemCode,
    description: `Articulo ${itemCode}`,
    itemGroup: "Grupo existente",
    financialGroupCode,
    tipoArticulo: 1,
    isActive: true,
    createdById: 8,
    updatedById: 9,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  };
}

function group(
  financialGroupCode: string,
  isActive = true
): ExistingFinancialGroup {
  return {
    financialGroupCode,
    financialGroupDescription: `Grupo ${financialGroupCode}`,
    isActive,
  };
}

describe("import-article-financial-groups", () => {
  it("reads the second header row and keeps leading zero codes", () => {
    const result = parseFinancialGroupSheetRows([
      ...headerRows,
      ["010100001", "DIESEL", "02020301"],
    ]);

    expect(result.headerRowNumber).toBe(2);
    expect(result.parsedRows).toEqual([
      {
        rowNumber: 3,
        itemCode: "010100001",
        financialGroupCode: "02020301",
      },
    ]);
    expect(result.validationErrors).toHaveLength(0);
  });

  it("skips blank CodN4 values without clearing existing assignments", () => {
    const result = parseFinancialGroupSheetRows([
      ...headerRows,
      ["010100001", "DIESEL", null],
    ]);

    expect(result.parsedRows).toHaveLength(0);
    expect(result.skippedRows[0]?.reason).toContain("no se limpiara");
    expect(result.validationErrors).toHaveLength(0);
  });

  it("blocks conflicting financial groups for the same article", () => {
    const result = parseFinancialGroupSheetRows([
      ...headerRows,
      ["010100001", "DIESEL", "02020301"],
      ["010100001", "DIESEL", "02020302"],
    ]);

    expect(result.conflictingDuplicateGroups).toHaveLength(1);
    expect(result.validationErrors[0]).toContain("010100001");
  });

  it("plans updates and unchanged rows while only reporting missing articles", () => {
    const parsed = parseFinancialGroupSheetRows([
      ...headerRows,
      ["010100001", "DIESEL", "02020301"],
      ["010100002", "DIESEL", "02020301"],
      ["010100003", "NO EXISTE", "02020301"],
    ]);
    const plan = buildFinancialGroupImportPlan(
      parsed,
      [article(1, "010100001", null), article(2, "010100002", "02020301")],
      [group("02020301")]
    );

    expect(plan.updates.map(row => row.itemCode)).toEqual(["010100001"]);
    expect(plan.unchanged.map(row => row.itemCode)).toEqual(["010100002"]);
    expect(plan.missingCatalogCodes.map(row => row.itemCode)).toEqual([
      "010100003",
    ]);
    expect(plan.validationErrors).toHaveLength(0);
  });

  it("blocks nonexistent and inactive financial groups", () => {
    const parsed = parseFinancialGroupSheetRows([
      ...headerRows,
      ["010100001", "DIESEL", "02020301"],
      ["010100002", "DIESEL", "02020302"],
    ]);
    const plan = buildFinancialGroupImportPlan(
      parsed,
      [article(1, "010100001", null), article(2, "010100002", null)],
      [group("02020301", false)]
    );

    expect(plan.missingFinancialGroups).toEqual(["02020302"]);
    expect(plan.inactiveFinancialGroups).toEqual(["02020301"]);
    expect(plan.validationErrors).toHaveLength(2);
    expect(plan.updates).toHaveLength(0);
  });

  it("updates only financialGroupCode and commits after verification", async () => {
    const queries: string[] = [];
    const planned = {
      id: 1,
      itemCode: "010100001",
      financialGroupCode: "02020301",
      sourceRows: [3],
      previous: article(1, "010100001", null),
    };
    const fakeClient = {
      query: async (queryText: string) => {
        queries.push(queryText);
        if (queryText.includes('update "sapCatalog"')) {
          return { rows: [], rowCount: 1 };
        }
        if (queryText.includes('from "sapCatalog"')) {
          return {
            rows: [
              {
                ...article(1, "010100001", "02020301"),
              },
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: null };
      },
    };

    await expect(
      applyFinancialGroupImportPlan(fakeClient as any, [planned])
    ).resolves.toMatchObject({ updated: 1 });

    const updateSql = queries.find(query => query.includes("update")) ?? "";
    expect(updateSql).toContain('set "financialGroupCode"');
    expect(updateSql).toContain('"updatedAt" = now()');
    expect(updateSql).not.toMatch(/\binsert\b|\bdelete\b/i);
    expect(queries.at(-1)).toBe("COMMIT");
  });

  it("rolls back when the affected row count does not match", async () => {
    const queries: string[] = [];
    const fakeClient = {
      query: async (queryText: string) => {
        queries.push(queryText);
        return {
          rows: [],
          rowCount: queryText.includes("update") ? 0 : null,
        };
      },
    };
    const planned = {
      id: 1,
      itemCode: "010100001",
      financialGroupCode: "02020301",
      sourceRows: [3],
      previous: article(1, "010100001", null),
    };

    await expect(
      applyFinancialGroupImportPlan(fakeClient as any, [planned])
    ).rejects.toThrow("Se esperaban 1 updates");
    expect(queries.at(-1)).toBe("ROLLBACK");
  });
});
