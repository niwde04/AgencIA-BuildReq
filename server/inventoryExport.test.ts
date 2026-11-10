import { describe, expect, it } from "vitest";
import {
  buildInventoryExportRows,
  normalizeInventoryUnit,
  sumInventoryPendingQuantities,
} from "../client/src/lib/inventory-export";

describe("inventory export", () => {
  it.each(["und", "UND", "UND.", "unidad", "UNIDAD", "unidades"])(
    "normalizes %s as und",
    unit => {
      expect(normalizeInventoryUnit(unit)).toBe("und");
    }
  );

  it("combines equivalent units, sums stock, and fills descriptions", () => {
    const rows = buildInventoryExportRows([
      {
        sapItemCode: "050700036",
        name: "ACETILENO GAS 5.95M3",
        description: "",
        unit: "UNIDAD",
        currentStock: "3.00",
        totalRequiredQuantity: "12.00",
        pendingReceiptQuantity: "0.00",
        minimumStock: "0.00",
        project: { id: 10, code: "010", name: "San José" },
        warehouse: { id: 10, displayName: "010 - HEH SAN JOSE" },
        storageLocation: "A1",
      },
      {
        sapItemCode: "050700036",
        name: "ACETILENO GAS 5.95M3",
        description: "Descripción completa",
        unit: "und",
        currentStock: "4.00",
        totalRequiredQuantity: "12.00",
        pendingReceiptQuantity: "0.00",
        minimumStock: "0.00",
        project: { id: 10, code: "010", name: "San José" },
        warehouse: { id: 10, displayName: "010 - HEH SAN JOSE" },
        storageLocation: "B2",
      },
      {
        sapItemCode: "050700036",
        name: "ACETILENO GAS 5.95M3",
        unit: "UNIDAD",
        currentStock: "0.00",
        project: { id: 18, code: "018", name: "El Zamorano" },
        warehouse: { id: 18, displayName: "018 - EL ZAMORANO" },
      },
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      description: "Descripción completa",
      unit: "und",
      currentStock: 7,
      totalRequiredQuantity: 12,
      storageLocation: "A1 · B2",
    });
  });

  it("does not combine genuinely different units", () => {
    const rows = buildInventoryExportRows([
      {
        sapItemCode: "ITEM-1",
        unit: "und",
        currentStock: 2,
        projectId: 1,
        warehouseId: 1,
      },
      {
        sapItemCode: "ITEM-1",
        unit: "kg",
        currentStock: 5,
        projectId: 1,
        warehouseId: 1,
      },
    ]);

    expect(rows).toHaveLength(2);
  });

  it.each(["gal", "GAL", "GALON", "galón", "Galones", " gal "])(
    "normalizes gallon label %s without converting quantities",
    unit => expect(normalizeInventoryUnit(unit)).toBe("gal")
  );

  it("preserves unknown historical units and never treats und as gallons", () => {
    expect(normalizeInventoryUnit(" BOTELLA-500CC ")).toBe("BOTELLA-500CC");
    expect(normalizeInventoryUnit("und")).toBe("und");
    expect(normalizeInventoryUnit(null)).toBe("");
  });

  it("counts each article/project once across warehouses and stock rows", () => {
    expect(
      sumInventoryPendingQuantities([
        {
          sapItemCode: "OIL",
          projectId: 14,
          warehouseId: 19,
          totalRequiredQuantity: "27",
          pendingReceiptQuantity: "27",
        },
        {
          sapItemCode: "OIL",
          projectId: 14,
          warehouseId: 20,
          totalRequiredQuantity: "27",
          pendingReceiptQuantity: "27",
        },
        {
          sapItemCode: "OIL",
          projectId: 14,
          warehouseId: 20,
          totalRequiredQuantity: "27",
          pendingReceiptQuantity: "27",
        },
      ])
    ).toEqual({ totalRequiredQuantity: 27, pendingReceiptQuantity: 27 });
  });

  it("adds distinct project scopes and respects API scope metadata", () => {
    expect(
      sumInventoryPendingQuantities([
        {
          sapItemCode: "OIL",
          projectId: 14,
          totalRequiredQuantity: 27,
          pendingReceiptQuantity: 9,
        },
        {
          sapItemCode: "OIL",
          projectId: 22,
          totalRequiredQuantity: 5,
          pendingReceiptQuantity: 3,
        },
        {
          pendingScopeKey: '["OIL","project",14]',
          totalRequiredQuantity: 27,
          pendingReceiptQuantity: 9,
        },
      ])
    ).toEqual({ totalRequiredQuantity: 32, pendingReceiptQuantity: 12 });
  });

  it("does not allocate project demand to a zero-stock row omitted from Excel", () => {
    const rows = buildInventoryExportRows([
      {
        sapItemCode: "OIL",
        projectId: 14,
        warehouseId: 19,
        unit: "gal",
        currentStock: 0,
        totalRequiredQuantity: 27,
        pendingReceiptQuantity: 27,
      },
      {
        sapItemCode: "OIL",
        projectId: 14,
        warehouseId: 20,
        unit: "gal",
        currentStock: 7,
        totalRequiredQuantity: 27,
        pendingReceiptQuantity: 27,
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      currentStock: 7,
      totalRequiredQuantity: 27,
      pendingReceiptQuantity: 27,
      pendingQuantitiesReferenceOnly: false,
    });
  });

  it("exports project demand once while preserving separate physical measures", () => {
    const rows = buildInventoryExportRows([
      {
        sapItemCode: "OIL",
        projectId: 14,
        warehouseId: 19,
        unit: "gal",
        currentStock: 2,
        totalRequiredQuantity: 27,
        pendingReceiptQuantity: 27,
      },
      {
        sapItemCode: "OIL",
        projectId: 14,
        warehouseId: 20,
        unit: "gal",
        currentStock: 7,
        totalRequiredQuantity: 27,
        pendingReceiptQuantity: 27,
      },
      {
        sapItemCode: "OIL",
        projectId: 14,
        warehouseId: 20,
        unit: "und",
        currentStock: 1,
        totalRequiredQuantity: 27,
        pendingReceiptQuantity: 27,
      },
    ]);
    expect(rows).toHaveLength(3);
    expect(rows.map(row => row.currentStock)).toEqual([2, 7, 1]);
    expect(rows.map(row => row.unit)).toEqual(["gal", "gal", "und"]);
    expect(rows.reduce((sum, row) => sum + row.pendingReceiptQuantity, 0)).toBe(
      27
    );
    expect(rows.slice(1).every(row => row.pendingQuantitiesReferenceOnly)).toBe(
      true
    );
    expect(rows[1].pendingQuantitiesNote).toContain("otra fila");
  });

  it.each([false, true])(
    "keeps a project's non-zero pending total across refreshed warehouse pages (reversed=%s)",
    reversed => {
      const inputs = [
        {
          sapItemCode: "OIL",
          projectId: 14,
          warehouseId: 19,
          unit: "gal",
          currentStock: 2,
          totalRequiredQuantity: 0,
          pendingReceiptQuantity: 0,
        },
        {
          sapItemCode: "OIL",
          projectId: 14,
          warehouseId: 20,
          unit: "gal",
          currentStock: 7,
          totalRequiredQuantity: 27,
          pendingReceiptQuantity: 27,
        },
      ];
      const rows = buildInventoryExportRows(
        reversed ? inputs.reverse() : inputs
      );
      expect(rows).toHaveLength(2);
      expect(
        rows.reduce((sum, row) => sum + row.totalRequiredQuantity, 0)
      ).toBe(27);
      expect(
        rows.reduce((sum, row) => sum + row.pendingReceiptQuantity, 0)
      ).toBe(27);
      expect(rows[0].pendingQuantitiesReferenceOnly).toBe(false);
      expect(rows[1].pendingQuantitiesReferenceOnly).toBe(true);
    }
  );

  it("reproduces the oil case without turning 27 into 54, 81 or 108", () => {
    const inputs = [
      {
        id: 21331,
        projectId: 14,
        warehouseId: 19,
        unit: "GALON",
        currentStock: 0,
        storageLocation: "PISO BODEGA 1",
      },
      {
        id: 21332,
        projectId: 22,
        warehouseId: 23,
        unit: "GALON",
        currentStock: 0,
        storageLocation: "2C1",
      },
      {
        id: 21333,
        projectId: 24,
        warehouseId: 24,
        unit: "GALON",
        currentStock: 0,
      },
      {
        id: 28801,
        projectId: 14,
        warehouseId: 20,
        unit: "gal",
        currentStock: 2,
      },
      {
        id: 30645,
        projectId: 20,
        warehouseId: 31,
        unit: "und",
        currentStock: 1,
      },
      {
        id: 31168,
        projectId: 14,
        warehouseId: 19,
        unit: "gal",
        currentStock: 2,
      },
      {
        id: 31355,
        projectId: 22,
        warehouseId: 23,
        unit: "gal",
        currentStock: 3,
      },
      {
        id: 31956,
        projectId: 14,
        warehouseId: 20,
        unit: "gal",
        currentStock: 5,
        storageLocation: "1B3",
      },
    ].map(row => ({
      ...row,
      sapItemCode: "010200003",
      totalRequiredQuantity: row.projectId === 14 ? 27 : 0,
      pendingReceiptQuantity: row.projectId === 14 ? 27 : 0,
    }));
    const before = structuredClone(inputs);
    const rows = buildInventoryExportRows(inputs);
    expect(inputs).toEqual(before);
    expect(rows).toHaveLength(4);
    expect(
      rows
        .filter(row => row.unit === "gal")
        .reduce((sum, row) => sum + row.currentStock, 0)
    ).toBe(12);
    expect(rows.find(row => row.unit === "und")?.currentStock).toBe(1);
    expect(rows.reduce((sum, row) => sum + row.totalRequiredQuantity, 0)).toBe(
      27
    );
    expect(rows.reduce((sum, row) => sum + row.pendingReceiptQuantity, 0)).toBe(
      27
    );
    expect(rows.find(row => row.warehouseId === 20)?.storageLocation).toBe(
      "1B3"
    );
  });
});
