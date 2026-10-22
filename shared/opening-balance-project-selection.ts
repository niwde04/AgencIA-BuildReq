export type OpeningBalanceWarehouseCatalogEntry = {
  id: number;
  code?: string | null;
  localCode?: string | null;
  name?: string | null;
  displayName?: string | null;
  isActive: boolean;
};

export type OpeningBalanceProjectCatalogEntry = {
  id: number;
  code: string;
  name: string;
  warehouses?: readonly OpeningBalanceWarehouseCatalogEntry[] | null;
};

/** A shared warehouse never determines the opening document's project. */
export function resolveOpeningBalanceProjectSelection(
  projects: readonly OpeningBalanceProjectCatalogEntry[],
  projectId: number | undefined,
  warehouseId: number | undefined,
  registeredWarehouseIds: ReadonlySet<number>
) {
  const project = projects.find(entry => entry.id === projectId) ?? null;
  const seen = new Set<number>();
  const warehouses = (project?.warehouses ?? [])
    .filter(warehouse => {
      if (!warehouse.isActive || seen.has(warehouse.id)) return false;
      seen.add(warehouse.id);
      return true;
    })
    .map(warehouse => ({
      warehouse,
      hasOpeningBalance: registeredWarehouseIds.has(warehouse.id),
    }))
    .sort(
      (left, right) =>
        (left.warehouse.localCode || left.warehouse.code || "").localeCompare(
          right.warehouse.localCode || right.warehouse.code || "",
          "es-HN"
        ) || left.warehouse.id - right.warehouse.id
    );
  const selectedWarehouse =
    warehouses.find(
      option => option.warehouse.id === warehouseId && !option.hasOpeningBalance
    )?.warehouse ?? null;

  return { project, warehouses, selectedWarehouse };
}

/** Keep explicit mixed-project lines while dropping invalid destinations. */
export function reconcileOpeningBalanceDestinations<
  T extends { projectId: string; storageLocation: string },
>(
  rows: readonly T[],
  options: {
    defaultProjectId?: number;
    previousDefaultProjectId?: number;
    allowedProjectIds: ReadonlySet<number>;
    resetLocations?: boolean;
  }
): T[] {
  return rows.map(row => {
    const explicitProjectIsAllowed = options.allowedProjectIds.has(
      Number(row.projectId)
    );
    // Empty means "follow the opening project" in the destination fields and
    // submit normalization. Keep that marker so changing the header cannot
    // overwrite an explicitly selected, still-valid line project.
    const projectId = explicitProjectIsAllowed ? row.projectId : "";
    const defaultChanged =
      !projectId &&
      options.previousDefaultProjectId !== undefined &&
      options.previousDefaultProjectId !== options.defaultProjectId;
    const storageLocation =
      options.resetLocations || projectId !== row.projectId || defaultChanged
        ? ""
        : row.storageLocation;
    return { ...row, projectId, storageLocation };
  });
}
