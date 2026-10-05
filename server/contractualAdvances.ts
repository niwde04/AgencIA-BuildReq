import { and, asc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import {
  advanceFinancialEvents,
  invoiceContractualAmortizations,
  invoiceDocumentAdjustments,
  invoices,
  purchaseOrderAdvances,
  purchaseOrders,
} from "../drizzle/schema";
import {
  contractualAmortizationAmount,
  legacyManualRemainingAmount,
  proposeContractualAmortization,
  type ContractualAdvanceRule,
  type AmortizationMode,
  type AdvanceAmortizationTreatment,
} from "../shared/contractual-advances";
import { decimalToMinorUnits, roundDecimalAmount } from "../shared/money";
import type { InvoiceDocumentAdjustmentInput } from "../shared/invoice-document-adjustments";

export const contractualAdvancesEnabled = () =>
  process.env.CONTRACTUAL_ADVANCES_ENABLED !== "false";
// Readers/consumption remain compatible even when new historical captures are paused.
export const legacyManualAdvancesEnabled = () =>
  process.env.LEGACY_MANUAL_ADVANCES_ENABLED !== "false";
export async function queryRows<T>(executor: any, query: SQL): Promise<T[]> {
  const result = await executor.execute(query);
  return result.rows ?? result;
}

/** Order -> advances -> invoices is the common lock order for amortization writes. */
export async function lockAdvanceOrder(executor: any, orderId: number) {
  await executor
    .select({ id: purchaseOrders.id })
    .from(purchaseOrders)
    .where(eq(purchaseOrders.id, orderId))
    .for("update");
  await executor
    .select({ id: purchaseOrderAdvances.id })
    .from(purchaseOrderAdvances)
    .where(eq(purchaseOrderAdvances.purchaseOrderId, orderId))
    .orderBy(asc(purchaseOrderAdvances.id))
    .for("update");
}
export async function lockInvoiceAdvanceOrder(
  executor: any,
  invoiceId: number
) {
  const [invoice] = await executor
    .select({ purchaseOrderId: invoices.purchaseOrderId })
    .from(invoices)
    .where(eq(invoices.id, invoiceId));
  if (invoice) await lockAdvanceOrder(executor, invoice.purchaseOrderId);
}

export async function getContractualInvoiceContext(
  executor: any,
  invoiceId: number
) {
  const [invoice] = await executor
    .select()
    .from(invoices)
    .where(eq(invoices.id, invoiceId));
  if (!invoice) return null;
  const advances = await executor
    .select()
    .from(purchaseOrderAdvances)
    .where(
      and(
        eq(purchaseOrderAdvances.purchaseOrderId, invoice.purchaseOrderId),
        isNull(purchaseOrderAdvances.cancelledAt)
      )
    )
    .orderBy(asc(purchaseOrderAdvances.id));
  const contractual = advances.filter(
    (a: any) =>
      a.applicationMode === "contractual" ||
      a.applicationMode === "legacy_manual"
  );
  if (!contractual.length) return null;
  const first = contractual[0];
  const treatment = first.applicationMode as AdvanceAmortizationTreatment;
  const manual = treatment === "legacy_manual";
  if (
    contractual.length !== advances.length ||
    advances.some(
      (a: any) =>
        a.applicationMode !== treatment ||
        a.supplierId !== invoice.supplierId ||
        a.projectId !== invoice.projectId ||
        a.currency !== invoice.currency ||
        a.amortizationMode !== first.amortizationMode ||
        a.amortizationBase !== first.amortizationBase ||
        Number(a.amortizationValue) !== Number(first.amortizationValue)
    )
  ) {
    throw new Error(
      "Los anticipos de esta orden requieren conciliación: sus condiciones u origen no coinciden."
    );
  }
  const [totals] = await queryRows<{
    committed: string;
    covered: string;
    applied: string;
    ownApplied: string;
    unconsumedCommitments: string;
  }>(
    executor,
    sql`
    select coalesce((select sum(c.amount) from "invoiceContractualAmortizations" c join invoices i on i.id=c."invoiceId"
      where c."purchaseOrderId"=${invoice.purchaseOrderId} and c."invoiceId"<>${invoiceId} and i.status in ('revisada','pendiente_contabilizar','registrada')),0)::text committed,
    coalesce((select sum(round(t."bankPaidAmount",2)) from "treasuryPaymentItems" t join "purchaseOrderAdvances" a on a.id=t."purchaseOrderAdvanceId"
      where a."purchaseOrderId"=${invoice.purchaseOrderId} and a."cancelledAt" is null and t."sourceType"='purchase_order_advance' and t.status='contabilizada'),0)::text covered,
    coalesce((select sum(p.amount) from "purchaseOrderAdvanceApplications" p join "purchaseOrderAdvances" a on a.id=p."purchaseOrderAdvanceId"
      where a."purchaseOrderId"=${invoice.purchaseOrderId} and a."cancelledAt" is null),0)::text applied,
    coalesce((select sum(p.amount) from "purchaseOrderAdvanceApplications" p
      where p."invoiceId"=${invoiceId} and p."applicationMode"=${treatment}),0)::text "ownApplied",
    coalesce((select sum(greatest(0, c.amount-coalesce((select sum(p.amount) from "purchaseOrderAdvanceApplications" p where p."invoiceId"=c."invoiceId"),0)))
      from "invoiceContractualAmortizations" c join invoices i on i.id=c."invoiceId"
      where c."purchaseOrderId"=${invoice.purchaseOrderId} and c."invoiceId"<>${invoiceId}
      and i.status in ('revisada','pendiente_contabilizar','registrada')),0)::text "unconsumedCommitments"`
  );
  const requestedAmount =
    advances.reduce(
      (n: number, a: any) => n + decimalToMinorUnits(a.requestedAmount),
      0
    ) / 100;
  const remainingAmount = manual
    ? legacyManualRemainingAmount(totals)
    : Math.max(
        0,
        (decimalToMinorUnits(requestedAmount) -
          decimalToMinorUnits(totals.committed)) /
          100
      );
  const rule: ContractualAdvanceRule = {
    amortizationMode: first.amortizationMode ?? "amount",
    amortizationValue: first.amortizationValue ?? 0,
    amortizationBase: manual ? "subtotal" : first.amortizationBase,
  };
  const proposal = proposeContractualAmortization({
    ...rule,
    subtotal: invoice.subtotal,
    total: invoice.total,
    remainingAmount,
  });
  const [saved] = await executor
    .select()
    .from(invoiceContractualAmortizations)
    .where(eq(invoiceContractualAmortizations.invoiceId, invoiceId));
  return {
    treatment,
    ...rule,
    amortizationMode: manual ? null : rule.amortizationMode,
    amortizationValue: manual ? null : rule.amortizationValue,
    ...proposal,
    purchaseOrderId: invoice.purchaseOrderId,
    requestedAmount,
    coveredAmount: Number(totals.covered),
    pendingFundingAmount: Math.max(
      0,
      roundDecimalAmount(requestedAmount - Number(totals.covered), 2)
    ),
    pendingAmortizationAmount: Math.max(
      0,
      roundDecimalAmount(Number(totals.covered) - Number(totals.applied), 2)
    ),
    saved: saved ?? null,
    enabled: manual
      ? legacyManualAdvancesEnabled()
      : contractualAdvancesEnabled(),
  };
}

export async function prepareContractualAmortization(
  executor: any,
  invoiceId: number,
  input: InvoiceDocumentAdjustmentInput
) {
  const context = await getContractualInvoiceContext(executor, invoiceId);
  if (!context) {
    if (
      Number(
        input.advanceAmortizationAmount ?? input.advanceAmortizationPercent ?? 0
      ) > 0
    )
      throw new Error(
        "Para amortizar un anticipo debe registrar o conciliar primero un anticipo contractual vinculado a esta orden."
      );
    return null;
  }
  if (!context.enabled)
    throw new Error(
      "La captura de amortizaciones está temporalmente deshabilitada."
    );
  const hasAmount =
    input.advanceAmortizationAmount !== undefined &&
    input.advanceAmortizationAmount !== null &&
    String(input.advanceAmortizationAmount).trim() !== "";
  const hasPercent =
    input.advanceAmortizationPercent !== undefined &&
    input.advanceAmortizationPercent !== null &&
    String(input.advanceAmortizationPercent).trim() !== "";
  const inputMode: AmortizationMode =
    hasAmount || !hasPercent ? "amount" : "percentage";
  const inputValue = hasAmount
    ? Number(input.advanceAmortizationAmount)
    : hasPercent
      ? Number(input.advanceAmortizationPercent)
      : context.amount;
  const amount = contractualAmortizationAmount({
    baseAmount: context.baseAmount,
    inputMode,
    inputValue,
    remainingAmount: context.remainingAmount,
    proposedAmount: context.amount,
    overrideReason: input.advanceAmortizationOverrideReason,
    requireOverrideReason: context.treatment !== "legacy_manual",
  });
  return {
    context,
    snapshot: {
      invoiceId,
      purchaseOrderId: context.purchaseOrderId,
      treatment: context.treatment,
      inputMode,
      inputValue: String(inputValue),
      baseKind: context.amortizationBase,
      baseAmount: String(context.baseAmount),
      proposedAmount: context.amount.toFixed(2),
      amount: amount.toFixed(2),
      overrideReason:
        context.treatment === "legacy_manual"
          ? null
          : input.advanceAmortizationOverrideReason?.trim() || null,
    },
  };
}

export async function saveContractualSnapshot(
  executor: any,
  prepared: NonNullable<
    Awaited<ReturnType<typeof prepareContractualAmortization>>
  >,
  adjustmentId: number | null,
  actorId?: number
) {
  const values = {
    ...prepared.snapshot,
    invoiceDocumentAdjustmentId: adjustmentId,
    updatedById: actorId ?? null,
    updatedAt: new Date(),
  };
  await executor
    .insert(invoiceContractualAmortizations)
    .values(values)
    .onConflictDoUpdate({
      target: invoiceContractualAmortizations.invoiceId,
      set: values,
    });
  await executor.insert(advanceFinancialEvents).values({
    purchaseOrderId: values.purchaseOrderId,
    invoiceId: values.invoiceId,
    actorId: actorId ?? null,
    actorLabel: actorId ? `user:${actorId}` : "system",
    action: "save_amortization",
    reason:
      values.overrideReason ||
      (values.treatment === "legacy_manual"
        ? "Captura manual de amortización de anticipo histórico"
        : "Amortización conforme a la regla contractual"),
    before: prepared.context.saved,
    after: values,
  });
}

export async function assertContractualInvoiceReady(
  executor: any,
  invoiceId: number
) {
  const context = await getContractualInvoiceContext(executor, invoiceId);
  if (!context) {
    const [unlinked] = await executor
      .select({ id: invoiceDocumentAdjustments.id })
      .from(invoiceDocumentAdjustments)
      .where(
        and(
          eq(invoiceDocumentAdjustments.invoiceId, invoiceId),
          eq(invoiceDocumentAdjustments.adjustmentType, "advance_amortization")
        )
      );
    if (unlinked)
      throw new Error(
        "La factura tiene una amortización sin anticipo contractual conciliado."
      );
    return;
  }
  const saved = context.saved;
  // Historical capture is optional; a missing snapshot only permits a genuine zero.
  if (!saved && context.treatment === "legacy_manual") {
    const rows = await queryRows<{ count: number }>(
      executor,
      sql`
      select count(*)::int count from "invoiceDocumentAdjustments"
      where "invoiceId"=${invoiceId} and "adjustmentType"='advance_amortization' and amount>0`
    );
    if (!rows[0].count) return;
  }
  if (
    !saved ||
    saved.treatment !== context.treatment ||
    saved.purchaseOrderId !== context.purchaseOrderId ||
    Number(saved.baseAmount) !== context.baseAmount ||
    saved.baseKind !== context.amortizationBase ||
    decimalToMinorUnits(saved.amount) >
      decimalToMinorUnits(context.remainingAmount)
  ) {
    throw new Error(
      "Actualice y guarde la amortización antes de contabilizar: la base o el saldo disponible cambió."
    );
  }
  if (Number(saved.amount) > 0) {
    const [adjustment] = await executor
      .select()
      .from(invoiceDocumentAdjustments)
      .where(
        eq(
          invoiceDocumentAdjustments.id,
          saved.invoiceDocumentAdjustmentId ?? 0
        )
      );
    if (
      !adjustment ||
      adjustment.invoiceId !== invoiceId ||
      adjustment.adjustmentType !== "advance_amortization" ||
      decimalToMinorUnits(adjustment.amount) !==
        decimalToMinorUnits(saved.amount)
    )
      throw new Error(
        "La amortización documental no coincide con su control contractual."
      );
  }
}

/** Bounded diagnosis reused by Treasury; never guesses a historical treatment. */
export async function getInvoiceAdvanceReconciliationMap(
  executor: any,
  invoiceIds: number[]
) {
  const result = new Map<number, string>();
  if (!invoiceIds.length) return result;
  const ids = sql.join(
    Array.from(new Set(invoiceIds)).map(id => sql`${id}`),
    sql`, `
  );
  const rows = await queryRows<{ invoiceId: number }>(
    executor,
    sql`
    select distinct d."invoiceId" from "invoiceDocumentAdjustments" d
    left join "invoiceContractualAmortizations" c on c."invoiceId"=d."invoiceId"
    where d."invoiceId" in (${ids}) and d."adjustmentType"='advance_amortization' and d.amount>0
    and (c."invoiceId" is null or c."invoiceDocumentAdjustmentId" is distinct from d.id or c.amount<>d.amount
      or exists(select 1 from "purchaseOrderAdvanceApplications" p where p."invoiceId"=d."invoiceId" and p."applicationMode"='direct'))`
  );
  for (const row of rows)
    result.set(
      row.invoiceId,
      "La amortización del anticipo requiere conciliación antes de generar un nuevo borrador."
    );
  return result;
}

export async function getInvoiceContractualAmortizationMap(
  executor: any,
  invoiceIds: number[]
) {
  const result = new Map<number, number>();
  if (!invoiceIds.length) return result;
  const rows = await executor
    .select({
      invoiceId: invoiceContractualAmortizations.invoiceId,
      amount: invoiceContractualAmortizations.amount,
    })
    .from(invoiceContractualAmortizations)
    .where(inArray(invoiceContractualAmortizations.invoiceId, invoiceIds));
  for (const row of rows)
    result.set(row.invoiceId, roundDecimalAmount(row.amount, 2));
  return result;
}
