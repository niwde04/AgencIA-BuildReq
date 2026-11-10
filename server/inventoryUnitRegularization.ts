import { createHash } from "node:crypto";
import type { ClientBase } from "pg";

export const INVENTORY_UNIT_REGULARIZATION = Object.freeze({
  operationKey: "inventory-unit-010200003-gal-v1",
  projectRef: "ovaergjxbzrirmdwnwot",
  sapItemCode: "010200003",
  catalogId: 14805,
  inventoryIds: [21331, 21332, 21333, 28801, 30645, 31168, 31355, 31956],
  targetIds: [21331, 21332, 21333, 30645],
  unit: "gal",
  applyToken:
    "REGULARIZAR_UNIDAD_ovaergjxbzrirmdwnwot_010200003_21331-21332-21333-30645_GAL",
  restoreToken:
    "RESTAURAR_UNIDAD_ovaergjxbzrirmdwnwot_010200003_21331-21332-21333-30645",
});

export type InventoryUnitScope = "aliases" | "all";
export function inventoryUnitScope(scope: InventoryUnitScope) {
  requireState(
    scope === "aliases" || scope === "all",
    "alcance de regularización inválido."
  );
  return scope === "aliases"
    ? {
        operationKey: "inventory-unit-010200003-gallon-aliases-v1",
        targetIds: [21331, 21332, 21333],
        applyToken:
          "NORMALIZAR_ALIAS_ovaergjxbzrirmdwnwot_010200003_21331-21332-21333_GAL",
        restoreToken:
          "RESTAURAR_ALIAS_ovaergjxbzrirmdwnwot_010200003_21331-21332-21333",
      }
    : {
        operationKey: INVENTORY_UNIT_REGULARIZATION.operationKey,
        targetIds: [...INVENTORY_UNIT_REGULARIZATION.targetIds],
        applyToken: INVENTORY_UNIT_REGULARIZATION.applyToken,
        restoreToken: INVENTORY_UNIT_REGULARIZATION.restoreToken,
      };
}

const EXPECTED = [
  {
    id: 21331,
    unit: "GALON",
    stock: 0,
    projectId: 14,
    warehouseId: 19,
    warehouseLocation: "001 - HEH LA BARCA",
    storageLocation: "PISO BODEGA 1",
    updatedAt: "2026-10-21T11:52:29.896",
  },
  {
    id: 21332,
    unit: "GALON",
    stock: 0,
    projectId: 22,
    warehouseId: 23,
    warehouseLocation: "018 - EL ZAMORANO",
    storageLocation: "2C1",
    updatedAt: "2026-10-02T21:36:45.096",
  },
  {
    id: 21333,
    unit: "GALON",
    stock: 0,
    projectId: 24,
    warehouseId: 24,
    warehouseLocation: "20 - HEH SAN FRANCISCO DE BECERRA",
    storageLocation: null,
    updatedAt: "2026-08-31T17:12:46.963",
  },
  {
    id: 30645,
    unit: "und",
    stock: 1,
    projectId: 20,
    warehouseId: 31,
    warehouseLocation: "023 - HEH OJO DE AGUA",
    storageLocation: null,
    updatedAt: "2026-08-31T17:12:31.694174",
  },
] as const;

type Executor = Pick<ClientBase, "query">;
type Fields = Record<string, unknown>;

