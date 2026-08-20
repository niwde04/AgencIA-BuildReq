import { randomUUID } from "node:crypto";
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  ne,
  notExists,
  or,
  sql,
} from "drizzle-orm";
import {
  invoices,
  projects,
  purchaseOrderAdvanceApplications,
  purchaseOrderAdvances,
  purchaseOrderDigitalSeals,
  purchaseOrderItems,
  purchaseOrders,
  receipts,
  suppliers,
  treasuryPaymentItems,
  users,
} from "../drizzle/schema";
import {
  allowsPurchaseOrderAdvance,
  calculatePurchaseOrderAdvanceAvailableAmount,
  roundPurchaseOrderDisplayMoney,
  summarizePurchaseOrderLines,
  type PurchaseCurrency,
} from "../shared/purchase-orders";
import { hasAtMostDecimalPlaces } from "../shared/money";
import { getDb } from "./db";

type DbExecutor = NonNullable<Awaited<ReturnType<typeof getDb>>> | any;

export class PurchaseOrderAdvanceRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PurchaseOrderAdvanceRuleError";
  }
}

export type PurchaseOrderAdvanceActor = {
  id: number;
  name?: string | null;
  role: string;
  buildreqRole?: string | null;
};

function money(value: string | number | null | undefined) {
  return roundPurchaseOrderDisplayMoney(value);
}

function moneyString(value: string | number | null | undefined) {
  return money(value).toFixed(2);
}

function paymentAmount(item: {
  requestedAmount: string | number;
  approvedAmount?: string | number | null;
  bankPaidAmount?: string | number | null;
}) {
  return money(
    item.bankPaidAmount ?? item.approvedAmount ?? item.requestedAmount
  );
}

export type PurchaseOrderAdvanceMoneySummary = {
  requestedAmount: number;
  accountedAmount: number;
  reservedAmount: number;
  bankPaidPendingAmount: number;
  appliedAmount: number;
  availableToPayAmount: number;
  unappliedAmount: number;
  status:
    | "pendiente_pago"
    | "en_lote"
    | "pagado_pendiente_contabilizacion"
    | "parcialmente_contabilizado"
    | "contabilizado"
    | "parcialmente_aplicado"
    | "aplicado"
    | "anulado";
};

export type PurchaseOrderAdvancesSummary = {
  count: number;
  requestedAmount: number;
  accountedAmount: number;
  reservedAmount: number;
  bankPaidPendingAmount: number;
  appliedAmount: number;
  availableToPayAmount: number;
  unappliedAmount: number;
};

export function buildPurchaseOrderAdvanceMoneySummary(input: {
  requestedAmount: string | number;
  accountedAmount?: string | number | null;
  reservedAmount?: string | number | null;
  bankPaidPendingAmount?: string | number | null;
  appliedAmount?: string | number | null;
  cancelled?: boolean;
}): PurchaseOrderAdvanceMoneySummary {
  const requestedAmount = money(input.requestedAmount);
  const accountedAmount = money(input.accountedAmount);
  const reservedAmount = money(input.reservedAmount);
  const bankPaidPendingAmount = money(input.bankPaidPendingAmount);
  const appliedAmount = Math.min(accountedAmount, money(input.appliedAmount));
  const availableToPayAmount = money(
    Math.max(0, requestedAmount - accountedAmount - reservedAmount)
  );
  const unappliedAmount = money(Math.max(0, accountedAmount - appliedAmount));

  let status: PurchaseOrderAdvanceMoneySummary["status"];
  if (input.cancelled) status = "anulado";
  else if (bankPaidPendingAmount > 0)
    status = "pagado_pendiente_contabilizacion";
  else if (reservedAmount > 0) status = "en_lote";
  else if (accountedAmount <= 0) status = "pendiente_pago";
  else if (accountedAmount < requestedAmount)
    status = "parcialmente_contabilizado";
  else if (appliedAmount <= 0) status = "contabilizado";
  else if (appliedAmount < accountedAmount) status = "parcialmente_aplicado";
  else status = "aplicado";

  return {
    requestedAmount,
    accountedAmount,
    reservedAmount,
    bankPaidPendingAmount,
    appliedAmount,
    availableToPayAmount,
    unappliedAmount,
    status,
  };
}

