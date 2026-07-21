import { randomUUID } from "node:crypto";
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  ne,
  sql,
} from "drizzle-orm";
import * as XLSX from "xlsx";
import {
  attachments,
  invoices,
  projects,
  purchaseOrders,
  suppliers,
  systemSettings,
  treasuryPaymentBatches,
  treasuryPaymentEvents,
  treasuryPaymentItems,
  users,
} from "../drizzle/schema";
import type { PurchaseCurrency } from "../shared/purchase-orders";
import {
  buildTreasuryMoneySummary,
  roundTreasuryMoney,
  type TreasuryBatchStatus,
  type TreasuryItemStatus,
} from "../shared/treasury";
import {
  createAttachment,
  createNotification,
  getAttachmentsByEntity,
  getDb,
  getUsersByBuildreqRole,
} from "./db";
import { storageDelete, storageGet, storagePut } from "./storage";

export type TreasuryActor = {
  id: number;
  name?: string | null;
  role: string;
  buildreqRole?: string | null;
  assignedProjectId?: number | null;
  assignedProjectIds?: number[] | null;
};

export type TreasuryDraftItemInput = {
  invoiceId: number;
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

const FINAL_ITEM_STATUSES = new Set<TreasuryItemStatus>([
  "excluida",
  "rechazada_banco",
  "contabilizada",
]);

const BANK_EXPORT_HEADERS = {
  batchNumber: "LOTE",
  version: "VERSION",
  itemId: "LINEA_ID",
  project: "PROYECTO",
  supplierCode: "PROVEEDOR_CODIGO",
  supplierName: "PROVEEDOR",
  invoiceDocumentNumber: "FACTURA_INTERNA",
  invoiceNumber: "FACTURA_FISCAL",
  currency: "MONEDA",
  invoiceNetPayable: "TOTAL_FACTURA",
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

function getActorRole(actor: TreasuryActor) {
  return actor.role === "admin" ? "admin" : actor.buildreqRole || "sin_rol";
}

function toMoneyString(value: number) {
  return roundTreasuryMoney(value).toFixed(4);
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
    .where(inArray(treasuryPaymentItems.invoiceId, uniqueIds));

  for (const invoice of invoiceRows) {
    let paidAmount = 0;
    let reservedAmount = 0;
    for (const payment of paymentRows) {
      if (payment.invoiceId !== invoice.id) continue;
      if (payment.status === "contabilizada") {
        paidAmount += Number(payment.bankPaidAmount ?? 0);
      }
      if (payment.activeReservation && payment.batchId !== excludeBatchId) {
        reservedAmount += Number(
          payment.bankPaidAmount ??
            payment.approvedAmount ??
            payment.requestedAmount
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
      })
    );
  }
  return result;
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
    .where(inArray(invoices.id, uniqueIds));

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

export async function getTreasurySettings() {
  const db = await getDb();
  if (!db) return { treasuryEnabled: false, updatedAt: null };
  const [settings] = await db
    .select({
      treasuryEnabled: systemSettings.treasuryEnabled,
      updatedAt: systemSettings.updatedAt,
    })
    .from(systemSettings)
    .where(eq(systemSettings.id, 1));
  return {
    treasuryEnabled: settings?.treasuryEnabled === true,
    updatedAt: settings?.updatedAt ?? null,
  };
}

export async function updateTreasurySettings(input: {
  treasuryEnabled: boolean;
  updatedByUserId: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  if (input.treasuryEnabled) {
    const [approver] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.buildreqRole, "financiero"))
      .limit(1);
    if (!approver) {
      throw new TreasuryRuleError(
        "Asigne el rol Financiero al menos a un usuario antes de habilitar Tesorería."
      );
    }
  }
  const [settings] = await db
    .insert(systemSettings)
    .values({
      id: 1,
      treasuryEnabled: input.treasuryEnabled,
      updatedByUserId: input.updatedByUserId,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: systemSettings.id,
      set: {
        treasuryEnabled: input.treasuryEnabled,
        updatedByUserId: input.updatedByUserId,
        updatedAt: new Date(),
      },
    })
    .returning({
      treasuryEnabled: systemSettings.treasuryEnabled,
      updatedAt: systemSettings.updatedAt,
    });
  return settings;
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
    eq(purchaseOrders.paymentMethod, "linea_credito"),
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
  return rows
    .map(row => ({ ...row, money: financials.get(row.invoice.id)! }))
    .filter(
      row => row.money.availableAmount > 0 && row.money.reservedAmount <= 0
    );
}

export async function listTreasuryBatches(filters?: {
  projectIds?: number[];
  status?: TreasuryBatchStatus;
}) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [];
  if (!filters?.status) {
    conditions.push(isNull(treasuryPaymentBatches.consolidatedIntoBatchId));
  }
  if (filters?.projectIds) {
    conditions.push(
      filters.projectIds.length
        ? inArray(treasuryPaymentBatches.projectId, filters.projectIds)
        : eq(treasuryPaymentBatches.id, -1)
    );
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
  const items = await db
    .select()
    .from(treasuryPaymentItems)
    .where(
      inArray(
        treasuryPaymentItems.batchId,
        batchRows.map(row => row.batch.id)
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
        batchRows.map(row => row.batch.id)
      )
    );
  return batchRows.map(row => {
    const batchItems = items.filter(item => item.batchId === row.batch.id);
    const included = batchItems.filter(item => item.status !== "excluida");
    return {
      ...row,
      itemCount: included.length,
      supplierCount: new Set(
        included.map(item => item.supplierId ?? item.supplierCode)
      ).size,
      requestedTotal: roundTreasuryMoney(
        included.reduce((sum, item) => sum + Number(item.requestedAmount), 0)
      ),
      approvedTotal: roundTreasuryMoney(
        included.reduce(
          (sum, item) => sum + Number(item.approvedAmount ?? 0),
          0
        )
      ),
      paidTotal: roundTreasuryMoney(
        included.reduce(
          (sum, item) => sum + Number(item.bankPaidAmount ?? 0),
          0
        )
      ),
      sourceBatchNumbers: sourceBatches
        .filter(source => source.consolidatedIntoBatchId === row.batch.id)
        .map(source => source.batchNumber),
    };
  });
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
  const [items, events, attachmentRows, sourceBatches] = await Promise.all([
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
  ]);
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
    items,
    events,
    attachments: signedAttachments,
    sourceBatches,
  };
}

export async function createTreasuryBatch(input: {
  actor: TreasuryActor;
  projectId: number;
  currency: PurchaseCurrency;
  requestedPaymentDate: Date;
  notes?: string | null;
  items: TreasuryDraftItemInput[];
}) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  return db.transaction(async tx => {
    const snapshots = await getInvoiceSnapshots(
      tx,
      input.items.map(item => item.invoiceId)
    );
    const amountByInvoiceId = new Map(
      input.items.map(item => [
        item.invoiceId,
        roundTreasuryMoney(item.requestedAmount),
      ])
    );
    for (const row of snapshots) {
      if (row.invoice.projectId !== input.projectId) {
        throw new TreasuryRuleError(
          "Todas las facturas deben pertenecer al proyecto del lote."
        );
      }
      if (row.invoice.currency !== input.currency) {
        throw new TreasuryRuleError(
          "Todas las facturas deben utilizar la moneda del lote."
        );
      }
      if (row.invoice.status !== "registrada") {
        throw new TreasuryRuleError(
          "Solo se pueden pagar facturas contabilizadas."
        );
      }
      if (row.purchaseOrder.paymentMethod !== "linea_credito") {
        throw new TreasuryRuleError(
          "Solo se pueden incluir facturas de línea de crédito."
        );
      }
      if (!row.supplier) {
        throw new TreasuryRuleError(
          "Todas las facturas deben tener un proveedor."
        );
      }
      const amount = amountByInvoiceId.get(row.invoice.id) ?? 0;
      if (amount <= 0 || amount > row.money.availableAmount + 0.0001) {
        throw new TreasuryRuleError(
          `El abono de ${row.invoice.invoiceDocumentNumber} debe ser mayor que cero y no superar ${row.money.availableAmount.toFixed(4)} ${input.currency}.`
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
    await tx.insert(treasuryPaymentItems).values(
      snapshots.map((row: any) => ({
        batchId: batch.id,
        invoiceId: row.invoice.id,
        supplierId: row.supplier!.id,
        supplierCode: row.supplier!.supplierCode,
        supplierName: row.supplier!.name,
        invoiceDocumentNumber: row.invoice.invoiceDocumentNumber,
        invoiceNumber: row.invoice.invoiceNumber,
        currency: row.invoice.currency,
        invoiceNetPayable: row.invoice.netPayable,
        previousPaidAmount: toMoneyString(row.money.paidAmount),
        requestedAmount: toMoneyString(amountByInvoiceId.get(row.invoice.id)!),
      }))
    );
    await insertEvent(tx, {
      batchId: batch.id,
      action: "crear_lote",
      newStatus: "borrador",
      actor: input.actor,
      metadata: { itemCount: snapshots.length },
    });
    return { ...batch, batchNumber };
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
    const snapshots = await getInvoiceSnapshots(
      tx,
      input.items.map(item => item.invoiceId),
      input.batchId
    );
    const amountByInvoiceId = new Map(
      input.items.map(item => [
        item.invoiceId,
        roundTreasuryMoney(item.requestedAmount),
      ])
    );
    for (const row of snapshots) {
      if (
        row.invoice.projectId !== batch.projectId ||
        row.invoice.currency !== batch.currency
      ) {
        throw new TreasuryRuleError(
          "Las facturas deben conservar el proyecto y la moneda del lote."
        );
      }
      if (
        row.invoice.status !== "registrada" ||
        row.purchaseOrder.paymentMethod !== "linea_credito" ||
        !row.supplier
      ) {
        throw new TreasuryRuleError(
          "Una factura ya no cumple las condiciones para Tesorería."
        );
      }
      const amount = amountByInvoiceId.get(row.invoice.id) ?? 0;
      if (amount <= 0 || amount > row.money.availableAmount + 0.0001) {
        throw new TreasuryRuleError(
          `El abono de ${row.invoice.invoiceDocumentNumber} no puede superar ${row.money.availableAmount.toFixed(4)} ${batch.currency}.`
        );
      }
    }

    const existingItems = await readBatchItems(tx, input.batchId);
    const existingByInvoiceId = new Map<number, any>(
      existingItems.map((item: any) => [item.invoiceId, item])
    );
    const selectedInvoiceIds = new Set(input.items.map(item => item.invoiceId));
    const now = new Date();
    for (const item of existingItems) {
      if (selectedInvoiceIds.has(item.invoiceId)) continue;
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
      const amount = toMoneyString(amountByInvoiceId.get(row.invoice.id)!);
      const existing = existingByInvoiceId.get(row.invoice.id);
      if (existing) {
        await tx
          .update(treasuryPaymentItems)
          .set({
            status: "incluida",
            activeReservation: true,
            supplierId: row.supplier!.id,
            supplierCode: row.supplier!.supplierCode,
            supplierName: row.supplier!.name,
            invoiceDocumentNumber: row.invoice.invoiceDocumentNumber,
            invoiceNumber: row.invoice.invoiceNumber,
            invoiceNetPayable: row.invoice.netPayable,
            previousPaidAmount: toMoneyString(row.money.paidAmount),
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
        await tx.insert(treasuryPaymentItems).values({
          batchId: input.batchId,
          invoiceId: row.invoice.id,
          supplierId: row.supplier!.id,
          supplierCode: row.supplier!.supplierCode,
          supplierName: row.supplier!.name,
          invoiceDocumentNumber: row.invoice.invoiceDocumentNumber,
          invoiceNumber: row.invoice.invoiceNumber,
          currency: row.invoice.currency,
          invoiceNetPayable: row.invoice.netPayable,
          previousPaidAmount: toMoneyString(row.money.paidAmount),
          requestedAmount: amount,
        });
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
    const [updated] = await tx
      .update(treasuryPaymentBatches)
      .set({
        status: "enviado_depuracion",
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
      action: "enviar_depuracion",
      previousStatus: batch.status,
      newStatus: updated.status,
      actor,
    });
    return updated;
  });
  await notifyRole("administracion_central", {
    title: "Lote pendiente de revisión",
    message: `El lote ${result.batchNumber} fue enviado a Tesorería.`,
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
    const currentLimit = Number(
      phase === "aprobacion" ? item.requestedAmount : item.requestedAmount
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
  if (batchIds.length < 2) {
    throw new TreasuryRuleError(
      "Seleccione al menos dos lotes para crear un consolidado."
    );
  }
  const result = await db.transaction(async tx => {
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
    const consolidatableStatuses: TreasuryBatchStatus[] = [
      "enviado_depuracion",
      "pendiente_aprobacion",
    ];
    const invalidBatch = batches.find(
      batch => !consolidatableStatuses.includes(batch.status)
    );
    if (invalidBatch) {
      throw new TreasuryRuleError(
        `El lote ${invalidBatch.batchNumber} ya no está disponible para consolidar.`
      );
    }
    const projects = new Set(batches.map(batch => batch.projectId));
    if (projects.size !== 1) {
      throw new TreasuryRuleError(
        "Todos los lotes del consolidado deben pertenecer al mismo proyecto."
      );
    }
    const currencies = new Set(batches.map(batch => batch.currency));
    if (currencies.size !== 1) {
      throw new TreasuryRuleError(
        "Todos los lotes del consolidado deben utilizar la misma moneda."
      );
    }
    const paymentDates = new Set(
      batches.map(batch => toDateOnly(batch.requestedPaymentDate))
    );
    if (paymentDates.size !== 1) {
      throw new TreasuryRuleError(
        "Todos los lotes del consolidado deben tener la misma fecha prevista."
      );
    }
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
    const sourceBatchNumbers = batches.map(batch => batch.batchNumber);
    const baseBatch = batches[0]!;
    const tempNumber = `TEMP-${randomUUID()}`;
    const [consolidatedBatch] = await tx
      .insert(treasuryPaymentBatches)
      .values({
        batchNumber: tempNumber,
        projectId: baseBatch.projectId,
        currency: baseBatch.currency,
        requestedPaymentDate: baseBatch.requestedPaymentDate,
        status: "pendiente_aprobacion",
        notes: `Consolidado de ${sourceBatchNumbers.join(", ")}`,
        createdById: input.actor.id,
        submittedById: input.actor.id,
        submittedAt: now,
        purifiedById: input.actor.id,
        purifiedAt: now,
      })
      .returning();
    const batchNumber = `TES-${new Date(baseBatch.requestedPaymentDate).getUTCFullYear()}-${String(consolidatedBatch.id).padStart(6, "0")}`;
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
          invoiceId: item.invoiceId,
          supplierId: item.supplierId,
          supplierCode: item.supplierCode,
          supplierName: item.supplierName,
          invoiceDocumentNumber: item.invoiceDocumentNumber,
          invoiceNumber: item.invoiceNumber,
          currency: item.currency,
          invoiceNetPayable: item.invoiceNetPayable,
          previousPaidAmount: item.previousPaidAmount,
          requestedAmount: item.requestedAmount,
          status: "incluida" as const,
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
          inArray(treasuryPaymentBatches.status, consolidatableStatuses)
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
      action: "crear_lote_consolidado",
      newStatus: "pendiente_aprobacion",
      actor: input.actor,
      metadata: {
        sourceBatchIds: batchIds,
        sourceBatchNumbers,
        itemCount: copiedItems.length,
      },
    });
    return {
      batchId: consolidatedBatch.id,
      batchNumber,
      sourceBatchIds: batchIds,
      sourceBatchNumbers,
      currency: baseBatch.currency,
    };
  });
  await notifyTreasuryApprovers({
    title: "Consolidado pendiente de aprobación",
    message: `El lote consolidado ${result.batchNumber}, creado a partir de ${result.sourceBatchIds.length} lotes, requiere aprobación.`,
    batchId: result.batchId,
  });
  return result;
}

export async function approveTreasuryBatch(input: {
  batchId: number;
  actor: TreasuryActor;
  adjustments: TreasuryAdjustmentInput[];
  comment?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const result = await db.transaction(async tx => {
    const batch = await readBatch(tx, input.batchId);
    if (batch.status !== "pendiente_aprobacion") {
      throw new TreasuryRuleError("El lote no está pendiente de aprobación.");
    }
    await applyAdjustments(
      tx,
      input.batchId,
      input.actor,
      input.adjustments,
      "aprobacion"
    );
    const now = new Date();
    const [updated] = await tx
      .update(treasuryPaymentBatches)
      .set({
        status: "aprobado",
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
      comment: input.comment,
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

export async function returnTreasuryBatch(input: {
  batchId: number;
  actor: TreasuryActor;
  reason: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const result = await db.transaction(async tx => {
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

function buildBankWorkbook(
  detail: NonNullable<Awaited<ReturnType<typeof getTreasuryBatchById>>>
) {
  const rows = detail.items
    .filter(
      (item: any) =>
        item.status === "aprobada" ||
        item.status === "pagada" ||
        item.status === "con_diferencia"
    )
    .map((item: any) => ({
      [BANK_EXPORT_HEADERS.batchNumber]: detail.batch.batchNumber,
      [BANK_EXPORT_HEADERS.version]: detail.batch.version,
      [BANK_EXPORT_HEADERS.itemId]: item.id,
      [BANK_EXPORT_HEADERS.project]: `${detail.project.code} - ${detail.project.name}`,
      [BANK_EXPORT_HEADERS.supplierCode]: item.supplierCode,
      [BANK_EXPORT_HEADERS.supplierName]: item.supplierName,
      [BANK_EXPORT_HEADERS.invoiceDocumentNumber]: item.invoiceDocumentNumber,
      [BANK_EXPORT_HEADERS.invoiceNumber]: item.invoiceNumber ?? "",
      [BANK_EXPORT_HEADERS.currency]: item.currency,
      [BANK_EXPORT_HEADERS.invoiceNetPayable]: Number(item.invoiceNetPayable),
      [BANK_EXPORT_HEADERS.previousPaidAmount]: Number(item.previousPaidAmount),
      [BANK_EXPORT_HEADERS.availableBefore]: roundTreasuryMoney(
        Number(item.invoiceNetPayable) - Number(item.previousPaidAmount)
      ),
      [BANK_EXPORT_HEADERS.approvedAmount]: Number(
        item.approvedAmount ?? item.requestedAmount
      ),
      [BANK_EXPORT_HEADERS.requestedPaymentDate]: toDateOnly(
        detail.batch.requestedPaymentDate
      ),
      [BANK_EXPORT_HEADERS.bankStatus]: "",
      [BANK_EXPORT_HEADERS.bankPaidAmount]: "",
      [BANK_EXPORT_HEADERS.bankPaidDate]: "",
      [BANK_EXPORT_HEADERS.bankReference]: "",
      [BANK_EXPORT_HEADERS.bankComment]: "",
    }));
  const worksheet = XLSX.utils.json_to_sheet(rows, {
    header: Object.values(BANK_EXPORT_HEADERS),
  });
  worksheet["!cols"] = Object.values(BANK_EXPORT_HEADERS).map(header => ({
    wch: Math.min(32, Math.max(12, header.length + 2)),
  }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Pagos");
  return Buffer.from(
    XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer
  );
}

async function persistWorkbook(input: {
  batchId: number;
  actorId: number;
  fileName: string;
  buffer: Buffer;
  category: "archivo_bancario" | "comprobante_pago";
}) {
  const key = `treasury/${input.batchId}/${Date.now()}-${randomUUID()}-${input.fileName}`;
  const stored = await storagePut(
    key,
    input.buffer,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  try {
    await createAttachment({
      entityType: "treasury_payment_batch",
      entityId: input.batchId,
      fileName: input.fileName,
      fileKey: stored.key,
      fileUrl: stored.url,
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      fileSize: input.buffer.byteLength,
      category: input.category,
      uploadedById: input.actorId,
    });
  } catch (error) {
    await storageDelete(stored.key).catch(() => undefined);
    throw error;
  }
  return stored;
}

export async function exportTreasuryBankWorkbook(
  batchId: number,
  actor: TreasuryActor
) {
  const detail = await getTreasuryBatchById(batchId);
  if (!detail) throw new TreasuryRuleError("Lote de Tesorería no encontrado.");
  if (!["aprobado", "enviado_banco"].includes(detail.batch.status)) {
    throw new TreasuryRuleError("Solo se puede exportar un lote aprobado.");
  }
  const buffer = buildBankWorkbook(detail);
  const fileName = `${detail.batch.batchNumber}-v${detail.batch.version}-banco.xlsx`;
  await persistWorkbook({
    batchId,
    actorId: actor.id,
    fileName,
    buffer,
    category: "archivo_bancario",
  });
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.transaction(async tx => {
    const batch = await readBatch(tx, batchId);
    await tx
      .update(treasuryPaymentBatches)
      .set({
        status: "enviado_banco",
        exportedById: actor.id,
        exportedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(treasuryPaymentBatches.id, batchId));
    await insertEvent(tx, {
      batchId,
      action: "exportar_banco",
      previousStatus: batch.status,
      newStatus: "enviado_banco",
      actor,
      metadata: { fileName },
    });
  });
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
    const approved = Number(item.approvedAmount ?? item.requestedAmount);
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

  const stored = await persistWorkbook({
    batchId: input.batchId,
    actorId: input.actor.id,
    fileName: input.fileName,
    buffer,
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

export type TreasuryBankResponseItemInput = {
  itemId: number;
  paid: boolean;
  paidAmount?: number;
  paidDate?: Date;
  bankReference?: string;
  bankComment?: string;
};

export async function recordTreasuryBankResponse(input: {
  batchId: number;
  actor: TreasuryActor;
  items: TreasuryBankResponseItemInput[];
}) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const batch = await readBatch(db, input.batchId);
  const batchItems: any[] = await readBatchItems(db, input.batchId);
  const itemById = new Map<number, any>(
    batchItems.map((item: any) => [item.id, item])
  );
  const parsedRows: TreasuryBankRow[] = input.items.map((entry, index) => {
    const item = itemById.get(entry.itemId);
    const label = item?.invoiceDocumentNumber || `línea ${entry.itemId}`;
    const paidAmount = entry.paid
      ? roundTreasuryMoney(Number(entry.paidAmount))
      : 0;
    if (entry.paid && (!Number.isFinite(paidAmount) || paidAmount <= 0)) {
      throw new TreasuryRuleError(
        `${label}: ingrese un monto pagado mayor que cero.`
      );
    }
    const approvedAmount = Number(
      item?.approvedAmount ?? item?.requestedAmount ?? 0
    );
    if (entry.paid && paidAmount > approvedAmount + 0.0001) {
      throw new TreasuryRuleError(
        `${label}: el monto pagado no puede superar el abono aprobado.`
      );
    }
    if (
      entry.paid &&
      (!entry.paidDate || Number.isNaN(entry.paidDate.getTime()))
    ) {
      throw new TreasuryRuleError(`${label}: seleccione la fecha de pago.`);
    }
    return {
      rowNumber: index + 1,
      batchNumber: batch.batchNumber,
      version: batch.version,
      itemId: entry.itemId,
      bankStatus: entry.paid ? "PAGADO" : "RECHAZADO",
      paidAmount,
      paidDate: entry.paid ? entry.paidDate! : null,
      bankReference: entry.bankReference?.trim() || "",
      bankComment: entry.bankComment?.trim() || "",
    };
  });
  matchTreasuryBankRows(parsedRows, batch, batchItems);
  return applyTreasuryBankRows({
    db,
    batchId: input.batchId,
    actor: input.actor,
    parsedRows,
    eventAction: "registrar_respuesta_banco",
    eventMetadata: { source: "manual" },
  });
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
      const financials = await getInvoiceFinancialMap(
        tx,
        [item.invoiceId],
        input.batchId
      );
      const money = financials.get(item.invoiceId)!;
      const paid = Number(item.bankPaidAmount ?? 0);
      if (paid <= 0 || paid > money.availableAmount + 0.0001) {
        throw new TreasuryRuleError(
          `El abono de ${item.invoiceDocumentNumber} supera el saldo vigente de la factura.`
        );
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
          remainingAmount: roundTreasuryMoney(money.availableAmount - paid),
        },
      });
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

export async function cancelTreasuryBatch(input: {
  batchId: number;
  actor: TreasuryActor;
  reason: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  return db.transaction(async tx => {
    const batch = await readBatch(tx, input.batchId);
    if (
      [
        "enviado_banco",
        "conciliacion",
        "pendiente_contabilizacion",
        "cerrado",
        "anulado",
        "consolidado",
      ].includes(batch.status)
    ) {
      throw new TreasuryRuleError("El lote ya no puede anularse.");
    }
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

async function notifyTreasuryApprovers(input: {
  title: string;
  message: string;
  batchId: number;
}) {
  await notifyRole("financiero", input);
}
