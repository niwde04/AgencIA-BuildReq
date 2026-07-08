import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import XLSX from "xlsx";
import {
  buildImportData,
  buildPlan,
  parseRows,
  parseArgs,
  readWorkbook,
  type DbProject,
  type DbWarehouse,
  type ExistingCatalogRow,
  type ExistingInventoryRow,
} from "../scripts/import-products-inventory-hidalgo";

const HEADERS = [
  "codigo_sap*",
  "descripcion_articulo*",
  "tipo_articulo*",
  "unidad",
  "categoria",
  "marca",
  "numero_parte",
  "codigo_almacen*",
  "nombre_almacen",
  "codigo_bodega",
  "nombre_bodega",
  "cantidad_inicial*",
  "stock_minimo",
  "fecha_saldo",
  "habilitado",
  "notas",
  "ubicacion",
];

function parseFixture(rows: Array<Record<string, unknown>>) {
  const parsed = parseRows(rows);
  return buildImportData({
    file: "fixture.xlsx",
    sheetName: "Inventario",
    rawRows: rows.length,
    parsedRows: parsed.parsedRows,
    skippedRows: parsed.skippedRows,
    validationErrors: parsed.validationErrors,
  });
}

async function writeWorkbook(rows: Array<Record<string, unknown>>) {
  const tempDir = await mkdtemp(join(tmpdir(), "buildreq-products-"));
  const file = join(tempDir, "productos.xlsx");
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.json_to_sheet(rows, { header: HEADERS });
  XLSX.utils.book_append_sheet(workbook, worksheet, "Inventario");
  XLSX.writeFile(workbook, file);
  return { tempDir, file };
}

function project(overrides: Partial<DbProject> = {}) {
  return {
    id: 4,
    code: "004",
    sapProjectCode: "004",
    name: "Bodega hija",
    status: "activo",
    ...overrides,
  } satisfies DbProject;
}

function warehouse(overrides: Partial<DbWarehouse> = {}) {
  return {
    id: 1,
    code: "001",
    localCode: "001",
    name: "Almacen central",
    displayName: "001 - ALMACEN CENTRAL",
    isActive: true,
    ...overrides,
  } satisfies DbWarehouse;
}

function existingCatalog(
  overrides: Partial<ExistingCatalogRow> = {}
): ExistingCatalogRow {
  return {
    id: 10,
    itemCode: "P001",
    description: "Producto existente",
    itemGroup: "MATERIALES",
    brand: null,
    partNumber: null,
    tipoArticulo: 1,
    isActive: true,
    ...overrides,
  };
}

