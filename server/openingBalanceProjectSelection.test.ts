import { describe, expect, it } from "vitest";
import {
  reconcileOpeningBalanceDestinations,
  resolveOpeningBalanceProjectSelection,
} from "../shared/opening-balance-project-selection";
import { normalizeOpeningBalanceItems } from "../shared/opening-balances";

const sharedWarehouse = {
  id: 23,
  code: "014",
  localCode: "018",
  name: "EL ZAMORANO",
  isActive: true,
};
const projects = [
  {
    id: 26,
    code: "024",
    name: "Acceso escuela",
    warehouses: [sharedWarehouse],
  },
  {
    id: 22,
    code: "018",
    name: "Pinares de Uyuca",
    warehouses: [
      sharedWarehouse,
      {
        id: 14,
        code: "014",
        localCode: "014",
        name: "Otra bodega",
        isActive: true,
      },
      { id: 99, code: "099", name: "Inactiva", isActive: false },
    ],
  },
  { id: 14, code: "014", name: "Otro proyecto", warehouses: [] },
];

describe("opening balance explicit project selection", () => {
  it("requires a selected project instead of inferring it from a shared warehouse", () => {
    const selection = resolveOpeningBalanceProjectSelection(
      projects,
      undefined,
      23,
      new Set()
    );
    expect(selection.project).toBeNull();
    expect(selection.selectedWarehouse).toBeNull();
    expect(selection.warehouses).toEqual([]);
  });

  it.each([projects, [...projects].reverse()].map(catalog => ({ catalog })))(
    "keeps project 018 for the shared warehouse regardless of project order %#",
    ({ catalog }) => {
      const selection = resolveOpeningBalanceProjectSelection(
        catalog,
        22,
        23,
        new Set()
      );
      expect(selection.project?.code).toBe("018");
      expect(selection.project?.id).toBe(22);
      expect(selection.selectedWarehouse?.id).toBe(23);
    }
  );

  it("uses IDs to distinguish the warehouse's legacy 014 code from project 014", () => {
    const selection = resolveOpeningBalanceProjectSelection(
      projects,
      14,
      23,
      new Set()
    );
    expect(selection.project?.code).toBe("014");
    expect(selection.selectedWarehouse).toBeNull();
    const valid = resolveOpeningBalanceProjectSelection(
      projects,
      22,
      23,
      new Set()
    );
    expect(valid.selectedWarehouse?.localCode).toBe("018");
    expect(valid.warehouses.map(option => option.warehouse.id)).toEqual([
      14, 23,
    ]);
  });

  it("rejects stale, inactive, unassigned and already registered warehouse choices", () => {
    for (const warehouseId of [99, 999]) {
      expect(
        resolveOpeningBalanceProjectSelection(
          projects,
          22,
          warehouseId,
          new Set()
        ).selectedWarehouse
      ).toBeNull();
    }
    expect(
      resolveOpeningBalanceProjectSelection(projects, 999, 23, new Set())
        .project
    ).toBeNull();
    const registered = resolveOpeningBalanceProjectSelection(
      projects,
      22,
      23,
      new Set([23])
    );
    expect(registered.selectedWarehouse).toBeNull();
    expect(
      registered.warehouses.find(option => option.warehouse.id === 23)
        ?.hasOpeningBalance
    ).toBe(true);
    const unassigned = resolveOpeningBalanceProjectSelection(
      projects,
      26,
      14,
      new Set()
    );
    expect(unassigned.selectedWarehouse).toBeNull();
  });

  it("does not duplicate warehouse assignments", () => {
    const selection = resolveOpeningBalanceProjectSelection(
      [{ ...projects[0], warehouses: [sharedWarehouse, sharedWarehouse] }],
      26,
      23,
      new Set()
    );
    expect(selection.warehouses).toHaveLength(1);
  });
});

describe("opening balance line destination changes", () => {
  const rows = [
    { projectId: "", storageLocation: "A0", itemName: "Proyecto por defecto" },
    { projectId: "26", storageLocation: "A1", itemName: "Proyecto anterior" },
    { projectId: "14", storageLocation: "B1", itemName: "Destino explícito" },
    { projectId: "999", storageLocation: "C1", itemName: "Destino obsoleto" },
  ];

  it("defaults to the chosen opening project and preserves allowed mixed-project lines", () => {
    const result = reconcileOpeningBalanceDestinations(rows, {
      defaultProjectId: 22,
      previousDefaultProjectId: 26,
      allowedProjectIds: new Set([22, 26, 14]),
    });
    expect(result.map(row => [row.projectId, row.storageLocation])).toEqual([
      ["", ""],
      ["26", "A1"],
      ["14", "B1"],
      ["", ""],
    ]);
    expect(rows[1].storageLocation).toBe("A1");
    expect(result.map(row => row.itemName)).toEqual(
      rows.map(row => row.itemName)
    );
    expect(
      normalizeOpeningBalanceItems(
        result.map(row => ({
          ...row,
          projectId: Number(row.projectId) || undefined,
          sapItemCode: "090200032",
          quantity: "1",
        })),
        22
      ).map(row => row.projectId)
    ).toEqual([22, 26, 14, 22]);
  });

  it("clears old locations when the warehouse changes", () => {
    expect(
      reconcileOpeningBalanceDestinations(rows, {
        defaultProjectId: 22,
        allowedProjectIds: new Set([22, 26]),
        resetLocations: true,
      }).map(row => [row.projectId, row.storageLocation])
    ).toEqual([
      ["", ""],
      ["26", ""],
      ["", ""],
      ["", ""],
    ]);
  });

  it("clears destinations when a stale warehouse is removed without discarding item data", () => {
    const result = reconcileOpeningBalanceDestinations(rows, {
      allowedProjectIds: new Set(),
      resetLocations: true,
    });
    expect(
      result.every(row => row.projectId === "" && row.storageLocation === "")
    ).toBe(true);
    expect(result.map(row => row.itemName)).toEqual(
      rows.map(row => row.itemName)
    );
  });
});
