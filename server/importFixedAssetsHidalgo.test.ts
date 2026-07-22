import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import XLSX from "xlsx";
import {
  buildPlan,
  buildProjectLookup,
  findDuplicateCodes,
  parseRows,
  readWorkbook,
  resolveProjects,
  type ExistingAssetRow,
  type ParsedAssetRow,
  type ResolvedAssetRow,
} from "../scripts/import-fixed-assets-hidalgo";

const HEADERS = [
  "Codigo Proyecto",
  "Nombre Proyecto",
  "Codigo de almacen",
  "Nombre de almacen",
  "Numero de articulo",
  "Tipo de articulo",
  "Grupo SAP",
  "Descripcion del articulo",
  "Descripcion del articulo completa",
  "Unidad",
  "Categoria inventario",
  "En stock",
  "Stock minimo",
  "Permite retencion",
  "Activo",
  "Serie activo fijo",
  "Condicion activo fijo",
  "Color activo fijo",
  "Modelo activo fijo",
  "Marca activo fijo",
  "Serie chasis",
  "Serie motor",
  "Placa o codigo",
  "Año",
  "Es leasing",
  "Observacion activo fijo",
];

async function writeWorkbook(
  sheetName: string,
  rows: Array<Record<string, unknown>>
) {
  const tempDir = await mkdtemp(join(tmpdir(), "buildreq-fixed-assets-"));
  const file = join(tempDir, "activos.xlsx");
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.json_to_sheet(rows, { header: HEADERS });
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  XLSX.writeFile(workbook, file);
  return { tempDir, file };
}

function createExistingAsset(overrides: Partial<ExistingAssetRow> = {}) {
  return {
    id: 10,
    itemCode: "070200001",
    description: "Descripcion anterior",
    itemGroup: "0702 MAQUINARIA PESADA",
    tipoArticulo: 3,
    projectId: 1,
    allowsTaxWithholding: true,
    isActive: true,
    fixedAssetStatus: null,
    fixedAssetSourcePurchaseOrderId: null,
    fixedAssetSourcePurchaseOrderItemId: null,
    fixedAssetSerialNumber: "SER-OLD",
    fixedAssetCondition: "nuevo",
    fixedAssetColor: "Azul",
    fixedAssetModel: "Modelo viejo",
    fixedAssetBrand: "Marca vieja",
    fixedAssetChassisSeries: "CH-OLD",
    fixedAssetMotorSeries: "MO-OLD",
    fixedAssetPlateOrCode: "PL-OLD",
    fixedAssetIsLeasing: true,
    fixedAssetObservation: "Observacion previa",
    ...overrides,
  } satisfies ExistingAssetRow;
}

function createResolvedAsset(overrides: Partial<ResolvedAssetRow> = {}) {
  const parsed = {
    rowNumber: 2,
    itemCode: "070200001",
    description: "Descripcion nueva",
    itemGroup: "0702 MAQUINARIA PESADA",
    tipoArticulo: "ACTIVO",
    projectCodeRaw: "001",
    projectKey: "1",
    projectNameRaw: "001 Oficina Central",
    warehouseCodeRaw: null,
    warehouseNameRaw: null,
    allowsTaxWithholding: true,
    isActive: true,
    fixedAssetSerialNumber: null,
    fixedAssetCondition: null,
    fixedAssetColor: null,
    fixedAssetModel: null,
    fixedAssetBrand: null,
    fixedAssetChassisSeries: null,
    fixedAssetMotorSeries: null,
    fixedAssetPlateOrCode: null,
    fixedAssetIsLeasing: null,
    fixedAssetObservation: null,
  } satisfies ParsedAssetRow;

  return {
    ...parsed,
    project: { id: 1, code: "001", name: "Oficina Central" },
    projectId: 1,
    ...overrides,
  } satisfies ResolvedAssetRow;
}

