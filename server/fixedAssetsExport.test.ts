import { describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import { buildWorkbook } from "@/lib/excel-export";
import {
  buildFixedAssetsExportColumns,
  collectFixedAssetsExport,
  type FixedAssetExportArticle,
  type FixedAssetsExportFilters,
  type FixedAssetsExportPageInput,
} from "@/lib/fixed-assets-export";

const projectById = new Map([
  [17, { id: 17, code: "017", name: "Proyecto de prueba" }],
]);
const asset: FixedAssetExportArticle = {
  tipoArticulo: 3,
  itemGroup: "0012",
  itemCode: "0000123",
  description: "Equipo de prueba",
  fixedAssetBrand: "Marca del activo",
  fixedAssetModel: "Modelo 001",
  fixedAssetChassisSeries: "0000456",
  fixedAssetMotorSeries: "0000789",
  fixedAssetPlateOrCode: "00123",
  fixedAssetCondition: "usado_buen_estado",
  projectId: 17,
};

describe("fixed assets template export", () => {
  it("uses the original asset description supplied by the server without appending its attributes", () => {
    const workbook = buildWorkbook(XLSX, [
      {
        sheetName: "Formato",
        columns: buildFixedAssetsExportColumns(projectById),
        rows: [
          {
            ...asset,
            description:
              "APLICADOR BITUMEN HIERRO GENERICA TX50150 SERIE CHASIS 1113",
            fixedAssetExportDescription: "APLICADOR BITUMEN HIERRO",
            fixedAssetBrand: "GENERICA",
            fixedAssetModel: "TX50150",
            fixedAssetChassisSeries: "1113",
          },
        ],
      },
    ]);
    const sheet = XLSX.read(
      XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }),
      { type: "buffer" }
    ).Sheets.Formato;
    expect(sheet.C2.v).toBe("APLICADOR BITUMEN HIERRO");
    expect(sheet.D2.v).toBe("GENERICA");
    expect(sheet.E2.v).toBe("TX50150");
    expect(sheet.F2.v).toBe("1113");
  });

  it("writes exactly the twelve template fields in order and preserves SAP codes and serials as text", () => {
    const workbook = buildWorkbook(XLSX, [
      {
        sheetName: "Formato",
        columns: buildFixedAssetsExportColumns(projectById),
        rows: [asset],
      },
    ]);
    const roundtrip = XLSX.read(
      XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }),
      { type: "buffer" }
    );
    expect(roundtrip.SheetNames).toEqual(["Formato"]);
    const sheet = roundtrip.Sheets.Formato;
    expect(XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" })).toEqual([
      [
        "Grupo SAP",
        "Codigo SAP",
        "Descripcion del articulo",
        "Marca activo fijo",
        "Modelo activo fijo",
        "Serie chasis",
        "Serie motor",
        "Placa o codigo",
        "Año",
        "Condición activo fijo",
        "Proyecto",
        "Ubicación",
      ],
      [
        "0012",
        "0000123",
        "Equipo de prueba",
        "Marca del activo",
        "Modelo 001",
        "0000456",
        "0000789",
        "00123",
        "",
        "Usado buen estado",
        "017 - Proyecto de prueba",
        "",
      ],
    ]);
    for (const [cell, value] of [
      ["A2", "0012"],
      ["B2", "0000123"],
      ["F2", "0000456"],
      ["G2", "0000789"],
      ["H2", "00123"],
    ]) {
      expect(sheet[cell]).toMatchObject({ t: "s", v: value });
      expect(sheet[cell].f).toBeUndefined();
    }
    expect(sheet["!ref"]).toBe("A1:L2");
  });

  it("uses the asset fields, leaves unavailable year/location blank, and resolves saved or catalog project labels", () => {
    const columns = buildFixedAssetsExportColumns(projectById);
    const values = (row: FixedAssetExportArticle) =>
      columns.map(column => column.value(row));
    expect(
      values({
        ...asset,
        projectCode: "009",
        projectName: "Proyecto guardado",
      })[10]
    ).toBe("009 - Proyecto guardado");
    expect(
      values({
        ...asset,
        fixedAssetBrand: null,
        fixedAssetModel: null,
        fixedAssetCondition: "unknown",
        projectId: null,
      })
    ).toEqual([
      "0012",
      "0000123",
      "Equipo de prueba",
      "",
      "",
      "0000456",
      "0000789",
      "00123",
      "",
      "",
      "Sin proyecto",
      "",
    ]);
  });

  it("keeps untrusted cell values as strings without generating formulas", () => {
    const workbook = buildWorkbook(XLSX, [
      {
        sheetName: "Formato",
        columns: buildFixedAssetsExportColumns(projectById),
        rows: [
          {
            ...asset,
            itemCode: "=1+1",
            description: "+SUM(1,2)",
            fixedAssetBrand: "@SUM(1,2)",
            fixedAssetChassisSeries: "-1+1",
          },
        ],
      },
    ]);
    const sheet = XLSX.read(
      XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }),
      { type: "buffer" }
    ).Sheets.Formato;
    for (const [cell, value] of [
      ["B2", "=1+1"],
      ["C2", "+SUM(1,2)"],
      ["D2", "@SUM(1,2)"],
      ["F2", "-1+1"],
    ]) {
      expect(sheet[cell]).toMatchObject({ t: "s", v: value });
      expect(sheet[cell].f).toBeUndefined();
    }
  });

  it("fetches all pages of more than 200 matches with the same filter snapshot and fixed asset type", async () => {
    const rows = Array.from({ length: 405 }, (_, index) => ({
      ...asset,
      itemCode: String(index).padStart(7, "0"),
    }));
    const filters: FixedAssetsExportFilters = {
      search: "equipo",
      isActive: false,
      allowsTaxWithholding: false,
      fixedAssetStatus: "resuelto",
      projectId: 17,
      temporaryOnly: true,
    };
    const fetch = vi.fn(async (input: FixedAssetsExportPageInput) => {
      if (input.page === 1) filters.search = "changed after click";
      return {
        items: rows.slice(
          (input.page - 1) * input.pageSize,
          input.page * input.pageSize
        ),
        totalPages: 3,
      };
    });
    expect(await collectFixedAssetsExport(fetch, filters)).toEqual(rows);
    expect(fetch.mock.calls.map(([input]) => input)).toEqual(
      [1, 2, 3].map(page => ({
        search: "equipo",
        isActive: false,
        allowsTaxWithholding: false,
        fixedAssetStatus: "resuelto",
        projectId: 17,
        temporaryOnly: true,
        tipoArticulo: 3,
        page,
        pageSize: 200,
      }))
    );
  });

  it("preserves pending-view filters and never returns a partial export after a page fails", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({ items: [asset], totalPages: 2 })
      .mockRejectedValueOnce(new Error("Connection lost"));
    await expect(
      collectFixedAssetsExport(fetch, {
        isActive: true,
        fixedAssetStatus: "pendiente",
        projectId: undefined,
        temporaryOnly: true,
      })
    ).rejects.toThrow("Connection lost");
    expect(fetch.mock.calls.map(([input]) => input)).toEqual(
      [1, 2].map(page => ({
        search: undefined,
        isActive: true,
        allowsTaxWithholding: undefined,
        fixedAssetStatus: "pendiente",
        temporaryOnly: true,
        tipoArticulo: 3,
        page,
        pageSize: 200,
      }))
    );
  });

  it("handles no matching fixed assets without fetching extra pages", async () => {
    const fetch = vi.fn(async () => ({ items: [], totalPages: 1 }));
    expect(await collectFixedAssetsExport(fetch, {})).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
