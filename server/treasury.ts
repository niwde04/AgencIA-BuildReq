import { randomUUID } from "node:crypto";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  ne,
  sql,
} from "drizzle-orm";
import * as XLSX from "xlsx";
import {
  attachments,
  financialGroups,
  invoiceDocumentAdjustments,
  invoiceItems,
  invoiceOtherCharges,
  invoiceRetentions,
  invoices,
  notifications,
  projects,
  purchaseOrderAdvances,
  purchaseOrders,
  sapCatalog,
  suppliers,
  systemSettings,
  treasuryPaymentBatches,
  treasuryPaymentEvents,
  treasuryPaymentItems,
  users,
} from "../drizzle/schema";
import type { PurchaseCurrency } from "../shared/purchase-orders";
import {
  buildTreasuryPaymentsReportRows,
  resolveTreasuryPaymentFinancialGroup,
  type TreasuryPaymentsReportPayload,
  type TreasuryPaymentsSourceProduct,
} from "../shared/treasury-payments-report";
import {
  TREASURY_ACCOUNTING_REJECTION_REASON_CODES,
  buildTreasuryMoneySummary,
  getTreasuryBatchStatusLabel,
  getTreasuryPaymentStatus,
  roundTreasuryMoney,
  type TreasuryAccountingRejectionReason,
  type TreasuryBatchStatus,
  type TreasuryItemStatus,
  type TreasuryPaymentKind,
} from "../shared/treasury";
import {
  createAttachment,
  createNotification,
  getAttachmentsByEntity,
  getDb,
  getUsersByBuildreqRole,
  listDmcReportSourceInvoices,
} from "./db";
import {
  applyAvailableAdvancesForPurchaseOrder,
  getInvoiceAppliedAdvanceMap,
  getPurchaseOrderAdvanceBlockingSet,
  getPurchaseOrderAdvanceSnapshots,
  listEligiblePurchaseOrderAdvances,
  PurchaseOrderAdvanceRuleError,
} from "./purchaseOrderAdvances";
import {
  getQualityRetentionReleaseSnapshots,
  listQualityRetentionReleases,
  QualityRetentionReleaseRuleError,
  syncQualityRetentionReleasePaymentStatus,
} from "./qualityRetentionReleases";
import { storageDelete, storageGet, storagePut } from "./storage";

export type TreasuryActor = {
  id: number;
  name?: string | null;
  role: string;
  buildreqRole?: string | null;
  assignedProjectId?: number | null;
  assignedProjectIds?: number[] | null;
};

export type TreasuryDraftItemInput =
  | {
      sourceType?: "invoice";
      invoiceId: number;
      requestedAmount: number;
    }
  | {
      sourceType: "purchase_order_advance";
      purchaseOrderAdvanceId: number;
      requestedAmount: number;
    }
  | {
      sourceType: "quality_retention_release";
      qualityRetentionReleaseId: number;
      requestedAmount: number;
    };

export type TreasuryAdjustmentInput = {
  itemId: number;
  amount?: number;
  excluded?: boolean;
  reason?: string;
};

export class TreasuryRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TreasuryRuleError";
  }
}

export class TreasuryApprovalsDisabledError extends TreasuryRuleError {
  constructor() {
    super(
      "Las aprobaciones de lotes de pago están desactivadas en Configuración."
    );
    this.name = "TreasuryApprovalsDisabledError";
  }
}

export function resolveTreasurySettingsUpdate(
  current: {
    treasuryEnabled: boolean;
    treasuryBatchApprovalsEnabled: boolean;
  },
  update: {
    treasuryEnabled?: boolean;
    treasuryBatchApprovalsEnabled?: boolean;
  }
) {
  const treasuryEnabled = update.treasuryEnabled ?? current.treasuryEnabled;
  const treasuryBatchApprovalsEnabled =
    update.treasuryBatchApprovalsEnabled ??
    current.treasuryBatchApprovalsEnabled;
  return {
    treasuryEnabled,
    treasuryBatchApprovalsEnabled,
    requiresFinancialRole:
      (update.treasuryBatchApprovalsEnabled === true &&
        !current.treasuryBatchApprovalsEnabled) ||
      (update.treasuryEnabled === true &&
        !current.treasuryEnabled &&
        treasuryBatchApprovalsEnabled),
  };
}

export function getTreasuryApprovalRouting(approvalsEnabled: boolean) {
  const approvalBypassed = !approvalsEnabled;
  return {
    approvalBypassed,
    submissionStatus: (approvalBypassed
      ? "aprobado"
      : "enviado_depuracion") as TreasuryBatchStatus,
    rejectedReopenStatus: (approvalBypassed
      ? "aprobado"
      : "pendiente_aprobacion") as TreasuryBatchStatus,
    activeItemStatus: (approvalBypassed
      ? "aprobada"
      : "incluida") as TreasuryItemStatus,
  };
}

export function getTreasuryConsolidationRouting(approvalsEnabled: boolean) {
  return {
    approvalBypassed: !approvalsEnabled,
    consolidatableStatuses: (approvalsEnabled
      ? ["enviado_depuracion", "pendiente_aprobacion"]
      : ["aprobado"]) as TreasuryBatchStatus[],
    consolidatedStatus: (approvalsEnabled
      ? "pendiente_aprobacion"
      : "aprobado") as TreasuryBatchStatus,
    consolidatedItemStatus: (approvalsEnabled
      ? "incluida"
      : "aprobada") as TreasuryItemStatus,
  };
}

export function assertTreasuryBatchesCanBeConsolidated(
  batches: Array<{
    batchNumber: string;
    projectId: number;
    currency: PurchaseCurrency;
    requestedPaymentDate: Date | string;
    status: TreasuryBatchStatus;
    paymentKind?: TreasuryPaymentKind;
  }>,
  approvalsEnabled: boolean
) {
  const routing = getTreasuryConsolidationRouting(approvalsEnabled);
  const invalidBatch = batches.find(
    batch => !routing.consolidatableStatuses.includes(batch.status)
  );
  if (invalidBatch) {
    throw new TreasuryRuleError(
      `El lote ${invalidBatch.batchNumber} ya no está disponible para consolidar.`
    );
  }
  if (new Set(batches.map(batch => batch.currency)).size !== 1) {
    throw new TreasuryRuleError(
      "Todos los lotes del consolidado deben utilizar la misma moneda."
    );
  }
  if (
    new Set(batches.map(batch => batch.paymentKind ?? "invoice")).size !== 1
  ) {
    throw new TreasuryRuleError(
      "No se pueden consolidar lotes de tipos de pago diferentes."
    );
  }
  return routing;
}

export function getTreasuryBusinessDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Tegucigalpa",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const valueByType = new Map(parts.map(part => [part.type, part.value]));
  const year = Number(valueByType.get("year"));
  const month = Number(valueByType.get("month"));
  const day = Number(valueByType.get("day"));
  return new Date(Date.UTC(year, month - 1, day));
}

export function getTreasuryBatchPaymentRegistrationDate(
  items: Array<{ bankPaidDate?: Date | string | null }>
) {
  let latestDate: Date | null = null;
  for (const item of items) {
    if (!item.bankPaidDate) continue;
    const candidate =
      item.bankPaidDate instanceof Date
        ? item.bankPaidDate
        : new Date(item.bankPaidDate);
    if (Number.isNaN(candidate.getTime())) continue;
    if (!latestDate || candidate.getTime() > latestDate.getTime()) {
      latestDate = candidate;
    }
  }
  return latestDate;
}

const FINAL_ITEM_STATUSES = new Set<TreasuryItemStatus>([
  "excluida",
  "rechazada_banco",
  "contabilizada",
]);

const REOPENABLE_CLOSED_ITEM_STATUSES = new Set<TreasuryItemStatus>([
  "excluida",
  "rechazada_banco",
]);

const CANCELLABLE_BATCH_STATUSES = new Set<TreasuryBatchStatus>([
  "borrador",
  "enviado_depuracion",
  "pendiente_aprobacion",
  "aprobado",
  "enviado_banco",
  "devuelto",
  "rechazado",
]);

const BANK_RESPONSE_ITEM_STATUSES = new Set<TreasuryItemStatus>([
  "pagada",
  "rechazada_banco",
  "con_diferencia",
  "contabilizada",
]);

type TreasuryBankEvidenceItem = {
  status: TreasuryItemStatus;
  bankPaidAmount?: string | number | null;
  bankPaidDate?: Date | string | null;
  bankReference?: string | null;
};

function hasTreasuryBankEvidence(items: TreasuryBankEvidenceItem[]) {
  return items.some(
    item =>
      BANK_RESPONSE_ITEM_STATUSES.has(item.status) ||
      item.bankPaidAmount != null ||
      item.bankPaidDate != null ||
      Boolean(item.bankReference?.trim())
  );
}

export function assertTreasuryBatchCanBeCancelled(
  batchStatus: TreasuryBatchStatus,
  items: TreasuryBankEvidenceItem[]
) {
  if (!CANCELLABLE_BATCH_STATUSES.has(batchStatus)) {
    throw new TreasuryRuleError(
      "El lote ya tiene una respuesta o pago bancario registrado y no puede anularse."
    );
  }
  if (hasTreasuryBankEvidence(items)) {
    throw new TreasuryRuleError(
      "El lote ya tiene una respuesta o pago bancario registrado y no puede anularse."
    );
  }
}

export function assertTreasuryBatchCanReturnToDraft(
  batch: {
    status: TreasuryBatchStatus;
    exportedAt?: Date | string | null;
  },
  items: Array<
    TreasuryBankEvidenceItem & {
      activeReservation: boolean;
    }
  >,
  hasBankExportAttachment = false
) {
  if (batch.status !== "aprobado") {
    throw new TreasuryRuleError(
      "Solo un lote listo para banco puede regresar a borrador."
    );
  }
  if (batch.exportedAt || hasBankExportAttachment) {
    throw new TreasuryRuleError(
      "El lote ya fue exportado al banco y no puede regresar directamente a borrador."
    );
  }
  if (hasTreasuryBankEvidence(items)) {
    throw new TreasuryRuleError(
      "El lote ya tiene una respuesta o pago bancario registrado y no puede regresar a borrador."
    );
  }
  const activeItems = items.filter(
    item => item.activeReservation && item.status !== "excluida"
  );
  if (!activeItems.length) {
    throw new TreasuryRuleError(
      "El lote no tiene documentos activos para regresar a borrador."
    );
  }
  if (activeItems.some(item => item.status !== "aprobada")) {
    throw new TreasuryRuleError(
      "El lote contiene líneas que ya no están listas para regresar a borrador."
    );
  }
}

export function getTreasuryAccountingCorrectionRequirements(
  reason: TreasuryAccountingRejectionReason
) {
  return {
    reference:
      reason === "referencia_incorrecta" ||
      reason === "referencia_y_soporte_incorrectos",
    attachment:
      reason === "soporte_incorrecto" ||
      reason === "referencia_y_soporte_incorrectos",
  };
}

export function assertTreasuryPaymentCanBeRejectedForCorrection(
  batchStatus: TreasuryBatchStatus,
  itemStatuses: TreasuryItemStatus[]
) {
  if (batchStatus !== "pendiente_contabilizacion") {
    throw new TreasuryRuleError(
      "Solo se puede rechazar un pago pendiente de contabilización."
    );
  }
  if (itemStatuses.includes("contabilizada")) {
    throw new TreasuryRuleError(
      "El lote ya tiene abonos contabilizados y no puede rechazarse completo."
    );
  }
  if (!itemStatuses.includes("pagada")) {
    throw new TreasuryRuleError(
      "El lote no contiene pagos bancarios pendientes de contabilización."
    );
  }
}

export function validateTreasuryAccountingCorrection(input: {
  reason: TreasuryAccountingRejectionReason;
  currentBankReferences: string[];
  bankReference?: string | null;
  hasAttachment: boolean;
}) {
  const requirements = getTreasuryAccountingCorrectionRequirements(
    input.reason
  );
  const bankReference = input.bankReference?.trim() || null;
  const currentBankReferences = Array.from(
    new Set(
      input.currentBankReferences.map(value => value.trim()).filter(Boolean)
    )
  );
  if (requirements.reference && !bankReference) {
    throw new TreasuryRuleError("Ingrese la referencia bancaria corregida.");
  }
  if (
    requirements.reference &&
    currentBankReferences.length === 1 &&
    currentBankReferences[0] === bankReference
  ) {
    throw new TreasuryRuleError(
      "La referencia corregida debe ser diferente de la referencia rechazada."
    );
  }
  if (requirements.attachment && !input.hasAttachment) {
    throw new TreasuryRuleError("Adjunte el documento soporte corregido.");
  }
  return { requirements, bankReference };
}

export function resolveTreasuryPaymentSignatures(
  events: Array<{ action: string; actorName?: string | null }>
) {
  const actorForActions = (actions: string[]) => {
    for (const action of actions) {
      const actorName = events.find(
        event => event.action === action
      )?.actorName;
      if (actorName?.trim()) return actorName.trim();
    }
    return null;
  };
  return {
    preparedBy: actorForActions(["crear_lote", "crear_lote_consolidado"]),
    reviewedBy: actorForActions([
      "enviar_aprobacion",
      "guardar_revision",
      "crear_lote_consolidado",
    ]),
    approvedBy: actorForActions([
      "aprobar_lote",
      "omitir_aprobacion_configuracion",
      "enviar_sin_aprobacion",
    ]),
  };
}

export function resolveTreasuryPaymentReportAmount(item: {
  requestedAmount?: string | number | null;
  approvedAmount?: string | number | null;
  bankPaidAmount?: string | number | null;
}) {
  const value =
    item.bankPaidAmount ?? item.approvedAmount ?? item.requestedAmount ?? 0;
  const amount = Number(value);
  return roundTreasuryMoney(Number.isFinite(amount) ? amount : 0);
}

export function getTreasuryReopenTargetStatus(
  batchStatus: TreasuryBatchStatus,
  itemStatuses: TreasuryItemStatus[]
): TreasuryBatchStatus {
  if (batchStatus !== "cerrado") {
    throw new TreasuryRuleError("Solo se puede reabrir un lote cerrado.");
  }
  if (
    !itemStatuses.includes("rechazada_banco") ||
    itemStatuses.some(status => !REOPENABLE_CLOSED_ITEM_STATUSES.has(status))
  ) {
    throw new TreasuryRuleError(
      "El lote tiene pagos realizados o contabilizados y no puede reabrirse."
    );
  }
  return "enviado_banco";
}

const BANK_EXPORT_HEADERS = {
  batchNumber: "LOTE",
  version: "VERSION",
  itemId: "LINEA_ID",
  paymentKind: "TIPO_PAGO",
  project: "PROYECTO",
  supplierCode: "PROVEEDOR_CODIGO",
  supplierName: "PROVEEDOR",
  invoiceDocumentNumber: "FACTURA_INTERNA",
  invoiceNumber: "FACTURA_FISCAL",
  currency: "MONEDA",
  invoiceNetPayable: "TOTAL_FACTURA",
  appliedAdvanceAmount: "ANTICIPO_APLICADO",
  previousPaidAmount: "PAGADO_ANTERIOR",
  availableBefore: "SALDO_ANTES_ABONO",
  approvedAmount: "ABONO_APROBADO",
  requestedPaymentDate: "FECHA_SOLICITADA",
  bankStatus: "ESTADO_BANCO",
  bankPaidAmount: "MONTO_PAGADO",
  bankPaidDate: "FECHA_PAGO",
  bankReference: "REFERENCIA_BANCO",
  bankComment: "COMENTARIO_BANCO",
} as const;

const TREASURY_BANK_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
const TREASURY_BANK_ATTACHMENT_MIME_TYPES: Readonly<
  Record<string, readonly string[]>
> = {
  pdf: ["application/pdf"],
  jpg: ["image/jpeg"],
  jpeg: ["image/jpeg"],
  png: ["image/png"],
  webp: ["image/webp"],
  xls: ["application/vnd.ms-excel", "application/octet-stream"],
  xlsx: [
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/octet-stream",
  ],
};

export type TreasuryBankResponseAttachmentInput = {
  fileName: string;
  mimeType: string;
  base64: string;
};

export function prepareTreasuryBankAttachment(
  input: TreasuryBankResponseAttachmentInput
) {
  const fileName = input.fileName.trim().split(/[\\/]/).pop() ?? "";
  const extension = fileName.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
  const allowedMimeTypes = TREASURY_BANK_ATTACHMENT_MIME_TYPES[extension];
  const mimeType = input.mimeType.trim().toLowerCase();
  if (!fileName || !allowedMimeTypes?.includes(mimeType)) {
    throw new TreasuryRuleError(
      "El adjunto debe ser PDF, imagen JPG/PNG/WebP o archivo Excel."
    );
  }
  const buffer = Buffer.from(input.base64, "base64");
  if (!buffer.byteLength) {
    throw new TreasuryRuleError("El adjunto bancario está vacío.");
  }
  if (buffer.byteLength > TREASURY_BANK_ATTACHMENT_MAX_BYTES) {
    throw new TreasuryRuleError("El adjunto bancario no puede superar 10 MB.");
  }
  return { fileName, mimeType, buffer };
}

function getActorRole(actor: TreasuryActor) {
  return actor.role === "admin" ? "admin" : actor.buildreqRole || "sin_rol";
}

function toMoneyString(value: number) {
  return roundTreasuryMoney(value).toFixed(2);
}

