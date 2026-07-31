const INVENTORY_UNIT_ALIASES = new Set(["und", "unidad", "unidades"]);

function cleanText(value: unknown) {
  return String(value ?? "").trim();
}

export function normalizeInventoryUnit(value: unknown) {
  const unit = cleanText(value);
  const key = unit.toLocaleLowerCase("es-HN").replaceAll(".", "");
  return INVENTORY_UNIT_ALIASES.has(key) ? "und" : unit;
}

function getDescriptionCandidate(row: any) {
  const candidates = [
    { value: cleanText(row.description), priority: 3 },
    { value: cleanText(row.catalogItem?.description), priority: 2 },
    { value: cleanText(row.name), priority: 1 },
  ];
  return candidates.find(candidate => candidate.value) ?? {
    value: "",
    priority: 0,
  };
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

export function buildInventoryExportRows(rows: any[]) {
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
      totalRequiredQuantity: number;
      pendingReceiptQuantity: number;
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
      totalRequiredQuantity: 0,
      pendingReceiptQuantity: 0,
      minimumStock: 0,
      storageLocations: new Set<string>(),
    };

    existing.currentStock += toQuantity(row.currentStock);
    existing.totalRequiredQuantity += toQuantity(row.totalRequiredQuantity);
    existing.pendingReceiptQuantity += toQuantity(row.pendingReceiptQuantity);
    existing.minimumStock += toQuantity(row.minimumStock);
    const storageLocation = cleanText(row.storageLocation);
    if (storageLocation) existing.storageLocations.add(storageLocation);
    groups.set(groupKey, existing);
  }

  return Array.from(groups.values())
    .map(group => ({
      ...group.row,
      currentStock: group.currentStock,
      totalRequiredQuantity: group.totalRequiredQuantity,
      pendingReceiptQuantity: group.pendingReceiptQuantity,
      minimumStock: group.minimumStock,
      storageLocation: Array.from(group.storageLocations).join(" · "),
    }))
    .filter(row => toQuantity(row.currentStock) > 0);
}
