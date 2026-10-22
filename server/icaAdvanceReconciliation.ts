import { eq, sql } from "drizzle-orm";
import {
  advanceFinancialEvents,
  invoiceContractualAmortizations,
  purchaseOrderAdvanceApplications,
  purchaseOrderAdvances,
} from "../drizzle/schema";
import { lockAdvanceOrder, queryRows } from "./contractualAdvances";
import { decimalToMinorUnits } from "../shared/money";

export const ICA_CORRECTION_KEY = "contractual-ica-1058-2015-v1";
export const ICA_EXPECTED_RESULT = Object.freeze({
  invoiceAvailable: 3113652.15,
  advanceCovered: 753987,
  advancePendingFunding: 0,
  amortized: 549468.03,
  pendingAmortization: 204518.97,
});

/** Complete before-images of the affected operation, including untouched siblings. */
export async function inspectIca(executor: any) {
  const orders = await queryRows<any>(
    executor,
    sql`select * from "purchaseOrders" where id=1058`
  );
  const invoiceRows = await queryRows<any>(
    executor,
    sql`select * from invoices where "purchaseOrderId"=1058 or id in (2014,2015) order by id`
  );
  const advances = await queryRows<any>(
    executor,
    sql`select * from "purchaseOrderAdvances" where "purchaseOrderId"=1058 or id=21 order by id`
  );
  const applications = await queryRows<any>(
    executor,
    sql`select * from "purchaseOrderAdvanceApplications" where "purchaseOrderAdvanceId" in (select id from "purchaseOrderAdvances" where "purchaseOrderId"=1058) or "invoiceId" in (2014,2015) or id=71 order by id`
  );
  const adjustments = await queryRows<any>(
    executor,
    sql`select * from "invoiceDocumentAdjustments" where "invoiceId" in (2014,2015) or id=28 order by id`
  );
  const snapshots = await queryRows<any>(
    executor,
    sql`select * from "invoiceContractualAmortizations" where "purchaseOrderId"=1058 or "invoiceId" in (2014,2015) order by "invoiceId"`
  );
  const payments = await queryRows<any>(
    executor,
    sql`select * from "treasuryPaymentItems" where "purchaseOrderAdvanceId"=21 or "invoiceId" in (2014,2015) or id=641 order by id`
  );
  const batches = await queryRows<any>(
    executor,
    sql`select * from "treasuryPaymentBatches" where id in (select "batchId" from "treasuryPaymentItems" where "purchaseOrderAdvanceId"=21 or "invoiceId" in (2014,2015) or id=641) order by id`
  );
  const notes = await queryRows<any>(
    executor,
    sql`select * from "financialNoteInvoices" where "invoiceId" in (2014,2015) order by id`
  );
  const noteDocuments = await queryRows<any>(
    executor,
    sql`select * from "financialNotes" where "sourceInvoiceId" in (2014,2015) or id in (select "noteId" from "financialNoteInvoices" where "invoiceId" in (2014,2015)) order by id`
  );
  const quality = await queryRows<any>(
    executor,
    sql`select r.* from "qualityRetentionReleases" r join "invoiceDocumentAdjustments" d on d.id=r."invoiceDocumentAdjustmentId" where d."invoiceId" in (2014,2015) order by r.id`
  );
  const events = await queryRows<any>(
    executor,
    sql`select * from "advanceFinancialEvents" where "purchaseOrderId"=1058 or "operationKey"=${ICA_CORRECTION_KEY} order by id`
  );
  return {
    orders,
    invoices: invoiceRows,
    advances,
    applications,
    adjustments,
    snapshots,
    payments,
    batches,
    notes,
    noteDocuments,
    quality,
    events,
  };
}

