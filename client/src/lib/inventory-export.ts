import { getInventoryPendingScopeKey } from "@shared/inventory-pending";
import { normalizeInventoryUnitValue } from "@shared/units";

function cleanText(value: unknown) {
  return String(value ?? "").trim();
}

export function normalizeInventoryUnit(value: unknown) {
  return normalizeInventoryUnitValue(cleanText(value)) ?? "";
}

function getDescriptionCandidate(row: any) {
  const candidates = [
    { value: cleanText(row.description), priority: 3 },
    { value: cleanText(row.catalogItem?.description), priority: 2 },
    { value: cleanText(row.name), priority: 1 },
  ];
  return (
    candidates.find(candidate => candidate.value) ?? {
      value: "",
      priority: 0,
    }
  );
}

function getInventoryItemKey(row: any) {
  return (
    cleanText(row.sapItemCode) || cleanText(row.name).toLocaleLowerCase("es-HN")
  );
}

function getInventoryProjectKey(row: any) {
  return row.project?.id ?? row.projectId ?? "no-project";
}

function getInventoryWarehouseKey(row: any) {
  const warehouseId = row.warehouse?.id ?? row.warehouseId;
  if (warehouseId !== null && warehouseId !== undefined) return warehouseId;

  return (
    cleanText(row.warehouseLocation).toLocaleLowerCase("es-HN") ||
    "no-warehouse"
  );
}

function toQuantity(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function collectInventoryPendingScopes(rows: any[]) {
  const scopes = new Map<
    string,
    { totalRequiredQuantity: number; pendingReceiptQuantity: number }
  >();
  for (const row of rows) {
    const key =
      cleanText(row.pendingScopeKey) || getInventoryPendingScopeKey(row);
    const current = scopes.get(key);
    // One scope is one project total, repeated on its inventory rows. Keep a
    // single value even when a legacy API response contains different refreshes.
    scopes.set(key, {
      totalRequiredQuantity: Math.max(
        current?.totalRequiredQuantity ?? 0,
        toQuantity(row.totalRequiredQuantity)
      ),
      pendingReceiptQuantity: Math.max(
        current?.pendingReceiptQuantity ?? 0,
        toQuantity(row.pendingReceiptQuantity)
      ),
    });
  }
  return scopes;
}

export function sumInventoryPendingQuantities(rows: any[]) {
  const total = { totalRequiredQuantity: 0, pendingReceiptQuantity: 0 };
  for (const value of Array.from(
    collectInventoryPendingScopes(rows).values()
  )) {
    total.totalRequiredQuantity += value.totalRequiredQuantity;
    total.pendingReceiptQuantity += value.pendingReceiptQuantity;
  }
  return total;
}

export function buildInventoryExportRows(rows: any[]) {
  const pendingValuesByScope = collectInventoryPendingScopes(rows);
  const descriptionsByItem = new Map<
    string,
    { value: string; priority: number }
  >();

  for (const row of rows) {
    const itemKey = getInventoryItemKey(row);
    const candidate = getDescriptionCandidate(row);
    const current = descriptionsByItem.get(itemKey);
    if (
      !current ||
      candidate.priority > current.priority ||
      (candidate.priority === current.priority &&
        candidate.value.length > current.value.length)
    ) {
      descriptionsByItem.set(itemKey, candidate);
    }
  }

  const groups = new Map<
    string,
    {
      row: any;
      currentStock: number;
      pendingRows: any[];
      minimumStock: number;
      storageLocations: Set<string>;
    }
  >();

  for (const row of rows) {
    const itemKey = getInventoryItemKey(row);
    const normalizedUnit = normalizeInventoryUnit(row.unit);
    const groupKey = [
      itemKey,
      getInventoryProjectKey(row),
      getInventoryWarehouseKey(row),
      normalizedUnit.toLocaleLowerCase("es-HN"),
    ].join("::");
    const existing = groups.get(groupKey) ?? {
      row: {
        ...row,
        description: descriptionsByItem.get(itemKey)?.value ?? "",
        unit: normalizedUnit,
      },
      currentStock: 0,
      pendingRows: [],
      minimumStock: 0,
      storageLocations: new Set<string>(),
    };

    existing.currentStock += toQuantity(row.currentStock);
    existing.pendingRows.push(row);
    existing.minimumStock += toQuantity(row.minimumStock);
    const storageLocation = cleanText(row.storageLocation);
    if (storageLocation) existing.storageLocations.add(storageLocation);
    groups.set(groupKey, existing);
  }

  const includedPendingScopes = new Set<string>();
  return (
    Array.from(groups.values())
      // A zero-stock row must not claim a project's pending total and then vanish
      // from the export. Allocate references only among rows actually exported.
      .filter(group => group.currentStock > 0)
      .map(group => {
        const pendingScopes = collectInventoryPendingScopes(group.pendingRows);
        let totalRequiredQuantity = 0;
        let pendingReceiptQuantity = 0;
        let includedCount = 0;
        for (const key of Array.from(pendingScopes.keys())) {
          if (includedPendingScopes.has(key)) continue;
          includedPendingScopes.add(key);
          includedCount++;
          const value = pendingValuesByScope.get(key)!;
          totalRequiredQuantity += value.totalRequiredQuantity;
          pendingReceiptQuantity += value.pendingReceiptQuantity;
        }
        const pendingQuantitiesReferenceOnly =
          pendingScopes.size > 0 && includedCount === 0;
        return {
          ...group.row,
          currentStock: group.currentStock,
          totalRequiredQuantity,
          pendingReceiptQuantity,
          pendingQuantitiesReferenceOnly,
          pendingQuantitiesNote: pendingQuantitiesReferenceOnly
            ? "Pendientes del proyecto incluidos en otra fila de este archivo"
            : "Pendientes por artículo y proyecto, contabilizados una sola vez",
          minimumStock: group.minimumStock,
          storageLocation: Array.from(group.storageLocations).join(" · "),
        };
      })
  );
}
