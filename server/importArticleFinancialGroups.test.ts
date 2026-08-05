import { describe, expect, it } from "vitest";
import {
  applyFinancialGroupImportPlan,
  buildFinancialGroupImportPlan,
  parseFinancialGroupSheetRows,
  parseServiceFinancialGroupSheetRows,
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
    codN2: financialGroupCode.slice(0, 4),
    nivel2: "Nivel 2",
    isActive,
  };
}

function serviceRows(
  values: Array<{
    itemCode: string;
    financialGroupCode: string;
    codN2?: string;
    nivel2?: string;
    nivel4?: string;
    fullDescription?: string;
  }>
) {
  const headers = Array(45).fill(null);
  headers[0] = "Código Articulo";
  headers[1] = "NIVEL4";
  headers[3] = "grupo financiero";
  headers[15] = "NIVEL2";
  headers[16] = "NIVEL 2";
  headers[19] = "NIVEL 4";
  headers[44] = "descripcion grupo financiero";
  return [
    Array(45).fill(null),
    Array(45).fill(null),
    headers,
    ...values.map(value => {
      const row = Array(45).fill(null);
      const codN2 = value.codN2 ?? "0205";
      const nivel2 = value.nivel2 ?? "Subcontratistas";
      const nivel4 = value.nivel4 ?? "PGA - Plan de gestión ambiental";
      row[0] = value.itemCode;
      row[1] = value.financialGroupCode;
      row[3] = value.financialGroupCode;
      row[15] = codN2;
      row[16] = nivel2;
      row[19] = nivel4;
      row[44] =
        value.fullDescription ??
        `${value.financialGroupCode}-C.Operativo-${nivel2}-${nivel4}`;
      return row;
    }),
  ];
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

  it("reads the services profile and normalizes group descriptions", () => {
    const result = parseServiceFinancialGroupSheetRows(
      serviceRows([
        {
          itemCode: "0010010001",
          financialGroupCode: "02050501",
        },
      ])
    );

    expect(result.profile).toBe("services");
    expect(result.headerRowNumber).toBe(3);
    expect(result.parsedRows[0]).toMatchObject({
      rowNumber: 4,
      itemCode: "0010010001",
      financialGroupCode: "02050501",
    });
    expect(result.financialGroupDefinitions).toEqual([
      {
        financialGroupCode: "02050501",
        financialGroupDescription:
          "02050501-Subcontratistas-PGA - Plan de gestión ambiental",
        codN2: "0205",
        nivel2: "Subcontratistas",
        isActive: true,
        sourceRows: [4],
      },
    ]);
    expect(result.validationErrors).toHaveLength(0);
  });

  it("blocks conflicting metadata for one services financial group", () => {
    const result = parseServiceFinancialGroupSheetRows(
      serviceRows([
        {
          itemCode: "1002000001",
          financialGroupCode: "02050501",
        },
        {
          itemCode: "1002000002",
          financialGroupCode: "02050501",
          nivel4: "Otro detalle",
        },
      ])
    );

    expect(result.validationErrors.join(" ")).toContain(
      "metadatos conflictivos"
    );
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

  it("plans missing group creation only when explicitly enabled", () => {
    const parsed = parseServiceFinancialGroupSheetRows(
      serviceRows([
        {
          itemCode: "1002000001",
          financialGroupCode: "02050501",
        },
      ])
    );
    const blocked = buildFinancialGroupImportPlan(
      parsed,
      [article(1, "1002000001", null)],
      []
    );
    const enabled = buildFinancialGroupImportPlan(
      parsed,
      [article(1, "1002000001", null)],
      [],
      { createMissingGroups: true, requireAllArticles: true }
    );

    expect(blocked.validationErrors).toHaveLength(1);
    expect(enabled.validationErrors).toHaveLength(0);
    expect(enabled.groupsToCreate).toHaveLength(1);
    expect(enabled.updates).toHaveLength(1);
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
        if (queryText.includes('from "financialGroups"')) {
          return { rows: [group("02020301")], rowCount: 1 };
        }
        if (queryText.includes('from "sapCatalog"')) {
          return {
            rows: [
              {
                ...article(
                  1,
                  "010100001",
                  queryText.includes("for update") ? null : "02020301"
                ),
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

    const updateSql =
      queries.find(query => query.includes('update "sapCatalog"')) ?? "";
    expect(updateSql).toContain('set "financialGroupCode"');
    expect(updateSql).toContain('"updatedAt" = now()');
    expect(updateSql).not.toMatch(/\binsert\b|\bdelete\b/i);
    expect(queries.at(-1)).toBe("COMMIT");
  });

  it("inserts missing groups before updating articles", async () => {
    const queries: string[] = [];
    const definition = {
      financialGroupCode: "02050501",
      financialGroupDescription:
        "02050501-Subcontratistas-PGA - Plan de gestión ambiental",
      codN2: "0205",
      nivel2: "Subcontratistas",
      isActive: true as const,
      sourceRows: [4],
    };
    const planned = {
      id: 1,
      itemCode: "1002000001",
      financialGroupCode: "02050501",
      sourceRows: [4],
      previous: article(1, "1002000001", null),
    };
    const fakeClient = {
      query: async (queryText: string) => {
        queries.push(queryText);
        if (queryText.includes('insert into "financialGroups"')) {
          return { rows: [], rowCount: 1 };
        }
        if (queryText.includes('from "financialGroups"')) {
          return { rows: [definition], rowCount: 1 };
        }
        if (queryText.includes('update "sapCatalog"')) {
          return { rows: [], rowCount: 1 };
        }
        if (queryText.includes('from "sapCatalog"')) {
          return {
            rows: [
              article(
                1,
                "1002000001",
                queryText.includes("for update") ? null : "02050501"
              ),
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: null };
      },
    };

    await expect(
      applyFinancialGroupImportPlan(
        fakeClient as any,
        [planned],
        [definition],
        [definition.financialGroupCode]
      )
    ).resolves.toMatchObject({ updated: 1, insertedFinancialGroups: 1 });

    const insertIndex = queries.findIndex(query => query.includes("insert"));
    const updateIndex = queries.findIndex(query =>
      query.includes('update "sapCatalog"')
    );
    expect(insertIndex).toBeGreaterThan(-1);
    expect(updateIndex).toBeGreaterThan(insertIndex);
    expect(queries.at(-1)).toBe("COMMIT");
  });

  it("rolls back when the affected row count does not match", async () => {
    const queries: string[] = [];
    const fakeClient = {
      query: async (queryText: string) => {
        queries.push(queryText);
        if (
          queryText.includes('from "sapCatalog"') &&
          queryText.includes("for update")
        ) {
          return {
            rows: [article(1, "010100001", null)],
            rowCount: 1,
          };
        }
        if (queryText.includes('from "financialGroups"')) {
          return { rows: [group("02020301")], rowCount: 1 };
        }
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