/** Full inventory images only; catalogue/documents contain identifiers and server-side hashes. */
export interface InventoryUnitSnapshot {
  timeZone: string;
  catalog: string;
  inventory: string[];
  documents: Record<string, string[]>;
}
export interface InventoryUnitPlan {
  format: "buildreq-inventory-unit-plan-v2";
  operationKey: string;
  projectRef: string;
  sapItemCode: string;
  targetIds: number[];
  scope: InventoryUnitScope;
  generatedAt: string;
  before: InventoryUnitSnapshot;
  beforeFingerprint: string;
  classification: "pending" | "already-aligned";
}
export interface InventoryUnitResult {
  operationKey: string;
  mode: "apply" | "restore";
  scope: InventoryUnitScope;
  changedInventoryIds: number[];
  changed: boolean;
  alreadyAligned: boolean;
  actor: string;
  reason: string;
  physicalEquivalenceConfirmed: boolean;
  compatibleReadersConfirmed: boolean;
  readerEvidence: string;
  planFingerprint: string;
  before: InventoryUnitSnapshot;
  after: InventoryUnitSnapshot;
  fingerprints: { before: string; after: string; protectedDocuments: string };
}
export class InventoryUnitRegularizationError extends Error {
  constructor(message: string) {
    super(`Unidad de inventario: ${message}`);
    this.name = "InventoryUnitRegularizationError";
  }
}
export class InventoryUnitCommitOutcomeUnknownError extends InventoryUnitRegularizationError {
  constructor() {
    super(
      "el resultado del COMMIT no pudo confirmarse. Conserve el respaldo y prepared-result.json y verifique las imágenes actuales antes de reintentar; no suponga que hubo rollback."
    );
    this.name = "InventoryUnitCommitOutcomeUnknownError";
  }
}
function requireState(value: unknown, message: string): asserts value {
  if (!value) throw new InventoryUnitRegularizationError(message);
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, canonical(entry)])
    );
  return value;
}
export function inventoryUnitFingerprint(value: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}
function parse(image: string): Fields {
  const result: unknown = JSON.parse(image);
  requireState(
    result && typeof result === "object" && !Array.isArray(result),
    "imagen de fila inválida."
  );
  return result as Fields;
}
function immutableInventory(image: string) {
  return Object.fromEntries(
    Object.entries(parse(image)).filter(
      ([key]) => !["unit", "updatedAt"].includes(key)
    )
  );
}
function requireDocument(
  snapshot: InventoryUnitSnapshot,
  table: string,
  id: number
) {
  const row = snapshot.documents[table]?.map(parse).find(row => row.id === id);
  requireState(row, `falta el antecedente ${table} ${id}.`);
  return row;
}

