import { describe, expect, it } from "vitest";
import {
  buildProjectAssignmentSnapshot,
  sortAssignmentTargets,
  type RawAccountedPurchaseLine,
  type RawAssignmentExitLine,
  type RawAssignmentReturnLine,
} from "./projectAssignmentLedger";

const BASE_DATE = new Date("2026-07-09T17:00:00.000Z");

function exitLine(
  overrides: Partial<RawAssignmentExitLine> = {}
): RawAssignmentExitLine {
  return {
    exitItemId: 10,
    warehouseExitId: 20,
    warehouseExitNumber: "SB-001-00000019",
    exitDate: BASE_DATE,
    emittedAt: BASE_DATE,
    exitReceivedByName: "Elton Redondo",
    requestId: 30,
    requestNumber: "REQ-001-00000014",
    sapItemCode: "010100001",
    itemName: "DIESEL",
    unit: "gal",
    quantity: "22.00",
    targetType: "subproyecto",
    subProjectId: 1,
    fixedAssetSapItemCode: null,
    fixedAssetName: null,
    status: "emitida",
    ...overrides,
  };
}

function returnLine(
  overrides: Partial<RawAssignmentReturnLine> = {}
): RawAssignmentReturnLine {
  return {
    returnItemId: 40,
    sourceWarehouseExitItemId: 10,
    returnId: 50,
    returnNumber: "DEV-001-00000001",
    processedAt: new Date("2026-07-09T18:00:00.000Z"),
    createdAt: new Date("2026-07-09T17:30:00.000Z"),
    receivedByName: "Elton Redondo",
    quantity: "22.00",
    status: "recibida",
    ...overrides,
  };
}

function purchaseLine(
  overrides: Partial<RawAccountedPurchaseLine> = {}
): RawAccountedPurchaseLine {
  return {
    invoiceItemId: 60,
    invoiceId: 70,
    invoiceDocumentNumber: "FT-001-00000070",
    fiscalInvoiceNumber: "000-001-01-00000070",
    documentDate: new Date("2026-07-08T06:00:00.000Z"),
    supplierName: "Proveedor de prueba",
    sapItemCode: "010100001",
    itemName: "DIESEL",
    unit: "gal",
    total: "2500.00",
    currency: "HNL",
    targetType: "subproyecto",
    subProjectId: 1,
    fixedAssetSapItemCode: null,
    status: "registrada",
    accountedAt: new Date("2026-07-10T14:00:00.000Z"),
    ...overrides,
  };
}

function build(params?: {
  exitLines?: RawAssignmentExitLine[];
  returnLines?: RawAssignmentReturnLine[];
  purchaseLines?: RawAccountedPurchaseLine[];
}) {
  return buildProjectAssignmentSnapshot({
    subprojects: [
      { id: 1, code: "001B-01", name: "Mantenimiento", isActive: true },
      { id: 2, code: "001B-02", name: "Alimentación", isActive: false },
    ],
    fixedAssets: [
      {
        itemCode: "AF-001",
        description: "Camión de proyecto",
        isActive: true,
      },
    ],
    exitLines: params?.exitLines ?? [exitLine()],
    returnLines: params?.returnLines ?? [],
    purchaseLines: params?.purchaseLines ?? [],
  });
}

