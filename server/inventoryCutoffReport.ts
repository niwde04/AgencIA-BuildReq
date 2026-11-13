import { sql, type SQL } from "drizzle-orm";
import type {
  InventoryCutoffInput,
  InventoryCutoffMetadata,
  InventoryCutoffReport,
  InventoryCutoffStockRow,
} from "../shared/inventory-cutoff-report";
import { getDb } from "./db";
import { normalizeInventoryUnitValue } from "../shared/units";
import {
  loadInventoryCutoffSources,
  loadInventoryCutoffCurrentPending,
  type InventoryCutoffExecutor,
  type InventoryCutoffGrainSource,
} from "./inventoryCutoffSources";
import {
  buildCutoffDocumentMovements,
  projectLabel,
} from "./inventoryCutoffDocuments";
import {
  cutoffDayExclusive,
  cutoffDayStart,
  cutoffInstant,
  hondurasDate,
  reconstructDocumentaryStock,
  reconstructRecordedStock,
  stockKey,
  twoMonthsBefore,
  type CutoffChange,
  type CutoffStock,
} from "./inventoryCutoffReconstruction";

export type InventoryCutoffScope = {
  projectIds?: readonly number[] | null;
  warehouseIds?: readonly number[] | null;
};
type Snapshot = {
  id: number;
  sourceKey: string;
  capturedAt: string;
  kind: "backup" | "activation";
  rowsCount: number;
  metadata: {
    earliestOfferedDay?: string;
    captureStartedAt?: string;
    captureFinishedAt?: string;
    approximate?: boolean;
  };
};
const LIMIT = 50_000;

export class InventoryCutoffReportError extends Error {}

function rows<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (
    value &&
    typeof value === "object" &&
    "rows" in value &&
    Array.isArray(value.rows)
  )
    return value.rows as T[];
  throw new Error("Respuesta de consulta inesperada");
}

function scopeSql(row: SQL, scope: InventoryCutoffScope) {
  return sql`(${scope.projectIds ? sql`(${row}->>'projectId')::int = any(${sql.param([...scope.projectIds])}::int[])` : sql`true`}
    and ${scope.warehouseIds ? sql`(${row}->>'warehouseId')::int = any(${sql.param([...scope.warehouseIds])}::int[])` : sql`true`})`;
}

function allows(
  row: { projectId: number | null; warehouseId: number | null },
  scope: InventoryCutoffScope
) {
  return (
    (!scope.projectIds ||
      (row.projectId !== null && scope.projectIds.includes(row.projectId))) &&
    (!scope.warehouseIds ||
      (row.warehouseId !== null &&
        scope.warehouseIds.includes(row.warehouseId)))
  );
}

async function snapshots(
  executor: InventoryCutoffExecutor
): Promise<Snapshot[]> {
  const ready = rows<{ ready: boolean }>(
    await executor.execute(sql`select
    to_regclass('public."inventoryReportSnapshots"') is not null
    and to_regclass('public."inventoryReportSnapshotRows"') is not null
    and to_regclass('public."inventoryReportStockChanges"') is not null as ready`)
  )[0];
  if (!ready?.ready) return [];
  return rows<Snapshot>(
    await executor.execute(sql`select id,"sourceKey",kind,"rowsCount",metadata,
    ("capturedAt" at time zone 'UTC')::text as "capturedAt"
    from public."inventoryReportSnapshots" order by "capturedAt",id limit 100`)
  );
}

function earliestDay(snapshot: Snapshot) {
  if (snapshot.metadata?.earliestOfferedDay)
    return snapshot.metadata.earliestOfferedDay;
  const date = hondurasDate(snapshot.capturedAt);
  return snapshot.kind === "backup"
    ? new Date(cutoffInstant(cutoffDayStart(date)) + 86400_000)
        .toISOString()
        .slice(0, 10)
    : date;
}