export function buildPurchaseOrderAdvancesSummary(
  summaries: PurchaseOrderAdvanceMoneySummary[]
): PurchaseOrderAdvancesSummary {
  const totals = summaries.reduce(
    (result, summary) => ({
      requestedAmount: result.requestedAmount + summary.requestedAmount,
      accountedAmount: result.accountedAmount + summary.accountedAmount,
      reservedAmount: result.reservedAmount + summary.reservedAmount,
      bankPaidPendingAmount:
        result.bankPaidPendingAmount + summary.bankPaidPendingAmount,
      appliedAmount: result.appliedAmount + summary.appliedAmount,
      availableToPayAmount:
        result.availableToPayAmount + summary.availableToPayAmount,
      unappliedAmount: result.unappliedAmount + summary.unappliedAmount,
    }),
    {
      requestedAmount: 0,
      accountedAmount: 0,
      reservedAmount: 0,
      bankPaidPendingAmount: 0,
      appliedAmount: 0,
      availableToPayAmount: 0,
      unappliedAmount: 0,
    }
  );

  return {
    count: summaries.length,
    requestedAmount: money(totals.requestedAmount),
    accountedAmount: money(totals.accountedAmount),
    reservedAmount: money(totals.reservedAmount),
    bankPaidPendingAmount: money(totals.bankPaidPendingAmount),
    appliedAmount: money(totals.appliedAmount),
    availableToPayAmount: money(totals.availableToPayAmount),
    unappliedAmount: money(totals.unappliedAmount),
  };
}

async function getAdvanceFinancialMap(
  executor: DbExecutor,
  advanceIds: number[],
  excludeBatchId?: number
) {
  const uniqueIds = Array.from(new Set(advanceIds));
  const result = new Map<number, PurchaseOrderAdvanceMoneySummary>();
  if (!uniqueIds.length) return result;

  const [advanceRows, paymentRows, applicationRows] = await Promise.all([
    executor
      .select()
      .from(purchaseOrderAdvances)
      .where(inArray(purchaseOrderAdvances.id, uniqueIds)),
    executor
      .select()
      .from(treasuryPaymentItems)
      .where(
        and(
          eq(treasuryPaymentItems.sourceType, "purchase_order_advance"),
          inArray(treasuryPaymentItems.purchaseOrderAdvanceId, uniqueIds)
        )
      ),
    executor
      .select({
        purchaseOrderAdvanceId:
          purchaseOrderAdvanceApplications.purchaseOrderAdvanceId,
        amount: purchaseOrderAdvanceApplications.amount,
      })
      .from(purchaseOrderAdvanceApplications)
      .where(
        inArray(
          purchaseOrderAdvanceApplications.purchaseOrderAdvanceId,
          uniqueIds
        )
      ),
  ]);

  for (const advance of advanceRows) {
    let accountedAmount = 0;
    let reservedAmount = 0;
    let bankPaidPendingAmount = 0;
    let appliedAmount = 0;

    for (const item of paymentRows) {
      if (item.purchaseOrderAdvanceId !== advance.id) continue;
      if (item.status === "contabilizada") {
        accountedAmount += money(item.bankPaidAmount);
      } else if (item.status === "pagada" || item.status === "con_diferencia") {
        bankPaidPendingAmount += money(item.bankPaidAmount);
      }
      if (
        item.activeReservation &&
        (excludeBatchId === undefined || item.batchId !== excludeBatchId)
      ) {
        reservedAmount += paymentAmount(item);
      }
    }

    for (const application of applicationRows) {
      if (application.purchaseOrderAdvanceId === advance.id) {
        appliedAmount += money(application.amount);
      }
    }

    result.set(
      advance.id,
      buildPurchaseOrderAdvanceMoneySummary({
        requestedAmount: advance.requestedAmount,
        accountedAmount,
        reservedAmount,
        bankPaidPendingAmount,
        appliedAmount,
        cancelled: Boolean(advance.cancelledAt),
      })
    );
  }

  return result;
}