export function classifyInventoryUnitSnapshot(
  snapshot: InventoryUnitSnapshot,
  scope: InventoryUnitScope = "aliases"
): "pending" | "already-aligned" {
  const target = INVENTORY_UNIT_REGULARIZATION;
  const selected = inventoryUnitScope(scope);
  const catalog = parse(snapshot.catalog);
  requireState(
    catalog.id === target.catalogId &&
      catalog.itemCode === target.sapItemCode &&
      catalog.unit === "gal",
    "el maestro no coincide con el artículo y unidad aprobados."
  );
  const rows = snapshot.inventory.map(parse);
  requireState(
    JSON.stringify(rows.map(row => row.id)) ===
      JSON.stringify(target.inventoryIds),
    "cambió el conjunto de existencias del artículo."
  );
  let original = 0;
  let aligned = 0;
  for (const expected of EXPECTED) {
    const row = rows.find(row => row.id === expected.id);
    requireState(
      row &&
        row.sapItemCode === target.sapItemCode &&
        row.name === "ACEITE 2 TIEMPOS",
      `identidad inesperada en inventario ${expected.id}.`
    );
    requireState(
      row.projectId === expected.projectId &&
        row.warehouseId === expected.warehouseId &&
        row.warehouseLocation === expected.warehouseLocation &&
        row.storageLocation === expected.storageLocation,
      `cambió proyecto, almacén o estante de ${expected.id}.`
    );
    requireState(
      Number(row.currentStock) === expected.stock &&
        row.minimumStock === null &&
        row.isActive === true,
      `cambió existencia, mínimo o estado de ${expected.id}.`
    );
    if (row.unit === expected.unit) {
      requireState(
        row.updatedAt === expected.updatedAt,
        `cambió la fecha de actualización de ${expected.id}.`
      );
      if (selected.targetIds.includes(expected.id)) original++;
    } else if (
      row.unit === target.unit &&
      selected.targetIds.includes(expected.id)
    )
      aligned++;
    else
      throw new InventoryUnitRegularizationError(
        `unidad inesperada en ${expected.id}.`
      );
  }
  requireState(
    original + aligned === selected.targetIds.length,
    "el alcance de las unidades no coincide con el plan."
  );
  for (const row of rows.filter(
    row => !target.targetIds.includes(Number(row.id))
  )) {
    requireState(
      row.sapItemCode === target.sapItemCode && row.unit === "gal",
      "hay otras existencias fuera del alcance con una unidad distinta."
    );
  }
  const request = requireDocument(snapshot, "requestItems", 4166);
  requireState(
    request.requestId === 1910 &&
      request.sapItemCode === target.sapItemCode &&
      request.unit === "und" &&
      Number(request.quantity) === 1 &&
      request.status === "completo",
    "cambió la línea original de la requisición."
  );
  const line = requireDocument(snapshot, "transferRequestItems", 234);
  requireState(
    line.transferRequestId === 63 &&
      line.materialRequestItemId === 4166 &&
      line.sapItemCode === target.sapItemCode &&
      line.unit === "und" &&
      Number(line.quantity) === 1 &&
      Number(line.receivedQuantity) === 1 &&
      line.sourceProjectId === 24 &&
      line.sourceWarehouseId === 24 &&
      line.sourceStorageLocation === null,
    "cambió la línea de traslado o su recepción."
  );
  const receipt = requireDocument(snapshot, "receiptItems", 4687);
  requireState(
    receipt.receiptId === 1503 &&
      receipt.sourceItemId === 234 &&
      receipt.warehouseId === 31 &&
      receipt.sapItemCode === target.sapItemCode &&
      receipt.unit === "und" &&
      Number(receipt.quantityExpected) === 1 &&
      Number(receipt.quantityReceived) === 1,
    "cambió el antecedente de recepción."
  );
  const requestHeader = requireDocument(snapshot, "materialRequests", 1910);
  const transferHeader = requireDocument(snapshot, "transferRequests", 63);
  const transfer = requireDocument(snapshot, "transfers", 47);
  const receiptHeader = requireDocument(snapshot, "receipts", 1503);
  requireState(
    requestHeader.requestNumber === "REQ-020-00000082" &&
      requestHeader.projectId === 24 &&
      transferHeader.requestNumber === "ST-020-00000004" &&
      transferHeader.destinationProjectId === 20 &&
      transferHeader.destinationWarehouseId === 31 &&
      transfer.transferNumber === "TR-020-00000003" &&
      transfer.transferRequestId === 63 &&
      receiptHeader.receiptNumber === "RE-023-00000074" &&
      receiptHeader.sourceType === "transfer" &&
      receiptHeader.sourceId === 47 &&
      receiptHeader.projectId === 20,
    "la cadena documental no coincide con el respaldo aprobado."
  );
  return original > 0 ? "pending" : "already-aligned";
}

