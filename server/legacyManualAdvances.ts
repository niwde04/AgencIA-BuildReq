import { and, eq, inArray, sql } from "drizzle-orm";
import {
  advanceFinancialEvents,
  purchaseOrderAdvances,
} from "../drizzle/schema";
import { decimalToMinorUnits } from "../shared/money";
import { lockAdvanceOrder, queryRows } from "./contractualAdvances";

export const LEGACY_MANUAL_KEY = "legacy-manual-2202-114-115-116-v1";
const advanceManifest = [
  {
    id: 114,
    number: "ANT-2026-000114",
    amount: 36502.39,
    paymentId: 2534,
    batch: "TES-2026-000556",
  },
  {
    id: 115,
    number: "ANT-2026-000115",
    amount: 21155.06,
    paymentId: 2535,
    batch: "TES-2026-000557",
  },
  {
    id: 116,
    number: "ANT-2026-000116",
    amount: 71705.15,
    paymentId: 2536,
    batch: "TES-2026-000558",
  },
] as const;

export async function inspectLegacyManualAdvances(executor: any) {
  const [order] = await queryRows<any>(
    executor,
    sql`select id,"orderNumber","supplierId","projectId",currency,"appliesContract" from "purchaseOrders" where id=2202`
  );
  const advances = await queryRows<any>(
    executor,
    sql`select * from "purchaseOrderAdvances" where "purchaseOrderId"=2202 order by id`
  );
  const invoices = await queryRows<any>(
    executor,
    sql`select * from invoices where "purchaseOrderId"=2202 order by id`
  );
  const payments = await queryRows<any>(
    executor,
    sql`select t.*, b."batchNumber",b.status "batchStatus" from "treasuryPaymentItems" t join "treasuryPaymentBatches" b on b.id=t."batchId" where t."purchaseOrderAdvanceId" in (114,115,116) or t."invoiceId" in (select id from invoices where "purchaseOrderId"=2202) order by t.id`
  );
  const applications = await queryRows<any>(
    executor,
    sql`select * from "purchaseOrderAdvanceApplications" where "purchaseOrderAdvanceId" in (114,115,116) or "invoiceId" in (select id from invoices where "purchaseOrderId"=2202) order by id`
  );
  const snapshots = await queryRows<any>(
    executor,
    sql`select * from "invoiceContractualAmortizations" where "purchaseOrderId"=2202 order by "invoiceId"`
  );
  const adjustments = await queryRows<any>(
    executor,
    sql`select * from "invoiceDocumentAdjustments" where "invoiceId" in (select id from invoices where "purchaseOrderId"=2202) order by id`
  );
  return {
    order,
    advances,
    invoices,
    payments,
    applications,
    snapshots,
    adjustments,
  };
}
function requireHistorical(
  condition: unknown,
  message: string
): asserts condition {
  if (!condition)
    throw new Error(`Anticipos históricos: habilitación detenida. ${message}`);
}
const sameMoney = (value: string | number, expected: number) =>
  decimalToMinorUnits(value) === decimalToMinorUnits(expected);