function parseMoney(value: unknown, label: string) {
  const normalized =
    typeof value === "string"
      ? value.trim().replace(/,/g, "")
      : String(value ?? "").trim();
  const amount = Number(normalized);
  if (!Number.isFinite(amount)) {
    throw new TreasuryRuleError(`${label} no contiene un monto válido.`);
  }
  return roundTreasuryMoney(amount);
}

function parseDateValue(value: unknown, label: string) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "number") {
    const parts = XLSX.SSF.parse_date_code(value);
    if (parts) {
      return new Date(Date.UTC(parts.y, parts.m - 1, parts.d));
    }
  }
  const raw = String(value ?? "").trim();
  if (!raw) throw new TreasuryRuleError(`${label} es obligatoria.`);
  const date = new Date(`${raw.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw new TreasuryRuleError(`${label} no contiene una fecha válida.`);
  }
  return date;
}

function toDateOnly(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString().slice(0, 10);
}

async function insertEvent(
  executor: any,
  input: {
    batchId: number;
    itemId?: number | null;
    action: string;
    previousStatus?: string | null;
    newStatus?: string | null;
    actor: TreasuryActor;
    comment?: string | null;
    metadata?: Record<string, unknown> | null;
  }
) {
  await executor.insert(treasuryPaymentEvents).values({
    batchId: input.batchId,
    itemId: input.itemId ?? null,
    action: input.action,
    previousStatus: input.previousStatus ?? null,
    newStatus: input.newStatus ?? null,
    actorUserId: input.actor.id,
    actorName: input.actor.name?.trim() || `Usuario ${input.actor.id}`,
    actorRole: getActorRole(input.actor),
    comment: input.comment?.trim() || null,
    metadata: input.metadata ?? null,
  });
}

async function readBatch(executor: any, batchId: number) {
  const [batch] = await executor
    .select()
    .from(treasuryPaymentBatches)
    .where(eq(treasuryPaymentBatches.id, batchId))
    .limit(1);
  if (!batch) throw new TreasuryRuleError("Lote de Tesorería no encontrado.");
  return batch;
}

async function readBatchItems(executor: any, batchId: number) {
  return executor
    .select()
    .from(treasuryPaymentItems)
    .where(eq(treasuryPaymentItems.batchId, batchId))
    .orderBy(
      asc(treasuryPaymentItems.supplierName),
      asc(treasuryPaymentItems.id)
    );
}

async function getInvoiceFinancialMap(
  executor: any,
  invoiceIds: number[],
  excludeBatchId?: number
) {
  const uniqueIds = Array.from(new Set(invoiceIds));
  const result = new Map<
    number,
    ReturnType<typeof buildTreasuryMoneySummary>
  >();
  if (uniqueIds.length === 0) return result;

  const invoiceRows = await executor
    .select({
      id: invoices.id,
      currency: invoices.currency,
      netPayable: invoices.netPayable,
    })
    .from(invoices)
    .where(inArray(invoices.id, uniqueIds));

  const paymentRows = await executor
    .select({
      invoiceId: treasuryPaymentItems.invoiceId,
      batchId: treasuryPaymentItems.batchId,
      status: treasuryPaymentItems.status,
      activeReservation: treasuryPaymentItems.activeReservation,
      requestedAmount: treasuryPaymentItems.requestedAmount,
      approvedAmount: treasuryPaymentItems.approvedAmount,
      bankPaidAmount: treasuryPaymentItems.bankPaidAmount,
    })
    .from(treasuryPaymentItems)
    .where(
      and(
        eq(treasuryPaymentItems.sourceType, "invoice"),
        inArray(treasuryPaymentItems.invoiceId, uniqueIds)
      )
    );
  const appliedAdvanceByInvoice = await getInvoiceAppliedAdvanceMap(
    executor,
    uniqueIds
  );

  for (const invoice of invoiceRows) {
    let paidAmount = 0;
    let reservedAmount = 0;
    for (const payment of paymentRows) {
      if (payment.invoiceId !== invoice.id) continue;
      if (payment.status === "contabilizada") {
        paidAmount += roundTreasuryMoney(Number(payment.bankPaidAmount ?? 0));
      }
      if (payment.activeReservation && payment.batchId !== excludeBatchId) {
        reservedAmount += roundTreasuryMoney(
          Number(
            payment.bankPaidAmount ??
              payment.approvedAmount ??
              payment.requestedAmount
          )
        );
      }
    }
    result.set(
      invoice.id,
      buildTreasuryMoneySummary({
        currency: invoice.currency,
        invoiceNetPayable: invoice.netPayable,
        paidAmount,
        reservedAmount,
        appliedAdvanceAmount: appliedAdvanceByInvoice.get(invoice.id) ?? 0,
      })
    );
  }
  return result;
}

export type TreasuryInvoiceReportPayment = {
  batchId: number;
  batchNumber: string;
  paidDate: Date | null;
  bankReference: string | null;
  amount: number;
};

export async function getTreasuryInvoiceReportPayments(invoiceIds: number[]) {
  const db = await getDb();
  const uniqueIds = Array.from(new Set(invoiceIds));
  const result = new Map<number, TreasuryInvoiceReportPayment[]>();
  if (!db || uniqueIds.length === 0) return result;

  const rows = await db
    .select({
      invoiceId: treasuryPaymentItems.invoiceId,
      batchId: treasuryPaymentBatches.id,
      batchNumber: treasuryPaymentBatches.batchNumber,
      paidDate: treasuryPaymentItems.bankPaidDate,
      bankReference: treasuryPaymentItems.bankReference,
      amount: treasuryPaymentItems.bankPaidAmount,
    })
    .from(treasuryPaymentItems)
    .innerJoin(
      treasuryPaymentBatches,
      eq(treasuryPaymentItems.batchId, treasuryPaymentBatches.id)
    )
    .where(
      and(
        eq(treasuryPaymentItems.sourceType, "invoice"),
        inArray(treasuryPaymentItems.invoiceId, uniqueIds),
        inArray(treasuryPaymentItems.status, [
          "pagada",
          "con_diferencia",
          "contabilizada",
        ])
      )
    )
    .orderBy(
      asc(treasuryPaymentItems.bankPaidDate),
      asc(treasuryPaymentBatches.id),
      asc(treasuryPaymentItems.id)
    );

  rows.forEach(row => {
    if (!row.invoiceId) return;
    const payments = result.get(row.invoiceId) ?? [];
    payments.push({
      batchId: row.batchId,
      batchNumber: row.batchNumber,
      paidDate: row.paidDate,
      bankReference: row.bankReference,
      amount: roundTreasuryMoney(Number(row.amount ?? 0)),
    });
    result.set(row.invoiceId, payments);
  });
  return result;
}

export async function listTreasuryInvoiceReportPage(input: {
  paymentStatus: "all" | "paid" | "pending" | "partial";
  search?: string | null;
  dateFrom?: Date | null;
  dateTo?: Date | null;
  projectIds?: number[];
  page: number;
  pageSize: number;
}) {
  const db = await getDb();
  if (!db) {
    return {
      invoiceIds: [] as number[],
      page: 1,
      pageSize: input.pageSize,
      total: 0,
      totalPages: 1,
    };
  }

  const conditions = [eq(invoices.status, "registrada")];
  if (input.projectIds) {
    conditions.push(
      input.projectIds.length
        ? inArray(invoices.projectId, input.projectIds)
        : eq(invoices.id, -1)
    );
  }
  if (input.dateFrom) {
    conditions.push(
      sql`coalesce(${invoices.documentDate}, ${invoices.postingDate}, ${invoices.receiptDate}, ${invoices.createdAt}) >= ${input.dateFrom}`
    );
  }
  if (input.dateTo) {
    conditions.push(
      sql`coalesce(${invoices.documentDate}, ${invoices.postingDate}, ${invoices.receiptDate}, ${invoices.createdAt}) <= ${input.dateTo}`
    );
  }

  const candidates = await db
    .select({
      invoiceId: invoices.id,
      invoiceDocumentNumber: invoices.invoiceDocumentNumber,
      invoiceNumber: invoices.invoiceNumber,
      netPayable: invoices.netPayable,
      projectCode: projects.code,
      projectName: projects.name,
      supplierCode: suppliers.supplierCode,
      supplierName: suppliers.name,
      supplierRtn: suppliers.rtn,
    })
    .from(invoices)
    .leftJoin(projects, eq(invoices.projectId, projects.id))
    .leftJoin(suppliers, eq(invoices.supplierId, suppliers.id))
    .where(and(...conditions))
    .orderBy(
      asc(invoices.documentDate),
      asc(invoices.postingDate),
      asc(invoices.id)
    );
  const invoiceIds = candidates.map(invoice => invoice.invoiceId);
  const [paymentsByInvoice, appliedAdvanceByInvoice] = await Promise.all([
    getTreasuryInvoiceReportPayments(invoiceIds),
    getInvoiceAppliedAdvanceMap(db, invoiceIds),
  ]);
  const searchTerm = String(input.search ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es-HN");
  const matchingIds = candidates.flatMap(invoice => {
    const payments = paymentsByInvoice.get(invoice.invoiceId) ?? [];
    const paidAmount = roundTreasuryMoney(
      payments.reduce((sum, payment) => sum + payment.amount, 0)
    );
    const treasuryPaymentStatus = getTreasuryPaymentStatus(
      Number(invoice.netPayable ?? 0),
      paidAmount + (appliedAdvanceByInvoice.get(invoice.invoiceId) ?? 0)
    );
    const paymentStatus =
      treasuryPaymentStatus === "pagada"
        ? "paid"
        : treasuryPaymentStatus === "parcialmente_pagada"
          ? "partial"
          : "pending";
    if (
      input.paymentStatus !== "all" &&
      input.paymentStatus !== paymentStatus
    ) {
      return [];
    }
    if (searchTerm) {
      const searchableText = [
        invoice.invoiceDocumentNumber,
        invoice.invoiceNumber,
        invoice.projectCode,
        invoice.projectName,
        invoice.supplierCode,
        invoice.supplierName,
        invoice.supplierRtn,
        ...payments.map(payment => payment.batchNumber),
        ...payments.map(payment => payment.bankReference),
      ]
        .join(" ")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLocaleLowerCase("es-HN");
      if (!searchableText.includes(searchTerm)) return [];
    }
    return [invoice.invoiceId];
  });
  const total = matchingIds.length;
  const totalPages = Math.max(1, Math.ceil(total / input.pageSize));
  const page = Math.min(input.page, totalPages);
  const start = (page - 1) * input.pageSize;
  return {
    invoiceIds: matchingIds.slice(start, start + input.pageSize),
    page,
    pageSize: input.pageSize,
    total,
    totalPages,
  };
}

async function getInvoiceSnapshots(
  executor: any,
  invoiceIds: number[],
  excludeBatchId?: number
) {
  const uniqueIds = Array.from(new Set(invoiceIds));
  if (uniqueIds.length !== invoiceIds.length) {
    throw new TreasuryRuleError("No se puede repetir una factura en el lote.");
  }
  if (uniqueIds.length === 0) {
    throw new TreasuryRuleError("Seleccione al menos una factura.");
  }

  const rows = await executor
    .select({
      invoice: invoices,
      purchaseOrder: purchaseOrders,
      supplier: suppliers,
      project: projects,
    })
    .from(invoices)
    .innerJoin(purchaseOrders, eq(invoices.purchaseOrderId, purchaseOrders.id))
    .innerJoin(projects, eq(invoices.projectId, projects.id))
    .leftJoin(suppliers, eq(invoices.supplierId, suppliers.id))
    .where(inArray(invoices.id, uniqueIds))
    .for("update", { of: invoices });

  if (rows.length !== uniqueIds.length) {
    throw new TreasuryRuleError("Una o más facturas seleccionadas no existen.");
  }
  const financials = await getInvoiceFinancialMap(
    executor,
    uniqueIds,
    excludeBatchId
  );
  return rows.map((row: any) => ({
    ...row,
    money: financials.get(row.invoice.id)!,
  }));
}

async function readTreasurySettings(
  executor: any,
  options: { forUpdate?: boolean } = {}
) {
  const query = executor
    .select({
      treasuryEnabled: systemSettings.treasuryEnabled,
      treasuryBatchApprovalsEnabled:
        systemSettings.treasuryBatchApprovalsEnabled,
      updatedAt: systemSettings.updatedAt,
    })
    .from(systemSettings)
    .where(eq(systemSettings.id, 1));
  const [settings] = options.forUpdate
    ? await query.for("update")
    : await query;
  return {
    treasuryEnabled: settings?.treasuryEnabled === true,
    treasuryBatchApprovalsEnabled:
      settings?.treasuryBatchApprovalsEnabled === true,
    updatedAt: settings?.updatedAt ?? null,
  };
}

async function assertTreasuryBatchApprovalsEnabled(executor: any) {
  const settings = await readTreasurySettings(executor, { forUpdate: true });
  if (!settings.treasuryBatchApprovalsEnabled) {
    throw new TreasuryApprovalsDisabledError();
  }
  return settings;
}

async function markActiveItemsApprovedWithoutWorkflow(
  executor: any,
  batchIds: number[],
  now: Date
) {
  if (!batchIds.length) return [];
  return executor
    .update(treasuryPaymentItems)
    .set({
      status: "aprobada",
      approvedAmount: treasuryPaymentItems.requestedAmount,
      updatedAt: now,
    })
    .where(
      and(
        inArray(treasuryPaymentItems.batchId, batchIds),
        eq(treasuryPaymentItems.activeReservation, true),
        ne(treasuryPaymentItems.status, "excluida")
      )
    )
    .returning({ id: treasuryPaymentItems.id });
}

export async function getTreasurySettings() {
  const db = await getDb();
  if (!db) {
    return {
      treasuryEnabled: false,
      treasuryBatchApprovalsEnabled: false,
      updatedAt: null,
    };
  }
  return readTreasurySettings(db);
}

export async function updateTreasurySettings(input: {
  treasuryEnabled?: boolean;
  treasuryBatchApprovalsEnabled?: boolean;
  actor: TreasuryActor;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  if (
    input.treasuryEnabled === undefined &&
    input.treasuryBatchApprovalsEnabled === undefined
  ) {
    throw new TreasuryRuleError(
      "Indique al menos una configuración de Tesorería para actualizar."
    );
  }

  const result = await db.transaction(async tx => {
    const current = await readTreasurySettings(tx, { forUpdate: true });
    const resolved = resolveTreasurySettingsUpdate(current, input);
    const {
      treasuryEnabled,
      treasuryBatchApprovalsEnabled,
      requiresFinancialRole,
    } = resolved;

    if (requiresFinancialRole) {
      const [approver] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.buildreqRole, "financiero"))
        .limit(1);
      if (!approver) {
        throw new TreasuryRuleError(
          "Asigne el rol Financiero al menos a un usuario antes de activar las aprobaciones de lotes."
        );
      }
    }

    const now = new Date();
    const [settings] = await tx
      .update(systemSettings)
      .set({
        treasuryEnabled,
        treasuryBatchApprovalsEnabled,
        updatedByUserId: input.actor.id,
        updatedAt: now,
      })
      .where(eq(systemSettings.id, 1))
      .returning({
        treasuryEnabled: systemSettings.treasuryEnabled,
        treasuryBatchApprovalsEnabled:
          systemSettings.treasuryBatchApprovalsEnabled,
        updatedAt: systemSettings.updatedAt,
      });
    if (!settings) throw new Error("Configuración del sistema no disponible");

    let bypassedBatches: Array<{
      id: number;
      batchNumber: string;
      status: TreasuryBatchStatus;
    }> = [];
    if (!treasuryBatchApprovalsEnabled) {
      const pendingBatches = (await tx
        .select()
        .from(treasuryPaymentBatches)
        .where(
          inArray(treasuryPaymentBatches.status, [
            "enviado_depuracion",
            "pendiente_aprobacion",
          ])
        )
        .orderBy(asc(treasuryPaymentBatches.id))
        .for("update")) as Array<typeof treasuryPaymentBatches.$inferSelect>;
      const batchIds = pendingBatches.map(batch => batch.id);
      await markActiveItemsApprovedWithoutWorkflow(tx, batchIds, now);

      if (batchIds.length) {
        const updatedBatches = await tx
          .update(treasuryPaymentBatches)
          .set({
            status: "aprobado",
            approvalBypassed: true,
            approvedById: null,
            approvedAt: now,
            updatedAt: now,
          })
          .where(
            and(
              inArray(treasuryPaymentBatches.id, batchIds),
              inArray(treasuryPaymentBatches.status, [
                "enviado_depuracion",
                "pendiente_aprobacion",
              ])
            )
          )
          .returning({
            id: treasuryPaymentBatches.id,
            batchNumber: treasuryPaymentBatches.batchNumber,
            status: treasuryPaymentBatches.status,
          });
        if (updatedBatches.length !== pendingBatches.length) {
          throw new TreasuryRuleError(
            "Uno o más lotes cambiaron de estado mientras se desactivaban las aprobaciones."
          );
        }
        bypassedBatches = updatedBatches;
        for (const batch of pendingBatches) {
          await insertEvent(tx, {
            batchId: batch.id,
            action: "omitir_aprobacion_configuracion",
            previousStatus: batch.status,
            newStatus: "aprobado",
            actor: input.actor,
            metadata: {
              reason: "treasury_batch_approvals_disabled",
              source: "settings",
            },
          });
        }
      }
    }

    return { ...settings, bypassedBatches };
  });

  await Promise.all(
    result.bypassedBatches.map(batch =>
      notifyRole("administracion_central", {
        title: "Lote listo para banco",
        message: `El lote ${batch.batchNumber} quedó listo para banco porque las aprobaciones fueron desactivadas.`,
        batchId: batch.id,
      })
    )
  );

  return {
    treasuryEnabled: result.treasuryEnabled,
    treasuryBatchApprovalsEnabled: result.treasuryBatchApprovalsEnabled,
    updatedAt: result.updatedAt,
    bypassedBatchCount: result.bypassedBatches.length,
  };
}

export async function listTreasuryApprovers() {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({ user: users })
    .from(users)
    .where(eq(users.buildreqRole, "financiero"))
    .orderBy(asc(users.name));
  return rows.map(row => ({
    id: row.user.id,
    name: row.user.name,
    email: row.user.email,
    buildreqRole: row.user.buildreqRole,
    isTreasuryApprover: true,
  }));
}

export async function listEligibleTreasuryInvoices(filters?: {
  projectId?: number;
  projectIds?: number[];
  currency?: PurchaseCurrency;
  excludeBatchId?: number;
}) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [
    eq(invoices.status, "registrada"),
    isNotNull(invoices.supplierId),
  ];
  if (filters?.projectId)
    conditions.push(eq(invoices.projectId, filters.projectId));
  if (filters?.projectIds) {
    conditions.push(
      filters.projectIds.length
        ? inArray(invoices.projectId, filters.projectIds)
        : eq(invoices.id, -1)
    );
  }
  if (filters?.currency)
    conditions.push(eq(invoices.currency, filters.currency));

  const rows = await db
    .select({
      invoice: invoices,
      purchaseOrder: purchaseOrders,
      supplier: suppliers,
      project: projects,
    })
    .from(invoices)
    .innerJoin(purchaseOrders, eq(invoices.purchaseOrderId, purchaseOrders.id))
    .innerJoin(projects, eq(invoices.projectId, projects.id))
    .innerJoin(suppliers, eq(invoices.supplierId, suppliers.id))
    .where(and(...conditions))
    .orderBy(
      asc(suppliers.name),
      asc(invoices.documentDueDate),
      asc(invoices.id)
    );

  const financials = await getInvoiceFinancialMap(
    db,
    rows.map(row => row.invoice.id),
    filters?.excludeBatchId
  );
  const blockedPurchaseOrders = await getPurchaseOrderAdvanceBlockingSet(
    db,
    rows.map(row => row.purchaseOrder.id)
  );
  return rows
    .map(row => ({ ...row, money: financials.get(row.invoice.id)! }))
    .filter(
      row =>
        !blockedPurchaseOrders.has(row.purchaseOrder.id) &&
        row.money.availableAmount > 0 &&
        row.money.reservedAmount <= 0
    );
}

export async function listEligibleTreasuryAdvances(filters?: {
  projectId?: number;
  projectIds?: number[];
  currency?: PurchaseCurrency;
  excludeBatchId?: number;
}) {
  return listEligiblePurchaseOrderAdvances(filters);
}

export async function listEligibleTreasuryQualityRetentionReleases(filters?: {
  projectId?: number;
  projectIds?: number[];
  currency?: PurchaseCurrency;
  excludeBatchId?: number;
}) {
  const rows = await listQualityRetentionReleases({
    projectIds: filters?.projectId ? [filters.projectId] : filters?.projectIds,
    statuses: ["approved", "partially_paid"],
    excludeBatchId: filters?.excludeBatchId,
  });
  return rows.filter(
    row =>
      (!filters?.currency || row.invoice.currency === filters.currency) &&
      row.availableToPayAmount > 0 &&
      row.reservedAmount <= 0
  );
}

export async function listTreasuryBatches(filters?: {
  projectIds?: number[];
  status?: TreasuryBatchStatus;
  includeConsolidated?: boolean;
}) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [];
  if (!filters?.status && !filters?.includeConsolidated) {
    conditions.push(isNull(treasuryPaymentBatches.consolidatedIntoBatchId));
  }
  if (filters?.status)
    conditions.push(eq(treasuryPaymentBatches.status, filters.status));
  const batchRows = await db
    .select({ batch: treasuryPaymentBatches, project: projects })
    .from(treasuryPaymentBatches)
    .innerJoin(projects, eq(treasuryPaymentBatches.projectId, projects.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(
      desc(treasuryPaymentBatches.createdAt),
      desc(treasuryPaymentBatches.id)
    );
  if (!batchRows.length) return [];
  const batchProjectRows = await db
    .select({
      batchId: treasuryPaymentItems.batchId,
      id: projects.id,
      code: projects.code,
      name: projects.name,
    })
    .from(treasuryPaymentItems)
    .innerJoin(invoices, eq(treasuryPaymentItems.invoiceId, invoices.id))
    .innerJoin(projects, eq(invoices.projectId, projects.id))
    .where(
      inArray(
        treasuryPaymentItems.batchId,
        batchRows.map(row => row.batch.id)
      )
    );
  const advanceBatchProjectRows = await db
    .select({
      batchId: treasuryPaymentItems.batchId,
      id: projects.id,
      code: projects.code,
      name: projects.name,
    })
    .from(treasuryPaymentItems)
    .innerJoin(
      purchaseOrderAdvances,
      eq(treasuryPaymentItems.purchaseOrderAdvanceId, purchaseOrderAdvances.id)
    )
    .innerJoin(projects, eq(purchaseOrderAdvances.projectId, projects.id))
    .where(
      inArray(
        treasuryPaymentItems.batchId,
        batchRows.map(row => row.batch.id)
      )
    );
  const allBatchProjectRows = [...batchProjectRows, ...advanceBatchProjectRows];
  const batchRowsWithProjects = batchRows.map(row => {
    const projectMap = new Map<
      number,
      { id: number; code: string; name: string }
    >();
    for (const project of allBatchProjectRows) {
      if (project.batchId === row.batch.id) {
        projectMap.set(project.id, {
          id: project.id,
          code: project.code,
          name: project.name,
        });
      }
    }
    if (!projectMap.size) {
      projectMap.set(row.project.id, row.project);
    }
    const batchProjects = Array.from(projectMap.values()).sort((left, right) =>
      left.code.localeCompare(right.code, "es-HN", {
        numeric: true,
        sensitivity: "base",
      })
    );
    return {
      ...row,
      projects: batchProjects,
      projectIds: batchProjects.map(project => project.id),
    };
  });
  const scopedProjectIds = filters?.projectIds
    ? new Set(filters.projectIds)
    : null;
  const accessibleBatchRows = scopedProjectIds
    ? batchRowsWithProjects.filter(
        row =>
          row.projectIds.length > 0 &&
          row.projectIds.every(projectId => scopedProjectIds.has(projectId))
      )
    : batchRowsWithProjects;
  if (!accessibleBatchRows.length) return [];
  const items = await db
    .select()
    .from(treasuryPaymentItems)
    .where(
      inArray(
        treasuryPaymentItems.batchId,
        accessibleBatchRows.map(row => row.batch.id)
      )
    );
  const sourceBatches = await db
    .select({
      batchNumber: treasuryPaymentBatches.batchNumber,
      consolidatedIntoBatchId: treasuryPaymentBatches.consolidatedIntoBatchId,
    })
    .from(treasuryPaymentBatches)
    .where(
      inArray(
        treasuryPaymentBatches.consolidatedIntoBatchId,
        accessibleBatchRows.map(row => row.batch.id)
      )
    );
  return accessibleBatchRows.map(row => {
    const batchItems = items.filter(item => item.batchId === row.batch.id);
    const included = batchItems.filter(item => item.status !== "excluida");
    const invoiceItems = included.filter(item => item.sourceType === "invoice");
    return {
      ...row,
      itemCount: included.length,
      invoiceDocumentNumbers: Array.from(
        new Set(invoiceItems.map(item => item.invoiceDocumentNumber))
      ),
      invoiceNumbers: Array.from(
        new Set(
          invoiceItems
            .map(item => item.invoiceNumber?.trim())
            .filter((value): value is string => Boolean(value))
        )
      ),
      paymentRegistrationDate:
        getTreasuryBatchPaymentRegistrationDate(included),
      supplierCount: new Set(
        included.map(item => item.supplierId ?? item.supplierCode)
      ).size,
      requestedTotal: roundTreasuryMoney(
        included.reduce(
          (sum, item) => sum + roundTreasuryMoney(Number(item.requestedAmount)),
          0
        )
      ),
      approvedTotal: roundTreasuryMoney(
        included.reduce(
          (sum, item) =>
            sum + roundTreasuryMoney(Number(item.approvedAmount ?? 0)),
          0
        )
      ),
      paidTotal: roundTreasuryMoney(
        included.reduce(
          (sum, item) =>
            sum + roundTreasuryMoney(Number(item.bankPaidAmount ?? 0)),
          0
        )
      ),
      sourceBatchNumbers: sourceBatches
        .filter(source => source.consolidatedIntoBatchId === row.batch.id)
        .map(source => source.batchNumber),
    };
  });
}

export async function getTreasuryPaymentsReport(
  batchIds: number[]
): Promise<TreasuryPaymentsReportPayload> {
  const db = await getDb();
  const uniqueBatchIds = Array.from(new Set(batchIds));
  if (!db || uniqueBatchIds.length === 0) {
    return { generatedAt: new Date(), payments: [] };
  }

  const paymentRows = await db
    .select({
      paymentItemId: treasuryPaymentItems.id,
      batchNumber: treasuryPaymentBatches.batchNumber,
      bankReference: treasuryPaymentItems.bankReference,
      invoiceId: invoices.id,
      invoiceDate: invoices.documentDate,
      invoiceNumber: invoices.invoiceNumber,
      invoiceDocumentNumber: invoices.invoiceDocumentNumber,
      supplierName: treasuryPaymentItems.supplierName,
      jobCode: projects.code,
      currency: treasuryPaymentItems.currency,
      invoiceSubtotal: invoices.subtotal,
      invoiceTaxAmount: invoices.taxAmount,
      invoiceTotal: invoices.total,
      fiscalRetentionTotal: invoices.retentionTotal,
      otherRetentionTotal: invoices.otherRetentionTotal,
      documentDiscountTotal: invoices.documentDiscountTotal,
      invoiceNetPayable: treasuryPaymentItems.invoiceNetPayable,
      appliedAdvanceAmount: treasuryPaymentItems.appliedAdvanceAmount,
      bankPaidAmount: treasuryPaymentItems.bankPaidAmount,
      hasOceExemption: invoices.hasOceExemption,
      oceExemptAmount: invoices.oceExemptAmount,
    })
    .from(treasuryPaymentItems)
    .innerJoin(
      treasuryPaymentBatches,
      eq(treasuryPaymentItems.batchId, treasuryPaymentBatches.id)
    )
    .innerJoin(invoices, eq(treasuryPaymentItems.invoiceId, invoices.id))
    .innerJoin(projects, eq(invoices.projectId, projects.id))
    .where(
      and(
        inArray(treasuryPaymentItems.batchId, uniqueBatchIds),
        eq(treasuryPaymentBatches.paymentKind, "invoice"),
        eq(treasuryPaymentItems.sourceType, "invoice"),
        ne(treasuryPaymentItems.status, "excluida"),
        gt(treasuryPaymentItems.bankPaidAmount, "0")
      )
    )
    .orderBy(
      asc(treasuryPaymentBatches.batchNumber),
      asc(invoices.invoiceNumber),
      asc(treasuryPaymentItems.id)
    );

  if (!paymentRows.length) {
    return { generatedAt: new Date(), payments: [] };
  }

  const uniqueInvoiceIds = Array.from(
    new Set(paymentRows.map(row => row.invoiceId))
  );
  const [itemRows, otherChargeRows, retentionRows, documentAdjustmentRows] =
    await Promise.all([
      db
        .select({
          id: invoiceItems.id,
          invoiceId: invoiceItems.invoiceId,
          currentSapItemCode: invoiceItems.currentSapItemCode,
          originalSapItemCode: invoiceItems.originalSapItemCode,
          quantity: invoiceItems.quantity,
          itemName: invoiceItems.itemName,
          unit: invoiceItems.unit,
          unitPrice: invoiceItems.unitPrice,
          subtotal: invoiceItems.subtotal,
          taxAmount: invoiceItems.taxAmount,
          total: invoiceItems.total,
          taxCode: invoiceItems.taxCode,
          taxBreakdown: invoiceItems.taxBreakdown,
        })
        .from(invoiceItems)
        .where(inArray(invoiceItems.invoiceId, uniqueInvoiceIds))
        .orderBy(asc(invoiceItems.invoiceId), asc(invoiceItems.id)),
      db
        .select({
          id: invoiceOtherCharges.id,
          invoiceId: invoiceOtherCharges.invoiceId,
          concept: invoiceOtherCharges.concept,
          amount: invoiceOtherCharges.amount,
        })
        .from(invoiceOtherCharges)
        .where(inArray(invoiceOtherCharges.invoiceId, uniqueInvoiceIds))
        .orderBy(
          asc(invoiceOtherCharges.invoiceId),
          asc(invoiceOtherCharges.id)
        ),
      db
        .select({
          id: invoiceRetentions.id,
          invoiceId: invoiceRetentions.invoiceId,
          invoiceItemId: invoiceRetentions.invoiceItemId,
          retentionCode: invoiceRetentions.retentionCode,
          retentionErpCode: invoiceRetentions.retentionErpCode,
          description: invoiceRetentions.description,
          percentage: invoiceRetentions.percentage,
          baseAmount: invoiceRetentions.baseAmount,
          amount: invoiceRetentions.amount,
        })
        .from(invoiceRetentions)
        .where(inArray(invoiceRetentions.invoiceId, uniqueInvoiceIds))
        .orderBy(asc(invoiceRetentions.invoiceId), asc(invoiceRetentions.id)),
      db
        .select({
          invoiceId: invoiceDocumentAdjustments.invoiceId,
          adjustmentType: invoiceDocumentAdjustments.adjustmentType,
          percentage: invoiceDocumentAdjustments.percentage,
          baseAmount: invoiceDocumentAdjustments.baseAmount,
          amount: invoiceDocumentAdjustments.amount,
        })
        .from(invoiceDocumentAdjustments)
        .where(inArray(invoiceDocumentAdjustments.invoiceId, uniqueInvoiceIds))
        .orderBy(
          asc(invoiceDocumentAdjustments.invoiceId),
          asc(invoiceDocumentAdjustments.id)
        ),
    ]);
  const sapCodes = Array.from(
    new Set(
      itemRows.flatMap(item =>
        [item.currentSapItemCode, item.originalSapItemCode]
          .map(value => value?.trim())
          .filter((value): value is string => Boolean(value))
      )
    )
  );
  const catalogRows = sapCodes.length
    ? await db
        .select({
          itemCode: sapCatalog.itemCode,
          financialCode: sapCatalog.financialGroupCode,
          financialGroupDescription: financialGroups.financialGroupDescription,
        })
        .from(sapCatalog)
        .leftJoin(
          financialGroups,
          eq(sapCatalog.financialGroupCode, financialGroups.financialGroupCode)
        )
        .where(inArray(sapCatalog.itemCode, sapCodes))
    : [];
  const catalogByCode = new Map(
    catalogRows.map(row => [
      row.itemCode,
      {
        itemCode: row.itemCode,
        financialCode: row.financialCode?.trim() ?? "",
        financialGroupDescription: row.financialGroupDescription?.trim() ?? "",
      },
    ])
  );
  const products: TreasuryPaymentsSourceProduct[] = itemRows.map(item => {
    const codes = {
      currentSapItemCode: item.currentSapItemCode?.trim() ?? "",
      originalSapItemCode: item.originalSapItemCode?.trim() ?? "",
    };
    const financialGroup = resolveTreasuryPaymentFinancialGroup(
      codes,
      catalogByCode
    );
    return {
      id: item.id,
      invoiceId: item.invoiceId,
      ...codes,
      itemName: item.itemName,
      quantity: Number(item.quantity ?? 0),
      unit: item.unit?.trim() ?? "",
      unitPrice: Number(item.unitPrice ?? 0),
      subtotal: Number(item.subtotal ?? 0),
      taxAmount: Number(item.taxAmount ?? 0),
      total: Number(item.total ?? 0),
      taxCode: item.taxCode?.trim() || "exe",
      taxBreakdown: item.taxBreakdown,
      financialCode: financialGroup.financialCode,
      financialGroupDescription: financialGroup.financialGroupDescription,
    };
  });

  return {
    generatedAt: new Date(),
    payments: buildTreasuryPaymentsReportRows({
      payments: paymentRows.map(row => ({
        paymentItemId: row.paymentItemId,
        batchNumber: row.batchNumber,
        bankReference: row.bankReference?.trim() ?? "",
        invoiceDate: row.invoiceDate,
        invoiceNumber: row.invoiceNumber?.trim() || row.invoiceDocumentNumber,
        supplierName: row.supplierName,
        invoiceId: row.invoiceId,
        jobCode: row.jobCode,
        currency: row.currency,
        invoiceSubtotal: Number(row.invoiceSubtotal ?? 0),
        invoiceTaxAmount: Number(row.invoiceTaxAmount ?? 0),
        invoiceTotal: Number(row.invoiceTotal ?? 0),
        fiscalRetentionTotal: Number(row.fiscalRetentionTotal ?? 0),
        otherRetentionTotal: Number(row.otherRetentionTotal ?? 0),
        documentDiscountTotal: Number(row.documentDiscountTotal ?? 0),
        invoiceNetPayable: Number(row.invoiceNetPayable ?? 0),
        appliedAdvanceAmount: Number(row.appliedAdvanceAmount ?? 0),
        bankPaidAmount: Number(row.bankPaidAmount ?? 0),
        hasOceExemption: row.hasOceExemption === true,
        oceExemptAmount: Number(row.oceExemptAmount ?? 0),
      })),
      products,
      otherCharges: otherChargeRows.map(charge => ({
        id: charge.id,
        invoiceId: charge.invoiceId,
        concept: charge.concept,
        amount: Number(charge.amount ?? 0),
      })),
      retentions: retentionRows.map(retention => ({
        id: retention.id,
        invoiceId: retention.invoiceId,
        invoiceItemId: retention.invoiceItemId,
        retentionCode: retention.retentionCode,
        retentionErpCode: retention.retentionErpCode,
        description: retention.description,
        percentage: retention.percentage,
        baseAmount: retention.baseAmount,
        amount: retention.amount,
      })),
      documentAdjustments: documentAdjustmentRows,
    }),
  };
}

export async function getTreasuryBatchById(batchId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const [row] = await db
    .select({ batch: treasuryPaymentBatches, project: projects })
    .from(treasuryPaymentBatches)
    .innerJoin(projects, eq(treasuryPaymentBatches.projectId, projects.id))
    .where(eq(treasuryPaymentBatches.id, batchId))
    .limit(1);
  if (!row) return undefined;
  const [
    items,
    events,
    attachmentRows,
    sourceBatches,
    invoiceFinancialRows,
    invoiceDocumentAdjustmentRows,
    advanceFinancialRows,
  ] = await Promise.all([
    readBatchItems(db, batchId),
    db
      .select()
      .from(treasuryPaymentEvents)
      .where(eq(treasuryPaymentEvents.batchId, batchId))
      .orderBy(
        desc(treasuryPaymentEvents.createdAt),
        desc(treasuryPaymentEvents.id)
      ),
    getAttachmentsByEntity("treasury_payment_batch", batchId),
    db
      .select({
        id: treasuryPaymentBatches.id,
        batchNumber: treasuryPaymentBatches.batchNumber,
      })
      .from(treasuryPaymentBatches)
      .where(eq(treasuryPaymentBatches.consolidatedIntoBatchId, batchId))
      .orderBy(asc(treasuryPaymentBatches.id)),
    db
      .select({
        invoiceId: invoices.id,
        invoiceProjectId: projects.id,
        invoiceProjectCode: projects.code,
        invoiceProjectName: projects.name,
        invoiceDocumentDueDate: invoices.documentDueDate,
        invoiceSubtotal: invoices.subtotal,
        invoiceTaxAmount: invoices.taxAmount,
        invoiceTotal: invoices.total,
        invoiceRetentionTotal: invoices.retentionTotal,
        invoiceOtherRetentionTotal: invoices.otherRetentionTotal,
        invoiceDocumentDiscountTotal: invoices.documentDiscountTotal,
      })
      .from(treasuryPaymentItems)
      .innerJoin(invoices, eq(treasuryPaymentItems.invoiceId, invoices.id))
      .innerJoin(projects, eq(invoices.projectId, projects.id))
      .where(eq(treasuryPaymentItems.batchId, batchId)),
    db
      .select({
        invoiceId: invoiceDocumentAdjustments.invoiceId,
        adjustmentType: invoiceDocumentAdjustments.adjustmentType,
        percentage: invoiceDocumentAdjustments.percentage,
        baseAmount: invoiceDocumentAdjustments.baseAmount,
        amount: invoiceDocumentAdjustments.amount,
      })
      .from(treasuryPaymentItems)
      .innerJoin(
        invoiceDocumentAdjustments,
        eq(treasuryPaymentItems.invoiceId, invoiceDocumentAdjustments.invoiceId)
      )
      .where(
        and(
          eq(treasuryPaymentItems.batchId, batchId),
          inArray(invoiceDocumentAdjustments.adjustmentType, [
            "quality_retention",
            "advance_amortization",
            "prompt_payment_discount",
            "tc_discount",
          ])
        )
      )
      .orderBy(
        asc(invoiceDocumentAdjustments.invoiceId),
        asc(invoiceDocumentAdjustments.id)
      ),
    db
      .select({
        purchaseOrderAdvanceId: purchaseOrderAdvances.id,
        purchaseOrderId: purchaseOrders.id,
        orderNumber: purchaseOrders.orderNumber,
        invoiceProjectId: projects.id,
        invoiceProjectCode: projects.code,
        invoiceProjectName: projects.name,
        invoiceSubtotal: purchaseOrderAdvances.requestedAmount,
        invoiceTaxAmount: sql<string>`0`,
        invoiceTotal: purchaseOrderAdvances.requestedAmount,
        invoiceRetentionTotal: sql<string>`0`,
        invoiceOtherRetentionTotal: sql<string>`0`,
        invoiceDocumentDiscountTotal: sql<string>`0`,
      })
      .from(treasuryPaymentItems)
      .innerJoin(
        purchaseOrderAdvances,
        eq(
          treasuryPaymentItems.purchaseOrderAdvanceId,
          purchaseOrderAdvances.id
        )
      )
      .innerJoin(
        purchaseOrders,
        eq(purchaseOrderAdvances.purchaseOrderId, purchaseOrders.id)
      )
      .innerJoin(projects, eq(purchaseOrderAdvances.projectId, projects.id))
      .where(eq(treasuryPaymentItems.batchId, batchId)),
  ]);
  const invoiceFinancialsById = new Map(
    invoiceFinancialRows.map(invoice => [invoice.invoiceId, invoice])
  );
  const advanceFinancialsById = new Map(
    advanceFinancialRows.map(advance => [
      advance.purchaseOrderAdvanceId,
      advance,
    ])
  );
  const documentAdjustmentsByInvoiceId = new Map<
    number,
    typeof invoiceDocumentAdjustmentRows
  >();
  invoiceDocumentAdjustmentRows.forEach(adjustment => {
    const current =
      documentAdjustmentsByInvoiceId.get(adjustment.invoiceId) ?? [];
    current.push(adjustment);
    documentAdjustmentsByInvoiceId.set(adjustment.invoiceId, current);
  });
  const detailedItems = items.map((item: any) => {
    const documentAdjustments =
      item.sourceType === "purchase_order_advance"
        ? []
        : (documentAdjustmentsByInvoiceId.get(item.invoiceId) ?? []);
    return {
      ...item,
      ...(item.sourceType === "purchase_order_advance"
        ? advanceFinancialsById.get(item.purchaseOrderAdvanceId)
        : invoiceFinancialsById.get(item.invoiceId)),
      otherRetentionAdjustments: documentAdjustments.filter(adjustment =>
        ["quality_retention", "advance_amortization"].includes(
          adjustment.adjustmentType
        )
      ),
      documentDiscountAdjustments: documentAdjustments.filter(adjustment =>
        ["prompt_payment_discount", "tc_discount"].includes(
          adjustment.adjustmentType
        )
      ),
    };
  });
  const allFinancialRows = [...invoiceFinancialRows, ...advanceFinancialRows];
  const batchProjects = Array.from(
    new Map(
      allFinancialRows.map(invoice => [
        invoice.invoiceProjectId,
        {
          id: invoice.invoiceProjectId,
          code: invoice.invoiceProjectCode,
          name: invoice.invoiceProjectName,
        },
      ])
    ).values()
  ).sort((left, right) =>
    left.code.localeCompare(right.code, "es-HN", {
      numeric: true,
      sensitivity: "base",
    })
  );
  if (!batchProjects.length) {
    batchProjects.push(row.project);
  }
  const signedAttachments = await Promise.all(
    attachmentRows.map(async attachment => {
      try {
        const signed = await storageGet(attachment.fileKey);
        return { ...attachment, fileUrl: signed.url };
      } catch {
        return attachment;
      }
    })
  );
  return {
    ...row,
    items: detailedItems,
    events,
    attachments: signedAttachments,
    sourceBatches,
    projects: batchProjects,
    projectIds: batchProjects.map(project => project.id),
  };
}

export async function getTreasuryPaymentDetailReport(batchId: number) {
  const detail = await getTreasuryBatchById(batchId);
  if (!detail) {
    throw new TreasuryRuleError("Lote de Tesorería no encontrado.");
  }

  const reportItems = detail.items.filter(
    (item: any) =>
      !["excluida", "rechazada_banco"].includes(item.status) &&
      resolveTreasuryPaymentReportAmount(item) > 0
  );
  if (!reportItems.length) {
    throw new TreasuryRuleError(
      "El lote no tiene facturas con monto disponible para reportar."
    );
  }

  let lines;
  if (
    detail.batch.paymentKind === "purchase_order_advance" ||
    detail.batch.paymentKind === "quality_retention_release"
  ) {
    const isQualityRelease =
      detail.batch.paymentKind === "quality_retention_release";
    lines = reportItems.map((paymentItem: any) => ({
      paymentItem: {
        ...paymentItem,
        reportAmount: resolveTreasuryPaymentReportAmount(paymentItem),
      },
      invoice: {
        invoiceDocumentNumber: paymentItem.invoiceDocumentNumber,
        invoiceNumber: paymentItem.orderNumber ?? paymentItem.invoiceNumber,
        projectCode: paymentItem.invoiceProjectCode,
        projectName: paymentItem.invoiceProjectName,
        documentDate: detail.batch.requestedPaymentDate,
        total: paymentItem.invoiceNetPayable,
        supplierCode: paymentItem.supplierCode,
        supplierName: paymentItem.supplierName,
        items: [
          {
            itemName: isQualityRelease
              ? `Liberación de retención de calidad de factura ${paymentItem.invoiceDocumentNumber}`
              : `Anticipo a proveedor ${
                  paymentItem.orderNumber ?? paymentItem.invoiceNumber ?? ""
                }`.trim(),
          },
        ],
        retentions: [],
      },
    }));
  } else {
    const sourceInvoices = await listDmcReportSourceInvoices({
      invoiceIds: reportItems
        .map((item: any) => item.invoiceId)
        .filter((id: number | null): id is number => Boolean(id)),
    });
    const invoicesById = new Map(
      sourceInvoices.map(invoice => [invoice.invoiceId, invoice])
    );
    lines = reportItems.map((paymentItem: any) => {
      const invoice = invoicesById.get(paymentItem.invoiceId);
      if (!invoice) {
        throw new TreasuryRuleError(
          `No se encontró la factura ${paymentItem.invoiceDocumentNumber}.`
        );
      }
      return {
        paymentItem: {
          ...paymentItem,
          reportAmount: resolveTreasuryPaymentReportAmount(paymentItem),
        },
        invoice,
      };
    });
  }
  const hasRegisteredPayment = reportItems.some(
    (item: any) => Number(item.bankPaidAmount ?? 0) > 0
  );
  return {
    generatedAt: new Date(),
    batch: {
      id: detail.batch.id,
      batchNumber: detail.batch.batchNumber,
      status: detail.batch.status,
      currency: detail.batch.currency,
      paymentKind: detail.batch.paymentKind,
      requestedPaymentDate: detail.batch.requestedPaymentDate,
      notes: detail.batch.notes,
      paymentStatusLabel: hasRegisteredPayment
        ? "REGISTRADO"
        : getTreasuryBatchStatusLabel(
            detail.batch.status,
            detail.batch.approvalBypassed === true
          ).toUpperCase(),
    },
    project:
      detail.projects.length === 1
        ? detail.projects[0]
        : {
            id: 0,
            code: "VARIOS",
            name: "Varios proyectos",
          },
    projects: detail.projects,
    signatures: resolveTreasuryPaymentSignatures(detail.events),
    lines,
  };
}

function resolveDraftPaymentKind(
  items: TreasuryDraftItemInput[],
  requestedKind?: TreasuryPaymentKind
) {
  const inferredKinds = new Set(
    items.map(item =>
      item.sourceType === "purchase_order_advance"
        ? "purchase_order_advance"
        : item.sourceType === "quality_retention_release"
          ? "quality_retention_release"
          : "invoice"
    )
  );
  if (inferredKinds.size !== 1) {
    throw new TreasuryRuleError(
      "Un lote no puede mezclar fuentes de pago diferentes."
    );
  }
  const inferredKind = Array.from(inferredKinds)[0] as TreasuryPaymentKind;
  const paymentKind = requestedKind ?? inferredKind;
  if (paymentKind !== inferredKind) {
    throw new TreasuryRuleError(
      "El tipo del lote no coincide con los documentos seleccionados."
    );
  }
  return paymentKind;
}

async function getTreasuryDraftSourceSnapshots(
  executor: any,
  items: TreasuryDraftItemInput[],
  paymentKind: TreasuryPaymentKind,
  excludeBatchId?: number
) {
  const sourceIds = items.map(item =>
    paymentKind === "purchase_order_advance"
      ? (
          item as Extract<
            TreasuryDraftItemInput,
            { sourceType: "purchase_order_advance" }
          >
        ).purchaseOrderAdvanceId
      : paymentKind === "quality_retention_release"
        ? (
            item as Extract<
              TreasuryDraftItemInput,
              { sourceType: "quality_retention_release" }
            >
          ).qualityRetentionReleaseId
        : (item as Extract<TreasuryDraftItemInput, { invoiceId: number }>)
            .invoiceId
  );
  if (new Set(sourceIds).size !== sourceIds.length) {
    throw new TreasuryRuleError(
      paymentKind === "purchase_order_advance"
        ? "No se puede repetir un anticipo en el lote."
        : paymentKind === "quality_retention_release"
          ? "No se puede repetir una liberación en el lote."
          : "No se puede repetir una factura en el lote."
    );
  }
  const requestedAmountBySourceId = new Map(
    items.map((item, index) => [
      sourceIds[index]!,
      roundTreasuryMoney(item.requestedAmount),
    ])
  );

  if (paymentKind === "purchase_order_advance") {
    let rows;
    try {
      rows = await getPurchaseOrderAdvanceSnapshots(
        executor,
        sourceIds,
        excludeBatchId
      );
    } catch (error) {
      if (error instanceof PurchaseOrderAdvanceRuleError) {
        throw new TreasuryRuleError(error.message);
      }
      throw error;
    }
    return {
      requestedAmountBySourceId,
      snapshots: rows.map((row: any) => ({
        sourceId: row.advance.id,
        sourceType: "purchase_order_advance" as const,
        projectId: row.advance.projectId,
        currency: row.advance.currency,
        supplier: row.supplier,
        documentNumber: row.advance.advanceNumber,
        referenceNumber: row.purchaseOrder.orderNumber,
        targetAmount: row.advance.requestedAmount,
        previousPaidAmount: row.money.accountedAmount,
        appliedAdvanceAmount: 0,
        availableAmount: row.money.availableToPayAmount,
        isEligible:
          !row.advance.cancelledAt && row.money.bankPaidPendingAmount <= 0,
        purchaseOrderId: row.advance.purchaseOrderId,
      })),
    };
  }

  if (paymentKind === "quality_retention_release") {
    let rows;
    try {
      rows = await getQualityRetentionReleaseSnapshots(
        executor,
        sourceIds,
        excludeBatchId
      );
    } catch (error) {
      if (error instanceof QualityRetentionReleaseRuleError) {
        throw new TreasuryRuleError(error.message);
      }
      throw error;
    }
    return {
      requestedAmountBySourceId,
      snapshots: rows.map((row: any) => ({
        sourceId: row.release.id,
        sourceType: "quality_retention_release" as const,
        invoiceId: row.invoice.id,
        projectId: row.invoice.projectId,
        currency: row.invoice.currency,
        supplier: row.supplier,
        documentNumber: row.invoice.invoiceDocumentNumber,
        referenceNumber: row.invoice.invoiceNumber,
        targetAmount: row.release.approvedAmount,
        previousPaidAmount: row.money.paidAmount,
        appliedAdvanceAmount: 0,
        availableAmount: row.money.availableAmount,
        isEligible:
          ["approved", "partially_paid"].includes(row.release.status) &&
          row.ordinaryPayment?.isPaid === true,
        purchaseOrderId: row.invoice.purchaseOrderId,
      })),
    };
  }

  const rows = await getInvoiceSnapshots(executor, sourceIds, excludeBatchId);
  return {
    requestedAmountBySourceId,
    snapshots: rows.map((row: any) => ({
      sourceId: row.invoice.id,
      sourceType: "invoice" as const,
      projectId: row.invoice.projectId,
      currency: row.invoice.currency,
      supplier: row.supplier,
      documentNumber: row.invoice.invoiceDocumentNumber,
      referenceNumber: row.invoice.invoiceNumber,
      targetAmount: row.invoice.netPayable,
      previousPaidAmount: row.money.paidAmount,
      appliedAdvanceAmount: row.money.appliedAdvanceAmount,
      availableAmount: row.money.availableAmount,
      isEligible: row.invoice.status === "registrada",
      purchaseOrderId: row.invoice.purchaseOrderId,
    })),
  };
}

function validateTreasuryDraftSnapshots(input: {
  snapshots: any[];
  requestedAmountBySourceId: Map<number, number>;
  paymentKind: TreasuryPaymentKind;
  projectId: number;
  currency: PurchaseCurrency;
}) {
  for (const row of input.snapshots) {
    const sourceLabel =
      input.paymentKind === "purchase_order_advance"
        ? "Los anticipos"
        : input.paymentKind === "quality_retention_release"
          ? "Las liberaciones"
          : "Las facturas";
    if (row.projectId !== input.projectId) {
      throw new TreasuryRuleError(
        `${sourceLabel} deben pertenecer al proyecto del lote.`
      );
    }
    if (row.currency !== input.currency) {
      throw new TreasuryRuleError(
        `${sourceLabel} deben utilizar la moneda del lote.`
      );
    }
    if (!row.supplier || !row.isEligible) {
      throw new TreasuryRuleError(
        input.paymentKind === "purchase_order_advance"
          ? "Un anticipo ya no está disponible para Tesorería."
          : input.paymentKind === "quality_retention_release"
            ? "Una liberación ya no está autorizada o tiene el neto ordinario pendiente."
            : "Una factura ya no cumple las condiciones para Tesorería."
      );
    }
    const amount = input.requestedAmountBySourceId.get(row.sourceId) ?? 0;
    if (amount <= 0 || amount > row.availableAmount + 0.0001) {
      const noun =
        input.paymentKind === "purchase_order_advance"
          ? "El pago"
          : input.paymentKind === "quality_retention_release"
            ? "La liberación"
            : "El abono";
      throw new TreasuryRuleError(
        `${noun} de ${row.documentNumber} debe ser mayor que cero y no superar ${row.availableAmount.toFixed(2)} ${input.currency}.`
      );
    }
  }
}

function buildTreasuryItemValues(
  batchId: number,
  row: any,
  requestedAmount: number
) {
  return {
    batchId,
    sourceType: row.sourceType,
    invoiceId:
      row.sourceType === "invoice"
        ? row.sourceId
        : row.sourceType === "quality_retention_release"
          ? row.invoiceId
          : null,
    purchaseOrderAdvanceId:
      row.sourceType === "purchase_order_advance" ? row.sourceId : null,
    qualityRetentionReleaseId:
      row.sourceType === "quality_retention_release" ? row.sourceId : null,
    supplierId: row.supplier.id,
    supplierCode: row.supplier.supplierCode,
    supplierName: row.supplier.name,
    invoiceDocumentNumber: row.documentNumber,
    invoiceNumber: row.referenceNumber,
    currency: row.currency,
    invoiceNetPayable: row.targetAmount,
    previousPaidAmount: toMoneyString(row.previousPaidAmount),
    appliedAdvanceAmount: toMoneyString(row.appliedAdvanceAmount),
    requestedAmount: toMoneyString(requestedAmount),
  };
}

export async function createTreasuryBatch(input: {
  actor: TreasuryActor;
  projectId: number;
  currency: PurchaseCurrency;
  requestedPaymentDate: Date;
  notes?: string | null;
  paymentKind?: TreasuryPaymentKind;
  items: TreasuryDraftItemInput[];
}) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  return db.transaction(async tx => {
    const paymentKind = resolveDraftPaymentKind(input.items, input.paymentKind);
    const { snapshots, requestedAmountBySourceId } =
      await getTreasuryDraftSourceSnapshots(tx, input.items, paymentKind);
    validateTreasuryDraftSnapshots({
      snapshots,
      requestedAmountBySourceId,
      paymentKind,
      projectId: input.projectId,
      currency: input.currency,
    });
    if (paymentKind === "invoice") {
      const blocked = await getPurchaseOrderAdvanceBlockingSet(
        tx,
        snapshots.map((row: any) => row.purchaseOrderId)
      );
      if (snapshots.some((row: any) => blocked.has(row.purchaseOrderId))) {
        throw new TreasuryRuleError(
          "Complete o cancele los anticipos pendientes de la OC antes de pagar su factura."
        );
      }
    }

    const tempNumber = `TEMP-${randomUUID()}`;
    const [batch] = await tx
      .insert(treasuryPaymentBatches)
      .values({
        batchNumber: tempNumber,
        projectId: input.projectId,
        currency: input.currency,
        paymentKind,
        requestedPaymentDate: input.requestedPaymentDate,
        notes: input.notes?.trim() || null,
        createdById: input.actor.id,
      })
      .returning();
    const batchNumber = `TES-${input.requestedPaymentDate.getUTCFullYear()}-${String(batch.id).padStart(6, "0")}`;
    await tx
      .update(treasuryPaymentBatches)
      .set({ batchNumber })
      .where(eq(treasuryPaymentBatches.id, batch.id));
    await tx
      .insert(treasuryPaymentItems)
      .values(
        snapshots.map((row: any) =>
          buildTreasuryItemValues(
            batch.id,
            row,
            requestedAmountBySourceId.get(row.sourceId)!
          )
        )
      );
    await insertEvent(tx, {
      batchId: batch.id,
      action: "crear_lote",
      newStatus: "borrador",
      actor: input.actor,
      metadata: { itemCount: snapshots.length, paymentKind },
    });
    return { ...batch, batchNumber, paymentKind };
  });
}

export async function updateTreasuryDraft(input: {
  batchId: number;
  actor: TreasuryActor;
  requestedPaymentDate: Date;
  notes?: string | null;
  items: TreasuryDraftItemInput[];
}) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  return db.transaction(async tx => {
    const batch = await readBatch(tx, input.batchId);
    if (batch.status !== "borrador" && batch.status !== "devuelto") {
      throw new TreasuryRuleError(
        "Solo un lote en borrador o devuelto puede editarse."
      );
    }
    const paymentKind = resolveDraftPaymentKind(input.items, batch.paymentKind);
    const { snapshots, requestedAmountBySourceId } =
      await getTreasuryDraftSourceSnapshots(
        tx,
        input.items,
        paymentKind,
        input.batchId
      );
    validateTreasuryDraftSnapshots({
      snapshots,
      requestedAmountBySourceId,
      paymentKind,
      projectId: batch.projectId,
      currency: batch.currency,
    });
    if (paymentKind === "invoice") {
      const blocked = await getPurchaseOrderAdvanceBlockingSet(
        tx,
        snapshots.map((row: any) => row.purchaseOrderId)
      );
      if (snapshots.some((row: any) => blocked.has(row.purchaseOrderId))) {
        throw new TreasuryRuleError(
          "Complete o cancele los anticipos pendientes de la OC antes de pagar su factura."
        );
      }
    }

    const existingItems = await readBatchItems(tx, input.batchId);
    const existingBySourceId = new Map<number, any>(
      existingItems.map((item: any) => [
        item.sourceType === "purchase_order_advance"
          ? item.purchaseOrderAdvanceId
          : item.sourceType === "quality_retention_release"
            ? item.qualityRetentionReleaseId
            : item.invoiceId,
        item,
      ])
    );
    const selectedSourceIds = new Set(
      snapshots.map((row: any) => row.sourceId)
    );
    const now = new Date();
    for (const item of existingItems) {
      const sourceId =
        item.sourceType === "purchase_order_advance"
          ? item.purchaseOrderAdvanceId
          : item.sourceType === "quality_retention_release"
            ? item.qualityRetentionReleaseId
            : item.invoiceId;
      if (selectedSourceIds.has(sourceId)) continue;
      await tx
        .update(treasuryPaymentItems)
        .set({
          status: "excluida",
          activeReservation: false,
          exclusionReason: "Eliminada del borrador",
          excludedById: input.actor.id,
          excludedAt: now,
          updatedAt: now,
        })
        .where(eq(treasuryPaymentItems.id, item.id));
    }
    for (const row of snapshots) {
      const amount = toMoneyString(
        requestedAmountBySourceId.get(row.sourceId)!
      );
      const existing = existingBySourceId.get(row.sourceId);
      if (existing) {
        const values = buildTreasuryItemValues(
          input.batchId,
          row,
          requestedAmountBySourceId.get(row.sourceId)!
        );
        await tx
          .update(treasuryPaymentItems)
          .set({
            ...values,
            status: "incluida",
            activeReservation: true,
            requestedAmount: amount,
            approvedAmount: null,
            bankPaidAmount: null,
            bankPaidDate: null,
            bankReference: null,
            bankComment: null,
            exclusionReason: null,
            excludedById: null,
            excludedAt: null,
            differenceResolutionComment: null,
            updatedAt: now,
          })
          .where(eq(treasuryPaymentItems.id, existing.id));
      } else {
        await tx
          .insert(treasuryPaymentItems)
          .values(
            buildTreasuryItemValues(
              input.batchId,
              row,
              requestedAmountBySourceId.get(row.sourceId)!
            )
          );
      }
    }
    const [updated] = await tx
      .update(treasuryPaymentBatches)
      .set({
        status: "borrador",
        version:
          batch.status === "devuelto" ? batch.version + 1 : batch.version,
        requestedPaymentDate: input.requestedPaymentDate,
        notes: input.notes?.trim() || null,
        returnedById: null,
        returnedAt: null,
        returnReason: null,
        updatedAt: now,
      })
      .where(eq(treasuryPaymentBatches.id, input.batchId))
      .returning();
    await insertEvent(tx, {
      batchId: input.batchId,
      action: "editar_borrador",
      previousStatus: batch.status,
      newStatus: updated.status,
      actor: input.actor,
      metadata: { itemCount: input.items.length },
    });
    return updated;
  });
}

export async function submitTreasuryBatch(
  batchId: number,
  actor: TreasuryActor
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const result = await db.transaction(async tx => {
    const settings = await readTreasurySettings(tx, { forUpdate: true });
    const batch = await readBatch(tx, batchId);
    if (batch.status !== "borrador" && batch.status !== "devuelto") {
      throw new TreasuryRuleError(
        "Solo un lote en borrador o devuelto puede enviarse."
      );
    }
    const items = await readBatchItems(tx, batchId);
    if (
      !items.some(
        (item: any) => item.activeReservation && item.status !== "excluida"
      )
    ) {
      throw new TreasuryRuleError(
        "El lote debe conservar al menos una factura."
      );
    }
    const now = new Date();
    const routing = getTreasuryApprovalRouting(
      settings.treasuryBatchApprovalsEnabled
    );
    const { approvalBypassed } = routing;
    if (approvalBypassed) {
      await markActiveItemsApprovedWithoutWorkflow(tx, [batchId], now);
    }
    const [updated] = await tx
      .update(treasuryPaymentBatches)
      .set({
        status: routing.submissionStatus,
        approvalBypassed,
        approvedById: null,
        approvedAt: approvalBypassed ? now : null,
        version:
          batch.status === "devuelto" ? batch.version + 1 : batch.version,
        submittedById: actor.id,
        submittedAt: now,
        returnedById: null,
        returnedAt: null,
        returnReason: null,
        updatedAt: now,
      })
      .where(eq(treasuryPaymentBatches.id, batchId))
      .returning();
    await insertEvent(tx, {
      batchId,
      action: approvalBypassed ? "enviar_sin_aprobacion" : "enviar_depuracion",
      previousStatus: batch.status,
      newStatus: updated.status,
      actor,
      metadata: approvalBypassed
        ? { reason: "treasury_batch_approvals_disabled" }
        : undefined,
    });
    return updated;
  });
  await notifyRole("administracion_central", {
    title: result.approvalBypassed
      ? "Lote listo para banco"
      : "Lote pendiente de revisión",
    message: result.approvalBypassed
      ? `El lote ${result.batchNumber} está listo para exportarse al banco; la aprobación fue omitida por configuración.`
      : `El lote ${result.batchNumber} fue enviado a Tesorería.`,
    batchId,
  });
  return result;
}

async function applyAdjustments(
  tx: any,
  batchId: number,
  actor: TreasuryActor,
  adjustments: TreasuryAdjustmentInput[],
  phase: "depuracion" | "aprobacion"
) {
  const items = await readBatchItems(tx, batchId);
  const adjustmentMap = new Map(adjustments.map(item => [item.itemId, item]));
  for (const item of items) {
    if (!item.activeReservation || item.status === "excluida") continue;
    const adjustment = adjustmentMap.get(item.id);
    if (adjustment?.excluded) {
      const reason = adjustment.reason?.trim();
      if (!reason || reason.length < 5) {
        throw new TreasuryRuleError("Indique el motivo de cada exclusión.");
      }
      await tx
        .update(treasuryPaymentItems)
        .set({
          status: "excluida",
          activeReservation: false,
          exclusionReason: reason,
          excludedById: actor.id,
          excludedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(treasuryPaymentItems.id, item.id));
      await insertEvent(tx, {
        batchId,
        itemId: item.id,
        action: `excluir_${phase}`,
        previousStatus: item.status,
        newStatus: "excluida",
        actor,
        comment: reason,
      });
      continue;
    }
    const currentLimit = roundTreasuryMoney(
      Number(
        phase === "aprobacion" ? item.requestedAmount : item.requestedAmount
      )
    );
    const amount = roundTreasuryMoney(adjustment?.amount ?? currentLimit);
    if (amount <= 0 || amount > currentLimit + 0.0001) {
      throw new TreasuryRuleError(
        "Durante revisión y aprobación solo se puede mantener o disminuir el abono."
      );
    }
    const update =
      phase === "aprobacion"
        ? { approvedAmount: toMoneyString(amount), status: "aprobada" as const }
        : { requestedAmount: toMoneyString(amount) };
    await tx
      .update(treasuryPaymentItems)
      .set({ ...update, updatedAt: new Date() })
      .where(eq(treasuryPaymentItems.id, item.id));
    if (Math.abs(amount - currentLimit) > 0.0001) {
      await insertEvent(tx, {
        batchId,
        itemId: item.id,
        action: `ajustar_${phase}`,
        actor,
        metadata: { previousAmount: currentLimit, amount },
      });
    }
  }
  const remaining = await readBatchItems(tx, batchId);
  if (
    !remaining.some(
      (item: any) => item.activeReservation && item.status !== "excluida"
    )
  ) {
    throw new TreasuryRuleError(
      "No se puede continuar con un lote sin facturas."
    );
  }
  return remaining;
}

export async function saveTreasuryReview(input: {
  batchId: number;
  actor: TreasuryActor;
  adjustments: TreasuryAdjustmentInput[];
}) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  return db.transaction(async tx => {
    await assertTreasuryBatchApprovalsEnabled(tx);
    const batch = await readBatch(tx, input.batchId);
    if (batch.status !== "enviado_depuracion") {
      throw new TreasuryRuleError("El lote no está pendiente de revisión.");
    }
    await applyAdjustments(
      tx,
      input.batchId,
      input.actor,
      input.adjustments,
      "depuracion"
    );
    const now = new Date();
    const [updated] = await tx
      .update(treasuryPaymentBatches)
      .set({
        purifiedById: input.actor.id,
        purifiedAt: now,
        updatedAt: now,
      })
      .where(eq(treasuryPaymentBatches.id, input.batchId))
      .returning();
    await insertEvent(tx, {
      batchId: input.batchId,
      action: "guardar_revision",
      previousStatus: batch.status,
      newStatus: batch.status,
      actor: input.actor,
    });
    return updated;
  });
}

export async function consolidateTreasuryBatchesForApproval(input: {
  batchIds: number[];
  actor: TreasuryActor;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const batchIds = Array.from(new Set(input.batchIds));
  if (!batchIds.length) {
    throw new TreasuryRuleError("Seleccione al menos un lote.");
  }
  if (batchIds.length === 1) {
    const result = await db.transaction(async tx => {
      const settings = await readTreasurySettings(tx, { forUpdate: true });
      if (!settings.treasuryBatchApprovalsEnabled) {
        throw new TreasuryRuleError(
          "Seleccione al menos dos lotes para crear un consolidado listo para banco."
        );
      }
      const batch = await readBatch(tx, batchIds[0]!);
      if (batch.status !== "enviado_depuracion") {
        throw new TreasuryRuleError(
          batch.status === "pendiente_aprobacion"
            ? `El lote ${batch.batchNumber} ya está pendiente de aprobación.`
            : `El lote ${batch.batchNumber} ya no está disponible para enviar a aprobación.`
        );
      }
      const items = await readBatchItems(tx, batch.id);
      if (
        !items.some(
          (item: any) => item.activeReservation && item.status !== "excluida"
        )
      ) {
        throw new TreasuryRuleError(
          `El lote ${batch.batchNumber} no tiene facturas disponibles para aprobar.`
        );
      }
      const now = new Date();
      const [updated] = await tx
        .update(treasuryPaymentBatches)
        .set({
          status: "pendiente_aprobacion",
          purifiedById: input.actor.id,
          purifiedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(treasuryPaymentBatches.id, batch.id),
            eq(treasuryPaymentBatches.status, "enviado_depuracion")
          )
        )
        .returning();
      if (!updated) {
        throw new TreasuryRuleError(
          "El lote cambió de estado. Actualice la lista e intente nuevamente."
        );
      }
      await insertEvent(tx, {
        batchId: batch.id,
        action: "enviar_aprobacion",
        previousStatus: batch.status,
        newStatus: "pendiente_aprobacion",
        actor: input.actor,
      });
      return {
        batchId: updated.id,
        batchNumber: updated.batchNumber,
        sourceBatchIds: [updated.id],
        sourceBatchNumbers: [updated.batchNumber],
        currency: updated.currency,
        consolidated: false,
        approvalBypassed: false,
        status: updated.status,
      };
    });
    await notifyTreasuryApprovers({
      title: "Lote pendiente de aprobación",
      message: `El lote ${result.batchNumber} requiere aprobación.`,
      batchId: result.batchId,
    });
    return result;
  }
  const result = await db.transaction(async tx => {
    const settings = await readTreasurySettings(tx, { forUpdate: true });
    const batches = (
      await tx
        .select()
        .from(treasuryPaymentBatches)
        .where(inArray(treasuryPaymentBatches.id, batchIds))
    ).sort((left, right) => left.id - right.id);
    if (batches.length !== batchIds.length) {
      throw new TreasuryRuleError(
        "Uno o más lotes seleccionados ya no existen."
      );
    }
    const routing = assertTreasuryBatchesCanBeConsolidated(
      batches,
      settings.treasuryBatchApprovalsEnabled
    );
    const activeItems = await tx
      .select()
      .from(treasuryPaymentItems)
      .where(
        and(
          inArray(treasuryPaymentItems.batchId, batchIds),
          eq(treasuryPaymentItems.activeReservation, true),
          ne(treasuryPaymentItems.status, "excluida")
        )
      );
    const emptyBatch = batches.find(
      batch => !activeItems.some(item => item.batchId === batch.id)
    );
    if (emptyBatch) {
      throw new TreasuryRuleError(
        `El lote ${emptyBatch.batchNumber} no tiene facturas disponibles para aprobar.`
      );
    }

    const now = new Date();
    const consolidatedPaymentDate = getTreasuryBusinessDate(now);
    const sourceBatchNumbers = batches.map(batch => batch.batchNumber);
    const baseBatch = batches[0]!;
    const tempNumber = `TEMP-${randomUUID()}`;
    const [consolidatedBatch] = await tx
      .insert(treasuryPaymentBatches)
      .values({
        batchNumber: tempNumber,
        projectId: baseBatch.projectId,
        currency: baseBatch.currency,
        paymentKind: baseBatch.paymentKind,
        requestedPaymentDate: consolidatedPaymentDate,
        status: routing.consolidatedStatus,
        notes: `Consolidado de ${sourceBatchNumbers.join(", ")}`,
        createdById: input.actor.id,
        submittedById: input.actor.id,
        submittedAt: now,
        purifiedById: input.actor.id,
        purifiedAt: now,
        approvalBypassed: routing.approvalBypassed,
        approvedById: null,
        approvedAt: routing.approvalBypassed ? now : null,
      })
      .returning();
    const batchNumber = `TES-${consolidatedPaymentDate.getUTCFullYear()}-${String(consolidatedBatch.id).padStart(6, "0")}`;
    await tx
      .update(treasuryPaymentBatches)
      .set({ batchNumber })
      .where(eq(treasuryPaymentBatches.id, consolidatedBatch.id));

    const deactivatedItems = await tx
      .update(treasuryPaymentItems)
      .set({ activeReservation: false, updatedAt: now })
      .where(
        inArray(
          treasuryPaymentItems.id,
          activeItems.map(item => item.id)
        )
      )
      .returning({ id: treasuryPaymentItems.id });
    if (deactivatedItems.length !== activeItems.length) {
      throw new TreasuryRuleError(
        "No se pudieron liberar todas las facturas de los lotes origen."
      );
    }
    const copiedItems = await tx
      .insert(treasuryPaymentItems)
      .values(
        activeItems.map(item => ({
          batchId: consolidatedBatch.id,
          sourceType: item.sourceType,
          invoiceId: item.invoiceId,
          purchaseOrderAdvanceId: item.purchaseOrderAdvanceId,
          qualityRetentionReleaseId: item.qualityRetentionReleaseId,
          supplierId: item.supplierId,
          supplierCode: item.supplierCode,
          supplierName: item.supplierName,
          invoiceDocumentNumber: item.invoiceDocumentNumber,
          invoiceNumber: item.invoiceNumber,
          currency: item.currency,
          invoiceNetPayable: item.invoiceNetPayable,
          previousPaidAmount: item.previousPaidAmount,
          appliedAdvanceAmount: item.appliedAdvanceAmount,
          requestedAmount: item.requestedAmount,
          approvedAmount: routing.approvalBypassed
            ? item.requestedAmount
            : null,
          status: routing.consolidatedItemStatus,
          activeReservation: true,
        }))
      )
      .returning({ id: treasuryPaymentItems.id });
    if (copiedItems.length !== activeItems.length) {
      throw new TreasuryRuleError(
        "No se pudieron copiar todas las facturas al lote consolidado."
      );
    }

    const consolidatedSources = await tx
      .update(treasuryPaymentBatches)
      .set({
        status: "consolidado",
        consolidatedIntoBatchId: consolidatedBatch.id,
        consolidatedById: input.actor.id,
        consolidatedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          inArray(treasuryPaymentBatches.id, batchIds),
          inArray(treasuryPaymentBatches.status, routing.consolidatableStatuses)
        )
      )
      .returning({ id: treasuryPaymentBatches.id });
    if (consolidatedSources.length !== batchIds.length) {
      throw new TreasuryRuleError(
        "Uno o más lotes cambiaron de estado. Actualice la lista e intente nuevamente."
      );
    }

    for (const batch of batches) {
      await insertEvent(tx, {
        batchId: batch.id,
        action: "consolidar_en_lote",
        previousStatus: batch.status,
        newStatus: "consolidado",
        actor: input.actor,
        metadata: {
          consolidatedBatchId: consolidatedBatch.id,
          consolidatedBatchNumber: batchNumber,
        },
      });
    }
    await insertEvent(tx, {
      batchId: consolidatedBatch.id,
      action: routing.approvalBypassed
        ? "crear_lote_consolidado_sin_aprobacion"
        : "crear_lote_consolidado",
      newStatus: routing.consolidatedStatus,
      actor: input.actor,
      metadata: {
        sourceBatchIds: batchIds,
        sourceBatchNumbers,
        itemCount: copiedItems.length,
        projectIds: Array.from(new Set(batches.map(batch => batch.projectId))),
        approvalBypassed: routing.approvalBypassed,
      },
    });
    return {
      batchId: consolidatedBatch.id,
      batchNumber,
      sourceBatchIds: batchIds,
      sourceBatchNumbers,
      currency: baseBatch.currency,
      consolidated: true,
      approvalBypassed: routing.approvalBypassed,
      status: routing.consolidatedStatus,
    };
  });
  if (!result.approvalBypassed) {
    await notifyTreasuryApprovers({
      title: "Consolidado pendiente de aprobación",
      message: `El lote consolidado ${result.batchNumber}, creado a partir de ${result.sourceBatchIds.length} lotes, requiere aprobación.`,
      batchId: result.batchId,
    });
  }
  return result;
}

export async function approveTreasuryBatch(input: {
  batchId: number;
  actor: TreasuryActor;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const result = await db.transaction(async tx => {
    await assertTreasuryBatchApprovalsEnabled(tx);
    const batch = await readBatch(tx, input.batchId);
    if (batch.status !== "pendiente_aprobacion") {
      throw new TreasuryRuleError("El lote no está pendiente de aprobación.");
    }
    await applyAdjustments(tx, input.batchId, input.actor, [], "aprobacion");
    const now = new Date();
    const [updated] = await tx
      .update(treasuryPaymentBatches)
      .set({
        status: "aprobado",
        approvalBypassed: false,
        approvedById: input.actor.id,
        approvedAt: now,
        updatedAt: now,
      })
      .where(eq(treasuryPaymentBatches.id, input.batchId))
      .returning();
    await insertEvent(tx, {
      batchId: input.batchId,
      action: "aprobar_lote",
      previousStatus: batch.status,
      newStatus: updated.status,
      actor: input.actor,
    });
    return updated;
  });
  await notifyRole("administracion_central", {
    title: "Lote aprobado",
    message: `El lote ${result.batchNumber} está listo para enviarse al banco.`,
    batchId: input.batchId,
  });
  return result;
}

export async function rejectTreasuryBatch(input: {
  batchId: number;
  actor: TreasuryActor;
  reason: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const reason = input.reason.trim();
  const result = await db.transaction(async tx => {
    await assertTreasuryBatchApprovalsEnabled(tx);
    const batch = await readBatch(tx, input.batchId);
    if (batch.status !== "pendiente_aprobacion") {
      throw new TreasuryRuleError("El lote no está pendiente de aprobación.");
    }
    const now = new Date();
    const [updated] = await tx
      .update(treasuryPaymentBatches)
      .set({
        status: "rechazado",
        returnedById: input.actor.id,
        returnedAt: now,
        returnReason: reason,
        updatedAt: now,
      })
      .where(eq(treasuryPaymentBatches.id, input.batchId))
      .returning();
    await insertEvent(tx, {
      batchId: input.batchId,
      action: "rechazar_lote",
      previousStatus: batch.status,
      newStatus: "rechazado",
      actor: input.actor,
      comment: reason,
    });
    return updated;
  });
  await notifyRole("administracion_central", {
    title: "Lote rechazado",
    message: `El lote ${result.batchNumber} fue rechazado: ${reason}`,
    batchId: input.batchId,
  });
  return result;
}

export async function reopenRejectedTreasuryBatch(input: {
  batchId: number;
  actor: TreasuryActor;
  reason: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const reason = input.reason.trim();
  const result = await db.transaction(async tx => {
    const settings = await readTreasurySettings(tx, { forUpdate: true });
    const batch = await readBatch(tx, input.batchId);
    if (batch.status !== "rechazado") {
      throw new TreasuryRuleError("Solo se puede reabrir un lote rechazado.");
    }
    const routing = getTreasuryApprovalRouting(
      settings.treasuryBatchApprovalsEnabled
    );
    const { approvalBypassed } = routing;
    const now = new Date();
    if (approvalBypassed) {
      await markActiveItemsApprovedWithoutWorkflow(tx, [input.batchId], now);
    }
    const [updated] = await tx
      .update(treasuryPaymentBatches)
      .set({
        status: routing.rejectedReopenStatus,
        approvalBypassed,
        approvedById: null,
        approvedAt: approvalBypassed ? now : null,
        returnedById: null,
        returnedAt: null,
        returnReason: null,
        updatedAt: now,
      })
      .where(eq(treasuryPaymentBatches.id, input.batchId))
      .returning();
    await insertEvent(tx, {
      batchId: input.batchId,
      action: approvalBypassed
        ? "reabrir_sin_aprobacion"
        : "reabrir_lote_rechazado",
      previousStatus: batch.status,
      newStatus: updated.status,
      actor: input.actor,
      comment: reason,
      metadata: approvalBypassed
        ? { reason: "treasury_batch_approvals_disabled" }
        : undefined,
    });
    return updated;
  });
  if (result.approvalBypassed) {
    await notifyRole("administracion_central", {
      title: "Lote listo para banco",
      message: `El lote ${result.batchNumber} fue reabierto y quedó listo para banco sin aprobación.`,
      batchId: input.batchId,
    });
  } else {
    await notifyTreasuryApprovers({
      title: "Lote reabierto para aprobación",
      message: `El lote ${result.batchNumber} volvió a quedar pendiente de aprobación.`,
      batchId: input.batchId,
    });
  }
  return result;
}

export async function returnTreasuryBatch(input: {
  batchId: number;
  actor: TreasuryActor;
  reason: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const result = await db.transaction(async tx => {
    await assertTreasuryBatchApprovalsEnabled(tx);
    const batch = await readBatch(tx, input.batchId);
    if (
      !["enviado_depuracion", "pendiente_aprobacion"].includes(batch.status)
    ) {
      throw new TreasuryRuleError(
        "El lote ya no puede devolverse al proyecto."
      );
    }
    const now = new Date();
    const [updated] = await tx
      .update(treasuryPaymentBatches)
      .set({
        status: "devuelto",
        returnedById: input.actor.id,
        returnedAt: now,
        returnReason: input.reason.trim(),
        updatedAt: now,
      })
      .where(eq(treasuryPaymentBatches.id, input.batchId))
      .returning();
    await insertEvent(tx, {
      batchId: input.batchId,
      action: "devolver_lote",
      previousStatus: batch.status,
      newStatus: updated.status,
      actor: input.actor,
      comment: input.reason,
    });
    return updated;
  });
  await notifyUsers([result.createdById], {
    title: "Lote devuelto",
    message: `El lote ${result.batchNumber} fue devuelto: ${input.reason.trim()}`,
    batchId: input.batchId,
  });
  return result;
}

export async function returnTreasuryBatchToDraft(input: {
  batchId: number;
  actor: TreasuryActor;
  reason: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  return db.transaction(async tx => {
    const batch = await readBatch(tx, input.batchId);
    const items = await readBatchItems(tx, input.batchId);
    const bankExportAttachments = await tx
      .select({ id: attachments.id })
      .from(attachments)
      .where(
        and(
          eq(attachments.entityType, "treasury_payment_batch"),
          eq(attachments.entityId, input.batchId),
          eq(attachments.category, "archivo_bancario")
        )
      )
      .limit(1);
    assertTreasuryBatchCanReturnToDraft(
      batch,
      items,
      bankExportAttachments.length > 0
    );

    const activeItems = items.filter(
      (item: any) => item.activeReservation && item.status !== "excluida"
    );
    const now = new Date();
    const nextVersion = batch.version + 1;
    const [updated] = await tx
      .update(treasuryPaymentBatches)
      .set({
        status: "borrador",
        version: nextVersion,
        submittedById: null,
        submittedAt: null,
        purifiedById: null,
        purifiedAt: null,
        approvedById: null,
        approvedAt: null,
        approvalBypassed: false,
        exportedById: null,
        exportedAt: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(treasuryPaymentBatches.id, input.batchId),
          eq(treasuryPaymentBatches.status, "aprobado"),
          isNull(treasuryPaymentBatches.exportedAt)
        )
      )
      .returning();
    if (!updated) {
      throw new TreasuryRuleError(
        "El lote cambió de estado o fue exportado. Actualice e intente nuevamente."
      );
    }

    const restoredItems = await tx
      .update(treasuryPaymentItems)
      .set({
        status: "incluida",
        approvedAmount: null,
        updatedAt: now,
      })
      .where(
        and(
          inArray(
            treasuryPaymentItems.id,
            activeItems.map((item: any) => item.id)
          ),
          eq(treasuryPaymentItems.activeReservation, true),
          eq(treasuryPaymentItems.status, "aprobada")
        )
      )
      .returning({ id: treasuryPaymentItems.id });
    if (restoredItems.length !== activeItems.length) {
      throw new TreasuryRuleError(
        "Una o más líneas cambiaron de estado. Actualice e intente nuevamente."
      );
    }

    await insertEvent(tx, {
      batchId: input.batchId,
      action: "regresar_borrador",
      previousStatus: batch.status,
      newStatus: "borrador",
      actor: input.actor,
      comment: input.reason,
      metadata: {
        previousVersion: batch.version,
        version: nextVersion,
        restoredItems: restoredItems.length,
      },
    });
    return updated;
  });
}

function buildBankWorkbook(
  detail: NonNullable<Awaited<ReturnType<typeof getTreasuryBatchById>>>
) {
  const headers =
    detail.batch.paymentKind === "purchase_order_advance"
      ? {
          ...BANK_EXPORT_HEADERS,
          invoiceDocumentNumber: "ANTICIPO",
          invoiceNumber: "ORDEN_COMPRA",
          invoiceNetPayable: "IMPORTE_SOLICITADO",
          appliedAdvanceAmount: "APLICADO_EN_FACTURAS",
          previousPaidAmount: "PAGOS_ANTERIORES",
          availableBefore: "SALDO_ANTES_PAGO",
          approvedAmount: "PAGO_APROBADO",
        }
      : BANK_EXPORT_HEADERS;
  const rows = detail.items
    .filter(
      (item: any) =>
        item.status === "aprobada" ||
        item.status === "pagada" ||
        item.status === "con_diferencia"
    )
    .map((item: any) => ({
      [headers.batchNumber]: detail.batch.batchNumber,
      [headers.version]: detail.batch.version,
      [headers.itemId]: item.id,
      [headers.paymentKind]:
        detail.batch.paymentKind === "purchase_order_advance"
          ? "ANTICIPO_PROVEEDOR"
          : detail.batch.paymentKind === "quality_retention_release"
            ? "LIBERACION_RETENCION_CALIDAD"
            : "FACTURA",
      [headers.project]: [item.invoiceProjectCode, item.invoiceProjectName]
        .filter(Boolean)
        .join(" - "),
      [headers.supplierCode]: item.supplierCode,
      [headers.supplierName]: item.supplierName,
      [headers.invoiceDocumentNumber]: item.invoiceDocumentNumber,
      [headers.invoiceNumber]: item.invoiceNumber ?? "",
      [headers.currency]: item.currency,
      [headers.invoiceNetPayable]: roundTreasuryMoney(
        Number(item.invoiceNetPayable)
      ),
      [headers.appliedAdvanceAmount]: roundTreasuryMoney(
        Number(item.appliedAdvanceAmount ?? 0)
      ),
      [headers.previousPaidAmount]: roundTreasuryMoney(
        Number(item.previousPaidAmount)
      ),
      [headers.availableBefore]: roundTreasuryMoney(
        Number(item.invoiceNetPayable) -
          Number(item.appliedAdvanceAmount ?? 0) -
          Number(item.previousPaidAmount)
      ),
      [headers.approvedAmount]: roundTreasuryMoney(
        Number(item.approvedAmount ?? item.requestedAmount)
      ),
      [headers.requestedPaymentDate]: toDateOnly(
        detail.batch.requestedPaymentDate
      ),
      [headers.bankStatus]: "",
      [headers.bankPaidAmount]: "",
      [headers.bankPaidDate]: "",
      [headers.bankReference]: "",
      [headers.bankComment]: "",
    }));
  const worksheet = XLSX.utils.json_to_sheet(rows, {
    header: Object.values(headers),
  });
  worksheet["!cols"] = Object.values(headers).map(header => ({
    wch: Math.min(32, Math.max(12, header.length + 2)),
  }));
  const moneyHeaders = new Set<string>([
    headers.invoiceNetPayable,
    headers.appliedAdvanceAmount,
    headers.previousPaidAmount,
    headers.availableBefore,
    headers.approvedAmount,
    headers.bankPaidAmount,
  ]);
  const headerValues = Object.values(headers);
  for (let rowIndex = 1; rowIndex <= rows.length; rowIndex += 1) {
    headerValues.forEach((header, columnIndex) => {
      if (!moneyHeaders.has(header)) return;
      const cell =
        worksheet[XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex })];
      if (cell) cell.z = "#,##0.00";
    });
  }
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Pagos");
  return Buffer.from(
    XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer
  );
}

async function persistTreasuryAttachment(input: {
  batchId: number;
  actorId: number;
  fileName: string;
  buffer: Buffer;
  mimeType: string;
  category: "archivo_bancario" | "comprobante_pago";
}) {
  const key = `treasury/${input.batchId}/${Date.now()}-${randomUUID()}-${input.fileName}`;
  const stored = await storagePut(key, input.buffer, input.mimeType);
  try {
    const attachment = await createAttachment({
      entityType: "treasury_payment_batch",
      entityId: input.batchId,
      fileName: input.fileName,
      fileKey: stored.key,
      fileUrl: stored.url,
      mimeType: input.mimeType,
      fileSize: input.buffer.byteLength,
      category: input.category,
      uploadedById: input.actorId,
    });
    return { ...stored, attachmentId: attachment.id };
  } catch (error) {
    await storageDelete(stored.key).catch(() => undefined);
    throw error;
  }
}

export async function exportTreasuryBankWorkbook(
  batchId: number,
  actor: TreasuryActor
) {
  const detail = await getTreasuryBatchById(batchId);
  if (!detail) throw new TreasuryRuleError("Lote de Tesorería no encontrado.");
  if (!["aprobado", "enviado_banco"].includes(detail.batch.status)) {
    throw new TreasuryRuleError(
      "Solo se puede exportar un lote listo para banco."
    );
  }
  const buffer = buildBankWorkbook(detail);
  const fileName = `${detail.batch.batchNumber}-v${detail.batch.version}-banco.xlsx`;
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const stored = await persistTreasuryAttachment({
    batchId,
    actorId: actor.id,
    fileName,
    buffer,
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    category: "archivo_bancario",
  });
  try {
    await db.transaction(async tx => {
      const batch = await readBatch(tx, batchId);
      if (!["aprobado", "enviado_banco"].includes(batch.status)) {
        throw new TreasuryRuleError(
          "El lote cambió de estado y ya no puede exportarse."
        );
      }
      const [updated] = await tx
        .update(treasuryPaymentBatches)
        .set({
          status: "enviado_banco",
          exportedById: actor.id,
          exportedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(treasuryPaymentBatches.id, batchId),
            inArray(treasuryPaymentBatches.status, [
              "aprobado",
              "enviado_banco",
            ])
          )
        )
        .returning({ id: treasuryPaymentBatches.id });
      if (!updated) {
        throw new TreasuryRuleError(
          "El lote cambió de estado y ya no puede exportarse."
        );
      }
      await insertEvent(tx, {
        batchId,
        action: "exportar_banco",
        previousStatus: batch.status,
        newStatus: "enviado_banco",
        actor,
        metadata: { fileName },
      });
    });
  } catch (error) {
    await db
      .delete(attachments)
      .where(eq(attachments.fileKey, stored.key))
      .catch(() => undefined);
    await storageDelete(stored.key).catch(() => undefined);
    throw error;
  }
  return {
    fileName,
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    base64: buffer.toString("base64"),
  };
}

export function parseTreasuryBankWorkbook(buffer: Buffer) {
  if (buffer.byteLength === 0 || buffer.byteLength > 10 * 1024 * 1024) {
    throw new TreasuryRuleError(
      "El archivo bancario debe pesar entre 1 byte y 10 MB."
    );
  }
  if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
    throw new TreasuryRuleError(
      "El archivo no parece ser un libro XLSX válido."
    );
  }
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  } catch {
    throw new TreasuryRuleError("No se pudo leer el archivo XLSX.");
  }
  const firstSheet = workbook.SheetNames[0];
  if (!firstSheet) throw new TreasuryRuleError("El archivo no contiene hojas.");
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
    workbook.Sheets[firstSheet],
    { defval: "", raw: true }
  );
  if (!rows.length)
    throw new TreasuryRuleError("El archivo no contiene pagos.");
  return rows.map((row, index) => {
    const rowNumber = index + 2;
    const bankStatus = String(row[BANK_EXPORT_HEADERS.bankStatus] ?? "")
      .trim()
      .toUpperCase();
    if (bankStatus !== "PAGADO" && bankStatus !== "RECHAZADO") {
      throw new TreasuryRuleError(
        `Fila ${rowNumber}: ESTADO_BANCO debe ser PAGADO o RECHAZADO.`
      );
    }
    const paidAmount =
      bankStatus === "PAGADO"
        ? parseMoney(
            row[BANK_EXPORT_HEADERS.bankPaidAmount],
            `Fila ${rowNumber}: MONTO_PAGADO`
          )
        : 0;
    if (bankStatus === "PAGADO" && paidAmount <= 0) {
      throw new TreasuryRuleError(
        `Fila ${rowNumber}: el monto pagado debe ser mayor que cero.`
      );
    }
    return {
      rowNumber,
      batchNumber: String(row[BANK_EXPORT_HEADERS.batchNumber] ?? "").trim(),
      version: Number(row[BANK_EXPORT_HEADERS.version]),
      itemId: Number(row[BANK_EXPORT_HEADERS.itemId]),
      bankStatus,
      paidAmount,
      paidDate:
        bankStatus === "PAGADO"
          ? parseDateValue(
              row[BANK_EXPORT_HEADERS.bankPaidDate],
              `Fila ${rowNumber}: FECHA_PAGO`
            )
          : null,
      bankReference: String(
        row[BANK_EXPORT_HEADERS.bankReference] ?? ""
      ).trim(),
      bankComment: String(row[BANK_EXPORT_HEADERS.bankComment] ?? "").trim(),
    };
  });
}

type TreasuryBankRow = ReturnType<typeof parseTreasuryBankWorkbook>[number];

function matchTreasuryBankRows(
  parsedRows: ReturnType<typeof parseTreasuryBankWorkbook>,
  batch: any,
  items: any[]
) {
  if (batch.status !== "enviado_banco") {
    throw new TreasuryRuleError(
      "El lote no está pendiente de respuesta bancaria."
    );
  }
  const payableItems = items.filter(item => item.status === "aprobada");
  if (
    parsedRows.length !== payableItems.length ||
    new Set(parsedRows.map(row => row.itemId)).size !== parsedRows.length
  ) {
    throw new TreasuryRuleError(
      "El archivo debe contener exactamente una fila por cada línea aprobada."
    );
  }
  const itemById = new Map<number, any>(
    payableItems.map(item => [item.id, item])
  );
  let hasDifferences = false;
  let hasPaidLines = false;
  const matchedRows = parsedRows.map(row => {
    if (
      row.batchNumber !== batch.batchNumber ||
      row.version !== batch.version
    ) {
      throw new TreasuryRuleError(
        `Fila ${row.rowNumber}: el lote o la versión no corresponde al archivo vigente.`
      );
    }
    const item = itemById.get(row.itemId);
    if (!item) {
      throw new TreasuryRuleError(
        `Fila ${row.rowNumber}: la línea no pertenece al lote aprobado.`
      );
    }
    const approved = roundTreasuryMoney(
      Number(item.approvedAmount ?? item.requestedAmount)
    );
    if (row.paidAmount > approved + 0.0001) {
      throw new TreasuryRuleError(
        `Fila ${row.rowNumber}: el banco no puede pagar más que el abono aprobado.`
      );
    }
    const rejected = row.bankStatus === "RECHAZADO";
    const differs = !rejected && Math.abs(row.paidAmount - approved) > 0.0001;
    hasDifferences ||= differs;
    hasPaidLines ||= !rejected;
    return { row, item, approved, rejected, differs };
  });
  return { matchedRows, hasDifferences, hasPaidLines };
}

export async function importTreasuryBankWorkbook(input: {
  batchId: number;
  actor: TreasuryActor;
  fileName: string;
  base64: string;
}) {
  const buffer = Buffer.from(input.base64, "base64");
  const parsedRows = parseTreasuryBankWorkbook(buffer);
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const preliminaryBatch = await readBatch(db, input.batchId);
  const preliminaryItems = await readBatchItems(db, input.batchId);
  matchTreasuryBankRows(parsedRows, preliminaryBatch, preliminaryItems);

  const stored = await persistTreasuryAttachment({
    batchId: input.batchId,
    actorId: input.actor.id,
    fileName: input.fileName,
    buffer,
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    category: "comprobante_pago",
  });
  let result;
  try {
    result = await applyTreasuryBankRows({
      db,
      batchId: input.batchId,
      actor: input.actor,
      parsedRows,
      eventAction: "importar_respuesta_banco",
      eventMetadata: { fileName: input.fileName },
    });
  } catch (error) {
    try {
      await db.delete(attachments).where(eq(attachments.fileKey, stored.key));
    } catch {
      // Best effort: keep the original transaction error as the user-facing cause.
    }
    await storageDelete(stored.key).catch(() => undefined);
    throw error;
  }
  return result;
}

async function applyTreasuryBankRows(input: {
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>;
  batchId: number;
  actor: TreasuryActor;
  parsedRows: TreasuryBankRow[];
  eventAction: string;
  eventMetadata?: Record<string, unknown>;
}) {
  const result = await input.db.transaction(async tx => {
    const batch = await readBatch(tx, input.batchId);
    const items = await readBatchItems(tx, input.batchId);
    const { matchedRows, hasDifferences, hasPaidLines } = matchTreasuryBankRows(
      input.parsedRows,
      batch,
      items
    );
    for (const { row, item, approved, rejected, differs } of matchedRows) {
      const nextItemStatus = rejected
        ? "rechazada_banco"
        : differs
          ? "con_diferencia"
          : "pagada";
      await tx
        .update(treasuryPaymentItems)
        .set({
          status: nextItemStatus,
          activeReservation: !rejected,
          bankPaidAmount: rejected ? null : toMoneyString(row.paidAmount),
          bankPaidDate: row.paidDate,
          bankReference: row.bankReference || null,
          bankComment: row.bankComment || null,
          updatedAt: new Date(),
        })
        .where(eq(treasuryPaymentItems.id, item.id));
      await insertEvent(tx, {
        batchId: input.batchId,
        itemId: item.id,
        action: rejected ? "rechazo_bancario" : "pago_bancario",
        previousStatus: item.status,
        newStatus: nextItemStatus,
        actor: input.actor,
        metadata: { approvedAmount: approved, paidAmount: row.paidAmount },
      });
    }
    const now = new Date();
    const nextStatus = hasDifferences
      ? "conciliacion"
      : hasPaidLines
        ? "pendiente_contabilizacion"
        : "cerrado";
    const [updated] = await tx
      .update(treasuryPaymentBatches)
      .set({
        status: nextStatus,
        reconciledById: input.actor.id,
        reconciledAt: now,
        updatedAt: now,
      })
      .where(eq(treasuryPaymentBatches.id, input.batchId))
      .returning();
    await insertEvent(tx, {
      batchId: input.batchId,
      action: input.eventAction,
      previousStatus: batch.status,
      newStatus: nextStatus,
      actor: input.actor,
      metadata: {
        ...input.eventMetadata,
        hasDifferences,
        hasPaidLines,
      },
    });
    return updated;
  });
  if (result.status === "pendiente_contabilizacion") {
    await notifyRole("contable", {
      title: "Pagos pendientes de contabilización",
      message: `El lote ${result.batchNumber} fue conciliado con el banco.`,
      batchId: input.batchId,
    });
  }
  return result;
}

export function buildTreasuryFullPaymentRows(input: {
  batch: { batchNumber: string; version: number };
  items: Array<{
    id: number;
    status: TreasuryItemStatus;
    approvedAmount?: string | number | null;
    requestedAmount: string | number;
  }>;
  bankReference: string;
  paidDate: Date;
}): TreasuryBankRow[] {
  const approvedItems = input.items.filter(item => item.status === "aprobada");
  if (!approvedItems.length) {
    throw new TreasuryRuleError(
      "El lote no tiene facturas aprobadas para pagar."
    );
  }
  const bankReference = input.bankReference.trim();
  if (!bankReference) {
    throw new TreasuryRuleError("Ingrese la referencia bancaria del lote.");
  }
  return approvedItems.map((item, index) => ({
    rowNumber: index + 1,
    batchNumber: input.batch.batchNumber,
    version: input.batch.version,
    itemId: item.id,
    bankStatus: "PAGADO",
    paidAmount: roundTreasuryMoney(
      Number(item.approvedAmount ?? item.requestedAmount)
    ),
    paidDate: input.paidDate,
    bankReference,
    bankComment: "",
  }));
}

export async function recordTreasuryBankResponse(input: {
  batchId: number;
  actor: TreasuryActor;
  bankReference: string;
  paidDate: Date;
  attachment: TreasuryBankResponseAttachmentInput;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const batch = await readBatch(db, input.batchId);
  const batchItems: any[] = await readBatchItems(db, input.batchId);
  const bankReference = input.bankReference.trim();
  const parsedRows = buildTreasuryFullPaymentRows({
    batch,
    items: batchItems,
    bankReference,
    paidDate: input.paidDate,
  });
  matchTreasuryBankRows(parsedRows, batch, batchItems);
  const preparedAttachment = prepareTreasuryBankAttachment(input.attachment);
  const stored = await persistTreasuryAttachment({
    batchId: input.batchId,
    actorId: input.actor.id,
    fileName: preparedAttachment.fileName,
    buffer: preparedAttachment.buffer,
    mimeType: preparedAttachment.mimeType,
    category: "comprobante_pago",
  });
  try {
    return await applyTreasuryBankRows({
      db,
      batchId: input.batchId,
      actor: input.actor,
      parsedRows,
      eventAction: "registrar_pago_banco",
      eventMetadata: {
        source: "manual",
        bankReference,
        paidDate: toDateOnly(input.paidDate),
        attachmentFileName: preparedAttachment.fileName,
      },
    });
  } catch (error) {
    try {
      await db.delete(attachments).where(eq(attachments.fileKey, stored.key));
    } catch {
      // Best effort: keep the transaction error as the user-facing cause.
    }
    await storageDelete(stored.key).catch(() => undefined);
    throw error;
  }
}

export async function resolveTreasuryDifference(input: {
  batchId: number;
  itemId: number;
  actor: TreasuryActor;
  resolution: "accept" | "reject";
  comment: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const result = await db.transaction(async tx => {
    const batch = await readBatch(tx, input.batchId);
    if (batch.status !== "conciliacion") {
      throw new TreasuryRuleError("El lote no tiene diferencias pendientes.");
    }
    const [item] = await tx
      .select()
      .from(treasuryPaymentItems)
      .where(
        and(
          eq(treasuryPaymentItems.id, input.itemId),
          eq(treasuryPaymentItems.batchId, input.batchId)
        )
      )
      .limit(1);
    if (!item || item.status !== "con_diferencia") {
      throw new TreasuryRuleError(
        "La línea no tiene una diferencia pendiente."
      );
    }
    const nextItemStatus =
      input.resolution === "accept" ? "pagada" : "rechazada_banco";
    await tx
      .update(treasuryPaymentItems)
      .set({
        status: nextItemStatus,
        activeReservation: input.resolution === "accept",
        differenceResolutionComment: input.comment.trim(),
        updatedAt: new Date(),
      })
      .where(eq(treasuryPaymentItems.id, input.itemId));
    await insertEvent(tx, {
      batchId: input.batchId,
      itemId: input.itemId,
      action:
        input.resolution === "accept"
          ? "aceptar_diferencia"
          : "rechazar_diferencia",
      previousStatus: item.status,
      newStatus: nextItemStatus,
      actor: input.actor,
      comment: input.comment,
    });
    const remaining = await tx
      .select({
        id: treasuryPaymentItems.id,
        status: treasuryPaymentItems.status,
      })
      .from(treasuryPaymentItems)
      .where(
        and(
          eq(treasuryPaymentItems.batchId, input.batchId),
          eq(treasuryPaymentItems.status, "con_diferencia")
        )
      );
    if (remaining.length > 0) return batch;
    const [{ hasPaidLines = false } = {}] = await tx
      .select({
        hasPaidLines: sql<boolean>`bool_or(${treasuryPaymentItems.status} = 'pagada')`,
      })
      .from(treasuryPaymentItems)
      .where(eq(treasuryPaymentItems.batchId, input.batchId));
    const nextStatus = hasPaidLines ? "pendiente_contabilizacion" : "cerrado";
    const [updated] = await tx
      .update(treasuryPaymentBatches)
      .set({ status: nextStatus, updatedAt: new Date() })
      .where(eq(treasuryPaymentBatches.id, input.batchId))
      .returning();
    await insertEvent(tx, {
      batchId: input.batchId,
      action: "cerrar_conciliacion",
      previousStatus: batch.status,
      newStatus: updated.status,
      actor: input.actor,
    });
    return updated;
  });
  if (result.status === "pendiente_contabilizacion") {
    await notifyRole("contable", {
      title: "Pagos pendientes de contabilización",
      message: `Las diferencias del lote ${result.batchNumber} fueron resueltas.`,
      batchId: input.batchId,
    });
  }
  return result;
}

export async function accountTreasuryItems(input: {
  batchId: number;
  itemIds: number[];
  actor: TreasuryActor;
  comment?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  return db.transaction(async tx => {
    const batch = await readBatch(tx, input.batchId);
    if (batch.status !== "pendiente_contabilizacion") {
      throw new TreasuryRuleError(
        "El lote no está pendiente de contabilización."
      );
    }
    const uniqueItemIds = Array.from(new Set(input.itemIds));
    if (!uniqueItemIds.length) {
      throw new TreasuryRuleError("Seleccione al menos un abono pagado.");
    }
    const items = await tx
      .select()
      .from(treasuryPaymentItems)
      .where(
        and(
          eq(treasuryPaymentItems.batchId, input.batchId),
          inArray(treasuryPaymentItems.id, uniqueItemIds)
        )
      );
    if (
      items.length !== uniqueItemIds.length ||
      items.some((item: any) => item.status !== "pagada")
    ) {
      throw new TreasuryRuleError(
        "Solo se pueden contabilizar líneas pagadas por el banco."
      );
    }
    const now = new Date();
    for (const item of items) {
      const paid = roundTreasuryMoney(Number(item.bankPaidAmount ?? 0));
      let availableAmount = 0;
      let purchaseOrderId: number | null = null;
      if (
        item.sourceType === "purchase_order_advance" &&
        item.purchaseOrderAdvanceId
      ) {
        let snapshots;
        try {
          snapshots = await getPurchaseOrderAdvanceSnapshots(
            tx,
            [item.purchaseOrderAdvanceId],
            input.batchId
          );
        } catch (error) {
          if (error instanceof PurchaseOrderAdvanceRuleError) {
            throw new TreasuryRuleError(error.message);
          }
          throw error;
        }
        const snapshot = snapshots[0];
        availableAmount = snapshot?.money.availableToPayAmount ?? 0;
        purchaseOrderId = snapshot?.advance.purchaseOrderId ?? null;
        if (paid <= 0 || paid > availableAmount + 0.0001) {
          throw new TreasuryRuleError(
            `El pago de ${item.invoiceDocumentNumber} supera el saldo vigente del anticipo.`
          );
        }
      } else if (
        item.sourceType === "quality_retention_release" &&
        item.qualityRetentionReleaseId
      ) {
        let snapshots;
        try {
          snapshots = await getQualityRetentionReleaseSnapshots(
            tx,
            [item.qualityRetentionReleaseId],
            input.batchId
          );
        } catch (error) {
          if (error instanceof QualityRetentionReleaseRuleError) {
            throw new TreasuryRuleError(error.message);
          }
          throw error;
        }
        const snapshot = snapshots[0];
        availableAmount = snapshot?.money.availableAmount ?? 0;
        if (paid <= 0 || paid > availableAmount + 0.0001) {
          throw new TreasuryRuleError(
            `El pago de ${item.invoiceDocumentNumber} supera el saldo autorizado de la liberación.`
          );
        }
      } else {
        if (!item.invoiceId) {
          throw new TreasuryRuleError(
            "La línea de factura no tiene una referencia válida."
          );
        }
        const financials = await getInvoiceFinancialMap(
          tx,
          [item.invoiceId],
          input.batchId
        );
        const money = financials.get(item.invoiceId);
        availableAmount = money?.availableAmount ?? 0;
        if (paid <= 0 || paid > availableAmount + 0.0001) {
          throw new TreasuryRuleError(
            `El abono de ${item.invoiceDocumentNumber} supera el saldo vigente de la factura.`
          );
        }
      }
      await tx
        .update(treasuryPaymentItems)
        .set({
          status: "contabilizada",
          activeReservation: false,
          accountingComment: input.comment?.trim() || null,
          accountedById: input.actor.id,
          accountedAt: now,
          updatedAt: now,
        })
        .where(eq(treasuryPaymentItems.id, item.id));
      await insertEvent(tx, {
        batchId: input.batchId,
        itemId: item.id,
        action: "contabilizar_abono",
        previousStatus: item.status,
        newStatus: "contabilizada",
        actor: input.actor,
        comment: input.comment,
        metadata: {
          paidAmount: paid,
          remainingAmount: roundTreasuryMoney(availableAmount - paid),
        },
      });
      if (purchaseOrderId) {
        await applyAvailableAdvancesForPurchaseOrder({
          executor: tx,
          purchaseOrderId,
          actorId: input.actor.id,
        });
      }
      if (item.qualityRetentionReleaseId) {
        const release = await syncQualityRetentionReleasePaymentStatus(
          tx,
          item.qualityRetentionReleaseId
        );
        if (release?.requestedById) {
          await tx.insert(notifications).values({
            userId: release.requestedById,
            title:
              release.status === "paid"
                ? "Retención de calidad pagada"
                : "Pago parcial de retención de calidad",
            message: `Se contabilizó ${paid.toFixed(2)} de la liberación asociada a la factura ${item.invoiceDocumentNumber}.`,
            type: "cambio_estatus",
            relatedEntityType: "quality_retention_release",
            relatedEntityId: release.id,
          });
        }
      }
    }
    const remainingItems = await readBatchItems(tx, input.batchId);
    const allFinal = remainingItems.every(
      (item: any) =>
        item.id &&
        (uniqueItemIds.includes(item.id)
          ? true
          : FINAL_ITEM_STATUSES.has(item.status as TreasuryItemStatus))
    );
    if (!allFinal) return batch;
    const [updated] = await tx
      .update(treasuryPaymentBatches)
      .set({
        status: "cerrado",
        accountedById: input.actor.id,
        accountedAt: now,
        updatedAt: now,
      })
      .where(eq(treasuryPaymentBatches.id, input.batchId))
      .returning();
    await insertEvent(tx, {
      batchId: input.batchId,
      action: "cerrar_lote",
      previousStatus: batch.status,
      newStatus: updated.status,
      actor: input.actor,
    });
    return updated;
  });
}

function parseTreasuryAccountingRejectionReason(
  value: unknown
): TreasuryAccountingRejectionReason {
  if (
    typeof value === "string" &&
    TREASURY_ACCOUNTING_REJECTION_REASON_CODES.includes(
      value as TreasuryAccountingRejectionReason
    )
  ) {
    return value as TreasuryAccountingRejectionReason;
  }
  throw new TreasuryRuleError(
    "No se encontró el motivo vigente del rechazo contable."
  );
}

async function readLatestTreasuryAccountingRejection(
  executor: any,
  batchId: number
) {
  const [event] = await executor
    .select()
    .from(treasuryPaymentEvents)
    .where(
      and(
        eq(treasuryPaymentEvents.batchId, batchId),
        eq(treasuryPaymentEvents.action, "rechazar_pago_contabilidad")
      )
    )
    .orderBy(
      desc(treasuryPaymentEvents.createdAt),
      desc(treasuryPaymentEvents.id)
    )
    .limit(1);
  if (!event) {
    throw new TreasuryRuleError(
      "No se encontró el rechazo contable que debe corregirse."
    );
  }
  return event;
}

export async function rejectTreasuryPaymentForCorrection(input: {
  batchId: number;
  actor: TreasuryActor;
  reason: TreasuryAccountingRejectionReason;
  comment: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const comment = input.comment.trim();
  const result = await db.transaction(async tx => {
    const batch = await readBatch(tx, input.batchId);
    const items = await readBatchItems(tx, input.batchId);
    assertTreasuryPaymentCanBeRejectedForCorrection(
      batch.status,
      items.map((item: any) => item.status as TreasuryItemStatus)
    );
    const now = new Date();
    const [updated] = await tx
      .update(treasuryPaymentBatches)
      .set({
        status: "rechazado_contabilidad",
        updatedAt: now,
      })
      .where(
        and(
          eq(treasuryPaymentBatches.id, input.batchId),
          eq(treasuryPaymentBatches.status, "pendiente_contabilizacion")
        )
      )
      .returning();
    if (!updated) {
      throw new TreasuryRuleError(
        "El lote cambió de estado. Actualice e intente nuevamente."
      );
    }
    await insertEvent(tx, {
      batchId: input.batchId,
      action: "rechazar_pago_contabilidad",
      previousStatus: batch.status,
      newStatus: "rechazado_contabilidad",
      actor: input.actor,
      comment,
      metadata: { reasonCode: input.reason },
    });
    return updated;
  });
  await notifySystemAdministrators({
    title: "Pago rechazado por Contabilidad",
    message: `El pago ${result.batchNumber} requiere corrección: ${comment}`,
    batchId: input.batchId,
  });
  return result;
}

export async function correctTreasuryPayment(input: {
  batchId: number;
  actor: TreasuryActor;
  bankReference?: string | null;
  attachment?: TreasuryBankResponseAttachmentInput;
  comment: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const preliminaryBatch = await readBatch(db, input.batchId);
  if (preliminaryBatch.status !== "rechazado_contabilidad") {
    throw new TreasuryRuleError(
      "Solo se puede corregir un pago rechazado por Contabilidad."
    );
  }
  const preliminaryItems = await readBatchItems(db, input.batchId);
  const preliminaryRejection = await readLatestTreasuryAccountingRejection(
    db,
    input.batchId
  );
  const rejectionReason = parseTreasuryAccountingRejectionReason(
    preliminaryRejection.metadata?.reasonCode
  );
  const currentBankReferences = preliminaryItems
    .filter((item: any) => item.status === "pagada")
    .map((item: any) => String(item.bankReference ?? ""));
  const correction = validateTreasuryAccountingCorrection({
    reason: rejectionReason,
    currentBankReferences,
    bankReference: input.bankReference,
    hasAttachment: Boolean(input.attachment),
  });
  const previousPaymentAttachments = await db
    .select({
      id: attachments.id,
      fileName: attachments.fileName,
      createdAt: attachments.createdAt,
    })
    .from(attachments)
    .where(
      and(
        eq(attachments.entityType, "treasury_payment_batch"),
        eq(attachments.entityId, input.batchId),
        eq(attachments.category, "comprobante_pago")
      )
    )
    .orderBy(desc(attachments.createdAt), desc(attachments.id));
  const preparedAttachment = input.attachment
    ? prepareTreasuryBankAttachment(input.attachment)
    : null;
  const stored = preparedAttachment
    ? await persistTreasuryAttachment({
        batchId: input.batchId,
        actorId: input.actor.id,
        fileName: preparedAttachment.fileName,
        buffer: preparedAttachment.buffer,
        mimeType: preparedAttachment.mimeType,
        category: "comprobante_pago",
      })
    : null;

  try {
    const result = await db.transaction(async tx => {
      const batch = await readBatch(tx, input.batchId);
      if (batch.status !== "rechazado_contabilidad") {
        throw new TreasuryRuleError(
          "El lote cambió de estado. Actualice e intente nuevamente."
        );
      }
      const items = await readBatchItems(tx, input.batchId);
      assertTreasuryPaymentCanBeRejectedForCorrection(
        "pendiente_contabilizacion",
        items.map((item: any) => item.status as TreasuryItemStatus)
      );
      const rejection = await readLatestTreasuryAccountingRejection(
        tx,
        input.batchId
      );
      const currentReason = parseTreasuryAccountingRejectionReason(
        rejection.metadata?.reasonCode
      );
      if (currentReason !== rejectionReason) {
        throw new TreasuryRuleError(
          "El motivo del rechazo cambió. Actualice e intente nuevamente."
        );
      }
      if (correction.bankReference) {
        await tx
          .update(treasuryPaymentItems)
          .set({
            bankReference: correction.bankReference,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(treasuryPaymentItems.batchId, input.batchId),
              eq(treasuryPaymentItems.status, "pagada")
            )
          );
      }
      const now = new Date();
      const [updated] = await tx
        .update(treasuryPaymentBatches)
        .set({
          status: "pendiente_contabilizacion",
          updatedAt: now,
        })
        .where(
          and(
            eq(treasuryPaymentBatches.id, input.batchId),
            eq(treasuryPaymentBatches.status, "rechazado_contabilidad")
          )
        )
        .returning();
      if (!updated) {
        throw new TreasuryRuleError(
          "El lote cambió de estado. Actualice e intente nuevamente."
        );
      }
      const correctedFields = [
        ...(correction.bankReference ? ["bankReference"] : []),
        ...(stored ? ["attachment"] : []),
      ];
      await insertEvent(tx, {
        batchId: input.batchId,
        action: "corregir_pago_contabilidad",
        previousStatus: batch.status,
        newStatus: "pendiente_contabilizacion",
        actor: input.actor,
        comment: input.comment,
        metadata: {
          rejectionEventId: rejection.id,
          reasonCode: rejectionReason,
          correctedFields,
          previousBankReferences: Array.from(
            new Set(currentBankReferences.filter(Boolean))
          ),
          bankReference: correction.bankReference,
          previousAttachmentId: previousPaymentAttachments[0]?.id ?? null,
          previousAttachmentFileName:
            previousPaymentAttachments[0]?.fileName ?? null,
          attachmentId: stored?.attachmentId ?? null,
          attachmentFileName: preparedAttachment?.fileName ?? null,
        },
      });
      return updated;
    });
    await notifyRole("contable", {
      title: "Pago corregido",
      message: `El pago ${result.batchNumber} fue corregido y volvió a quedar pendiente de contabilización.`,
      batchId: input.batchId,
    });
    return result;
  } catch (error) {
    if (stored) {
      await db
        .delete(attachments)
        .where(eq(attachments.id, stored.attachmentId))
        .catch(() => undefined);
      await storageDelete(stored.key).catch(() => undefined);
    }
    throw error;
  }
}

export async function reopenClosedTreasuryBatch(input: {
  batchId: number;
  actor: TreasuryActor;
  reason: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  return db.transaction(async tx => {
    const batch = await readBatch(tx, input.batchId);
    const items = await readBatchItems(tx, input.batchId);
    const targetStatus = getTreasuryReopenTargetStatus(
      batch.status,
      items.map((item: any) => item.status as TreasuryItemStatus)
    );
    const now = new Date();
    const reason = input.reason.trim();
    const rejectedItems = items.filter(
      (item: any) => item.status === "rechazada_banco"
    );

    for (const item of rejectedItems) {
      await tx
        .update(treasuryPaymentItems)
        .set({
          status: "aprobada",
          activeReservation: true,
          bankPaidAmount: null,
          bankPaidDate: null,
          bankReference: null,
          bankComment: null,
          differenceResolutionComment: null,
          updatedAt: now,
        })
        .where(eq(treasuryPaymentItems.id, item.id));
      await insertEvent(tx, {
        batchId: input.batchId,
        itemId: item.id,
        action: "reabrir_respuesta_bancaria",
        previousStatus: item.status,
        newStatus: "aprobada",
        actor: input.actor,
        comment: reason,
      });
    }

    const [updated] = await tx
      .update(treasuryPaymentBatches)
      .set({
        status: targetStatus,
        reconciledById: null,
        reconciledAt: null,
        updatedAt: now,
      })
      .where(eq(treasuryPaymentBatches.id, input.batchId))
      .returning();
    await insertEvent(tx, {
      batchId: input.batchId,
      action: "reabrir_lote",
      previousStatus: batch.status,
      newStatus: targetStatus,
      actor: input.actor,
      comment: reason,
      metadata: { restoredItems: rejectedItems.length },
    });
    return updated;
  });
}

export async function cancelTreasuryBatch(input: {
  batchId: number;
  actor: TreasuryActor;
  reason: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  return db.transaction(async tx => {
    const batch = await readBatch(tx, input.batchId);
    const items = await readBatchItems(tx, input.batchId);
    assertTreasuryBatchCanBeCancelled(batch.status, items);
    const now = new Date();
    await tx
      .update(treasuryPaymentItems)
      .set({ activeReservation: false, updatedAt: now })
      .where(eq(treasuryPaymentItems.batchId, input.batchId));
    const [updated] = await tx
      .update(treasuryPaymentBatches)
      .set({
        status: "anulado",
        cancelledById: input.actor.id,
        cancelledAt: now,
        cancellationReason: input.reason.trim(),
        updatedAt: now,
      })
      .where(eq(treasuryPaymentBatches.id, input.batchId))
      .returning();
    await insertEvent(tx, {
      batchId: input.batchId,
      action: "anular_lote",
      previousStatus: batch.status,
      newStatus: updated.status,
      actor: input.actor,
      comment: input.reason,
    });
    return updated;
  });
}

async function notifyUsers(
  userIds: number[],
  input: { title: string; message: string; batchId: number }
) {
  await Promise.allSettled(
    Array.from(new Set(userIds)).map(userId =>
      createNotification({
        userId,
        title: input.title,
        message: input.message,
        type: "tesoreria",
        relatedEntityType: "treasury_payment_batch",
        relatedEntityId: input.batchId,
      })
    )
  );
}

async function notifyRole(
  role: "administracion_central" | "contable" | "financiero",
  input: { title: string; message: string; batchId: number }
) {
  const recipients = await getUsersByBuildreqRole(role);
  await notifyUsers(
    recipients.map(user => user.id),
    input
  );
}

async function notifySystemAdministrators(input: {
  title: string;
  message: string;
  batchId: number;
}) {
  const db = await getDb();
  if (!db) return;
  const recipients = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "admin"), eq(users.isActive, true)));
  await notifyUsers(
    recipients.map(user => user.id),
    input
  );
}

async function notifyTreasuryApprovers(input: {
  title: string;
  message: string;
  batchId: number;
}) {
  await notifyRole("financiero", input);
}
