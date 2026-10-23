import { createHash } from "node:crypto";
import type { ClientBase } from "pg";

export const OPENING_PROJECT_REPAIR = Object.freeze({
  operationKey: "opening-project-si-024-00000001-to-018-v1",
  openingBalanceId: 4,
  balanceNumber: "SI-024-00000001",
  warehouseId: 23,
  warehouseCode: "018",
  oldProjectId: 26,
  oldProjectCode: "024",
  projectId: 22,
  projectCode: "018",
});

/** Match the effective pg target, including query parameters that override URL authority. */
export function requireOpeningRepairCloudTarget(
  connectionString: string | undefined,
  supabaseApiUrl: string | undefined
): string {
  const projectRef = "ovaergjxbzrirmdwnwot";
  let databaseUrl: URL;
  let supabaseUrl: URL;
  try {
    databaseUrl = new URL(connectionString ?? "");
    supabaseUrl = new URL(supabaseApiUrl ?? "");
  } catch {
    throw new Error(
      "Falta la configuración válida del proyecto Cloud autorizado."
    );
  }
  const seen = new Set<string>();
  for (const [key] of Array.from(databaseUrl.searchParams.entries())) {
    if (!["sslmode", "application_name"].includes(key) || seen.has(key))
      throw new Error(
        "La conexión contiene parámetros no autorizados que pueden cambiar el destino."
      );
    seen.add(key);
  }
  const sslmode = databaseUrl.searchParams.get("sslmode");
  if (
    sslmode !== null &&
    !["require", "verify-full", "verify-ca", "prefer"].includes(sslmode)
  )
    throw new Error("La conexión contiene un modo TLS no autorizado.");
  if (sslmode === null) databaseUrl.searchParams.set("sslmode", "require");
  const username = decodeURIComponent(databaseUrl.username);
  const direct =
    databaseUrl.hostname === `db.${projectRef}.supabase.co` &&
    username === "postgres" &&
    ["", "5432"].includes(databaseUrl.port);
  const pooler =
    databaseUrl.hostname.endsWith(".pooler.supabase.com") &&
    username === `postgres.${projectRef}` &&
    ["", "5432", "6543"].includes(databaseUrl.port);
  if (
    !["postgres:", "postgresql:"].includes(databaseUrl.protocol) ||
    !(direct || pooler) ||
    databaseUrl.pathname !== "/postgres" ||
    databaseUrl.hash ||
    supabaseUrl.origin !== `https://${projectRef}.supabase.co` ||
    !["", "/"].includes(supabaseUrl.pathname) ||
    supabaseUrl.search ||
    supabaseUrl.hash ||
    supabaseUrl.username ||
    supabaseUrl.password
  )
    throw new Error(
      "El destino no coincide con el proyecto Cloud, usuario y base autorizados."
    );
  return databaseUrl.toString();
}
type RecordImage = Record<string, unknown>;
type Executor = Pick<ClientBase, "query">;
export interface OpeningProjectRepairSnapshot {
  header: RecordImage;
  warehouse: RecordImage;
  projects: RecordImage[];
  items: RecordImage[];
  inventory: RecordImage[];
}
export interface OpeningProjectRepairResult {
  operationKey: string;
  apply: boolean;
  changed: boolean;
  alreadyApplied: boolean;
  before: OpeningProjectRepairSnapshot;
  after: OpeningProjectRepairSnapshot;
  fingerprints: {
    beforeItems: string;
    afterItems: string;
    beforeInventory: string;
    afterInventory: string;
  };
}