export async function getPurchaseOrderAdvancesSummary(
  executor: DbExecutor,
  purchaseOrderId: number
) {
  const advances = await executor
    .select({ id: purchaseOrderAdvances.id })
    .from(purchaseOrderAdvances)
    .where(
      and(
        eq(purchaseOrderAdvances.purchaseOrderId, purchaseOrderId),
        isNull(purchaseOrderAdvances.cancelledAt)
      )
    );
  const financials = await getAdvanceFinancialMap(
    executor,
    advances.map((advance: { id: number }) => advance.id)
  );

  return buildPurchaseOrderAdvancesSummary(
    advances
      .map((advance: { id: number }) => financials.get(advance.id))
      .filter(
        (
          summary: PurchaseOrderAdvanceMoneySummary | undefined
        ): summary is PurchaseOrderAdvanceMoneySummary => Boolean(summary)
      )
  );
}

export async function getInvoiceAppliedAdvanceMap(
  executor: DbExecutor,
  invoiceIds: number[]
) {
  const uniqueIds = Array.from(new Set(invoiceIds));
  const result = new Map<number, number>();
  if (!uniqueIds.length) return result;
  const rows = await executor
    .select({
      invoiceId: purchaseOrderAdvanceApplications.invoiceId,
      amount: purchaseOrderAdvanceApplications.amount,
    })
    .from(purchaseOrderAdvanceApplications)
    .where(inArray(purchaseOrderAdvanceApplications.invoiceId, uniqueIds));
  for (const row of rows) {
    result.set(
      row.invoiceId,
      money((result.get(row.invoiceId) ?? 0) + money(row.amount))
    );
  }
  return result;
}

export async function getPurchaseOrderAdvanceBlockingSet(
  executor: DbExecutor,
  purchaseOrderIds: number[]
) {
  const uniqueIds = Array.from(new Set(purchaseOrderIds));
  const blocked = new Set<number>();
  if (!uniqueIds.length) return blocked;
  const advances = await executor
    .select()
    .from(purchaseOrderAdvances)
    .where(
      and(
        inArray(purchaseOrderAdvances.purchaseOrderId, uniqueIds),
        isNull(purchaseOrderAdvances.cancelledAt)
      )
    );
  const financials = await getAdvanceFinancialMap(
    executor,
    advances.map((advance: any) => advance.id)
  );
  for (const advance of advances) {
    const summary = financials.get(advance.id);
    if (
      summary &&
      (summary.availableToPayAmount > 0 ||
        summary.reservedAmount > 0 ||
        summary.bankPaidPendingAmount > 0)
    ) {
      blocked.add(advance.purchaseOrderId);
    }
  }
  return blocked;
}

async function getCalculatedPurchaseOrderTotal(
  executor: DbExecutor,
  purchaseOrderId: number,
  pricesIncludeTax: boolean
) {
  const items = await executor
    .select()
    .from(purchaseOrderItems)
    .where(eq(purchaseOrderItems.purchaseOrderId, purchaseOrderId));
  return summarizePurchaseOrderLines(
    items.map((item: any) => ({
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      subtotal: item.subtotal,
      pricesIncludeTax,
      taxCode: item.taxCode,
      additionalTaxCodes: item.additionalTaxCodes,
      taxBreakdown: item.taxBreakdown,
    }))
  ).total;
}

export function resolvePurchaseOrderOfficialTotal(input: {
  sealedTotal?: string | number | null;
  calculatedTotal: string | number;
}) {
  return money(input.sealedTotal ?? input.calculatedTotal);
}

async function getPurchaseOrderOfficialTotal(
  executor: DbExecutor,
  purchaseOrderId: number,
  pricesIncludeTax: boolean
) {
  const [seal] = await executor
    .select({ totalAmount: purchaseOrderDigitalSeals.totalAmount })
    .from(purchaseOrderDigitalSeals)
    .where(eq(purchaseOrderDigitalSeals.purchaseOrderId, purchaseOrderId))
    .limit(1);
  if (seal) {
    return resolvePurchaseOrderOfficialTotal({
      sealedTotal: seal.totalAmount,
      calculatedTotal: 0,
    });
  }

  return resolvePurchaseOrderOfficialTotal({
    calculatedTotal: await getCalculatedPurchaseOrderTotal(
      executor,
      purchaseOrderId,
      pricesIncludeTax
    ),
  });
}

