import { sql, type SQL } from "drizzle-orm";

/** Flat, read-only sources. This module never changes inventory or infers missing allocations. */
export type InventoryCutoffExecutor = {
  execute: (query: SQL) => Promise<unknown>;
};

export type InventoryCutoffSourceInput = {
  fromDate: string;
  throughDate: string;
  projectIds?: readonly number[] | null;
  warehouseIds?: readonly number[] | null;
};

export type InventoryCutoffGrainSource = {
  sourceProvenance?: string;
  sapItemCode: string | null;
  itemName: string;
  unit: string | null;
  projectId: number | null;
  projectCode: string | null;
  projectName: string | null;
  warehouseId: number | null;
  warehouseLabel: string | null;
  storageLocation: string | null;
};

export type CurrentInventorySource = InventoryCutoffGrainSource & {
  inventoryItemId: number;
  currentStock: string;
  description: string | null;
  brand: string | null;
  partNumber: string | null;
  category: string | null;
  createdAt: string;
  updatedAt: string;
  isActive: boolean;
};

export type OpeningLineSource = InventoryCutoffGrainSource & {
  openingItemId: number;
  openingBalanceId: number;
  documentNumber: string;
  effectiveAt: string;
  recordedAt: string;
  quantity: string;
};

type TargetSource = {
  targetType: "subproyecto" | "activo_fijo" | null;
  subprojectCode: string | null;
  subprojectName: string | null;
  fixedAssetCode: string | null;
  fixedAssetName: string | null;
};

export type ReceiptLineSource = InventoryCutoffGrainSource &
  TargetSource & {
    receiptItemId: number;
    receiptId: number;
    documentNumber: string;
    sourceType: "purchase_order" | "transfer";
    sourceId: number;
    sourceItemId: number | null;
    status: string;
    effectiveAt: string;
    recordedAt: string;
    postingDate: string;
    documentDate: string | null;
    invoiceNumber: string | null;
    isFiscalDocument: boolean;
    voidedAt: string | null;
    quantity: string;
    brand: string | null;
    partNumber: string | null;
    sourceProjectId: number | null;
    sourceProjectCode: string | null;
    sourceProjectName: string | null;
    sourceWarehouseId: number | null;
    sourceWarehouseLabel: string | null;
    sourceStorageLocation: string | null;
    transferRequestId: number | null;
    reverseLogisticId: number | null;
    classification: "inventory" | "non_inventory" | "unknown";
    sourceLineMissing: boolean;
  };

export type ExitLineSource = InventoryCutoffGrainSource &
  TargetSource & {
    exitItemId: number;
    exitId: number;
    documentNumber: string;
    status: string;
    effectiveAt: string;
    recordedAt: string;
    createdAt: string;
    quantity: string;
    locationKnown: boolean;
    requestProjectId: number | null;
    requestProjectCode: string | null;
    requestProjectName: string | null;
    destinationProjectId: number | null;
    destinationProjectCode: string | null;
    destinationProjectName: string | null;
    destinationWarehouseLabel: string | null;
    lineNotes: string | null;
    headerNotes: string | null;
    requestNumber: string | null;
  };

export type ReturnLineSource = InventoryCutoffGrainSource & {
  returnItemId: number;
  returnId: number;
  documentNumber: string;
  returnType: string;
  status: string;
  effectiveAt: string | null;
  recordedAt: string;
  processedAt: string | null;
  noteCreatedAt: string | null;
  financialNoteId: number | null;
  quantity: string;
  locationKnown: boolean;
  sourceWarehouseExitId: number | null;
  sourceWarehouseExitItemId: number | null;
  sourceReceiptId: number | null;
  sourceReceiptItemId: number | null;
  sourceExitLinkValid: boolean;
  lineNotes: string | null;
  headerNotes: string | null;
  sourceReceiptNumber: string | null;
};

export type InventoryCutoffSources = {
  currentInventory: CurrentInventorySource[];
  openingLines: OpeningLineSource[];
  receiptLines: ReceiptLineSource[];
  exitLines: ExitLineSource[];
  returnLines: ReturnLineSource[];
};

export type InventoryCutoffCurrentPending = {
  sapItemCode: string;
  projectId: number | null;
  /** Only unclassified inventory uses the warehouse fallback; assigned totals are per project. */
  warehouseId: number | null;
  totalRequired: string;
  pendingReceipt: string;
};