const DOCUMENT_QUERIES: Record<string, string> = {
  requestItems: 't."sapItemCode"=$1',
  purchaseRequestItems:
    '(t."currentSapItemCode"=$1 OR t."originalSapItemCode"=$1)',
  purchaseOrderItems:
    '(t."currentSapItemCode"=$1 OR t."originalSapItemCode"=$1)',
  transferRequestItems: 't."sapItemCode"=$1',
  receiptItems: '(t."sapItemCode"=$1 OR t."requestedSapItemCode"=$1)',
  warehouseExitItems: 't."sapItemCode"=$1',
  reverseLogisticsItems: 't."sapItemCode"=$1',
  openingBalanceItems: 't."sapItemCode"=$1',
  invoiceItems: '(t."currentSapItemCode"=$1 OR t."originalSapItemCode"=$1)',
  materialRequests:
    't.id IN (SELECT "requestId" FROM "requestItems" WHERE "sapItemCode"=$1)',
  purchaseRequests:
    't.id IN (SELECT "purchaseRequestId" FROM "purchaseRequestItems" WHERE "currentSapItemCode"=$1 OR "originalSapItemCode"=$1)',
  purchaseOrders:
    't.id IN (SELECT "purchaseOrderId" FROM "purchaseOrderItems" WHERE "currentSapItemCode"=$1 OR "originalSapItemCode"=$1)',
  transferRequests:
    't.id IN (SELECT "transferRequestId" FROM "transferRequestItems" WHERE "sapItemCode"=$1)',
  transfers:
    't."transferRequestId" IN (SELECT "transferRequestId" FROM "transferRequestItems" WHERE "sapItemCode"=$1)',
  receipts:
    't.id IN (SELECT "receiptId" FROM "receiptItems" WHERE "sapItemCode"=$1 OR "requestedSapItemCode"=$1)',
  warehouseExits:
    't.id IN (SELECT "warehouseExitId" FROM "warehouseExitItems" WHERE "sapItemCode"=$1)',
  invoices:
    't.id IN (SELECT "invoiceId" FROM "invoiceItems" WHERE "currentSapItemCode"=$1 OR "originalSapItemCode"=$1)',
};
const CHAIN_FIELDS: Record<string, { id: number; fields: string[] }> = {
  requestItems: {
    id: 4166,
    fields: ["requestId", "sapItemCode", "unit", "quantity", "status"],
  },
  transferRequestItems: {
    id: 234,
    fields: [
      "transferRequestId",
      "materialRequestItemId",
      "sapItemCode",
      "unit",
      "quantity",
      "receivedQuantity",
      "sourceProjectId",
      "sourceWarehouseId",
      "sourceStorageLocation",
    ],
  },
  receiptItems: {
    id: 4687,
    fields: [
      "receiptId",
      "sourceItemId",
      "warehouseId",
      "sapItemCode",
      "unit",
      "quantityExpected",
      "quantityReceived",
    ],
  },
  materialRequests: { id: 1910, fields: ["requestNumber", "projectId"] },
  transferRequests: {
    id: 63,
    fields: ["requestNumber", "destinationProjectId", "destinationWarehouseId"],
  },
  transfers: { id: 47, fields: ["transferNumber", "transferRequestId"] },
  receipts: {
    id: 1503,
    fields: ["receiptNumber", "sourceType", "sourceId", "projectId"],
  },
};
const ROW_SHA256 =
  "pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(to_jsonb(t)::text,'UTF8')),'hex')";

export async function captureInventoryUnitSnapshot(
  client: Executor,
  lock = false
): Promise<InventoryUnitSnapshot> {
  const code = INVENTORY_UNIT_REGULARIZATION.sapItemCode;
  const timeZone = String(
    (await client.query("SELECT current_setting('TimeZone') AS \"timeZone\""))
      .rows[0].timeZone
  );
  const catalog = await client.query<{ image: string }>(
    `SELECT jsonb_build_object('id',t.id,'itemCode',t."itemCode",'unit',t.unit,'sha256',${ROW_SHA256})::text AS image FROM public."sapCatalog" t WHERE "itemCode"=$1 ORDER BY id${lock ? " FOR SHARE" : ""}`,
    [code]
  );
  requireState(
    catalog.rows.length === 1,
    "el catálogo no contiene exactamente un artículo."
  );
  const inventory = await client.query<{ image: string }>(
    `SELECT to_jsonb(t)::text AS image FROM public."inventoryItems" t WHERE "sapItemCode"=$1 ORDER BY id${lock ? " FOR UPDATE" : ""}`,
    [code]
  );
  const documents: Record<string, string[]> = Object.fromEntries(
    Object.keys(DOCUMENT_QUERIES).map(table => [table, []])
  );
  const documentSql =
    Object.entries(DOCUMENT_QUERIES)
      .map(([table, where]) => {
        const chain = CHAIN_FIELDS[table];
        const projection = `jsonb_build_object('id',t.id,'sha256',${ROW_SHA256})`;
        const minimalChain = chain
          ? ` || CASE WHEN t.id=${chain.id} THEN jsonb_build_object(${chain.fields.map(field => `'${field}',to_jsonb(t)->'${field}'`).join(",")}) ELSE '{}'::jsonb END`
          : "";
        return `SELECT '${table}'::text AS "tableName",t.id,(${projection}${minimalChain})::text AS image FROM public."${table}" t WHERE ${where}`;
      })
      .join(" UNION ALL ") + ' ORDER BY "tableName",id';
  const documentRows = await client.query<{ tableName: string; image: string }>(
    documentSql,
    [code]
  );
  for (const row of documentRows.rows) documents[row.tableName].push(row.image);
  return {
    timeZone,
    catalog: catalog.rows[0].image,
    inventory: inventory.rows.map(row => row.image),
    documents,
  };
}

