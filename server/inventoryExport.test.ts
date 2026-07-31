import { describe, expect, it } from "vitest";
import {
  buildInventoryExportRows,
  normalizeInventoryUnit,
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
      totalRequiredQuantity: 24,
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
});
