import { describe, expect, it } from "vitest";
import {
  isInventoryPostedReceiptStatus,
  isPurchaseOrderNonInventoryLine,
} from "@shared/receipt-inventory";

describe("purchase-order receipt inventory classification", () => {
  it("keeps an inventory spare part inventoriable when its destination is a fixed asset", () => {
    expect(
      isPurchaseOrderNonInventoryLine({
        item: {
          isFixedAsset: false,
          fixedAssetSapItemCode: "120200007",
        } as any,
        sourceItem: {
          currentSapItemCode: "090503157",
          tipoArticulo: 1,
          isFixedAsset: false,
          fixedAssetArticleId: null,
        },
      })
    ).toBe(false);
  });

  it.each([
    {
      label: "service",
      sourceItem: { currentSapItemCode: "SRV-001", tipoArticulo: 2 },
      item: {},
    },
    {
      label: "catalog fixed asset",
      sourceItem: { currentSapItemCode: "FA-001", tipoArticulo: 3 },
      item: {},
    },
    {
      label: "resolved fixed asset article",
      sourceItem: {
        currentSapItemCode: "FA-002",
        tipoArticulo: 1,
        fixedAssetArticleId: 80,
      },
      item: {},
    },
    {
      label: "AFT code",
      sourceItem: { currentSapItemCode: "aft-0001", tipoArticulo: 1 },
      item: {},
    },
    {
      label: "receipt creates a fixed asset",
      sourceItem: { currentSapItemCode: "EQUIPO-001", tipoArticulo: 1 },
      item: { isFixedAsset: true },
    },
  ])("excludes a $label from inventory", ({ sourceItem, item }) => {
    expect(
      isPurchaseOrderNonInventoryLine({
        item,
        sourceItem,
      })
    ).toBe(true);
  });

  it("uses catalog metadata for an additional receipt line", () => {
    expect(
      isPurchaseOrderNonInventoryLine({
        item: { isFixedAsset: false },
        sourceItem: { sapItemCode: "MAT-001" },
        catalogItem: { itemCode: "MAT-001", tipoArticulo: 1 },
      })
    ).toBe(false);
  });

  it.each(["parcial", "completa", "cierre_incompleto"])(
    "includes posted receipt status %s in inventory movements",
    status => {
      expect(isInventoryPostedReceiptStatus(status)).toBe(true);
    }
  );

  it.each(["borrador", "pendiente", "anulada"])(
    "excludes non-posted receipt status %s from inventory movements",
    status => {
      expect(isInventoryPostedReceiptStatus(status)).toBe(false);
    }
  );
});
