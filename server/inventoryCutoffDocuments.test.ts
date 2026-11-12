import { describe, expect, it } from "vitest";
import { buildCutoffDocumentMovements } from "./inventoryCutoffDocuments";
import type {
  InventoryCutoffSources,
  ReceiptLineSource,
} from "./inventoryCutoffSources";

const empty = (): InventoryCutoffSources => ({
  currentInventory: [],
  openingLines: [],
  receiptLines: [],
  exitLines: [],
  returnLines: [],
});
const receipt = (
  extra: Partial<ReceiptLineSource> = {}
): ReceiptLineSource => ({
  receiptItemId: 10,
  receiptId: 2,
  documentNumber: "RE-002",
  sourceType: "transfer",
  sourceId: 3,
  sourceItemId: 9,
  status: "parcial",
  effectiveAt: "2026-10-01 18:00:00",
  recordedAt: "2026-10-05 12:00:00",
  postingDate: "2026-10-05 12:00:00",
  documentDate: null,
  invoiceNumber: null,
  isFiscalDocument: false,
  voidedAt: null,
  quantity: "3.00",
  sapItemCode: "000123",
  itemName: "Material",
  unit: "und",
  projectId: 2,
  projectCode: "002",
  projectName: "Destino",
  warehouseId: 20,
  warehouseLabel: "Bodega destino",
  storageLocation: "B",
  sourceProjectId: 1,
  sourceProjectCode: "001",
  sourceProjectName: "Origen",
  sourceWarehouseId: 10,
  sourceWarehouseLabel: "Bodega origen",
  sourceStorageLocation: "A",
  brand: "Marca recibida",
  partNumber: "0001",
  targetType: null,
  subprojectCode: null,
  subprojectName: null,
  fixedAssetCode: null,
  fixedAssetName: null,
  transferRequestId: 8,
  reverseLogisticId: 4,
  classification: "inventory",
  sourceLineMissing: false,
  ...extra,
});

describe("movimientos físicos del reporte reciente", () => {
  it("un traslado parcial genera solo sus dos efectos por lo recibido", () => {
    const source = empty();
    source.receiptLines = [receipt()];
    const events = buildCutoffDocumentMovements(source);
    expect(
      events.map(x => [
        x.direction,
        x.quantity,
        x.projectId,
        x.warehouseId,
        x.storageLocation,
      ])
    ).toEqual([
      [1, "3.00", 2, 20, "B"],
      [-1, "3.00", 1, 10, "A"],
    ]);
    expect(events[0].entry).toMatchObject({
      invoiceNumber: "",
      invoiceDate: "",
      brand: "Marca recibida",
      partNumber: "0001",
    });
  });
  it("no usa fecha de factura o fecha operativa para retrofechar el efecto registrado", () => {
    const source = empty();
    source.receiptLines = [
      receipt({
        sourceType: "purchase_order",
        documentDate: "2026-09-01 18:00:00",
      }),
    ];
    const events = buildCutoffDocumentMovements(source);
    expect(events[0].at).toBe("2026-10-05 12:00:00");
    expect(events[0].entry?.entryDate).toBe("2026-10-05");
    expect(events[0].entry?.invoiceDate).toBe("2026-09-01");
  });
  it("conserva ingreso original y reverso al anular una recepción", () => {
    const source = empty();
    source.receiptLines = [
      receipt({
        sourceType: "purchase_order",
        status: "anulada",
        voidedAt: "2026-10-10 13:00:00",
      }),
    ];
    expect(
      buildCutoffDocumentMovements(source).map(x => [x.direction, x.at])
    ).toEqual([
      [1, "2026-10-05 12:00:00"],
      [-1, "2026-10-10 13:00:00"],
    ]);
  });
  it("no trata un servicio como entrada física de inventario", () => {
    const source = empty();
    source.receiptLines = [
      receipt({
        sourceType: "purchase_order",
        classification: "non_inventory",
      }),
    ];
    expect(buildCutoffDocumentMovements(source)).toEqual([]);
  });
});