export async function getInventoryCutoffMetadata(): Promise<InventoryCutoffMetadata> {
  const today = hondurasDate(new Date());
  const database = await getDb();
  if (!database)
    return {
      ready: false,
      earliestDate: null,
      today,
      message: "El reporte no está disponible en este momento.",
    };
  const available = await snapshots(database);
  if (!available.some(snapshot => snapshot.kind === "activation"))
    return {
      ready: false,
      earliestDate: null,
      today,
      message:
        "El reporte histórico todavía no está habilitado. Contacte a Administración Central.",
    };
  return {
    ready: true,
    earliestDate: earliestDay(available[0]),
    today,
    message:
      "Las fechas anteriores al inicio del registro se reconstruyen con documentos; los saldos sin evidencia suficiente se indican como N/D.",
  };
}

async function snapshotRows(
  executor: InventoryCutoffExecutor,
  snapshot: Snapshot,
  scope: InventoryCutoffScope
) {
  const result = rows<{ rowData: CutoffStock }>(
    await executor.execute(sql`select "rowData" from public."inventoryReportSnapshotRows"
    where "snapshotId"=${snapshot.id} and ${scopeSql(sql`"rowData"`, scope)} order by id limit ${LIMIT + 1}`)
  );
  if (result.length > LIMIT)
    throw new InventoryCutoffReportError(
      "Seleccione un proyecto o almacén para reducir el reporte."
    );
  return result.map(row => row.rowData);
}

async function changes(
  executor: InventoryCutoffExecutor,
  from: string,
  through: string,
  scope: InventoryCutoffScope
) {
  const result = rows<CutoffChange>(
    await executor.execute(sql`select
    ("changedAt" at time zone 'UTC')::text as "changedAt","beforeRow","afterRow"
    from public."inventoryReportStockChanges" where "changedAt">=${new Date(cutoffInstant(from)).toISOString()}::timestamptz
      and "changedAt"<${through}::timestamptz
      and (${scopeSql(sql`"beforeRow"`, scope)} or ${scopeSql(sql`"afterRow"`, scope)})
    order by "changedAt",id limit ${LIMIT + 1}`)
  );
  if (result.length > LIMIT)
    throw new InventoryCutoffReportError(
      "El historial supera el límite del reporte. Seleccione un proyecto o almacén."
    );
  return result;
}

