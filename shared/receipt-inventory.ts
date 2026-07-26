type PurchaseOrderLineClassificationItem = {
  isFixedAsset?: boolean | null;
  fixedAssetArticleId?: number | null;
  tipoArticulo?: number | null;
  currentSapItemCode?: string | null;
  originalSapItemCode?: string | null;
  sapItemCode?: string | null;
  catalogItem?: {
    tipoArticulo?: number | null;
    itemCode?: string | null;
  } | null;
  catalog?: {
    tipoArticulo?: number | null;
    itemCode?: string | null;
  } | null;
};

type PurchaseOrderLineCatalogItem = {
  tipoArticulo?: number | null;
  itemCode?: string | null;
};

export type PurchaseOrderNonInventoryLineInput = {
  item?: Pick<PurchaseOrderLineClassificationItem, "isFixedAsset"> | null;
  sourceItem?: PurchaseOrderLineClassificationItem | null;
  catalogItem?: PurchaseOrderLineCatalogItem | null;
};

export const INVENTORY_POSTED_RECEIPT_STATUSES = [
  "parcial",
  "completa",
  "cierre_incompleto",
] as const;

export function isInventoryPostedReceiptStatus(status: string) {
  return (INVENTORY_POSTED_RECEIPT_STATUSES as readonly string[]).includes(
    status
  );
}

/**
 * Classifies the article being purchased, not the operational destination of
 * that article. In particular, fixedAssetSapItemCode is intentionally absent:
 * a spare part assigned to a fixed asset remains an inventory article.
 */
export function isPurchaseOrderNonInventoryLine(
  params: PurchaseOrderNonInventoryLineInput
) {
  const tipoArticulo = Number(
    params.sourceItem?.catalogItem?.tipoArticulo ??
      params.sourceItem?.catalog?.tipoArticulo ??
      params.sourceItem?.tipoArticulo ??
      params.catalogItem?.tipoArticulo ??
      0
  );
  const sourceCode = String(
    params.sourceItem?.currentSapItemCode ??
      params.sourceItem?.originalSapItemCode ??
      params.sourceItem?.sapItemCode ??
      params.catalogItem?.itemCode ??
      ""
  )
    .trim()
    .toUpperCase();

  return (
    tipoArticulo === 2 ||
    tipoArticulo === 3 ||
    params.item?.isFixedAsset === true ||
    params.sourceItem?.isFixedAsset === true ||
    Boolean(params.sourceItem?.fixedAssetArticleId) ||
    sourceCode.startsWith("AFT")
  );
}