export function createInventoryUnitPlan(
  snapshot: InventoryUnitSnapshot,
  scope: InventoryUnitScope = "aliases"
): InventoryUnitPlan {
  const selected = inventoryUnitScope(scope);
  return {
    format: "buildreq-inventory-unit-plan-v2",
    operationKey: selected.operationKey,
    projectRef: INVENTORY_UNIT_REGULARIZATION.projectRef,
    sapItemCode: INVENTORY_UNIT_REGULARIZATION.sapItemCode,
    targetIds: selected.targetIds,
    scope,
    generatedAt: new Date().toISOString(),
    before: snapshot,
    beforeFingerprint: inventoryUnitFingerprint(snapshot),
    classification: classifyInventoryUnitSnapshot(snapshot, scope),
  };
}
function validatePlan(plan: InventoryUnitPlan) {
  const target = INVENTORY_UNIT_REGULARIZATION;
  const selected = inventoryUnitScope(plan.scope);
  requireState(
    plan.format === "buildreq-inventory-unit-plan-v2" &&
      plan.operationKey === selected.operationKey &&
      plan.projectRef === target.projectRef &&
      plan.sapItemCode === target.sapItemCode &&
      JSON.stringify(plan.targetIds) === JSON.stringify(selected.targetIds),
    "el manifiesto no corresponde al alcance autorizado."
  );
  requireState(
    plan.beforeFingerprint === inventoryUnitFingerprint(plan.before),
    "el manifiesto de respaldo fue alterado."
  );
  requireState(
    plan.classification ===
      classifyInventoryUnitSnapshot(plan.before, plan.scope),
    "clasificación del manifiesto inválida."
  );
}
async function begin(client: Executor, readOnly: boolean) {
  await client.query(
    `BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ${readOnly ? " READ ONLY" : ""}`
  );
  await client.query("SET LOCAL statement_timeout='15000ms'");
  await client.query("SET LOCAL lock_timeout='5000ms'");
  if (readOnly)
    requireState(
      (await client.query("SHOW transaction_read_only")).rows[0]
        .transaction_read_only === "on",
      "no se pudo activar la lectura exclusiva."
    );
}
export async function inspectInventoryUnitRegularization(
  client: Executor,
  scope: InventoryUnitScope = "aliases"
) {
  await begin(client, true);
  try {
    const plan = createInventoryUnitPlan(
      await captureInventoryUnitSnapshot(client),
      scope
    );
    await client.query("ROLLBACK");
    return plan;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

interface AuditHooks {
  beforeApply: (snapshot: InventoryUnitSnapshot) => Promise<void>;
  beforeCommit: (result: InventoryUnitResult) => Promise<void>;
}
interface Operator {
  actor: string;
  reason: string;
}
function requireOperator(options: Operator) {
  requireState(
    options.actor.trim().length >= 3 &&
      options.actor.length <= 200 &&
      options.reason.trim().length >= 10 &&
      options.reason.length <= 1000,
    "indique responsable y motivo explícitos para la auditoría."
  );
}
function assertPreserved(
  before: InventoryUnitSnapshot,
  after: InventoryUnitSnapshot,
  changedInventoryIds: number[]
) {
  requireState(
    before.timeZone === after.timeZone &&
      before.catalog === after.catalog &&
      inventoryUnitFingerprint(before.documents) ===
        inventoryUnitFingerprint(after.documents),
    "cambió un antecedente documental o el maestro; se revierte la operación."
  );
  requireState(
    before.inventory.length === after.inventory.length,
    "cambió el conjunto de existencias."
  );
  for (let index = 0; index < before.inventory.length; index++) {
    const oldRow = before.inventory[index];
    const newRow = after.inventory[index];
    const id = Number(parse(oldRow).id);
    requireState(
      changedInventoryIds.includes(id)
        ? inventoryUnitFingerprint(immutableInventory(oldRow)) ===
            inventoryUnitFingerprint(immutableInventory(newRow))
        : oldRow === newRow,
      "cambió una cantidad, mínimo, ubicación u otro dato ajeno a la unidad."
    );
  }
}
function alignedEquivalent(
  before: InventoryUnitSnapshot,
  current: InventoryUnitSnapshot,
  scope: InventoryUnitScope
) {
  if (
    before.timeZone !== current.timeZone ||
    before.catalog !== current.catalog ||
    inventoryUnitFingerprint(before.documents) !==
      inventoryUnitFingerprint(current.documents) ||
    before.inventory.length !== current.inventory.length
  )
    return false;
  return before.inventory.every((row, index) => {
    const next = current.inventory[index];
    return inventoryUnitScope(scope).targetIds.includes(Number(parse(row).id))
      ? inventoryUnitFingerprint(immutableInventory(row)) ===
          inventoryUnitFingerprint(immutableInventory(next)) &&
          parse(next).unit === "gal"
      : row === next;
  });
}

export async function applyInventoryUnitRegularization(
  client: Executor,
  plan: InventoryUnitPlan,
  options: Operator &
    AuditHooks & {
      confirmation: string;
      confirmOneUndIsOneGal: boolean;
      confirmCompatibleReaders: boolean;
      readerEvidence: string;
    }
): Promise<InventoryUnitResult> {
  validatePlan(plan);
  const selected = inventoryUnitScope(plan.scope);
  requireOperator(options);
  requireState(
    options.confirmation === selected.applyToken,
    "confirmación de aplicación inválida."
  );
  requireState(
    plan.scope === "aliases" || options.confirmOneUndIsOneGal === true,
    "falta confirmar físicamente que 1 und representa 1 galón."
  );
  requireState(
    options.confirmCompatibleReaders === true &&
      options.readerEvidence.trim().length >= 8 &&
      options.readerEvidence.length <= 500,
    "falta constancia de publicación y verificación de los lectores de unidades y pendientes compatibles."
  );
  requireState(
    typeof options.beforeApply === "function" &&
      typeof options.beforeCommit === "function",
    "se requiere respaldo y auditoría durables antes del commit."
  );
  await begin(client, false);
  let commitAttempted = false;
  try {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      INVENTORY_UNIT_REGULARIZATION.operationKey,
    ]);
    const before = await captureInventoryUnitSnapshot(client, true);
    const state = classifyInventoryUnitSnapshot(before, plan.scope);
    const alreadyAligned = state === "already-aligned";
    requireState(
      alreadyAligned
        ? alignedEquivalent(plan.before, before, plan.scope)
        : inventoryUnitFingerprint(before) === plan.beforeFingerprint,
      "los datos cambiaron desde el plan revisado; genere y revise otro dry-run."
    );
    await options.beforeApply(before);
    requireState(
      inventoryUnitFingerprint(before) ===
        inventoryUnitFingerprint(
          await captureInventoryUnitSnapshot(client, true)
        ),
      "los datos cambiaron durante el respaldo."
    );
    const changedInventoryIds = selected.targetIds.filter(
      id =>
        parse(before.inventory.find(row => parse(row).id === id)!).unit !==
        "gal"
    );
    if (!alreadyAligned) {
      for (const id of changedInventoryIds) {
        const image = before.inventory.find(row => parse(row).id === id)!;
        const result = await client.query(
          `UPDATE public."inventoryItems" t SET unit='gal',"updatedAt"=timezone('America/Tegucigalpa',transaction_timestamp()) WHERE id=$1 AND to_jsonb(t)=$2::jsonb RETURNING id`,
          [id, image]
        );
        requireState(
          result.rowCount === 1,
          `la existencia ${id} cambió antes de la actualización.`
        );
      }
    }
    const after = await captureInventoryUnitSnapshot(client, true);
    assertPreserved(before, after, changedInventoryIds);
    requireState(
      classifyInventoryUnitSnapshot(after, plan.scope) === "already-aligned",
      "la comprobación final de unidades falló."
    );
    const result: InventoryUnitResult = {
      operationKey: selected.operationKey,
      mode: "apply",
      scope: plan.scope,
      changedInventoryIds,
      changed: !alreadyAligned,
      alreadyAligned,
      actor: options.actor.trim(),
      reason: options.reason.trim(),
      physicalEquivalenceConfirmed:
        plan.scope === "all" && options.confirmOneUndIsOneGal === true,
      compatibleReadersConfirmed: true,
      readerEvidence: options.readerEvidence.trim(),
      planFingerprint: inventoryUnitFingerprint(plan),
      before,
      after,
      fingerprints: {
        before: inventoryUnitFingerprint(before),
        after: inventoryUnitFingerprint(after),
        protectedDocuments: inventoryUnitFingerprint(after.documents),
      },
    };
    await options.beforeCommit(result);
    requireState(
      inventoryUnitFingerprint(after) ===
        inventoryUnitFingerprint(
          await captureInventoryUnitSnapshot(client, true)
        ),
      "los datos cambiaron después de preparar la auditoría; no se confirmó la operación."
    );
    commitAttempted = true;
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    if (commitAttempted) throw new InventoryUnitCommitOutcomeUnknownError();
    throw error;
  }
}

