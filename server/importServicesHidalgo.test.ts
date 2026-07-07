import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import XLSX from "xlsx";
import {
  buildPlan,
  findDuplicateCodes,
  parseRows,
  readWorkbook,
  type ExistingCatalogRow,
} from "../scripts/import-services-hidalgo";

const HEADERS = [
  "codigo_sap*",
  "descripcion_servicio*",
  "tipo_articulo*",
  "grupo_sap",
  "marca",
  "numero_parte",
  "permite_retencion",
  "habilitado",
];

async function writeWorkbook(rows: Array<Record<string, unknown>>) {
  const tempDir = await mkdtemp(join(tmpdir(), "buildreq-services-"));
  const file = join(tempDir, "servicios.xlsx");
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.json_to_sheet(rows, { header: HEADERS });
  XLSX.utils.book_append_sheet(workbook, worksheet, "SERVICIOS");
  XLSX.writeFile(workbook, file);
  return { tempDir, file };
}

function existingCatalog(
  overrides: Partial<ExistingCatalogRow> = {}
): ExistingCatalogRow {
  return {
    id: 10,
    itemCode: "1001000001",
    description: "Servicio previo",
    itemGroup: "Grupo previo",
    brand: "Marca previa",
    partNumber: "Parte previa",
    tipoArticulo: 2,
    allowsTaxWithholding: true,
    isActive: true,
    ...overrides,
  };
}

describe("import-services-hidalgo", () => {
  it("reads SERVICIOS and parses service fields", async () => {
    const { tempDir, file } = await writeWorkbook([
      {
        "codigo_sap*": "1001000001",
        "descripcion_servicio*": "Servicios de internet",
        "tipo_articulo*": "SERVICIO",
        grupo_sap: "0104 Servicios basicos",
        permite_retencion: "NO",
        habilitado: "SI",
      },
    ]);

    try {
      const workbook = readWorkbook(file);
      const result = parseRows(workbook.rawRows, {
        missingHeaders: workbook.missingHeaders,
      });

      expect(workbook.sheetName).toBe("SERVICIOS");
      expect(result.validationErrors).toEqual([]);
      expect(result.parsedRows).toEqual([
        expect.objectContaining({
          itemCode: "1001000001",
          description: "Servicios de internet",
          itemGroup: "0104 Servicios basicos",
          allowsTaxWithholding: false,
          isActive: true,
        }),
      ]);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("detects duplicate service codes", () => {
    const rows = parseRows([
      {
        "codigo_sap*": "SRV001",
        "descripcion_servicio*": "Servicio uno",
        "tipo_articulo*": "SERVICIO",
      },
      {
        "codigo_sap*": "SRV001",
        "descripcion_servicio*": "Servicio uno duplicado",
        "tipo_articulo*": "SERVICIO",
      },
    ]).parsedRows;

    expect(findDuplicateCodes(rows)).toEqual([
      { itemCode: "SRV001", sourceRows: [2, 3] },
    ]);
  });

  it("preserves optional existing fields when update has blanks", () => {
    const rows = parseRows([
      {
        "codigo_sap*": "1001000001",
        "descripcion_servicio*": "Servicio actualizado",
        "tipo_articulo*": "SERVICIO",
        grupo_sap: "",
        marca: "",
        numero_parte: "",
      },
    ]).parsedRows;

    const plan = buildPlan(rows, [existingCatalog()]);

    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0]).toMatchObject({
      itemGroup: "Grupo previo",
      brand: "Marca previa",
      partNumber: "Parte previa",
      tipoArticulo: 2,
    });
  });

  it("blocks codes that already exist as products or fixed assets", () => {
    const rows = parseRows([
      {
        "codigo_sap*": "1001000001",
        "descripcion_servicio*": "Servicio nuevo",
        "tipo_articulo*": "SERVICIO",
      },
    ]).parsedRows;

    const plan = buildPlan(rows, [existingCatalog({ tipoArticulo: 1 })]);

    expect(plan.existingTypeConflicts).toEqual([
      expect.objectContaining({ itemCode: "1001000001", tipoArticulo: 1 }),
    ]);
    expect(plan.inserts).toHaveLength(0);
    expect(plan.updates).toHaveLength(0);
  });
});