export const INVENTORY_CUTOFF_SOURCE_ROW_LIMIT = 50_000;

export class InventoryCutoffSourceLimitError extends Error {
  constructor() {
    super(
      "El reporte supera el límite de registros. Seleccione un proyecto o almacén para reducir el alcance."
    );
    this.name = "InventoryCutoffSourceLimitError";
  }
}

function validDate(value: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
  );
}

function validateInput(input: InventoryCutoffSourceInput) {
  if (
    !validDate(input.fromDate) ||
    !validDate(input.throughDate) ||
    input.fromDate > input.throughDate
  ) {
    throw new Error("El período del reporte de inventario no es válido.");
  }
  validateScope(input);
}

function validateScope(
  input: Pick<InventoryCutoffSourceInput, "projectIds" | "warehouseIds">
) {
  for (const ids of [input.projectIds, input.warehouseIds]) {
    if (ids?.some(id => !Number.isSafeInteger(id) || id <= 0)) {
      throw new Error("El alcance del reporte de inventario no es válido.");
    }
  }
}

function scope(
  input: Pick<InventoryCutoffSourceInput, "projectIds" | "warehouseIds">,
  project: SQL,
  warehouse: SQL
) {
  const projectCondition = input.projectIds
    ? sql`${project} = any(${sql.param([...input.projectIds])}::int[])`
    : sql`true`;
  const warehouseCondition = input.warehouseIds
    ? sql`${warehouse} = any(${sql.param([...input.warehouseIds])}::int[])`
    : sql`true`;
  return sql`(${projectCondition} and ${warehouseCondition})`;
}

function recordedWithin(input: InventoryCutoffSourceInput, field: SQL) {
  return sql`(${field} >= ${input.fromDate}::date and ${field} < ${input.throughDate}::date + interval '1 day')`;
}

function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (
    result &&
    typeof result === "object" &&
    "rows" in result &&
    Array.isArray(result.rows)
  ) {
    return result.rows as T[];
  }
  throw new Error("No se pudieron leer los datos del reporte de inventario.");
}

/**
 * All timestamps are PostgreSQL text, preserving the stored clock. The report
 * service owns timezone/cutoff interpretation. Call within one read-only,
 * repeatable-read transaction when a consistent snapshot is required.
 *
 * Date bounds use posting evidence, including a later receipt reversal. A
 * backdated document must not disappear just because its business date predates
 * the selected baseline. Historical allocation eligibility belongs to the
 * reconstruction layer; a blank exit location is not an explicit null-location.
 */