export async function listEligiblePurchaseOrdersForAdvance(filters?: {
  purchaseOrderId?: number;
  projectId?: number;
  projectIds?: number[];
  currency?: PurchaseCurrency;
  search?: string;
}) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [
    inArray(purchaseOrders.status, ["emitida", "enviada"]),
    eq(purchaseOrders.paymentMethod, "contado"),
    sql`${purchaseOrders.supplierId} is not null`,
    notExists(
      db
        .select({ id: receipts.id })
        .from(receipts)
        .where(
          and(
            eq(receipts.sourceType, "purchase_order"),
            eq(receipts.sourceId, purchaseOrders.id),
            ne(receipts.status, "borrador"),
            ne(receipts.status, "anulada")
          )
        )
    ),
  ];
  if (filters?.purchaseOrderId) {
    conditions.push(eq(purchaseOrders.id, filters.purchaseOrderId));
  }
  if (filters?.projectId)
    conditions.push(eq(purchaseOrders.projectId, filters.projectId));
  if (filters?.projectIds) {
    conditions.push(
      filters.projectIds.length
        ? inArray(purchaseOrders.projectId, filters.projectIds)
        : eq(purchaseOrders.id, -1)
    );
  }
  if (filters?.currency)
    conditions.push(eq(purchaseOrders.currency, filters.currency));
  if (filters?.search?.trim()) {
    const pattern = `%${filters.search.trim()}%`;
    conditions.push(
      or(
        sql`${purchaseOrders.orderNumber} ilike ${pattern}`,
        sql`${suppliers.name} ilike ${pattern}`,
        sql`${suppliers.supplierCode} ilike ${pattern}`,
        sql`${projects.code} ilike ${pattern}`,
        sql`${projects.name} ilike ${pattern}`
      )!
    );
  }

  const rows = await db
    .select({
      purchaseOrder: purchaseOrders,
      supplier: suppliers,
      project: projects,
    })
    .from(purchaseOrders)
    .innerJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id))
    .innerJoin(projects, eq(purchaseOrders.projectId, projects.id))
    .where(and(...conditions))
    .orderBy(asc(suppliers.name), asc(purchaseOrders.orderNumber));

  const sealedTotals = rows.length
    ? await db
        .select({
          purchaseOrderId: purchaseOrderDigitalSeals.purchaseOrderId,
          totalAmount: purchaseOrderDigitalSeals.totalAmount,
        })
        .from(purchaseOrderDigitalSeals)
        .where(
          inArray(
            purchaseOrderDigitalSeals.purchaseOrderId,
            rows.map((row: any) => row.purchaseOrder.id)
          )
        )
    : [];
  const sealedTotalByOrder = new Map(
    sealedTotals.map((seal: any) => [seal.purchaseOrderId, seal.totalAmount])
  );

  const advances = rows.length
    ? await db
        .select()
        .from(purchaseOrderAdvances)
        .where(
          and(
            inArray(
              purchaseOrderAdvances.purchaseOrderId,
              rows.map((row: any) => row.purchaseOrder.id)
            ),
            isNull(purchaseOrderAdvances.cancelledAt)
          )
        )
    : [];
  const requestedByOrder = new Map<number, number>();
  for (const advance of advances) {
    requestedByOrder.set(
      advance.purchaseOrderId,
      money(
        (requestedByOrder.get(advance.purchaseOrderId) ?? 0) +
          money(advance.requestedAmount)
      )
    );
  }

  return Promise.all(
    rows.map(async (row: any) => {
      const sealedTotal = sealedTotalByOrder.get(row.purchaseOrder.id);
      const total =
        sealedTotal !== undefined
          ? resolvePurchaseOrderOfficialTotal({
              sealedTotal,
              calculatedTotal: 0,
            })
          : resolvePurchaseOrderOfficialTotal({
              calculatedTotal: await getCalculatedPurchaseOrderTotal(
                db,
                row.purchaseOrder.id,
                row.purchaseOrder.pricesIncludeTax
              ),
            });
      const requestedAdvanceAmount =
        requestedByOrder.get(row.purchaseOrder.id) ?? 0;
      return {
        ...row,
        total,
        requestedAdvanceAmount,
        availableAdvanceRequestAmount:
          calculatePurchaseOrderAdvanceAvailableAmount(
            total,
            requestedAdvanceAmount
          ),
      };
    })
  );
}