describe("import-products-inventory-hidalgo", () => {
  it("reads Inventario by default and parses storageLocation", async () => {
    const { tempDir, file } = await writeWorkbook([
      {
        "codigo_sap*": "P001",
        "descripcion_articulo*": "Cemento",
        "tipo_articulo*": "Materiales",
        "codigo_almacen*": "001",
        "cantidad_inicial*": "12.50",
        ubicacion: "Estante A1",
      },
    ]);

    try {
      const workbook = readWorkbook(file);
      const result = parseRows(workbook.rawRows, {
        missingHeaders: workbook.missingHeaders,
      });

      expect(workbook.sheetName).toBe("Inventario");
      expect(result.validationErrors).toEqual([]);
      expect(result.parsedRows).toEqual([
        expect.objectContaining({
          itemCode: "P001",
          projectCodeRaw: "001",
          warehouseCodeRaw: "001",
          quantity: 12.5,
          storageLocation: "Estante A1",
        }),
      ]);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("uses codigo_bodega as project when present and warehouse as fallback otherwise", () => {
    const result = parseRows([
      {
        "codigo_sap*": "P001",
        "descripcion_articulo*": "Cemento",
        "tipo_articulo*": "Materiales",
        "codigo_almacen*": "001",
        codigo_bodega: "004",
        "cantidad_inicial*": "1",
      },
      {
        "codigo_sap*": "P002",
        "descripcion_articulo*": "Arena",
        "tipo_articulo*": "Materiales",
        "codigo_almacen*": "010",
        codigo_bodega: "",
        "cantidad_inicial*": "2",
      },
    ]);

    expect(result.validationErrors).toEqual([]);
    expect(result.parsedRows[0]).toMatchObject({
      warehouseCodeRaw: "001",
      projectCodeRaw: "004",
    });
    expect(result.parsedRows[1]).toMatchObject({
      warehouseCodeRaw: "010",
      projectCodeRaw: "010",
    });
  });

  it("sums duplicate inventory groups only when storageLocation also matches", () => {
    const data = parseFixture([
      {
        "codigo_sap*": "P001",
        "descripcion_articulo*": "Cemento",
        "tipo_articulo*": "Materiales",
        "codigo_almacen*": "001",
        codigo_bodega: "004",
        "cantidad_inicial*": "2.50",
        ubicacion: "Zona 1",
      },
      {
        "codigo_sap*": "P001",
        "descripcion_articulo*": "Cemento",
        "tipo_articulo*": "Materiales",
        "codigo_almacen*": "001",
        codigo_bodega: "004",
        "cantidad_inicial*": "3.25",
        ubicacion: "Zona 1",
      },
    ]);

    expect(data.products).toHaveLength(1);
    expect(data.inventory).toHaveLength(1);
    expect(data.inventory[0]).toMatchObject({
      sapItemCode: "P001",
      warehouseKey: "1",
      projectKey: "4",
      currentStock: 5.75,
      storageLocation: "Zona 1",
    });
  });

  it("splits inventory groups when storageLocation differs", () => {
    const data = parseFixture([
      {
        "codigo_sap*": "P001",
        "descripcion_articulo*": "Cemento",
        "tipo_articulo*": "Materiales",
        "codigo_almacen*": "001",
        codigo_bodega: "004",
        "cantidad_inicial*": "2.50",
        ubicacion: "Zona 1",
      },
      {
        "codigo_sap*": "P001",
        "descripcion_articulo*": "Cemento",
        "tipo_articulo*": "Materiales",
        "codigo_almacen*": "001",
        codigo_bodega: "004",
        "cantidad_inicial*": "3.25",
        ubicacion: "Zona 2",
      },
    ]);

    expect(data.products).toHaveLength(1);
    expect(data.inventory).toHaveLength(2);
    expect(data.inventory).toEqual([
      expect.objectContaining({
        key: "P001::1::4::ZONA 1",
        currentStock: 2.5,
        storageLocation: "Zona 1",
      }),
      expect.objectContaining({
        key: "P001::1::4::ZONA 2",
        currentStock: 3.25,
        storageLocation: "Zona 2",
      }),
    ]);
  });

  it("keeps blank storageLocation as its own group with zero stock", () => {
    const data = parseFixture([
      {
        "codigo_sap*": "P001",
        "descripcion_articulo*": "Cemento",
        "tipo_articulo*": "Materiales",
        "codigo_almacen*": "001",
        codigo_bodega: "004",
        "cantidad_inicial*": "0",
        ubicacion: "",
      },
      {
        "codigo_sap*": "P001",
        "descripcion_articulo*": "Cemento",
        "tipo_articulo*": "Materiales",
        "codigo_almacen*": "001",
        codigo_bodega: "004",
        "cantidad_inicial*": "2",
        ubicacion: "Zona 2",
      },
    ]);

    expect(data.inventory).toHaveLength(2);
    expect(data.inventory).toEqual([
      expect.objectContaining({
        key: "P001::1::4::__SIN_UBICACION__",
        currentStock: 0,
        storageLocation: null,
      }),
      expect.objectContaining({
        key: "P001::1::4::ZONA 2",
        currentStock: 2,
        storageLocation: "Zona 2",
      }),
    ]);
  });

  it("does not preserve an existing storageLocation when Excel group is blank", () => {
    const data = parseFixture([
      {
        "codigo_sap*": "P001",
        "descripcion_articulo*": "Cemento",
        "tipo_articulo*": "Materiales",
        "codigo_almacen*": "001",
        codigo_bodega: "004",
        "cantidad_inicial*": "4",
        ubicacion: "",
      },
    ]);
    const resolvedInventory = [
      {
        ...data.inventory[0],
        project: project(),
        warehouse: warehouse(),
        projectId: 4,
        warehouseId: 1,
        warehouseLocation: "001 - ALMACEN CENTRAL",
      },
    ];
    const existingInventory: ExistingInventoryRow[] = [
      {
        id: 99,
        sapItemCode: "P001",
        projectId: 4,
        warehouseId: 1,
        storageLocation: "Ubicacion previa",
      },
    ];

    const plan = buildPlan({
      data,
      resolvedInventory,
      existingCatalogRows: [existingCatalog()],
      existingInventoryRows: existingInventory,
    });

    expect(plan.inventory.updates).toHaveLength(0);
    expect(plan.inventory.inserts).toHaveLength(1);
    expect(plan.inventory.inserts[0]).toMatchObject({
      storageLocationForDb: null,
    });
  });

  it("reconciles exact inventory by deleting old rows and inserting split locations", () => {
    const data = parseFixture([
      {
        "codigo_sap*": "P001",
        "descripcion_articulo*": "Cemento",
        "tipo_articulo*": "Materiales",
        "codigo_almacen*": "001",
        codigo_bodega: "004",
        "cantidad_inicial*": "6",
        ubicacion: "2C1",
      },
      {
        "codigo_sap*": "P001",
        "descripcion_articulo*": "Cemento",
        "tipo_articulo*": "Materiales",
        "codigo_almacen*": "001",
        codigo_bodega: "004",
        "cantidad_inicial*": "6",
        ubicacion: "2B1",
      },
    ]);
    const resolvedInventory = data.inventory.map(item => ({
      ...item,
      project: project(),
      warehouse: warehouse(),
      projectId: 4,
      warehouseId: 1,
      warehouseLocation: "001 - ALMACEN CENTRAL",
    }));
    const existingInventory: ExistingInventoryRow[] = [
      {
        id: 99,
        sapItemCode: "P001",
        projectId: 4,
        warehouseId: 1,
        storageLocation: "2C1",
      },
    ];

    const plan = buildPlan({
      data,
      resolvedInventory,
      existingCatalogRows: [existingCatalog()],
      existingInventoryRows: existingInventory,
      reconcileInventory: true,
    });

    expect(plan.inventory.reconcileDeletes).toEqual([
      expect.objectContaining({ id: 99 }),
    ]);
    expect(plan.inventory.updates).toHaveLength(0);
    expect(plan.inventory.inserts).toHaveLength(2);
    expect(plan.inventory.inserts.map(row => row.storageLocationForDb)).toEqual([
      "2C1",
      "2B1",
    ]);
  });

  it("blocks product codes that already exist as fixed assets", () => {
    const data = parseFixture([
      {
        "codigo_sap*": "P001",
        "descripcion_articulo*": "Cemento",
        "tipo_articulo*": "Materiales",
        "codigo_almacen*": "001",
        codigo_bodega: "004",
        "cantidad_inicial*": "4",
      },
    ]);
    const resolvedInventory = [
      {
        ...data.inventory[0],
        project: project(),
        warehouse: warehouse(),
        projectId: 4,
        warehouseId: 1,
        warehouseLocation: "001 - ALMACEN CENTRAL",
      },
    ];

    const plan = buildPlan({
      data,
      resolvedInventory,
      existingCatalogRows: [existingCatalog({ tipoArticulo: 3 })],
      existingInventoryRows: [],
    });

    expect(plan.catalog.existingAssetConflicts).toEqual([
      expect.objectContaining({ itemCode: "P001", tipoArticulo: 3 }),
    ]);
    expect(plan.catalog.inserts).toHaveLength(0);
    expect(plan.catalog.updates).toHaveLength(0);
    expect(plan.inventory.inserts).toHaveLength(0);
  });

  it("blocks product codes that already exist as services", () => {
    const data = parseFixture([
      {
        "codigo_sap*": "P001",
        "descripcion_articulo*": "Cemento",
        "tipo_articulo*": "Materiales",
        "codigo_almacen*": "001",
        codigo_bodega: "004",
        "cantidad_inicial*": "4",
      },
    ]);
    const resolvedInventory = [
      {
        ...data.inventory[0],
        project: project(),
        warehouse: warehouse(),
        projectId: 4,
        warehouseId: 1,
        warehouseLocation: "001 - ALMACEN CENTRAL",
      },
    ];

    const plan = buildPlan({
      data,
      resolvedInventory,
      existingCatalogRows: [existingCatalog({ tipoArticulo: 2 })],
      existingInventoryRows: [
        {
          id: 88,
          sapItemCode: "P001",
          projectId: 4,
          warehouseId: 1,
          storageLocation: null,
        },
      ],
      reconcileInventory: true,
    });

    expect(plan.catalog.existingServiceConflicts).toEqual([
      expect.objectContaining({ itemCode: "P001", tipoArticulo: 2 }),
    ]);
    expect(plan.catalog.inserts).toHaveLength(0);
    expect(plan.catalog.updates).toHaveLength(0);
    expect(plan.inventory.reconcileDeletes).toHaveLength(0);
    expect(plan.inventory.inserts).toHaveLength(0);
  });

  it("requires confirmation for apply reconcile mode", () => {
    expect(() =>
      parseArgs(["--file", "productos.xlsx", "--apply", "--reconcile-inventory"])
    ).toThrow(/RECONCILE_HIDALGO_PRODUCTS_BY_LOCATION/);
  });
});