/** Maintenance-only, exact approved manifest. Never called by a browser route. */
export async function enableLegacyManualAdvances(
  executor: any,
  options: { apply?: boolean; actorId?: number; actorLabel?: string } = {}
) {
  await executor.execute(sql`set local lock_timeout='5s'`);
  await executor.execute(sql`set local statement_timeout='30s'`);
  await lockAdvanceOrder(executor, 2202);
  await executor.execute(
    sql`select id from invoices where "purchaseOrderId"=2202 order by id for update`
  );
  await executor.execute(
    sql`select id from "treasuryPaymentItems" where "purchaseOrderAdvanceId" in (114,115,116) or "invoiceId"=2198 order by id for update`
  );
  const before = await inspectLegacyManualAdvances(executor);
  const [event] = await executor
    .select()
    .from(advanceFinancialEvents)
    .where(eq(advanceFinancialEvents.operationKey, LEGACY_MANUAL_KEY));
  requireHistorical(
    before.order?.orderNumber === "CD-018-00000527" &&
      before.order.supplierId === 111 &&
      before.order.projectId === 22 &&
      before.order.currency === "HNL" &&
      before.order.appliesContract,
    "La orden no coincide con la evidencia aprobada."
  );
  requireHistorical(
    before.advances.length === 3 &&
      advanceManifest.every(m =>
        before.advances.some(
          (a: any) =>
            a.id === m.id &&
            a.advanceNumber === m.number &&
            a.supplierId === 111 &&
            a.projectId === 22 &&
            a.currency === "HNL" &&
            sameMoney(a.requestedAmount, m.amount) &&
            !a.cancelledAt &&
            a.amortizationMode === null &&
            a.amortizationValue === null &&
            a.amortizationBase === null
        )
      ),
    "Cambió el conjunto o el origen de anticipos."
  );
  if (event) {
    requireHistorical(
      before.advances.every((a: any) => a.applicationMode === "legacy_manual"),
      "Existe auditoría pero cambió la clasificación; requiere revisión."
    );
    return {
      changed: false,
      alreadyApplied: true,
      operationKey: LEGACY_MANUAL_KEY,
    };
  }
  requireHistorical(
    before.advances.every((a: any) => a.applicationMode === "direct"),
    "El tratamiento actual requiere conciliación."
  );
  const invoice = before.invoices[0];
  requireHistorical(
    before.invoices.length === 1 &&
      invoice.id === 2198 &&
      invoice.invoiceDocumentNumber === "FT-018-00000542" &&
      invoice.purchaseOrderId === 2202 &&
      invoice.receiptId === 2356 &&
      invoice.supplierId === 111 &&
      invoice.projectId === 22 &&
      invoice.currency === "HNL" &&
      invoice.status === "borrador" &&
      !invoice.accountedAt,
    "Cambió la factura o su estado."
  );
  requireHistorical(
    sameMoney(invoice.subtotal, 185387.6) &&
      sameMoney(invoice.total, 185387.6) &&
      sameMoney(invoice.netPayable, 185387.6) &&
      [
        invoice.retentionTotal,
        invoice.otherRetentionTotal,
        invoice.documentDiscountTotal,
        invoice.creditNoteTotal,
        invoice.debitNoteTotal,
      ].every(v => sameMoney(v, 0)),
    "Cambió el cálculo de la factura."
  );
  requireHistorical(
    before.payments.length === 3 &&
      advanceManifest.every(m =>
        before.payments.some(
          (t: any) =>
            t.id === m.paymentId &&
            t.purchaseOrderAdvanceId === m.id &&
            t.batchNumber === m.batch &&
            t.batchStatus === "cerrado" &&
            t.sourceType === "purchase_order_advance" &&
            t.supplierId === 111 &&
            t.currency === "HNL" &&
            t.invoiceId === null &&
            t.status === "contabilizada" &&
            !t.activeReservation &&
            sameMoney(t.requestedAmount, m.amount) &&
            sameMoney(t.bankPaidAmount, m.amount)
        )
      ),
    "Cambió un pago o una reserva de Tesorería."
  );
  requireHistorical(
    !before.applications.length &&
      !before.snapshots.length &&
      !before.adjustments.length,
    "Ya existen aplicaciones o deducciones; deben reevaluarse."
  );
  const [dependencies] = await queryRows<{ n: number }>(
    executor,
    sql`select ( (select count(*) from "financialNoteInvoices" where "invoiceId"=2198) + (select count(*) from "qualityRetentionReleases" r join "invoiceDocumentAdjustments" d on d.id=r."invoiceDocumentAdjustmentId" where d."invoiceId"=2198) )::int n`
  );
  requireHistorical(
    dependencies.n === 0,
    "La factura tiene dependencias financieras nuevas."
  );
  if (!options.apply)
    return {
      changed: false,
      alreadyApplied: false,
      operationKey: LEGACY_MANUAL_KEY,
      expected: { availableAmount: 129362.6, treatment: "legacy_manual" },
      before,
    };
  // Preserve amounts, status, dates and payment rows; only the approved classification changes.
  const after = await executor
    .update(purchaseOrderAdvances)
    .set({ applicationMode: "legacy_manual" })
    .where(
      and(
        eq(purchaseOrderAdvances.purchaseOrderId, 2202),
        inArray(purchaseOrderAdvances.id, [114, 115, 116])
      )
    )
    .returning();
  requireHistorical(
    after.length === 3,
    "No se reclasificaron los tres anticipos; se revierte la operación."
  );
  await executor.insert(advanceFinancialEvents).values({
    purchaseOrderId: 2202,
    invoiceId: 2198,
    actorId: options.actorId ?? null,
    actorLabel: options.actorLabel ?? "maintenance:legacy-manual",
    action: "enable_legacy_manual",
    reason:
      "Habilitación aprobada de captura manual para anticipos históricos de CD-018-00000527; pagos y documentos conservados",
    before,
    after: { advances: after },
    operationKey: LEGACY_MANUAL_KEY,
  });
  return {
    changed: true,
    alreadyApplied: false,
    operationKey: LEGACY_MANUAL_KEY,
    expected: { availableAmount: 129362.6, treatment: "legacy_manual" },
  };
}
