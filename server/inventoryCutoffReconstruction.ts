import { normalizeInventoryUnitValue } from "../shared/units";

export type CutoffStock = {
  id?: number;
  sapItemCode: string;
  name?: string | null;
  description?: string | null;
  category?: string | null;
  unit?: string | null;
  projectId: number | null;
  warehouseId: number | null;
  storageLocation?: string | null;
  currentStock: string | number;
};

export type CutoffMovement = {
  id: string;
  at: string;
  sapItemCode: string;
  itemName: string;
  unit: string | null;
  projectId: number | null;
  warehouseId: number | null;
  storageLocation: string | null;
  locationKnown: boolean;
  quantity: string | number;
  direction: 1 | -1;
  uncertain?: boolean;
};

export type CutoffChange = {
  changedAt: string;
  beforeRow: CutoffStock | null;
  afterRow: CutoffStock | null;
};

export type ReconstructedStock = {
  row: CutoffStock;
  quantity: number | null;
  coverage: "recorded" | "documentary" | "unavailable";
  reason: string;
};

export function cutoffInstant(value: string | Date): number {
  if (value instanceof Date) return value.getTime();
  let normalized = value.trim().replace(" ", "T");
  if (normalized.includes("T") && /[+-]\d{2}$/.test(normalized))
    normalized += ":00";
  if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(normalized)) normalized += "Z";
  const result = Date.parse(normalized);
  if (!Number.isFinite(result)) throw new Error("Fecha de movimiento inválida");
  return result;
}

export function hondurasDate(value: string | Date): string {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value))
    return value;
  const date = value instanceof Date ? value : new Date(cutoffInstant(value));
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Tegucigalpa",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (name: string) => parts.find(p => p.type === name)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function cutoffDayExclusive(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new Error("Seleccione una fecha válida");
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.toISOString().slice(0, 10) !== value)
    throw new Error("Seleccione una fecha válida");
  return new Date(Date.UTC(y, m - 1, d + 1, 6)).toISOString();
}

export function cutoffDayStart(value: string): string {
  cutoffDayExclusive(value);
  return `${value}T06:00:00.000Z`;
}

export function twoMonthsBefore(value: string): string {
  cutoffDayExclusive(value);
  const [y, m, d] = value.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 3, 1));
  const lastDay = new Date(
    Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)
  ).getUTCDate();
  first.setUTCDate(Math.min(d, lastDay));
  return first.toISOString().slice(0, 10);
}

function units(value: string | null | undefined) {
  return normalizeInventoryUnitValue(value) ?? "";
}

export function stockScope(
  row: Pick<CutoffStock, "sapItemCode" | "projectId" | "warehouseId" | "unit">
) {
  return JSON.stringify([
    row.sapItemCode.trim(),
    row.projectId,
    row.warehouseId,
    units(row.unit),
  ]);
}

export function stockKey(row: CutoffStock) {
  return JSON.stringify([
    row.sapItemCode.trim(),
    row.projectId,
    row.warehouseId,
    String(row.storageLocation ?? "")
      .trim()
      .toLocaleLowerCase("es-HN"),
    units(row.unit),
  ]);
}

function hundredths(value: string | number): bigint {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(String(value).trim());
  if (!match || (match[3]?.slice(2) ?? "").replace(/0/g, ""))
    throw new Error("Cantidad de inventario inválida");
  const quantity =
    BigInt(match[2]) * BigInt(100) +
    BigInt((match[3] ?? "").padEnd(2, "0").slice(0, 2));
  return match[1] ? -quantity : quantity;
}

function displayQuantity(value: bigint): number {
  if (
    value > BigInt(Number.MAX_SAFE_INTEGER) ||
    value < BigInt(Number.MIN_SAFE_INTEGER)
  ) {
    throw new Error(
      "La cantidad excede el límite del reporte; reduzca los filtros"
    );
  }
  return Number(value) / 100;
}

type Cell = { row: CutoffStock; quantity: bigint };
function apply(map: Map<string, Cell>, row: CutoffStock, direction: 1 | -1) {
  const key = stockKey(row);
  const current = map.get(key);
  map.set(key, {
    row: current?.row ?? row,
    quantity:
      (current?.quantity ?? BigInt(0)) +
      BigInt(direction) * hundredths(row.currentStock),
  });
}
function stockMap(rows: CutoffStock[]) {
  const map = new Map<string, Cell>();
  for (const row of rows) apply(map, row, 1);
  return map;
}

export function reconstructRecordedStock(input: {
  baseline: CutoffStock[];
  baselineAt: string;
  cutoffExclusive: string;
  changes: CutoffChange[];
}): ReconstructedStock[] {
  const start = cutoffInstant(input.baselineAt);
  const end = cutoffInstant(input.cutoffExclusive);
  if (end <= start)
    throw new Error("La fecha es anterior a la apertura registrada");
  const state = stockMap(input.baseline);
  for (const change of input.changes) {
    const at = cutoffInstant(change.changedAt);
    if (at < start || at >= end) continue;
    if (change.beforeRow) apply(state, change.beforeRow, -1);
    if (change.afterRow) apply(state, change.afterRow, 1);
  }
  return Array.from(state.values())
    .filter(cell => cell.quantity !== BigInt(0))
    .map(cell => ({
      row: cell.row,
      quantity: displayQuantity(cell.quantity),
      coverage: "recorded" as const,
      reason:
        "Saldo reconstruido desde la apertura y los cambios registrados de inventario.",
    }));
}