export async function restoreInventoryUnitRegularization(
  client: Executor,
  receipt: InventoryUnitResult,
  options: Operator & AuditHooks & { confirmation: string }
): Promise<InventoryUnitResult> {
  requireOperator(options);
  const selected = inventoryUnitScope(receipt.scope);
  requireState(
    receipt.operationKey === selected.operationKey &&
      receipt.mode === "apply" &&
      (receipt.scope === "aliases" || receipt.physicalEquivalenceConfirmed) &&
      receipt.compatibleReadersConfirmed &&
      options.confirmation === selected.restoreToken,
    "el recibo o la confirmación de restauración no son válidos."
  );
  requireState(
    inventoryUnitFingerprint(receipt.before) === receipt.fingerprints.before &&
      inventoryUnitFingerprint(receipt.after) === receipt.fingerprints.after &&
      inventoryUnitFingerprint(receipt.after.documents) ===
        receipt.fingerprints.protectedDocuments,
    "el recibo de operación fue alterado."
  );
  classifyInventoryUnitSnapshot(receipt.before, receipt.scope);
  requireState(
    classifyInventoryUnitSnapshot(receipt.after, receipt.scope) ===
      "already-aligned",
    "el recibo no tiene una imagen posterior válida."
  );
  requireState(
    typeof options.beforeApply === "function" &&
      typeof options.beforeCommit === "function",
    "se requieren respaldo y auditoría antes de restaurar."
  );
  await begin(client, false);
  let commitAttempted = false;
  try {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      INVENTORY_UNIT_REGULARIZATION.operationKey,
    ]);
    const before = await captureInventoryUnitSnapshot(client, true);
    const alreadyAligned =
      inventoryUnitFingerprint(before) === receipt.fingerprints.before;
    requireState(
      alreadyAligned ||
        inventoryUnitFingerprint(before) === receipt.fingerprints.after,
      "hubo cambios posteriores; la restauración automática se detuvo para preservar los datos nuevos."
    );
    await options.beforeApply(before);
    requireState(
      inventoryUnitFingerprint(before) ===
        inventoryUnitFingerprint(
          await captureInventoryUnitSnapshot(client, true)
        ),
      "los datos cambiaron durante el respaldo de restauración."
    );
    if (!alreadyAligned)
      for (const id of receipt.changedInventoryIds) {
        requireState(
          selected.targetIds.includes(id),
          "el recibo incluye una existencia fuera del alcance."
        );
        const oldImage = receipt.before.inventory.find(
          row => parse(row).id === id
        )!;
        const currentImage = before.inventory.find(
          row => parse(row).id === id
        )!;
        const result = await client.query(
          `UPDATE public."inventoryItems" t SET unit=b.unit,"updatedAt"=b."updatedAt" FROM jsonb_populate_record(NULL::public."inventoryItems",$1::jsonb) b WHERE t.id=$2 AND to_jsonb(t)=$3::jsonb RETURNING t.id`,
          [oldImage, id, currentImage]
        );
        requireState(
          result.rowCount === 1,
          `la existencia ${id} cambió antes de restaurar.`
        );
      }
    const after = await captureInventoryUnitSnapshot(client, true);
    requireState(
      inventoryUnitFingerprint(after) === receipt.fingerprints.before,
      "la restauración no coincide con el respaldo original."
    );
    const result: InventoryUnitResult = {
      operationKey: selected.operationKey,
      mode: "restore",
      scope: receipt.scope,
      changedInventoryIds: alreadyAligned ? [] : receipt.changedInventoryIds,
      changed: !alreadyAligned,
      alreadyAligned,
      actor: options.actor.trim(),
      reason: options.reason.trim(),
      physicalEquivalenceConfirmed: receipt.physicalEquivalenceConfirmed,
      compatibleReadersConfirmed: receipt.compatibleReadersConfirmed,
      readerEvidence: receipt.readerEvidence,
      planFingerprint: receipt.planFingerprint,
      before,
      after,
      fingerprints: {
        before: inventoryUnitFingerprint(before),
        after: inventoryUnitFingerprint(after),
        protectedDocuments: inventoryUnitFingerprint(after.documents),
      },
    };
    await options.beforeCommit(result);
    requireState(
      inventoryUnitFingerprint(after) ===
        inventoryUnitFingerprint(
          await captureInventoryUnitSnapshot(client, true)
        ),
      "los datos cambiaron después de auditar la restauración."
    );
    commitAttempted = true;
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    if (commitAttempted) throw new InventoryUnitCommitOutcomeUnknownError();
    throw error;
  }
}