export type IcaSnapshot = Awaited<ReturnType<typeof inspectIca>>;
function requireIca(condition: unknown, message: string): asserts condition {
  if (!condition)
    throw new Error(`ICA: se detuvo la regularización. ${message}`);
}
function same(value: unknown, expected: number) {
  return (
    value !== null &&
    value !== undefined &&
    Number.isFinite(Number(value)) &&
    decimalToMinorUnits(String(value), 4) === decimalToMinorUnits(expected, 4)
  );
}
function canonical(value: any): any {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map(key => [key, canonical(value[key])])
    );
  return value;
}
function equal(left: unknown, right: unknown) {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}
function omit(row: any, keys: string[]) {
  return Object.fromEntries(
    Object.entries(row).filter(([key]) => !keys.includes(key))
  );
}
function assertCommon(before: IcaSnapshot) {
  const order = before.orders[0];
  requireIca(
    before.orders.length === 1 &&
      order.id === 1058 &&
      order.orderNumber === "OC-017-00000233" &&
      order.supplierId === 1871 &&
      order.projectId === 21 &&
      order.currency === "HNL" &&
      order.appliesContract === true,
    "La orden no coincide con la operación documentada."
  );
  requireIca(
    before.invoices.length === 2 &&
      before.invoices[0].id === 2014 &&
      before.invoices[0].invoiceDocumentNumber === "FT-017-00000620" &&
      before.invoices[0].status === "anulada" &&
      before.invoices[1].id === 2015 &&
      before.invoices.every(
        row =>
          row.purchaseOrderId === 1058 &&
          row.supplierId === 1871 &&
          row.projectId === 21 &&
          row.currency === "HNL"
      ),
    "Cambió el conjunto o estado de facturas de la orden."
  );
  const invoice = before.invoices[1];
  requireIca(
    invoice.invoiceDocumentNumber === "FT-017-00000621" &&
      invoice.receiptId === 2164 &&
      invoice.purchaseOrderId === 1058 &&
      invoice.supplierId === 1871 &&
      invoice.projectId === 21 &&
      invoice.currency === "HNL" &&
      invoice.status === "registrada",
    "La factura no coincide con la evidencia."
  );
  requireIca(
    same(invoice.subtotal, 3663120.18) &&
      same(invoice.total, 3663120.18) &&
      same(invoice.taxAmount, 0) &&
      same(invoice.netPayable, 3113652.15) &&
      same(invoice.otherRetentionTotal, 549468.03) &&
      same(invoice.retentionTotal, 0) &&
      same(invoice.documentDiscountTotal, 0) &&
      same(invoice.creditNoteTotal, 0) &&
      same(invoice.debitNoteTotal, 0),
    "Cambió el cálculo de la factura."
  );
  requireIca(
    before.advances.length === 1,
    "Cambió el conjunto de anticipos de la orden."
  );
  const advance = before.advances[0];
  requireIca(
    advance.id === 21 &&
      advance.advanceNumber === "ANT-2026-000021" &&
      advance.purchaseOrderId === 1058 &&
      advance.supplierId === 1871 &&
      advance.projectId === 21 &&
      advance.currency === "HNL" &&
      !advance.cancelledAt &&
      same(advance.requestedAmount, 753987),
    "Cambió el anticipo autorizado."
  );
  const amortizations = before.adjustments.filter(d => d.invoiceId === 2015);
  const adjustment = amortizations[0];
  requireIca(
    amortizations.length === 1 &&
      adjustment.id === 28 &&
      adjustment.adjustmentType === "advance_amortization" &&
      same(adjustment.baseAmount, 3663120.18) &&
      same(adjustment.amount, 549468.03),
    "Cambió la amortización documental."
  );
  // The original amount-input row stores percentage=15.00000008. Preserve it exactly.
  requireIca(
    decimalToMinorUnits(adjustment.amount) ===
      Number(
        (BigInt(decimalToMinorUnits(invoice.subtotal)) * BigInt(15) +
          BigInt(50)) /
          BigInt(100)
      ),
    "La amortización no corresponde al 15% documentado del subtotal."
  );
  requireIca(
    before.applications.length === 1 &&
      before.applications[0].id === 71 &&
      before.applications[0].purchaseOrderAdvanceId === 21 &&
      before.applications[0].invoiceId === 2015,
    "Cambiaron las aplicaciones del anticipo."
  );
  requireIca(
    before.payments.length === 1 &&
      before.payments[0].id === 641 &&
      before.payments[0].batchId === 169 &&
      before.payments[0].sourceType === "purchase_order_advance" &&
      before.payments[0].purchaseOrderAdvanceId === 21 &&
      before.payments[0].invoiceId === null &&
      before.payments[0].supplierId === 1871 &&
      before.payments[0].currency === "HNL" &&
      before.payments[0].status === "contabilizada" &&
      before.payments[0].activeReservation === false &&
      same(before.payments[0].bankPaidAmount, 753987),
    "Cambió el TES o existen pagos/reservas sobre las facturas."
  );
  requireIca(
    before.batches.length === 1 &&
      before.batches[0].id === 169 &&
      before.batches[0].batchNumber === "TES-2026-000169" &&
      before.batches[0].status === "cerrado" &&
      before.batches[0].projectId === 21 &&
      before.batches[0].currency === "HNL",
    "Cambió el lote del anticipo pagado."
  );
  requireIca(
    before.notes.length === 0 &&
      before.noteDocuments.length === 0 &&
      before.quality.length === 0,
    "Existen notas o liberaciones posteriores."
  );
  return { invoice, advance, application: before.applications[0], adjustment };
}
function assertFinal(state: IcaSnapshot) {
  const { advance, application } = assertCommon(state);
  const snapshot = state.snapshots[0];
  requireIca(
    advance.applicationMode === "contractual" &&
      advance.amortizationMode === "percentage" &&
      same(advance.amortizationValue, 15) &&
      advance.amortizationBase === "subtotal" &&
      application.applicationMode === "contractual" &&
      same(application.amount, 549468.03) &&
      application.invoiceDocumentAdjustmentId === 28,
    "La aplicación o regla contractual no coincide con el resultado autorizado."
  );
  requireIca(
    state.snapshots.length === 1 &&
      snapshot.invoiceId === 2015 &&
      snapshot.purchaseOrderId === 1058 &&
      snapshot.treatment === "contractual" &&
      snapshot.invoiceDocumentAdjustmentId === 28 &&
      snapshot.inputMode === "percentage" &&
      same(snapshot.inputValue, 15) &&
      snapshot.baseKind === "subtotal" &&
      same(snapshot.baseAmount, 3663120.18) &&
      same(snapshot.proposedAmount, 549468.03) &&
      same(snapshot.amount, 549468.03) &&
      snapshot.overrideReason === null,
    "El control contractual no coincide con la regularización."
  );
}