/** One consistent read-only snapshot for all three sheets and coverage checks. */
export async function getInventoryCutoffReport(
  input: InventoryCutoffInput,
  scope: InventoryCutoffScope
): Promise<InventoryCutoffReport> {
  const today = hondurasDate(new Date());
  let requestedEnd: string;
  try {
    requestedEnd = cutoffDayExclusive(input.cutoffDate);
  } catch {
    throw new InventoryCutoffReportError("Seleccione una fecha válida.");
  }
  if (input.cutoffDate > today)
    throw new InventoryCutoffReportError(
      "Seleccione hoy o una fecha anterior."
    );
  const database = await getDb();
  if (!database)
    throw new InventoryCutoffReportError(
      "No se pudo consultar el inventario. Intente nuevamente."
    );
  return database.transaction(
    async tx => {
      await tx.execute(sql`set local statement_timeout='25s'`);
      await tx.execute(sql`set local timezone='UTC'`);
      const available = await snapshots(tx);
      const activation = available.find(
        snapshot => snapshot.kind === "activation"
      );
      if (!activation)
        throw new InventoryCutoffReportError(
          "El reporte histórico todavía no está habilitado."
        );
      const first = available[0];
      const earliest = earliestDay(first);
      if (input.cutoffDate < earliest)
        throw new InventoryCutoffReportError(
          `Hay información disponible desde ${earliest}. Seleccione esa fecha o una posterior.`
        );
      const now = new Date().toISOString();
      const end = new Date(
        Math.min(cutoffInstant(requestedEnd), cutoffInstant(now))
      ).toISOString();
      const isRecorded =
        cutoffInstant(requestedEnd) > cutoffInstant(activation.capturedAt);
      const documentaryBaseline =
        available
          .filter(
            snapshot =>
              snapshot.kind === "backup" &&
              earliestDay(snapshot) <= input.cutoffDate &&
              cutoffInstant(snapshot.capturedAt) < cutoffInstant(requestedEnd)
          )
          .at(-1) ?? first;
      const periodStartDate = [earliest, twoMonthsBefore(input.cutoffDate)]
        .sort()
        .at(-1)!;
      const periodStart = cutoffDayStart(periodStartDate);
      const baselineStart =
        documentaryBaseline.metadata?.captureStartedAt ??
        documentaryBaseline.capturedAt;
      const sourceStart =
        isRecorded || cutoffInstant(periodStart) < cutoffInstant(baselineStart)
          ? periodStart
          : baselineStart;
      const through = new Date(
        Math.max(cutoffInstant(end), cutoffInstant(activation.capturedAt))
      ).toISOString();
      const sources = await loadInventoryCutoffSources(tx, {
        fromDate: new Date(cutoffInstant(sourceStart))
          .toISOString()
          .slice(0, 10),
        throughDate: through.slice(0, 10),
        ...scope,
      });
      const movements = buildCutoffDocumentMovements(sources);
      let stock;
      if (isRecorded) {
        const prior =
          available
            .filter(
              snapshot =>
                snapshot.kind === "activation" &&
                cutoffInstant(snapshot.capturedAt) < cutoffInstant(end)
            )
            .at(-1) ?? activation;
        stock = reconstructRecordedStock({
          baseline: await snapshotRows(tx, prior, scope),
          baselineAt: prior.capturedAt,
          cutoffExclusive: end,
          changes: await changes(tx, prior.capturedAt, end, scope),
        });
      } else {
        stock = reconstructDocumentaryStock({
          baseline: await snapshotRows(tx, documentaryBaseline, scope),
          baselineAt: documentaryBaseline.capturedAt,
          captureStartedAt: documentaryBaseline.metadata?.captureStartedAt,
          activation: await snapshotRows(tx, activation, scope),
          activationAt: activation.capturedAt,
          cutoffExclusive: requestedEnd,
          movements: movements.filter(event => allows(event, scope)),
        });
      }
      const currentByKey = new Map(
        sources.currentInventory.map(item => [
          stockKey({
            ...item,
            sapItemCode: item.sapItemCode ?? "",
            name: item.itemName,
          }),
          item,
        ])
      );
      const labels = new Map<string, InventoryCutoffGrainSource>();
      for (const row of [
        ...sources.currentInventory,
        ...sources.openingLines,
        ...sources.receiptLines,
        ...sources.exitLines,
        ...sources.returnLines,
      ]) {
        labels.set(`${row.projectId}:${row.warehouseId}`, row);
      }
      const stockRows = stock.filter(item => allows(item.row, scope));
      const rowScopes = new WeakMap<InventoryCutoffStockRow, CutoffStock>();
      const inventory: InventoryCutoffStockRow[] = stockRows
        .map(item => {
          const metadata = currentByKey.get(stockKey(item.row));
          const archived = item.row as CutoffStock & {
            brand?: string;
            partNumber?: string;
            catalogDescription?: string;
          };
          const label = labels.get(
            `${item.row.projectId}:${item.row.warehouseId}`
          );
          const result: InventoryCutoffStockRow = {
            sapItemCode: item.row.sapItemCode,
            description:
              metadata?.description ||
              archived.catalogDescription ||
              item.row.description ||
              item.row.name ||
              "",
            brand: metadata?.brand || archived.brand || "",
            partNumber: metadata?.partNumber || archived.partNumber || "",
            category: metadata?.category || item.row.category || "",
            unit: normalizeInventoryUnitValue(item.row.unit) || "",
            stock: item.quantity,
            totalRequired: null,
            pendingReceipt: null,
            projectLabel: projectLabel(
              label?.projectCode,
              label?.projectName,
              item.row.projectId
            ),
            warehouseLabel:
              label?.warehouseLabel ||
              (item.row.warehouseId
                ? `Almacén ${item.row.warehouseId}`
                : "Sin almacén registrado"),
            storageLocation:
              item.row.storageLocation?.trim() || "Sin ubicación",
            coverage: item.coverage,
            observations: `${item.reason} Pendientes históricos no disponibles.`,
          };
          rowScopes.set(result, item.row);
          return result;
        })
        .sort((a, b) =>
          [a.projectLabel, a.warehouseLabel, a.sapItemCode, a.storageLocation]
            .join("|")
            .localeCompare(
              [
                b.projectLabel,
                b.warehouseLabel,
                b.sapItemCode,
                b.storageLocation,
              ].join("|"),
              "es-HN",
              { numeric: true }
            )
        );
      if (input.cutoffDate === today) {
        const pending = await loadInventoryCutoffCurrentPending(tx, scope);
        const keyFor = (
          code: string,
          project: number | null,
          warehouse: number | null
        ) =>
          JSON.stringify([code, project, project === null ? warehouse : null]);
        const pendingByScope = new Map(
          pending.map(row => [
            keyFor(row.sapItemCode, row.projectId, row.warehouseId),
            row,
          ])
        );
        const claimed = new Set<string>();
        for (const row of inventory) {
          const source = rowScopes.get(row);
          if (!source) continue;
          const key = keyFor(
            row.sapItemCode,
            source.projectId,
            source.warehouseId
          );
          const value = pendingByScope.get(key);
          if (!value) continue;
          if (claimed.has(key)) {
            row.pendingReferenceOnly = true;
            row.observations = row.observations.replace(
              "Pendientes históricos no disponibles.",
              "Pendientes del artículo/proyecto incluidos en otra fila."
            );
          } else {
            claimed.add(key);
            row.totalRequired = Number(value.totalRequired);
            row.pendingReceipt = Number(value.pendingReceipt);
            row.observations = row.observations.replace(
              "Pendientes históricos no disponibles.",
              "Pendientes actuales del artículo/proyecto, contabilizados una sola vez."
            );
          }
        }
      }
      const from = cutoffInstant(cutoffDayStart(periodStartDate));
      const periodMovements = movements.filter(
        event =>
          allows(event, scope) &&
          cutoffInstant(event.at) >= from &&
          cutoffInstant(event.at) < cutoffInstant(end)
      );
      periodMovements.sort(
        (a, b) =>
          cutoffInstant(a.at) - cutoffInstant(b.at) || a.id.localeCompare(b.id)
      );
      const entries = periodMovements.flatMap(event =>
        event.entry ? [event.entry] : []
      );
      const exits = periodMovements.flatMap(event =>
        event.exit ? [event.exit] : []
      );
      if (inventory.length + entries.length + exits.length > LIMIT)
        throw new InventoryCutoffReportError(
          "El archivo supera el límite de registros. Seleccione un proyecto o almacén."
        );
      const unavailableRows = inventory.filter(
        row => row.stock === null
      ).length;
      const recordedRows = inventory.filter(
        row => row.coverage === "recorded"
      ).length;
      const documentaryRows = inventory.filter(
        row => row.coverage === "documentary"
      ).length;
      return {
        cutoffDate: input.cutoffDate,
        generatedAt: now,
        periodStartDate,
        timeZone: "America/Tegucigalpa",
        coverage: {
          kind: isRecorded ? "recorded" : "documentary_partial",
          baselineDate: earliest,
          recordedFrom: hondurasDate(activation.capturedAt),
          recordedRows,
          documentaryRows,
          unavailableRows,
          message: isRecorded
            ? "Existencias reconstruidas con los cambios registrados por ubicación."
            : "Reconstrucción documental del período disponible. N/D identifica saldos por ubicación que no se pudieron comprobar.",
          warnings: [
            input.cutoffDate === today
              ? "Los pendientes actuales pertenecen al artículo/proyecto y se contabilizan una sola vez entre sus ubicaciones."
              : "Total requeridas y Por recibirse históricos se muestran N/D; no se sustituyeron por valores actuales.",
            "Descripciones, marca, parte y categoría usan la información del catálogo disponible.",
            "Las hojas de movimientos usan el registro disponible de recepciones, salidas, traslados, devoluciones y reversos; los ajustes sin documento se reflejan en las existencias registradas.",
            ...(input.cutoffDate === today
              ? [
                  "El corte de hoy refleja los movimientos registrados hasta el momento de la consulta.",
                ]
              : []),
            ...(!isRecorded
              ? [
                  "El respaldo inicial tiene una ventana de captura aproximada; las asignaciones sin evidencia no se completaron por suposición.",
                ]
              : []),
          ],
        },
        inventory,
        entries,
        exits,
      };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" }
  );
}