export async function loadInventoryCutoffSources(
  executor: InventoryCutoffExecutor,
  input: InventoryCutoffSourceInput
): Promise<InventoryCutoffSources> {
  validateInput(input);
  const result: InventoryCutoffSources = {
    currentInventory: [],
    openingLines: [],
    receiptLines: [],
    exitLines: [],
    returnLines: [],
  };
  // Empty permission scopes must fail closed, before issuing any query.
  if (input.projectIds?.length === 0 || input.warehouseIds?.length === 0) {
    return result;
  }
  let loaded = 0;
  async function read<T>(build: (limit: number) => SQL): Promise<T[]> {
    const remaining = INVENTORY_CUTOFF_SOURCE_ROW_LIMIT - loaded;
    const rows = rowsOf<T>(await executor.execute(build(remaining + 1)));
    if (rows.length > remaining) throw new InventoryCutoffSourceLimitError();
    loaded += rows.length;
    return rows;
  }

  result.currentInventory = await read<CurrentInventorySource>(
    limit => sql`
    select 'inventory_current' as "sourceProvenance", i.id as "inventoryItemId", i."sapItemCode", i.name as "itemName", i.unit,
      i."currentStock"::text as "currentStock", i."projectId", p.code as "projectCode",
      p.name as "projectName", i."warehouseId",
      coalesce(w."displayName", w.name, i."warehouseLocation") as "warehouseLabel",
      nullif(btrim(i."storageLocation"), '') as "storageLocation",
      coalesce(nullif(btrim(i.description), ''), c.description, i.name) as description,
      c.brand, c."partNumber", coalesce(nullif(btrim(c."itemGroup"), ''), nullif(btrim(i.category), '')) as category,
      i."createdAt"::text as "createdAt", i."updatedAt"::text as "updatedAt", i."isActive"
    from public."inventoryItems" i
    left join public.projects p on p.id = i."projectId"
    left join public.warehouses w on w.id = i."warehouseId"
    left join public."sapCatalog" c on c."itemCode" = i."sapItemCode"
    where ${scope(input, sql`i."projectId"`, sql`i."warehouseId"`)}
    order by i.id limit ${limit}
  `
  );

  result.openingLines = await read<OpeningLineSource>(
    limit => sql`
    select 'opening_line_created' as "sourceProvenance", i.id as "openingItemId", b.id as "openingBalanceId", b."balanceNumber" as "documentNumber",
      i."sapItemCode", i."itemName", i.unit, i.quantity::text as quantity,
      coalesce(i."projectId", b."projectId") as "projectId", p.code as "projectCode", p.name as "projectName",
      b."warehouseId", coalesce(w."displayName", w.name) as "warehouseLabel",
      nullif(btrim(i."storageLocation"), '') as "storageLocation",
      b."openingDate"::text as "effectiveAt", i."createdAt"::text as "recordedAt"
    from public."openingBalanceItems" i
    join public."openingBalances" b on b.id = i."openingBalanceId"
    left join public.projects p on p.id = coalesce(i."projectId", b."projectId")
    left join public.warehouses w on w.id = b."warehouseId"
    where ${scope(input, sql`coalesce(i."projectId", b."projectId")`, sql`b."warehouseId"`)}
      and ${recordedWithin(input, sql`i."createdAt"`)}
    order by i."createdAt", i.id limit ${limit}
  `
  );

  result.receiptLines = await read<ReceiptLineSource>(
    limit => sql`
    select case when r."voidedAt" is not null then 'receipt_line_with_void' else 'posted_receipt_line' end as "sourceProvenance",
      i.id as "receiptItemId", r.id as "receiptId", r."receiptNumber" as "documentNumber",
      r."sourceType"::text as "sourceType", r."sourceId", i."sourceItemId", r.status::text as status,
      coalesce(nullif(btrim(i."sapItemCode"), ''), po."currentSapItemCode", po."originalSapItemCode", t."sapItemCode") as "sapItemCode",
      i."itemName", i.unit, i."quantityReceived"::text as quantity,
      r."projectId", p.code as "projectCode", p.name as "projectName",
      i."warehouseId", coalesce(w."displayName", w.name) as "warehouseLabel",
      nullif(btrim(i."storageLocation"), '') as "storageLocation",
      r."receiptDate"::text as "effectiveAt", i."createdAt"::text as "recordedAt",
      r."postingDate"::text as "postingDate", r."documentDate"::text as "documentDate",
      r."invoiceNumber", r."isFiscalDocument", r."voidedAt"::text as "voidedAt",
      coalesce(nullif(btrim(i."receivedBrand"), ''), nullif(btrim(i."requestedBrand"), ''), nullif(btrim(pri.brand), ''), ac.brand, sc.brand) as brand,
      coalesce(nullif(btrim(i."receivedPartNumber"), ''), nullif(btrim(i."requestedPartNumber"), ''), ac."partNumber", sc."partNumber") as "partNumber",
      coalesce(i."targetType", pri."targetType", mri."targetType")::text as "targetType",
      sp.code as "subprojectCode", sp.name as "subprojectName",
      coalesce(i."fixedAssetSapItemCode", pri."fixedAssetSapItemCode", mri."fixedAssetSapItemCode") as "fixedAssetCode",
      coalesce(i."fixedAssetName", pri."fixedAssetName", mri."fixedAssetName") as "fixedAssetName",
      t."sourceProjectId", source_p.code as "sourceProjectCode", source_p.name as "sourceProjectName",
      t."sourceWarehouseId", coalesce(source_w."displayName", source_w.name) as "sourceWarehouseLabel",
      nullif(btrim(t."sourceStorageLocation"), '') as "sourceStorageLocation",
      t."transferRequestId", tr."reverseLogisticId",
      case
        when r."sourceType"::text = 'transfer' then 'inventory'
        when i."isFixedAsset" or coalesce(po."isFixedAsset", false) or po."fixedAssetArticleId" is not null
          or coalesce(sc."tipoArticulo", ac."tipoArticulo") in (2, 3)
          or upper(coalesce(i."sapItemCode", po."currentSapItemCode", po."originalSapItemCode", '')) like 'AFT%'
          then 'non_inventory'
        when coalesce(sc."tipoArticulo", ac."tipoArticulo") = 1 then 'inventory'
        else 'unknown'
      end as classification,
      case when r."sourceType"::text = 'transfer' then t.id is null
        else i."sourceItemId" is not null and po.id is null end as "sourceLineMissing"
    from public."receiptItems" i
    join public.receipts r on r.id = i."receiptId"
    left join public."purchaseOrderItems" po on r."sourceType"::text = 'purchase_order' and po.id = i."sourceItemId"
    left join public."transferRequestItems" t on r."sourceType"::text = 'transfer' and t.id = i."sourceItemId"
    left join public."purchaseRequestItems" pri on pri.id = po."purchaseRequestItemId"
    left join public."requestItems" mri on mri.id = coalesce(po."materialRequestItemId", pri."materialRequestItemId", t."materialRequestItemId")
    left join public."transferRequests" tr on tr.id = t."transferRequestId"
    left join public.projects p on p.id = r."projectId"
    left join public.warehouses w on w.id = i."warehouseId"
    left join public.projects source_p on source_p.id = t."sourceProjectId"
    left join public.warehouses source_w on source_w.id = t."sourceWarehouseId"
    left join public."sapCatalog" ac on ac."itemCode" = i."sapItemCode"
    left join public."sapCatalog" sc on sc."itemCode" = coalesce(po."currentSapItemCode", po."originalSapItemCode")
    left join public."projectSubprojects" sp on sp.id = coalesce(i."subProjectId", pri."subProjectId", mri."subProjectId")
    where i."quantityReceived" > 0
      and (r.status::text in ('parcial', 'completa', 'cierre_incompleto')
        or (r.status::text = 'anulada' and r."voidedAt" is not null))
      and (${scope(input, sql`r."projectId"`, sql`i."warehouseId"`)}
        or (r."sourceType"::text = 'transfer' and ${scope(input, sql`t."sourceProjectId"`, sql`t."sourceWarehouseId"`)}))
      and (${recordedWithin(input, sql`i."createdAt"`)} or ${recordedWithin(input, sql`r."voidedAt"`)})
    order by i."createdAt", i.id limit ${limit}
  `
  );

  result.exitLines = await read<ExitLineSource>(
    limit => sql`
    select 'emitted_exit_line' as "sourceProvenance", i.id as "exitItemId", e.id as "exitId", e."exitNumber" as "documentNumber", e.status::text as status,
      i."sapItemCode", i."itemName", i.unit, i.quantity::text as quantity,
      e."projectId", p.code as "projectCode", p.name as "projectName",
      coalesce(i."warehouseId", e."warehouseId") as "warehouseId", coalesce(w."displayName", w.name) as "warehouseLabel",
      nullif(btrim(i."storageLocation"), '') as "storageLocation",
      nullif(btrim(i."storageLocation"), '') is not null as "locationKnown",
      e."exitDate"::text as "effectiveAt", e."emittedAt"::text as "recordedAt", e."createdAt"::text as "createdAt",
      req."projectId" as "requestProjectId", request_p.code as "requestProjectCode", request_p.name as "requestProjectName",
      coalesce(i."destinationProjectId", e."destinationProjectId") as "destinationProjectId",
      destination_p.code as "destinationProjectCode", destination_p.name as "destinationProjectName",
      coalesce(destination_w."displayName", destination_w.name) as "destinationWarehouseLabel",
      i."targetType"::text as "targetType", sp.code as "subprojectCode", sp.name as "subprojectName",
      i."fixedAssetSapItemCode" as "fixedAssetCode", i."fixedAssetName",
      i.notes as "lineNotes", e.notes as "headerNotes", req."requestNumber"
    from public."warehouseExitItems" i
    join public."warehouseExits" e on e.id = i."warehouseExitId"
    left join public.projects p on p.id = e."projectId"
    left join public.warehouses w on w.id = coalesce(i."warehouseId", e."warehouseId")
    left join public."materialRequests" req on req.id = e."materialRequestId"
    left join public.projects request_p on request_p.id = req."projectId"
    left join public.projects destination_p on destination_p.id = coalesce(i."destinationProjectId", e."destinationProjectId")
    left join public.warehouses destination_w on destination_w.id = coalesce(i."destinationWarehouseId", e."destinationWarehouseId")
    left join public."projectSubprojects" sp on sp.id = i."subProjectId"
    where e.status::text = 'emitida' and i.quantity > 0
      and ${scope(input, sql`e."projectId"`, sql`coalesce(i."warehouseId", e."warehouseId")`)}
      and ${recordedWithin(input, sql`e."emittedAt"`)}
    order by e."emittedAt", i.id limit ${limit}
  `
  );

  result.returnLines = await read<ReturnLineSource>(
    limit => sql`
    select case when r."returnType"::text = 'devolucion_bodega_proyecto' and e.id = r."sourceWarehouseExitId"
        then 'linked_exit_return' when n.id is not null then 'supplier_return_note' else 'generic_return_status' end as "sourceProvenance",
      i.id as "returnItemId", r.id as "returnId", r."returnNumber" as "documentNumber",
      r."returnType"::text as "returnType", r.status::text as status,
      coalesce(i."sapItemCode", ei."sapItemCode", ri."sapItemCode") as "sapItemCode", i."itemName", i.unit,
      r."sourceProjectId" as "projectId", p.code as "projectCode", p.name as "projectName",
      coalesce(i."warehouseId", ei."warehouseId", e."warehouseId", ri."warehouseId") as "warehouseId",
      coalesce(w."displayName", w.name) as "warehouseLabel",
      case when r."returnType"::text = 'devolucion_bodega_proyecto'
        and e.id = r."sourceWarehouseExitId" then nullif(btrim(ei."storageLocation"), '') else null end as "storageLocation",
      coalesce(r."returnType"::text = 'devolucion_bodega_proyecto' and e.id = r."sourceWarehouseExitId", false) as "locationKnown",
      r."processedAt"::text as "effectiveAt", i."createdAt"::text as "recordedAt", r."processedAt"::text as "processedAt",
      n."createdAt"::text as "noteCreatedAt", n.id as "financialNoteId", i.quantity::text as quantity,
      r."sourceWarehouseExitId", i."sourceWarehouseExitItemId", r."sourceReceiptId", i."sourceReceiptItemId",
      coalesce(e.id = r."sourceWarehouseExitId", false) as "sourceExitLinkValid",
      i.notes as "lineNotes", r.justification as "headerNotes", rec."receiptNumber" as "sourceReceiptNumber"
    from public."reverseLogisticsItems" i
    join public."reverseLogistics" r on r.id = i."reverseLogisticId"
    left join public."warehouseExitItems" ei on ei.id = i."sourceWarehouseExitItemId"
    left join public."warehouseExits" e on e.id = ei."warehouseExitId"
    left join public."receiptItems" ri on ri.id = i."sourceReceiptItemId"
    left join public.receipts rec on rec.id = r."sourceReceiptId"
    left join public."financialNotes" n on n."sourceReturnId" = r.id and n.origin = 'supplier_return'
    left join public.projects p on p.id = r."sourceProjectId"
    left join public.warehouses w on w.id = coalesce(i."warehouseId", ei."warehouseId", e."warehouseId", ri."warehouseId")
    where i.quantity > 0
      and ${scope(input, sql`r."sourceProjectId"`, sql`coalesce(i."warehouseId", ei."warehouseId", e."warehouseId", ri."warehouseId")`)}
      and (${recordedWithin(input, sql`i."createdAt"`)}
        or ${recordedWithin(input, sql`r."processedAt"`)}
        or (n."createdAt" >= (${input.fromDate}::date::timestamp at time zone 'UTC')
          and n."createdAt" < (${input.throughDate}::date + interval '1 day') at time zone 'UTC'))
    order by i."createdAt", i.id limit ${limit}
  `
  );

  return result;
}