function requireRepair(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Saldo inicial: ${message}`);
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonical(entry)])
    );
  return value;
}
function serialized(value: unknown) {
  return JSON.stringify(canonical(value));
}
function fingerprint(value: unknown) {
  return createHash("sha256").update(serialized(value)).digest("hex");
}
function withoutMutableHeaderFields(row: RecordImage) {
  return Object.fromEntries(
    Object.entries(row).filter(
      ([key]) => !["projectId", "updatedAt"].includes(key)
    )
  );
}

export async function captureOpeningBalanceRepairSnapshot(
  client: Executor
): Promise<OpeningProjectRepairSnapshot> {
  const target = OPENING_PROJECT_REPAIR;
  // JSONB preserves database timestamp precision and includes every stored column.
  const header = await client.query<{ row: RecordImage }>(
    'SELECT to_jsonb(b) AS row FROM public."openingBalances" b WHERE b.id=$1',
    [target.openingBalanceId]
  );
  const warehouse = await client.query<{ row: RecordImage }>(
    "SELECT to_jsonb(w) AS row FROM public.warehouses w WHERE w.id=$1",
    [target.warehouseId]
  );
  const projects = await client.query<RecordImage>(
    `SELECT p.id,p.code,p.status,
       (p."warehouseId"=$3 OR EXISTS (
         SELECT 1 FROM public."projectWarehouseAssignments" a
         WHERE a."projectId"=p.id AND a."warehouseId"=$3
       )) AS "belongsToWarehouse"
     FROM public.projects p WHERE p.id IN ($1,$2) ORDER BY p.id`,
    [target.oldProjectId, target.projectId, target.warehouseId]
  );
  const items = await client.query<{ row: RecordImage }>(
    'SELECT to_jsonb(i) AS row FROM public."openingBalanceItems" i WHERE i."openingBalanceId"=$1 ORDER BY i.id',
    [target.openingBalanceId]
  );
  const inventory = await client.query<{ row: RecordImage }>(
    'SELECT to_jsonb(i) AS row FROM public."inventoryItems" i WHERE i."warehouseId"=$1 ORDER BY i.id',
    [target.warehouseId]
  );
  requireRepair(header.rows.length === 1, "El documento autorizado no existe.");
  requireRepair(warehouse.rows.length === 1, "La bodega autorizada no existe.");
  return {
    header: header.rows[0].row,
    warehouse: warehouse.rows[0].row,
    projects: projects.rows,
    items: items.rows.map(row => row.row),
    inventory: inventory.rows.map(row => row.row),
  };
}
function validateBefore(before: OpeningProjectRepairSnapshot) {
  const target = OPENING_PROJECT_REPAIR;
  requireRepair(
    before.header.id === target.openingBalanceId &&
      before.header.balanceNumber === target.balanceNumber &&
      before.header.warehouseId === target.warehouseId &&
      (before.header.projectId === target.oldProjectId ||
        before.header.projectId === target.projectId),
    "El encabezado no coincide con la operación autorizada."
  );
  requireRepair(
    before.warehouse.id === target.warehouseId &&
      before.warehouse.code === target.warehouseCode &&
      before.warehouse.isActive === true,
    "La bodega no coincide con la bodega activa autorizada."
  );
  requireRepair(
    before.projects.length === 2 &&
      [
        [target.oldProjectId, target.oldProjectCode],
        [target.projectId, target.projectCode],
      ].every(([id, code]) =>
        before.projects.some(
          project =>
            project.id === id &&
            project.code === code &&
            project.status === "activo" &&
            project.belongsToWarehouse === true
        )
      ),
    "Ambos proyectos deben estar activos y asignados a la bodega."
  );
  requireRepair(
    before.items.length > 0 &&
      before.items.every(
        item =>
          item.openingBalanceId === target.openingBalanceId &&
          item.projectId === target.projectId
      ),
    "Todas las líneas deben pertenecer explícitamente al proyecto 018; se requiere nueva revisión."
  );
}
function validateAfter(
  before: OpeningProjectRepairSnapshot,
  after: OpeningProjectRepairSnapshot
) {
  requireRepair(
    after.header.projectId === OPENING_PROJECT_REPAIR.projectId &&
      typeof after.header.updatedAt === "string" &&
      serialized(withoutMutableHeaderFields(before.header)) ===
        serialized(withoutMutableHeaderFields(after.header)),
    "El encabezado cambió fuera de los campos autorizados."
  );
  for (const field of ["warehouse", "projects", "items", "inventory"] as const)
    requireRepair(
      serialized(before[field]) === serialized(after[field]),
      `Se detectó un cambio inesperado en ${field}; se revierte la operación.`
    );
}

/** Owns its transaction. The supplied connection must not already be in a transaction. */
export async function repairOpeningBalanceProject(
  client: Executor,
  options: {
    apply: boolean;
    /** Must durably persist this complete locked before-image before resolving. */
    beforeApply?: (before: OpeningProjectRepairSnapshot) => Promise<void>;
    /** Must durably persist the before/after audit with status prepared before resolving. */
    beforeCommit?: (result: OpeningProjectRepairResult) => Promise<void>;
  }
): Promise<OpeningProjectRepairResult> {
  if (options.apply) {
    requireRepair(
      typeof options.beforeApply === "function",
      "Falta el respaldo durable obligatorio."
    );
    requireRepair(
      typeof options.beforeCommit === "function",
      "Falta el manifiesto durable obligatorio."
    );
  }
  const target = OPENING_PROJECT_REPAIR;
  await client.query(
    `BEGIN ISOLATION LEVEL REPEATABLE READ ${options.apply ? "READ WRITE" : "READ ONLY"}`
  );
  try {
    await client.query("SET LOCAL lock_timeout='5s'");
    await client.query("SET LOCAL statement_timeout='30s'");
    if (options.apply) {
      // Same warehouse-first order used by the application's stock creation path.
      await client.query(
        "SELECT id FROM public.warehouses WHERE id=$1 FOR UPDATE",
        [target.warehouseId]
      );
      await client.query(
        'SELECT id FROM public."openingBalances" WHERE id=$1 FOR UPDATE',
        [target.openingBalanceId]
      );
      await client.query(
        "SELECT id FROM public.projects WHERE id IN ($1,$2) FOR SHARE",
        [target.oldProjectId, target.projectId]
      );
      await client.query(
        'SELECT id FROM public."projectWarehouseAssignments" WHERE "warehouseId"=$1 AND "projectId" IN ($2,$3) FOR SHARE',
        [target.warehouseId, target.oldProjectId, target.projectId]
      );
    }
    const before = await captureOpeningBalanceRepairSnapshot(client);
    validateBefore(before);
    const alreadyApplied = before.header.projectId === target.projectId;
    let after = before;
    if (options.apply) await options.beforeApply!(structuredClone(before));
    if (options.apply && !alreadyApplied) {
      const updated = await client.query(
        `UPDATE public."openingBalances" SET "projectId"=$1,"updatedAt"=clock_timestamp()
         WHERE id=$2 AND "warehouseId"=$3 AND "projectId"=$4 AND "balanceNumber"=$5 RETURNING id`,
        [
          target.projectId,
          target.openingBalanceId,
          target.warehouseId,
          target.oldProjectId,
          target.balanceNumber,
        ]
      );
      requireRepair(
        updated.rowCount === 1,
        "El documento cambió durante la regularización."
      );
      after = await captureOpeningBalanceRepairSnapshot(client);
      validateAfter(before, after);
    }
    const result: OpeningProjectRepairResult = {
      operationKey: target.operationKey,
      apply: options.apply,
      changed: options.apply && !alreadyApplied,
      alreadyApplied,
      before,
      after,
      fingerprints: {
        beforeItems: fingerprint(before.items),
        afterItems: fingerprint(after.items),
        beforeInventory: fingerprint(before.inventory),
        afterInventory: fingerprint(after.inventory),
      },
    };
    if (options.apply) await options.beforeCommit!(structuredClone(result));
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}
