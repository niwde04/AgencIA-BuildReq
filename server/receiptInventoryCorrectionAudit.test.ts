import { describe, expect, it } from "vitest";
import {
  buildReceiptInventoryCorrectionPlan,
  type ReceiptCorrectionAuditRow,
  type ReceiptCorrectionInventoryRow,
} from "./_core/receiptInventoryCorrectionAudit";
import {
  APPLY_CONFIRMATION,
  classifyManifestApplyState,
  parseReceiptInventoryAuditArgs,
} from "../scripts/audit-receipt-inventory-corrections";

const caseRow: ReceiptCorrectionAuditRow = {
  receiptId: 503,
  receiptNumber: "RE-006-00000034",
  replacementReceiptId: 506,
  replacementReceiptNumber: "RE-006-00000035",
  replacementReceiptStatus: "completa",
  projectId: 15,
  receiptItemId: 972,
  sourceItemId: 989,
  sapItemCode: "090503157",
  quantityReceived: "2.00",
  warehouseId: 19,
  storageLocation: null,
  fixedAssetSapItemCode: "120200007",
  receiptItemIsFixedAsset: false,
  sourceCurrentSapItemCode: "090503157",
  sourceOriginalSapItemCode: "090503157",
  sourceIsFixedAsset: false,
  sourceFixedAssetArticleId: null,
  catalogTipoArticulo: 1,
};

const caseInventoryRow: ReceiptCorrectionInventoryRow = {
  id: 29074,
  sapItemCode: "090503157",
  projectId: 15,
  warehouseId: 19,
  storageLocation: null,
  currentStock: "2.00",
  updatedAt: "2026-07-25T22:02:29.081Z",
};

describe("receipt inventory correction audit", () => {
  it("plans the exact skipped reversal for the reported case", () => {
    const plan = buildReceiptInventoryCorrectionPlan(
      [caseRow],
      [caseInventoryRow]
    );

    expect(plan.candidateLines).toHaveLength(1);
    expect(plan.exceptions).toHaveLength(0);
    expect(plan.plannedUpdates).toEqual([
      expect.objectContaining({
        inventoryItemId: 29074,
        currentStockBefore: "2.00",
        skippedReversalQuantity: "2.00",
        currentStockAfter: "0.00",
      }),
    ]);
  });

  it("does not classify services or received fixed assets as skipped reversals", () => {
    const service = {
      ...caseRow,
      receiptItemId: 973,
      catalogTipoArticulo: 2,
    };
    const fixedAsset = {
      ...caseRow,
      receiptItemId: 974,
      catalogTipoArticulo: 3,
    };

    const plan = buildReceiptInventoryCorrectionPlan(
      [service, fixedAsset],
      [caseInventoryRow]
    );

    expect(plan.candidateLines).toHaveLength(0);
    expect(plan.plannedUpdates).toHaveLength(0);
  });

  it("groups repeated skipped reversals against the same inventory row", () => {
    const secondCorrection = {
      ...caseRow,
      receiptId: 504,
      receiptNumber: "RE-006-00000035",
      receiptItemId: 975,
      quantityReceived: "1.00",
    };
    const inventory = {
      ...caseInventoryRow,
      currentStock: "5.00",
    };

    const plan = buildReceiptInventoryCorrectionPlan(
      [caseRow, secondCorrection],
      [inventory]
    );

    expect(plan.plannedUpdates).toEqual([
      expect.objectContaining({
        currentStockBefore: "5.00",
        skippedReversalQuantity: "3.00",
        currentStockAfter: "2.00",
        sourceLines: expect.arrayContaining([
          expect.objectContaining({ receiptItemId: 972 }),
          expect.objectContaining({ receiptItemId: 975 }),
        ]),
      }),
    ]);
  });

  it("reports ambiguous and insufficient balances without planning updates", () => {
    const ambiguous = buildReceiptInventoryCorrectionPlan(
      [caseRow],
      [
        caseInventoryRow,
        {
          ...caseInventoryRow,
          id: 29075,
        },
      ]
    );
    expect(ambiguous.plannedUpdates).toHaveLength(0);
    expect(ambiguous.exceptions[0]?.code).toBe("ambiguous_inventory_rows");

    const insufficient = buildReceiptInventoryCorrectionPlan(
      [caseRow],
      [
        {
          ...caseInventoryRow,
          currentStock: "1.00",
        },
      ]
    );
    expect(insufficient.plannedUpdates).toHaveLength(0);
    expect(insufficient.exceptions[0]?.code).toBe(
      "insufficient_current_stock"
    );
  });

  it("requires backup metadata for dry-run and explicit confirmation for apply", () => {
    expect(() => parseReceiptInventoryAuditArgs(["--dry-run"])).toThrow(
      /backup-metadata/
    );
    expect(() =>
      parseReceiptInventoryAuditArgs([
        "--apply",
        "--manifest",
        "manifest.json",
      ])
    ).toThrow(/Confirmación inválida/);
    expect(
      parseReceiptInventoryAuditArgs([
        "--apply",
        "--manifest",
        "manifest.json",
        "--confirm",
        APPLY_CONFIRMATION,
      ])
    ).toEqual({
      mode: "apply",
      manifestPath: "manifest.json",
      confirmation: APPLY_CONFIRMATION,
      reportPath: null,
    });
  });

  it("classifies manifest rows as pending, applied, or conflicting", () => {
    const update = buildReceiptInventoryCorrectionPlan(
      [caseRow],
      [caseInventoryRow]
    ).plannedUpdates[0];

    expect(
      classifyManifestApplyState(update, {
        currentStock: "2.00",
        updatedAt: caseInventoryRow.updatedAt,
      })
    ).toBe("pending");
    expect(
      classifyManifestApplyState(update, {
        currentStock: "0.00",
        updatedAt: "2026-07-25T23:00:00.000Z",
      })
    ).toBe("already_applied");
    expect(
      classifyManifestApplyState(update, {
        currentStock: "3.00",
        updatedAt: caseInventoryRow.updatedAt,
      })
    ).toBe("conflict");
  });
});