export function reconstructDocumentaryStock(input: {
  baseline: CutoffStock[];
  baselineAt: string;
  captureStartedAt?: string;
  activation: CutoffStock[];
  activationAt: string;
  cutoffExclusive: string;
  movements: CutoffMovement[];
}): ReconstructedStock[] {
  const start = cutoffInstant(input.baselineAt);
  const boundaryStart = cutoffInstant(
    input.captureStartedAt ?? input.baselineAt
  );
  const activationAt = cutoffInstant(input.activationAt);
  const end = cutoffInstant(input.cutoffExclusive);
  if (end <= start || end > activationAt)
    throw new Error("Fecha fuera de la cobertura documental");
  const target = stockMap(input.baseline);
  const projected = stockMap(input.baseline);
  const actual = stockMap(input.activation);
  const uncertain: CutoffMovement[] = [];
  const reasons = new Map<string, string>();
  const seen = new Set<string>();

  for (const event of input.movements) {
    const at = cutoffInstant(event.at);
    if (at < boundaryStart || at >= activationAt) continue;
    if (seen.has(event.id))
      throw new Error("Movimiento duplicado en la reconstrucción");
    seen.add(event.id);
    if (
      at < start ||
      !event.locationKnown ||
      event.warehouseId === null ||
      event.uncertain
    ) {
      uncertain.push(event);
      continue;
    }
    const { id: _eventId, ...data } = event;
    const row: CutoffStock = {
      ...data,
      name: event.itemName,
      currentStock: event.quantity,
      unit: units(event.unit),
    };
    apply(projected, row, event.direction);
    if (at < end) apply(target, row, event.direction);
  }

  const all = new Set([
    ...Array.from(projected.keys()),
    ...Array.from(actual.keys()),
  ]);
  for (const key of Array.from(all)) {
    const expected = projected.get(key);
    const observed = actual.get(key);
    if (
      (expected?.quantity ?? BigInt(0)) !== (observed?.quantity ?? BigInt(0))
    ) {
      reasons.set(
        stockScope((expected ?? observed)!.row),
        "La reconstrucción documental no concilia con la apertura registrada; saldo histórico no disponible."
      );
    }
  }

  const matches = (row: CutoffStock, event: CutoffMovement) =>
    row.sapItemCode.trim() === event.sapItemCode.trim() &&
    row.projectId === event.projectId &&
    (event.warehouseId === null || row.warehouseId === event.warehouseId);

  const candidates = new Map<string, Cell[]>();
  const articleProject = (row: {
    sapItemCode: string;
    projectId: number | null;
  }) => JSON.stringify([row.sapItemCode.trim(), row.projectId]);
  for (const cell of Array.from(target.values())) {
    const key = articleProject(cell.row);
    candidates.set(key, [...(candidates.get(key) ?? []), cell]);
  }
  for (const event of uncertain) {
    const cells = candidates.get(articleProject(event)) ?? [];
    for (const cell of cells) {
      if (matches(cell.row, event))
        reasons.set(
          stockScope(cell.row),
          "Existen movimientos sin asignación histórica de ubicación acreditada; no se distribuyeron por suposición."
        );
    }
    if (
      cutoffInstant(event.at) < end &&
      !cells.some(cell => matches(cell.row, event))
    ) {
      const { id: _eventId, ...data } = event;
      const row: CutoffStock = {
        ...data,
        name: event.itemName,
        currentStock: 0,
        storageLocation: "Ubicación histórica no registrada",
      };
      const cell = { row, quantity: BigInt(0) };
      target.set(stockKey(row), cell);
      candidates.set(articleProject(event), [...cells, cell]);
      reasons.set(
        stockScope(row),
        "No se conserva la asignación histórica de este movimiento."
      );
    }
  }

  return Array.from(target.values()).flatMap<ReconstructedStock>(cell => {
    const reason = reasons.get(stockScope(cell.row));
    if (reason)
      return [
        {
          row: cell.row,
          quantity: null,
          coverage: "unavailable" as const,
          reason,
        },
      ];
    if (cell.quantity === BigInt(0)) return [];
    if (cell.quantity < BigInt(0))
      return [
        {
          row: cell.row,
          quantity: null,
          coverage: "unavailable" as const,
          reason:
            "El saldo documental resulta negativo; requiere revisión de la cobertura.",
        },
      ];
    return [
      {
        row: cell.row,
        quantity: displayQuantity(cell.quantity),
        coverage: "documentary" as const,
        reason:
          "Reconstrucción documental conciliada; el histórico anterior no tiene registro completo de ajustes.",
      },
    ];
  });
}