/**
 * Current procurement totals only. They are not historical facts and must not
 * be used for a past cutoff. A project's totals apply once across its stock
 * locations/warehouses, matching getInventoryPendingProcessQuantities.
 * The visible stock scopes restrict all aggregate queries before returning data.
 */
export async function loadInventoryCutoffCurrentPending(
  executor: InventoryCutoffExecutor,
  input: Pick<InventoryCutoffSourceInput, "projectIds" | "warehouseIds">,
  rowLimit = INVENTORY_CUTOFF_SOURCE_ROW_LIMIT
): Promise<InventoryCutoffCurrentPending[]> {
  validateScope(input);
  if (input.projectIds?.length === 0 || input.warehouseIds?.length === 0)
    return [];
  if (
    !Number.isSafeInteger(rowLimit) ||
    rowLimit < 0 ||
    rowLimit > INVENTORY_CUTOFF_SOURCE_ROW_LIMIT
  ) {
    throw new Error("El límite del reporte de inventario no es válido.");
  }
  const result = rowsOf<InventoryCutoffCurrentPending>(
    await executor.execute(sql`
    with visible_scopes as (
      select distinct btrim(i."sapItemCode") as "sapItemCode", i."projectId",
        case when i."projectId" is null then i."warehouseId" else null end as "warehouseId"
      from public."inventoryItems" i
      where ${scope(input, sql`i."projectId"`, sql`i."warehouseId"`)}
        and nullif(btrim(i."sapItemCode"), '') is not null
        and (i."projectId" is not null or i."warehouseId" is not null)
    ), scope_projects as (
      select v.*, p.id as "processProjectId"
      from visible_scopes v join public.projects p on p.id = v."projectId"
        or (v."projectId" is null and exists (
          select 1 from public."projectWarehouseAssignments" a
          where a."projectId" = p.id and a."warehouseId" = v."warehouseId"
        ))
    ), material_totals as (
      select v."sapItemCode", v."projectId", v."warehouseId",
        sum(greatest(i.quantity - coalesce(i."deliveredQuantity", 0), 0)) as quantity
      from scope_projects v join public."materialRequests" r on r."projectId" = v."processProjectId"
      join public."requestItems" i on i."requestId" = r.id and i."sapItemCode" = v."sapItemCode"
      where r.status::text in ('pendiente_aprobar', 'en_espera', 'en_proceso', 'parcialmente_atendida')
        and i.status::text <> 'completo'
      group by v."sapItemCode", v."projectId", v."warehouseId"
    ), purchase_request_totals as (
      select v."sapItemCode", v."projectId", v."warehouseId",
        sum(greatest(i.quantity - coalesce(i."receivedQuantity", 0), 0)) as quantity
      from scope_projects v join public."purchaseRequests" r on r."projectId" = v."processProjectId"
      join public."purchaseRequestItems" i on i."purchaseRequestId" = r.id
        and (i."currentSapItemCode" = v."sapItemCode" or i."originalSapItemCode" = v."sapItemCode")
      where r.status::text in ('pendiente', 'en_revision', 'aprobada', 'parcialmente_convertida')
      group by v."sapItemCode", v."projectId", v."warehouseId"
    ), purchase_order_totals as (
      select v."sapItemCode", v."projectId", v."warehouseId",
        sum(greatest(i.quantity - coalesce(i."receivedQuantity", 0), 0)) as quantity
      from scope_projects v join public."purchaseOrders" r on r."projectId" = v."processProjectId"
      join public."purchaseOrderItems" i on i."purchaseOrderId" = r.id
        and (i."currentSapItemCode" = v."sapItemCode" or i."originalSapItemCode" = v."sapItemCode")
      where r.status::text in ('borrador', 'emitida', 'enviada', 'parcialmente_recibida') and not i."receiptClosed"
      group by v."sapItemCode", v."projectId", v."warehouseId"
    )
    select v."sapItemCode", v."projectId", v."warehouseId",
      coalesce(m.quantity, 0)::text as "totalRequired",
      (coalesce(pr.quantity, 0) + coalesce(po.quantity, 0))::text as "pendingReceipt"
    from visible_scopes v
    left join material_totals m on m."sapItemCode" = v."sapItemCode"
      and m."projectId" is not distinct from v."projectId" and m."warehouseId" is not distinct from v."warehouseId"
    left join purchase_request_totals pr on pr."sapItemCode" = v."sapItemCode"
      and pr."projectId" is not distinct from v."projectId" and pr."warehouseId" is not distinct from v."warehouseId"
    left join purchase_order_totals po on po."sapItemCode" = v."sapItemCode"
      and po."projectId" is not distinct from v."projectId" and po."warehouseId" is not distinct from v."warehouseId"
    order by v."sapItemCode", v."projectId" nulls first, v."warehouseId" nulls first
    limit ${rowLimit + 1}
  `)
  );
  if (result.length > rowLimit) throw new InventoryCutoffSourceLimitError();
  return result;
}