describe("project assignment ledger", () => {
  it("keeps a fully returned item with a zero net balance and full history", () => {
    const snapshot = build({ returnLines: [returnLine()] });
    const summary = snapshot.summariesByTargetId.get("subproyecto:1");
    const movements = snapshot.movementsByTargetId.get("subproyecto:1");

    expect(summary).toEqual([
      expect.objectContaining({
        deliveredQuantity: 22,
        returnedQuantity: 22,
        netQuantity: 0,
      }),
    ]);
    expect(movements?.map(row => row.movementType)).toEqual([
      "devolucion",
      "salida",
    ]);
  });

  it("does not subtract rejected returns", () => {
    const snapshot = build({
      returnLines: [returnLine({ status: "rechazada", quantity: "5.00" })],
    });
    const summary = snapshot.summariesByTargetId.get("subproyecto:1");

    expect(summary?.[0]).toEqual(
      expect.objectContaining({
        deliveredQuantity: 22,
        returnedQuantity: 0,
        netQuantity: 22,
      })
    );
    expect(snapshot.movementsByTargetId.get("subproyecto:1")).toHaveLength(1);
  });

  it("excludes draft and cancelled exits", () => {
    const snapshot = build({
      exitLines: [
        exitLine({ exitItemId: 11, status: "borrador" }),
        exitLine({ exitItemId: 12, status: "anulada" }),
      ],
      returnLines: [],
    });

    expect(snapshot.summariesByTargetId.get("subproyecto:1")).toEqual([]);
    expect(snapshot.movementsByTargetId.get("subproyecto:1")).toEqual([]);
  });

  it("does not merge the same item when its units differ", () => {
    const snapshot = build({
      exitLines: [
        exitLine({ exitItemId: 10, unit: "gal", quantity: "2.00" }),
        exitLine({ exitItemId: 11, unit: "unidad", quantity: "3.00" }),
      ],
      returnLines: [],
    });

    const summary = snapshot.summariesByTargetId.get("subproyecto:1");
    expect(summary).toHaveLength(2);
    expect(summary?.map(row => row.unit).sort()).toEqual(["gal", "unidad"]);
  });

  it("lists configured targets without movements and groups legacy lines without a target", () => {
    const snapshot = build({
      exitLines: [
        exitLine({
          targetType: null,
          subProjectId: null,
          fixedAssetSapItemCode: null,
        }),
      ],
      returnLines: [],
    });

    expect(
      snapshot.targets.find(
        target =>
          target.targetType === "subproyecto" && target.targetKey === "2"
      )
    ).toEqual(expect.objectContaining({ articleCount: 0, isActive: false }));
    expect(
      snapshot.targets.find(target => target.targetType === "sin_destino")
    ).toEqual(
      expect.objectContaining({ name: "Sin destino definido", articleCount: 1 })
    );
  });

  it("adds totals from accounted invoices without mixing HNL and USD", () => {
    const snapshot = build({
      purchaseLines: [
        purchaseLine(),
        purchaseLine({
          invoiceItemId: 61,
          invoiceId: 71,
          invoiceDocumentNumber: "FT-001-00000071",
          currency: "USD",
          total: "125.50",
        }),
        purchaseLine({
          invoiceItemId: 62,
          total: "9999.00",
          status: "borrador",
          accountedAt: null,
        }),
      ],
    });

    const summary = snapshot.summariesByTargetId.get("subproyecto:1")?.[0];
    expect(summary).toEqual(
      expect.objectContaining({ purchasedHnl: 2500, purchasedUsd: 125.5 })
    );
    expect(summary?.purchaseInvoices).toHaveLength(2);
    expect(summary?.purchaseInvoices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          invoiceId: 70,
          supplierName: "Proveedor de prueba",
          currency: "HNL",
          lineTotal: 2500,
        }),
        expect.objectContaining({
          invoiceId: 71,
          currency: "USD",
          lineTotal: 125.5,
        }),
      ])
    );
  });

  it("sorts the complete target list before pagination", () => {
    const snapshot = build();

    expect(
      sortAssignmentTargets(snapshot.targets, "articulos", "desc")[0]
    ).toEqual(expect.objectContaining({ targetKey: "1", articleCount: 1 }));
    expect(
      sortAssignmentTargets(snapshot.targets, "destino", "desc").map(
        target => target.code
      )
    ).toEqual(["AF-001", "001B-02", "001B-01"]);
    expect(
      sortAssignmentTargets(snapshot.targets, "ultima_asignacion", "asc").at(-1)
        ?.lastAssignmentAt
    ).toBeNull();
  });
});