export function requireInventoryUnitCloudTarget(
  connectionString: string | undefined,
  apiUrl: string | undefined
) {
  let database: URL;
  let api: URL;
  try {
    database = new URL(connectionString ?? "");
    api = new URL(apiUrl ?? "");
  } catch {
    throw new InventoryUnitRegularizationError(
      "falta una conexión Cloud y URL de API válidas."
    );
  }
  const seen = new Set<string>();
  for (const [key] of Array.from(database.searchParams)) {
    requireState(
      ["sslmode", "application_name"].includes(key) && !seen.has(key),
      "parámetro de conexión inesperado o repetido."
    );
    seen.add(key);
  }
  const sslmode = database.searchParams.get("sslmode");
  requireState(
    sslmode === null ||
      ["require", "verify-full", "verify-ca", "prefer"].includes(sslmode),
    "modo TLS inesperado."
  );
  // Explicit verify-full avoids pg's deprecated aliases and remains strict after upgrades.
  database.searchParams.set("sslmode", "verify-full");
  const project = INVENTORY_UNIT_REGULARIZATION.projectRef;
  const username = decodeURIComponent(database.username);
  const direct =
    database.hostname === `db.${project}.supabase.co` &&
    username === "postgres" &&
    ["", "5432"].includes(database.port);
  const pooler =
    database.hostname === "aws-1-us-east-1.pooler.supabase.com" &&
    username === `postgres.${project}` &&
    ["", "5432", "6543"].includes(database.port);
  requireState(
    ["postgres:", "postgresql:"].includes(database.protocol) &&
      (direct || pooler) &&
      database.pathname === "/postgres" &&
      !database.hash &&
      api.origin === `https://${project}.supabase.co` &&
      ["", "/"].includes(api.pathname) &&
      !api.search &&
      !api.hash &&
      !api.username &&
      !api.password,
    "el destino no es el proyecto, usuario y base autorizados."
  );
  return database.toString();
}
