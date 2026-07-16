import { describe, expect, it } from "vitest";
import {
  buildArticleGroupsImportPlan,
  parseArticleGroupRows,
  type ExistingArticleGroupRow,
} from "../scripts/import-article-groups";

function articleRow(
  id: number,
  itemCode: string,
  itemGroup: string | null
): ExistingArticleGroupRow {
  return {
    id,
    itemCode,
    description: `Articulo ${itemCode}`,
    itemGroup,
    tipoArticulo: 1,
    isActive: true,
  };
}

describe("import-article-groups", () => {
  it("reads CODIGO and Grupo and keeps leading-zero codes as text", () => {
    const result = parseArticleGroupRows([
      { CODIGO: "010100001", Grupo: "0101 - COMBUSTIBLES" },
      { CODIGO: "090200001", Grupo: "0902 - FILTROS" },
    ]);

    expect(result.parsedRows).toEqual([
      {
        rowNumber: 2,
        itemCode: "010100001",
        itemGroup: "0101 - COMBUSTIBLES",
      },
      {
        rowNumber: 3,
        itemCode: "090200001",
        itemGroup: "0902 - FILTROS",
      },
    ]);
    expect(result.groupedRows.map(row => row.itemCode)).toEqual([
      "010100001",
      "090200001",
    ]);
    expect(result.validationErrors).toHaveLength(0);
  });

  it("collapses identical duplicates by code", () => {
    const result = parseArticleGroupRows([
      { CODIGO: "010100001", Grupo: "0101 - COMBUSTIBLES" },
      { CODIGO: "010100001", Grupo: "0101 - COMBUSTIBLES" },
      { CODIGO: "010100002", Grupo: "0101 - COMBUSTIBLES" },
    ]);

    expect(result.parsedRows).toHaveLength(3);
    expect(result.groupedRows).toHaveLength(2);
    expect(result.groupedRows[0]).toMatchObject({
      itemCode: "010100001",
      itemGroup: "0101 - COMBUSTIBLES",
      sourceRows: [2, 3],
      duplicateRows: [3],
    });
    expect(result.duplicateGroups).toHaveLength(1);
    expect(result.conflictingDuplicateGroups).toHaveLength(0);
    expect(result.validationErrors).toHaveLength(0);
  });

  it("blocks conflicting groups for the same code", () => {
    const result = parseArticleGroupRows([
      { CODIGO: "010100001", Grupo: "0101 - COMBUSTIBLES" },
      { CODIGO: "010100001", Grupo: "0102 - LUBRICANTES" },
    ]);

    expect(result.groupedRows).toHaveLength(1);
    expect(result.duplicateGroups).toHaveLength(1);
    expect(result.conflictingDuplicateGroups).toHaveLength(1);
    expect(result.validationErrors[0]).toContain("010100001");
  });

  it("plans updates, missing codes, and unchanged rows by itemCode", () => {
    const parseResult = parseArticleGroupRows([
      { CODIGO: "010100001", Grupo: "0101 - COMBUSTIBLES" },
      { CODIGO: "010100002", Grupo: "0101 - COMBUSTIBLES" },
      { CODIGO: "010100003", Grupo: "0101 - COMBUSTIBLES" },
    ]);
    const plan = buildArticleGroupsImportPlan(parseResult, [
      articleRow(1, "010100001", "Combustibles y Lubricantes"),
      articleRow(2, "010100002", "0101 - COMBUSTIBLES"),
    ]);

    expect(plan.updates.map(row => row.itemCode)).toEqual(["010100001"]);
    expect(plan.unchanged.map(row => row.itemCode)).toEqual(["010100002"]);
    expect(plan.missingCatalogCodes.map(row => row.itemCode)).toEqual([
      "010100003",
    ]);
    expect(plan.validationErrors).toEqual([
      "Hay 1 codigos que no existen en sapCatalog",
    ]);
  });
});
