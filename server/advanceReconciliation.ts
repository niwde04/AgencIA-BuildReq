import { eq, sql } from "drizzle-orm";
import {
  advanceFinancialEvents,
  invoiceContractualAmortizations,
  purchaseOrderAdvanceApplications,
  purchaseOrderAdvances,
} from "../drizzle/schema";
import { lockAdvanceOrder, queryRows } from "./contractualAdvances";
import { decimalToMinorUnits } from "../shared/money";

export const GEO_CORRECTION_KEY = "contractual-geo-897-1953-v1";
export async function inspectGeo(executor: any) {
  const [order] = await queryRows<any>(
    executor,
    sql`select id,"orderNumber","supplierId","projectId",currency from "purchaseOrders" where id=897`
  );
  const invoices = await queryRows<any>(
    executor,
    sql`select * from invoices where "purchaseOrderId"=897 order by id`
  );
  const advances = await queryRows<any>(
    executor,
    sql`select * from "purchaseOrderAdvances" where "purchaseOrderId"=897 order by id`
  );
  const applications = await queryRows<any>(
    executor,
    sql`select * from "purchaseOrderAdvanceApplications" where "purchaseOrderAdvanceId"=10 or "invoiceId"=1953 order by id`
  );
  const adjustments = await queryRows<any>(
    executor,
    sql`select * from "invoiceDocumentAdjustments" where "invoiceId"=1953 order by id`
  );
  const payments = await queryRows<any>(
    executor,
    sql`select t.*, b."batchNumber", b.status "batchStatus" from "treasuryPaymentItems" t join "treasuryPaymentBatches" b on b.id=t."batchId" where t."purchaseOrderAdvanceId"=10 or t."invoiceId"=1953 order by t.id`
  );
  const notes = await queryRows<any>(
    executor,
    sql`select * from "financialNoteInvoices" where "invoiceId"=1953`
  );
  const quality = await queryRows<any>(
    executor,
    sql`select r.* from "qualityRetentionReleases" r join "invoiceDocumentAdjustments" d on d.id=r."invoiceDocumentAdjustmentId" where d."invoiceId"=1953`
  );
  return {
    order,
    invoices,
    advances,
    applications,
    adjustments,
    payments,
    notes,
    quality,
  };
}
function requireGeo(condition: unknown, message: string): asserts condition {
  if (!condition)
    throw new Error(`GEO: se detuvo la regularización. ${message}`);
}
function same(value: unknown, expected: number) {
  return decimalToMinorUnits(value as string) === decimalToMinorUnits(expected);
}
export async function regularizeGeo(
  executor: any,
  options: { apply?: boolean; actorId?: number; actorLabel?: string } = {}
) {
  await executor.execute(sql`set local lock_timeout = '5s'`);
  await executor.execute(sql`set local statement_timeout = '30s'`);
  await lockAdvanceOrder(executor, 897);
  await executor.execute(
    sql`select id from invoices where "purchaseOrderId"=897 order by id for update`
  );
  const before = await inspectGeo(executor);
  const [event] = await executor
    .select()
    .from(advanceFinancialEvents)
    .where(eq(advanceFinancialEvents.operationKey, GEO_CORRECTION_KEY));
  requireGeo(
    before.order?.orderNumber === "CD-010-00000150" &&
      before.order.supplierId === 749 &&
      before.order.projectId === 18 &&
      before.order.currency === "HNL",
    "La orden ya no coincide con la evidencia."
  );
  requireGeo(
    before.invoices.length === 1 &&
      before.invoices[0].id === 1953 &&
      before.invoices[0].invoiceDocumentNumber === "FT-010-00000306" &&
      before.invoices[0].status === "registrada",
    "Cambió el conjunto o estado de facturas de la orden."
  );
  const invoice = before.invoices[0];
  requireGeo(
    same(invoice.total, 2061372.47) &&
      same(invoice.netPayable, 1442960.73) &&
      same(invoice.otherRetentionTotal, 618411.74) &&
      same(invoice.retentionTotal, 0) &&
      same(invoice.documentDiscountTotal, 0) &&
      same(invoice.creditNoteTotal, 0) &&
      same(invoice.debitNoteTotal, 0),
    "Cambió el cálculo de la factura."
  );
  requireGeo(
    before.advances.length === 1 &&
      before.advances[0].id === 10 &&
      before.advances[0].advanceNumber === "ANT-2026-000010" &&
      !before.advances[0].cancelledAt &&
      same(before.advances[0].requestedAmount, 1163051.75),
    "Cambió el anticipo autorizado."
  );
  requireGeo(
    before.notes.length === 0 && before.quality.length === 0,
    "Existen notas o liberaciones de calidad posteriores."
  );
  const activePayments = before.payments.filter(
    (p: any) => p.status === "contabilizada" || p.activeReservation
  );
  const expected = new Map([
    ["TES-2026-000140", 809456.56],
    ["TES-2026-000392", 223104.8],
    ["TES-2026-000501", 130490.39],
  ]);
  requireGeo(
    activePayments.length === 3 &&
      new Set(activePayments.map((p: any) => p.batchNumber)).size === 3 &&
      activePayments.every(
        (p: any) =>
          p.sourceType === "purchase_order_advance" &&
          p.invoiceId === null &&
          p.status === "contabilizada" &&
          !p.activeReservation &&
          p.batchStatus === "cerrado" &&
          expected.has(p.batchNumber) &&
          same(p.bankPaidAmount, expected.get(p.batchNumber)!)
      ),
    "Cambiaron los tres TES o existen pagos/reservas sobre la factura."
  );
  const amortization = before.adjustments.find(
    (d: any) => d.adjustmentType === "advance_amortization"
  );
  const quality = before.adjustments.find(
    (d: any) => d.adjustmentType === "quality_retention"
  );
  requireGeo(
    before.adjustments.length === 2 &&
      amortization &&
      same(amortization.amount, 515343.12) &&
      quality &&
      same(quality.amount, 103068.62),
    "Cambiaron las deducciones documentales."
  );
  requireGeo(
    before.applications.length === 1 &&
      before.applications[0].purchaseOrderAdvanceId === 10 &&
      before.applications[0].invoiceId === 1953,
    "Cambiaron las aplicaciones del anticipo."
  );
  const application = before.applications[0];
  const result = {
    invoiceAvailable: 1442960.73,
    advanceCovered: 1163051.75,
    advancePendingFunding: 0,
    amortized: 515343.12,
    pendingAmortization: 647708.63,
    qualityRetained: 103068.62,
  };
  if (event) {
    requireGeo(
      before.advances[0].applicationMode === "contractual" &&
        application.applicationMode === "contractual" &&
        same(application.amount, 515343.12) &&
        application.invoiceDocumentAdjustmentId === amortization.id,
      "La regularización registrada ya no coincide con los datos actuales."
    );
    return { changed: false, alreadyApplied: true, before, expected: result };
  }
  requireGeo(
    before.advances[0].applicationMode === "direct" &&
      application.applicationMode === "direct" &&
      same(application.amount, 1163051.75),
    "El tratamiento previo no coincide con la evidencia."
  );
  if (!options.apply)
    return { changed: false, alreadyApplied: false, before, expected: result };
  await executor
    .update(purchaseOrderAdvances)
    .set({
      applicationMode: "contractual",
      amortizationMode: "percentage",
      amortizationValue: "25",
      amortizationBase: "subtotal",
      updatedAt: new Date(),
    })
    .where(eq(purchaseOrderAdvances.id, 10));
  await executor
    .insert(invoiceContractualAmortizations)
    .values({
      invoiceId: 1953,
      purchaseOrderId: 897,
      invoiceDocumentAdjustmentId: amortization.id,
      inputMode: "amount",
      inputValue: "515343.12",
      baseKind: "subtotal",
      baseAmount: invoice.subtotal,
      proposedAmount: "515343.12",
      amount: "515343.12",
      overrideReason: null,
      updatedById: options.actorId ?? null,
    });
  await executor
    .update(purchaseOrderAdvanceApplications)
    .set({
      applicationMode: "contractual",
      amount: "515343.12",
      invoiceDocumentAdjustmentId: amortization.id,
    })
    .where(eq(purchaseOrderAdvanceApplications.id, application.id));
  const after = await inspectGeo(executor);
  requireGeo(
    JSON.stringify(before.payments) === JSON.stringify(after.payments) &&
      JSON.stringify(before.invoices) === JSON.stringify(after.invoices) &&
      JSON.stringify(before.adjustments) === JSON.stringify(after.adjustments),
    "Se alteró información fuera de las aplicaciones autorizadas."
  );
  await executor
    .insert(advanceFinancialEvents)
    .values({
      purchaseOrderId: 897,
      invoiceId: 1953,
      actorId: options.actorId ?? null,
      actorLabel: options.actorLabel ?? "technical:user-authorized",
      action: "regularize_contractual_advance",
      reason:
        "Corrección autorizada: amortización por planilla; TES-000501 corresponde a compensación documentada, sin repetir pagos",
      before,
      after,
      operationKey: GEO_CORRECTION_KEY,
    });
  return {
    changed: true,
    alreadyApplied: false,
    before,
    after,
    expected: result,
  };
}

