export type InventoryPendingScopeItem = {
  sapItemCode?: string | null;
  name?: string | null;
  projectId?: number | null;
  project?: { id?: number | null } | null;
  warehouseId?: number | null;
  warehouse?: { id?: number | null; displayName?: string | null } | null;
  warehouseLocation?: string | null;
};

/** Pending procurement quantities belong to an article/project, not a stock row. */
export function getInventoryPendingScopeKey(item: InventoryPendingScopeItem) {
  const article =
    item.sapItemCode?.trim() ||
    item.name?.trim().toLocaleLowerCase("es-HN") ||
    "";
  const projectId = item.project?.id ?? item.projectId;
  if (typeof projectId === "number" && projectId > 0) {
    return JSON.stringify([article, "project", projectId]);
  }

  // Legacy unassigned inventory uses the same warehouse fallback as the
  // pending-process query. Keep this scope separate from an assigned project.
  const warehouseId = item.warehouse?.id ?? item.warehouseId;
  if (typeof warehouseId === "number" && warehouseId > 0) {
    return JSON.stringify([article, "warehouse", warehouseId]);
  }
  const warehouseLocation = String(
    item.warehouseLocation ?? item.warehouse?.displayName ?? ""
  ).trim();
  return JSON.stringify([
    article,
    warehouseLocation ? "warehouse-location" : "all-projects",
    warehouseLocation,
  ]);
}

export async function loadInventoryPendingQuantitiesByScope<
  TItem extends InventoryPendingScopeItem,
  TResult,
>(items: readonly TItem[], load: (item: TItem) => Promise<TResult>) {
  const result = new Map<string, TResult>();
  for (const item of items) {
    const key = getInventoryPendingScopeKey(item);
    if (!result.has(key)) result.set(key, await load(item));
  }
  return result;
}