/** Must run inside a transaction. The callback must durably back up its locked snapshot before returning. */
export async function regularizeIca(
  executor: any,
  options: {
    apply?: boolean;
    actorId?: number;
    actorLabel?: string;
    beforeApply?: (before: IcaSnapshot) => Promise<void>;
  } = {}
) {
  await executor.execute(sql`set local lock_timeout = '5s'`);
  await executor.execute(sql`set local statement_timeout = '30s'`);
  await lockAdvanceOrder(executor, 1058);
  await executor.execute(
    sql`select id from invoices where "purchaseOrderId"=1058 or id in (2014,2015) order by id for update`
  );
  await executor.execute(
    sql`select id from "purchaseOrderAdvanceApplications" where "purchaseOrderAdvanceId"=21 or "invoiceId" in (2014,2015) order by id for update`
  );
  await executor.execute(
    sql`select id from "invoiceDocumentAdjustments" where "invoiceId" in (2014,2015) order by id for update`
  );
  await executor.execute(
    sql`select "invoiceId" from "invoiceContractualAmortizations" where "purchaseOrderId"=1058 or "invoiceId" in (2014,2015) order by "invoiceId" for update`
  );
  await executor.execute(
    sql`select id from "treasuryPaymentBatches" where id=169 for update`
  );
  await executor.execute(
    sql`select id from "treasuryPaymentItems" where "purchaseOrderAdvanceId"=21 or "invoiceId" in (2014,2015) or id=641 order by id for update`
  );
  const before = await inspectIca(executor);
  const { advance, application } = assertCommon(before);
  const matchingEvents = before.events.filter(
    event => event.operationKey === ICA_CORRECTION_KEY
  );
  if (matchingEvents.length) {
    const event = matchingEvents[0];
    assertFinal(before);
    requireIca(
      matchingEvents.length === 1 &&
        event.purchaseOrderId === 1058 &&
        event.invoiceId === 2015 &&
        event.action === "regularize_contractual_advance",
      "La auditoría no corresponde a esta operación."
    );
    requireIca(
      equal(
        {
          ...before,
          events: before.events.filter(
            row => row.operationKey !== ICA_CORRECTION_KEY
          ),
        },
        event.after
      ),
      "Existen cambios posteriores a la regularización; no se reaplicó ninguna modificación."
    );
    return {
      changed: false,
      alreadyApplied: true,
      before,
      expected: ICA_EXPECTED_RESULT,
    };
  }
  requireIca(
    before.snapshots.length === 0 &&
      advance.applicationMode === "direct" &&
      advance.amortizationMode === null &&
      advance.amortizationValue === null &&
      advance.amortizationBase === null &&
      application.applicationMode === "direct" &&
      application.invoiceDocumentAdjustmentId === null &&
      same(application.amount, 753987),
    "El tratamiento previo no coincide con el diagnóstico autorizado."
  );
  if (!options.apply)
    return {
      changed: false,
      alreadyApplied: false,
      before,
      expected: ICA_EXPECTED_RESULT,
    };
  requireIca(
    typeof options.beforeApply === "function",
    "La aplicación requiere un respaldo durable del estado bloqueado."
  );
  await options.beforeApply(before);
  // Ensure even the backup callback could not modify the captured transaction state.
  requireIca(
    equal(before, await inspectIca(executor)),
    "El estado cambió durante el respaldo; no se aplicó la regularización."
  );
  const changedAdvance = await executor
    .update(purchaseOrderAdvances)
    .set({
      applicationMode: "contractual",
      amortizationMode: "percentage",
      amortizationValue: "15",
      amortizationBase: "subtotal",
      updatedAt: new Date(),
    })
    .where(eq(purchaseOrderAdvances.id, 21))
    .returning({ id: purchaseOrderAdvances.id });
  requireIca(
    changedAdvance.length === 1,
    "No se actualizó exactamente el anticipo autorizado."
  );
  await executor.insert(invoiceContractualAmortizations).values({
    invoiceId: 2015,
    purchaseOrderId: 1058,
    treatment: "contractual",
    invoiceDocumentAdjustmentId: 28,
    inputMode: "percentage",
    inputValue: "15",
    baseKind: "subtotal",
    baseAmount: "3663120.18",
    proposedAmount: "549468.03",
    amount: "549468.03",
    overrideReason: null,
    updatedById: options.actorId ?? null,
  });
  const changedApplication = await executor
    .update(purchaseOrderAdvanceApplications)
    .set({
      applicationMode: "contractual",
      amount: "549468.03",
      invoiceDocumentAdjustmentId: 28,
    })
    .where(eq(purchaseOrderAdvanceApplications.id, 71))
    .returning({ id: purchaseOrderAdvanceApplications.id });
  requireIca(
    changedApplication.length === 1,
    "No se actualizó exactamente la aplicación autorizada."
  );
  const after = await inspectIca(executor);
  assertFinal(after);
  for (const key of [
    "orders",
    "invoices",
    "adjustments",
    "payments",
    "batches",
    "notes",
    "noteDocuments",
    "quality",
    "events",
  ] as const)
    requireIca(
      equal(before[key], after[key]),
      `Se alteró información no autorizada: ${key}.`
    );
  requireIca(
    equal(
      omit(advance, [
        "applicationMode",
        "amortizationMode",
        "amortizationValue",
        "amortizationBase",
        "updatedAt",
      ]),
      omit(after.advances[0], [
        "applicationMode",
        "amortizationMode",
        "amortizationValue",
        "amortizationBase",
        "updatedAt",
      ])
    ) &&
      equal(
        omit(application, [
          "applicationMode",
          "amount",
          "invoiceDocumentAdjustmentId",
        ]),
        omit(after.applications[0], [
          "applicationMode",
          "amount",
          "invoiceDocumentAdjustmentId",
        ])
      ),
    "Se modificaron campos fuera del tratamiento autorizado."
  );
  await executor.insert(advanceFinancialEvents).values({
    purchaseOrderId: 1058,
    invoiceId: 2015,
    actorId: options.actorId ?? null,
    actorLabel: options.actorLabel ?? "technical:user-authorized",
    action: "regularize_contractual_advance",
    reason:
      "Regularización autorizada respaldada por planilla firmada: anticipo pagado L753,987.00; amortización contractual del 15% L549,468.03; pendiente L204,518.97. Se conservan factura, deducción documental y TES originales.",
    before,
    after,
    operationKey: ICA_CORRECTION_KEY,
  });
  return {
    changed: true,
    alreadyApplied: false,
    before,
    after,
    expected: ICA_EXPECTED_RESULT,
  };
}