export async function createPurchaseOrderAdvance(input: {
  actor: PurchaseOrderAdvanceActor;
  purchaseOrderId: number;
  requestedAmount: number;
  requestedPaymentDate: Date;
  notes?: string | null;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  if (!hasAtMostDecimalPlaces(input.requestedAmount, 2)) {
    throw new PurchaseOrderAdvanceRuleError(
      "El importe del anticipo debe tener como máximo dos decimales."
    );
  }
  const requestedAmount = money(input.requestedAmount);
  if (requestedAmount <= 0) {
    throw new PurchaseOrderAdvanceRuleError(
      "El anticipo debe ser mayor que cero."
    );
  }

  return db.transaction(async tx => {
    const [purchaseOrder] = await tx
      .select()
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, input.purchaseOrderId))
      .for("update")
      .limit(1);
    if (!purchaseOrder) {
      throw new PurchaseOrderAdvanceRuleError("La orden de compra no existe.");
    }
    if (!["emitida", "enviada"].includes(purchaseOrder.status)) {
      throw new PurchaseOrderAdvanceRuleError(
        "Solo se pueden solicitar anticipos para órdenes emitidas o enviadas."
      );
    }
    if (!allowsPurchaseOrderAdvance(purchaseOrder.paymentMethod)) {
      throw new PurchaseOrderAdvanceRuleError(
        "Solo las órdenes de compra con método de pago Contado permiten solicitar anticipos."
      );
    }
    if (!purchaseOrder.supplierId) {
      throw new PurchaseOrderAdvanceRuleError(
        "La orden de compra debe tener proveedor."
      );
    }

    const [registeredReceipt] = await tx
      .select({ id: receipts.id })
      .from(receipts)
      .where(
        and(
          eq(receipts.sourceType, "purchase_order"),
          eq(receipts.sourceId, purchaseOrder.id),
          ne(receipts.status, "borrador"),
          ne(receipts.status, "anulada")
        )
      )
      .limit(1);
    if (registeredReceipt) {
      throw new PurchaseOrderAdvanceRuleError(
        "No se pueden crear nuevos anticipos después de registrar la primera recepción."
      );
    }

    const total = money(
      await getPurchaseOrderOfficialTotal(
        tx,
        purchaseOrder.id,
        purchaseOrder.pricesIncludeTax
      )
    );
    const existingAdvances = await tx
      .select()
      .from(purchaseOrderAdvances)
      .where(eq(purchaseOrderAdvances.purchaseOrderId, purchaseOrder.id))
      .for("update");
    const alreadyRequested = money(
      existingAdvances
        .filter((advance: any) => !advance.cancelledAt)
        .reduce(
          (sum: number, advance: any) => sum + money(advance.requestedAmount),
          0
        )
    );
    const availableAdvanceRequestAmount =
      calculatePurchaseOrderAdvanceAvailableAmount(total, alreadyRequested);
    if (requestedAmount > availableAdvanceRequestAmount + 0.0001) {
      throw new PurchaseOrderAdvanceRuleError(
        `El anticipo supera el saldo disponible de la OC (${availableAdvanceRequestAmount.toFixed(
          2
        )} ${purchaseOrder.currency}).`
      );
    }

    const [created] = await tx
      .insert(purchaseOrderAdvances)
      .values({
        advanceNumber: `TEMP-${randomUUID()}`,
        purchaseOrderId: purchaseOrder.id,
        projectId: purchaseOrder.projectId,
        supplierId: purchaseOrder.supplierId,
        currency: purchaseOrder.currency,
        requestedAmount: moneyString(requestedAmount),
        requestedPaymentDate: input.requestedPaymentDate,
        notes: input.notes?.trim() || null,
        createdById: input.actor.id,
      })
      .returning();
    const advanceNumber = `ANT-${input.requestedPaymentDate.getUTCFullYear()}-${String(
      created.id
    ).padStart(6, "0")}`;
    const [updated] = await tx
      .update(purchaseOrderAdvances)
      .set({ advanceNumber, updatedAt: new Date() })
      .where(eq(purchaseOrderAdvances.id, created.id))
      .returning();
    return {
      ...updated,
      purchaseOrderTotal: total,
      availableAdvanceRequestAmount:
        calculatePurchaseOrderAdvanceAvailableAmount(
          total,
          alreadyRequested + requestedAmount
        ),
    };
  });
}