describe("import-fixed-assets-hidalgo", () => {
  it("reads ARTICULOS by default and parses fixed asset fields", async () => {
    const { tempDir, file } = await writeWorkbook("ARTICULOS", [
      {
        "Codigo Proyecto": "001",
        "Nombre Proyecto": "001 Oficina Central",
        "Numero de articulo": "070200001",
        "Tipo de articulo": "ACTIVO",
        "Grupo SAP": "0702 MAQUINARIA PESADA",
        "Descripcion del articulo": "ZARANDA VIBRATORIA",
        "Descripcion del articulo completa": "Descripcion completa cargada",
        "Permite retencion": "NO",
        Activo: "NO",
        "Serie activo fijo": "110203306",
        "Condicion activo fijo": "Usado buen estado",
        "Color activo fijo": "Rojo",
        "Modelo activo fijo": "INCLINED25SCREEN",
        "Marca activo fijo": "TRIO",
        "Serie chasis": "CH-001",
        "Serie motor": "M-001",
        "Placa o codigo": "Z3306",
        Año: "2024",
        "Es leasing": "SI",
        "Observacion activo fijo": "Equipo importado",
      },
      {
        "Codigo Proyecto": "Total",
        "Numero de articulo": "461",
        "Tipo de articulo": "",
      },
    ]);

    try {
      const workbook = readWorkbook(file);
      const result = parseRows(workbook.rawRows, {
        missingHeaders: workbook.missingHeaders,
      });

      expect(workbook.sheetName).toBe("ARTICULOS");
      expect(workbook.unmappedColumns).toContain("Año");
      expect(workbook.unmappedColumns).not.toContain(
        "Descripcion del articulo completa"
      );
      expect(result.validationErrors).toEqual([]);
      expect(result.parsedRows).toHaveLength(1);
      expect(result.skippedRows).toEqual([
        expect.objectContaining({
          rowNumber: 3,
          blocking: false,
          reason: "Tipo de articulo no es ACTIVO",
        }),
      ]);
      expect(result.parsedRows[0]).toMatchObject({
        itemCode: "070200001",
        description: "DESCRIPCION COMPLETA CARGADA",
        itemGroup: "0702 MAQUINARIA PESADA",
        allowsTaxWithholding: false,
        isActive: false,
        fixedAssetSerialNumber: "110203306",
        fixedAssetCondition: "usado_buen_estado",
        fixedAssetColor: "Rojo",
        fixedAssetModel: "INCLINED25SCREEN",
        fixedAssetBrand: "TRIO",
        fixedAssetChassisSeries: "CH-001",
        fixedAssetMotorSeries: "M-001",
        fixedAssetPlateOrCode: "Z3306",
        fixedAssetIsLeasing: true,
        fixedAssetObservation: "Equipo importado",
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("falls back to short description when full description is blank", () => {
    const result = parseRows([
      {
        "Numero de articulo": "AF001",
        "Tipo de articulo": "ACTIVO",
        "Grupo SAP": "GRUPO",
        "Descripcion del articulo": "Descripcion corta",
        "Descripcion del articulo completa": "",
      },
    ]);

    expect(result.validationErrors).toEqual([]);
    expect(result.parsedRows).toHaveLength(1);
    expect(result.parsedRows[0]).toMatchObject({
      itemCode: "AF001",
      description: "DESCRIPCION CORTA",
    });
  });

  it("falls back to Hoja1 when ARTICULOS is not present", async () => {
    const { tempDir, file } = await writeWorkbook("Hoja1", [
      {
        "Numero de articulo": "AF001",
        "Tipo de articulo": "ACTIVO",
        "Grupo SAP": "GRUPO",
        "Descripcion del articulo": "Activo legacy",
      },
    ]);

    try {
      const workbook = readWorkbook(file);
      const result = parseRows(workbook.rawRows);

      expect(workbook.sheetName).toBe("Hoja1");
      expect(result.parsedRows).toHaveLength(1);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("detects duplicate codes and missing projects", () => {
    const rows = parseRows([
      {
        "Codigo Proyecto": "999",
        "Numero de articulo": "AF001",
        "Tipo de articulo": "ACTIVO",
        "Grupo SAP": "GRUPO",
        "Descripcion del articulo": "Activo 1",
      },
      {
        "Codigo Proyecto": "999",
        "Numero de articulo": "AF001",
        "Tipo de articulo": "ACTIVO",
        "Grupo SAP": "GRUPO",
        "Descripcion del articulo": "Activo 1 repetido",
      },
    ]).parsedRows;

    const duplicates = findDuplicateCodes(rows);
    const resolved = resolveProjects(
      rows,
      buildProjectLookup([{ id: 1, code: "001", name: "Oficina Central" }])
    );

    expect(duplicates).toEqual([{ itemCode: "AF001", sourceRows: [2, 3] }]);
    expect(resolved.resolvedRows).toHaveLength(0);
    expect(resolved.missingProjects).toEqual([
      expect.objectContaining({ projectCode: "999", rows: [2, 3] }),
    ]);
  });

  it("preserves existing fixed asset details when update rows are blank", () => {
    const plan = buildPlan(
      [createResolvedAsset()],
      [createExistingAsset()]
    );

    expect(plan.inserts).toHaveLength(0);
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0]).toMatchObject({
      description: "Descripcion nueva",
      fixedAssetSerialNumber: "SER-OLD",
      fixedAssetCondition: "nuevo",
      fixedAssetColor: "Azul",
      fixedAssetModel: "Modelo viejo",
      fixedAssetBrand: "Marca vieja",
      fixedAssetChassisSeries: "CH-OLD",
      fixedAssetMotorSeries: "MO-OLD",
      fixedAssetPlateOrCode: "PL-OLD",
      fixedAssetIsLeasing: true,
      fixedAssetObservation: "Observacion previa",
    });
    expect(plan.updates[0].fieldChanges.description).toBe(true);
    expect(plan.updates[0].fieldChanges.fixedAssetSerialNumber).toBe(false);
    expect(plan.updates[0].fieldChanges.fixedAssetIsLeasing).toBe(false);
  });
});