export async function listAdvanceReconciliationCandidates(
  executor: any,
  afterInvoiceId = 0,
  limit = 100
) {
  return queryRows<any>(
    executor,
    sql`select i.id,i."invoiceDocumentNumber",i."purchaseOrderId",i."supplierId",i."projectId",i.currency,i."netPayable",d.amount "documentAmortization",
    coalesce((select sum(a.amount) from "purchaseOrderAdvanceApplications" a where a."invoiceId"=i.id and a."applicationMode"='direct'),0)::text "directApplication",
    case when c."invoiceId" is null then 'amortizacion_sin_vinculo' else 'aplicacion_requiere_conciliacion' end reason
    from invoices i join "invoiceDocumentAdjustments" d on d."invoiceId"=i.id and d."adjustmentType"='advance_amortization'
    left join "invoiceContractualAmortizations" c on c."invoiceId"=i.id
    where i.id>${afterInvoiceId} and d.amount>0 and (c."invoiceId" is null or c.amount<>d.amount or c."invoiceDocumentAdjustmentId" is distinct from d.id or exists(select 1 from "purchaseOrderAdvanceApplications" a where a."invoiceId"=i.id and a."applicationMode"='direct'))
    order by i.id limit ${Math.max(1, Math.min(limit, 100))}`
  );
}