export async function listPurchaseOrderAdvances(filters?: {
  advanceId?: number;
  purchaseOrderId?: number;
  projectId?: number;
  projectIds?: number[];
  includeCancelled?: boolean;
}) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [];
  if (filters?.advanceId)
    conditions.push(eq(purchaseOrderAdvances.id, filters.advanceId));
  if (filters?.purchaseOrderId)
    conditions.push(
      eq(purchaseOrderAdvances.purchaseOrderId, filters.purchaseOrderId)
    );
  if (filters?.projectId)
    conditions.push(eq(purchaseOrderAdvances.projectId, filters.projectId));
  if (filters?.projectIds) {
    conditions.push(
      filters.projectIds.length
        ? inArray(purchaseOrderAdvances.projectId, filters.projectIds)
        : eq(purchaseOrderAdvances.id, -1)
    );
  }
  if (!filters?.includeCancelled)
    conditions.push(isNull(purchaseOrderAdvances.cancelledAt));

  const rows = await db
    .select({
      advance: purchaseOrderAdvances,
      purchaseOrder: purchaseOrders,
      supplier: suppliers,
      project: projects,
      createdBy: users,
    })
    .from(purchaseOrderAdvances)
    .innerJoin(
      purchaseOrders,
      eq(purchaseOrderAdvances.purchaseOrderId, purchaseOrders.id)
    )
    .innerJoin(suppliers, eq(purchaseOrderAdvances.supplierId, suppliers.id))
    .innerJoin(projects, eq(purchaseOrderAdvances.projectId, projects.id))
    .innerJoin(users, eq(purchaseOrderAdvances.createdById, users.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(
      desc(purchaseOrderAdvances.createdAt),
      desc(purchaseOrderAdvances.id)
    );
  const financials = await getAdvanceFinancialMap(
    db,
    rows.map((row: any) => row.advance.id)
  );
  return rows.map((row: any) => ({
    ...row,
    money: financials.get(row.advance.id)!,
  }));
}

export async function listEligiblePurchaseOrderAdvances(filters?: {
  projectId?: number;
  projectIds?: number[];
  currency?: PurchaseCurrency;
  excludeBatchId?: number;
}) {
  const rows = await listPurchaseOrderAdvances({
    projectId: filters?.projectId,
    projectIds: filters?.projectIds,
  });
  const db = await getDb();
  if (!db) return [];
  const financials = await getAdvanceFinancialMap(
    db,
    rows.map((row: any) => row.advance.id),
    filters?.excludeBatchId
  );
  return rows
    .map((row: any) => ({ ...row, money: financials.get(row.advance.id)! }))
    .filter(
      (row: any) =>
        (!filters?.currency || row.advance.currency === filters.currency) &&
        row.money.availableToPayAmount > 0 &&
        row.money.reservedAmount <= 0 &&
        row.money.bankPaidPendingAmount <= 0
    );
}

export async function getPurchaseOrderAdvanceSnapshots(
  executor: DbExecutor,
  advanceIds: number[],
  excludeBatchId?: number
) {
  const uniqueIds = Array.from(new Set(advanceIds));
  if (!uniqueIds.length) return [];
  const rows = await executor
    .select({
      advance: purchaseOrderAdvances,
      purchaseOrder: purchaseOrders,
      supplier: suppliers,
      project: projects,
    })
    .from(purchaseOrderAdvances)
    .innerJoin(
      purchaseOrders,
      eq(purchaseOrderAdvances.purchaseOrderId, purchaseOrders.id)
    )
    .innerJoin(suppliers, eq(purchaseOrderAdvances.supplierId, suppliers.id))
    .innerJoin(projects, eq(purchaseOrderAdvances.projectId, projects.id))
    .where(inArray(purchaseOrderAdvances.id, uniqueIds))
    .for("update", { of: purchaseOrderAdvances });
  if (rows.length !== uniqueIds.length) {
    throw new PurchaseOrderAdvanceRuleError("Uno o más anticipos no existen.");
  }
  const financials = await getAdvanceFinancialMap(
    executor,
    uniqueIds,
    excludeBatchId
  );
  return rows.map((row: any) => ({
    ...row,
    money: financials.get(row.advance.id)!,
  }));
}

export async function cancelPurchaseOrderAdvance(input: {
  advanceId: number;
  actor: PurchaseOrderAdvanceActor;
  reason: string;
}) {
  const reason = input.reason.trim();
  if (reason.length < 5) {
    throw new PurchaseOrderAdvanceRuleError(
      "Ingrese un motivo de anulación de al menos 5 caracteres."
    );
  }
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  return db.transaction(async tx => {
    const [advance] = await tx
      .select()
      .from(purchaseOrderAdvances)
      .where(eq(purchaseOrderAdvances.id, input.advanceId))
      .for("update")
      .limit(1);
    if (!advance) {
      throw new PurchaseOrderAdvanceRuleError("Anticipo no encontrado.");
    }
    if (advance.cancelledAt) return advance;
    const financials = await getAdvanceFinancialMap(tx, [advance.id]);
    const summary = financials.get(advance.id)!;
    if (
      summary.reservedAmount > 0 ||
      summary.bankPaidPendingAmount > 0 ||
      summary.accountedAmount > 0
    ) {
      throw new PurchaseOrderAdvanceRuleError(
        "No se puede anular un anticipo reservado, pagado o contabilizado."
      );
    }
    const [updated] = await tx
      .update(purchaseOrderAdvances)
      .set({
        cancelledById: input.actor.id,
        cancelledAt: new Date(),
        cancellationReason: reason,
        updatedAt: new Date(),
      })
      .where(eq(purchaseOrderAdvances.id, advance.id))
      .returning();
    return updated;
  });
}

export async function assertPurchaseOrderCanBeCancelledWithAdvances(
  executor: DbExecutor,
  purchaseOrderId: number,
  actorId: number
) {
  const advances = await executor
    .select()
    .from(purchaseOrderAdvances)
    .where(
      and(
        eq(purchaseOrderAdvances.purchaseOrderId, purchaseOrderId),
        isNull(purchaseOrderAdvances.cancelledAt)
      )
    );
  if (!advances.length) return;
  const financials = await getAdvanceFinancialMap(
    executor,
    advances.map((advance: any) => advance.id)
  );
  const blocking = advances.some((advance: any) => {
    const summary = financials.get(advance.id)!;
    return (
      summary.reservedAmount > 0 ||
      summary.bankPaidPendingAmount > 0 ||
      summary.accountedAmount > 0
    );
  });
  if (blocking) {
    throw new PurchaseOrderAdvanceRuleError(
      "La OC tiene anticipos reservados, pagados o contabilizados y no puede anularse."
    );
  }
  await executor
    .update(purchaseOrderAdvances)
    .set({
      cancelledAt: new Date(),
      cancelledById: actorId,
      cancellationReason: "OC anulada antes de pagar el anticipo",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(purchaseOrderAdvances.purchaseOrderId, purchaseOrderId),
        isNull(purchaseOrderAdvances.cancelledAt)
      )
    );
}

export async function applyAvailableAdvancesForPurchaseOrder(input: {
  executor: DbExecutor;
  purchaseOrderId: number;
  actorId: number;
}) {
  const advances = await input.executor
    .select()
    .from(purchaseOrderAdvances)
    .where(
      and(
        eq(purchaseOrderAdvances.purchaseOrderId, input.purchaseOrderId),
        isNull(purchaseOrderAdvances.cancelledAt)
      )
    )
    .orderBy(
      asc(purchaseOrderAdvances.createdAt),
      asc(purchaseOrderAdvances.id)
    )
    .for("update");
  if (!advances.length) return [];

  const invoiceRows = await input.executor
    .select()
    .from(invoices)
    .where(
      and(
        eq(invoices.purchaseOrderId, input.purchaseOrderId),
        eq(invoices.status, "registrada")
      )
    )
    .orderBy(asc(invoices.accountedAt), asc(invoices.id))
    .for("update");
  if (!invoiceRows.length) return [];

  const advanceFinancials = await getAdvanceFinancialMap(
    input.executor,
    advances.map((advance: any) => advance.id)
  );
  const advanceAccountingRows = await input.executor
    .select({
      purchaseOrderAdvanceId: treasuryPaymentItems.purchaseOrderAdvanceId,
      firstAccountedAt: sql<Date | null>`min(${treasuryPaymentItems.accountedAt})`,
    })
    .from(treasuryPaymentItems)
    .where(
      and(
        eq(treasuryPaymentItems.sourceType, "purchase_order_advance"),
        eq(treasuryPaymentItems.status, "contabilizada"),
        inArray(
          treasuryPaymentItems.purchaseOrderAdvanceId,
          advances.map((advance: any) => advance.id)
        )
      )
    )
    .groupBy(treasuryPaymentItems.purchaseOrderAdvanceId);
  const firstAccountedAtByAdvanceId = new Map<number, number>(
    advanceAccountingRows.map((row: any) => [
      row.purchaseOrderAdvanceId,
      row.firstAccountedAt
        ? new Date(row.firstAccountedAt).getTime()
        : Number.MAX_SAFE_INTEGER,
    ])
  );
  const orderedAdvances = [...advances].sort(
    (left: any, right: any) =>
      (firstAccountedAtByAdvanceId.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
        (firstAccountedAtByAdvanceId.get(right.id) ??
          Number.MAX_SAFE_INTEGER) || left.id - right.id
  );
  const invoiceIds = invoiceRows.map((invoice: any) => invoice.id);
  const [applicationRows, invoicePaymentRows] = await Promise.all([
    input.executor
      .select()
      .from(purchaseOrderAdvanceApplications)
      .where(inArray(purchaseOrderAdvanceApplications.invoiceId, invoiceIds)),
    input.executor
      .select()
      .from(treasuryPaymentItems)
      .where(
        and(
          eq(treasuryPaymentItems.sourceType, "invoice"),
          inArray(treasuryPaymentItems.invoiceId, invoiceIds)
        )
      ),
  ]);
  const invoiceApplied = new Map<number, number>();
  const invoiceSettled = new Map<number, number>();
  for (const row of applicationRows) {
    invoiceApplied.set(
      row.invoiceId,
      money((invoiceApplied.get(row.invoiceId) ?? 0) + money(row.amount))
    );
  }
  for (const item of invoicePaymentRows) {
    if (!item.invoiceId) continue;
    if (item.status === "contabilizada") {
      invoiceSettled.set(
        item.invoiceId,
        money(
          (invoiceSettled.get(item.invoiceId) ?? 0) + money(item.bankPaidAmount)
        )
      );
    } else if (item.activeReservation) {
      invoiceSettled.set(
        item.invoiceId,
        money((invoiceSettled.get(item.invoiceId) ?? 0) + paymentAmount(item))
      );
    }
  }

  const allocations: Array<{
    purchaseOrderAdvanceId: number;
    invoiceId: number;
    amount: number;
  }> = [];

  for (const advance of orderedAdvances) {
    let advanceAvailable = money(
      advanceFinancials.get(advance.id)?.unappliedAmount ?? 0
    );
    if (advanceAvailable <= 0) continue;
    for (const invoice of invoiceRows) {
      const invoiceRemaining = money(
        Math.max(
          0,
          money(invoice.netPayable) -
            (invoiceApplied.get(invoice.id) ?? 0) -
            (invoiceSettled.get(invoice.id) ?? 0)
        )
      );
      if (invoiceRemaining <= 0) continue;
      const amount = money(Math.min(advanceAvailable, invoiceRemaining));
      if (amount <= 0) continue;
      const existing = applicationRows.find(
        (row: any) =>
          row.purchaseOrderAdvanceId === advance.id &&
          row.invoiceId === invoice.id
      );
      if (existing) {
        await input.executor
          .update(purchaseOrderAdvanceApplications)
          .set({ amount: moneyString(money(existing.amount) + amount) })
          .where(eq(purchaseOrderAdvanceApplications.id, existing.id));
        existing.amount = moneyString(money(existing.amount) + amount);
      } else {
        const [created] = await input.executor
          .insert(purchaseOrderAdvanceApplications)
          .values({
            purchaseOrderAdvanceId: advance.id,
            invoiceId: invoice.id,
            amount: moneyString(amount),
            appliedById: input.actorId,
            appliedAt: new Date(),
          })
          .returning();
        applicationRows.push(created);
      }
      invoiceApplied.set(
        invoice.id,
        money((invoiceApplied.get(invoice.id) ?? 0) + amount)
      );
      advanceAvailable = money(advanceAvailable - amount);
      allocations.push({
        purchaseOrderAdvanceId: advance.id,
        invoiceId: invoice.id,
        amount,
      });
      if (advanceAvailable <= 0) break;
    }
  }

  return allocations;
}
