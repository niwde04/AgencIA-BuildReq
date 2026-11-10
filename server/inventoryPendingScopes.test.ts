import { describe, expect, it, vi } from "vitest";
import {
  getInventoryPendingScopeKey,
  loadInventoryPendingQuantitiesByScope,
} from "../shared/inventory-pending";
import { normalizeInventoryUnitValue } from "../shared/units";

describe("inventory pending project scopes", () => {
  it("uses the same project demand across warehouses, shelves and unit labels", () => {
    const rows = [
      {
        id: 21331,
        sapItemCode: "010200003",
        projectId: 14,
        warehouseId: 19,
        unit: "GALON",
        storageLocation: "PISO",
      },
      {
        id: 31168,
        sapItemCode: "010200003",
        project: { id: 14 },
        warehouseId: 19,
        unit: "gal",
        storageLocation: "A1",
      },
      {
        id: 28801,
        sapItemCode: " 010200003 ",
        projectId: 14,
        warehouseId: 20,
        unit: "gal",
        storageLocation: null,
      },
    ];
    expect(new Set(rows.map(getInventoryPendingScopeKey)).size).toBe(1);
  });

  it("does not merge demand from different projects or articles", () => {
    const key = getInventoryPendingScopeKey({
      sapItemCode: "ITEM",
      projectId: 1,
    });
    expect(
      getInventoryPendingScopeKey({ sapItemCode: "ITEM", projectId: 2 })
    ).not.toBe(key);
    expect(
      getInventoryPendingScopeKey({ sapItemCode: "OTHER", projectId: 1 })
    ).not.toBe(key);
  });

  it("uses the joined project when present and raw project when not joined", () => {
    expect(
      getInventoryPendingScopeKey({ sapItemCode: "ITEM", project: { id: 4 } })
    ).toBe(
      getInventoryPendingScopeKey({
        sapItemCode: "ITEM",
        project: null,
        projectId: 4,
      })
    );
    expect(
      getInventoryPendingScopeKey({
        sapItemCode: "ITEM",
        project: { id: 4 },
        projectId: 5,
      })
    ).toBe(getInventoryPendingScopeKey({ sapItemCode: "ITEM", projectId: 4 }));
  });

  it("keeps legacy unassigned warehouse scopes separate from assigned project demand", () => {
    const first = { sapItemCode: "ITEM", projectId: null, warehouseId: 10 };
    expect(getInventoryPendingScopeKey(first)).toBe(
      getInventoryPendingScopeKey({ ...first, storageLocation: "A2" } as any)
    );
    expect(getInventoryPendingScopeKey(first)).not.toBe(
      getInventoryPendingScopeKey({ ...first, warehouseId: 11 })
    );
    expect(getInventoryPendingScopeKey(first)).not.toBe(
      getInventoryPendingScopeKey({ ...first, projectId: 10 })
    );
  });

  it("uses warehouse labels only when no warehouse id exists", () => {
    const first = {
      sapItemCode: "ITEM",
      projectId: null,
      warehouseLocation: " CENTRAL ",
    };
    expect(getInventoryPendingScopeKey(first)).toBe(
      getInventoryPendingScopeKey({ ...first, warehouseLocation: "CENTRAL" })
    );
    expect(getInventoryPendingScopeKey(first)).not.toBe(
      getInventoryPendingScopeKey({ ...first, warehouseLocation: "OTHER" })
    );
    expect(getInventoryPendingScopeKey(first)).not.toBe(
      getInventoryPendingScopeKey({ sapItemCode: "ITEM" })
    );
  });

  it("loads a project's demand once for repeated inventory rows", async () => {
    const loader = vi.fn(async () => ({
      totalRequiredQuantity: "27.00",
      pendingReceiptQuantity: "27.00",
    }));
    const rows = [
      { sapItemCode: "010200003", projectId: 14, warehouseId: 19 },
      { sapItemCode: "010200003", projectId: 14, warehouseId: 20 },
      { sapItemCode: "010200003", projectId: 14, warehouseId: 20 },
    ];
    const result = await loadInventoryPendingQuantitiesByScope(rows, loader);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(result.size).toBe(1);
    expect(result.get(getInventoryPendingScopeKey(rows[2]))).toEqual({
      totalRequiredQuantity: "27.00",
      pendingReceiptQuantity: "27.00",
    });
  });

  it("loads each independent project and legacy warehouse scope", async () => {
    const loader = vi.fn(async row => ({ projectId: row.projectId }));
    const rows = [
      { sapItemCode: "ITEM", projectId: 1, warehouseId: 10 },
      { sapItemCode: "ITEM", projectId: 2, warehouseId: 10 },
      { sapItemCode: "ITEM", projectId: null, warehouseId: 10 },
      { sapItemCode: "ITEM", projectId: null, warehouseId: 10 },
    ];
    const result = await loadInventoryPendingQuantitiesByScope(rows, loader);
    expect(loader).toHaveBeenCalledTimes(3);
    expect(result.size).toBe(3);
  });

  it("does not reuse a failed demand query as zero", async () => {
    const failure = new Error("Unavailable");
    const loader = vi.fn(async () => {
      throw failure;
    });
    await expect(
      loadInventoryPendingQuantitiesByScope(
        [{ sapItemCode: "ITEM", projectId: 1 }],
        loader
      )
    ).rejects.toBe(failure);
  });
});

describe("inventory canonical unit labels", () => {
  it.each(["gal", "GALON", " galón ", "Galones"])(
    "recognizes gallon alias %s without a quantity conversion",
    unit => {
      expect(normalizeInventoryUnitValue(unit)).toBe("gal");
    }
  );

  it.each(["UND", "UND.", "UNIDAD.", "unidades", "unidad"])(
    "keeps legacy unit alias %s as und",
    unit => {
      expect(normalizeInventoryUnitValue(unit)).toBe("und");
    }
  );

  it("does not infer und as gallons from an article's expected unit", () => {
    expect(normalizeInventoryUnitValue("und")).toBe("und");
    expect(normalizeInventoryUnitValue("kg")).toBe("kg");
  });

  it("preserves unknown legacy unit values literally", () => {
    expect(normalizeInventoryUnitValue("  BOTELLA-500CC  ")).toBe(
      "BOTELLA-500CC"
    );
  });

  it.each([null, undefined, "", "   "])("keeps absent unit %j absent", unit => {
    expect(normalizeInventoryUnitValue(unit)).toBeNull();
  });
});
