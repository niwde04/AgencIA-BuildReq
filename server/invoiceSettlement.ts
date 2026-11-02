import { sql } from "drizzle-orm";
import { queryRows } from "./contractualAdvances";
import {
  assertInvoiceSettlementOriginals,
  calculateInvoiceSettlement,
  DOCUMENT_CENTS_POLICY,
  type InvoiceSettlement,
} from "../shared/invoice-settlement";

export const INVOICE_SETTLEMENT_ACTIVATION_KEY =
  "invoice-document-cents-v1-20261029";

export async function getInvoiceSettlementMap(
  executor: any,
  invoiceIds: number[]
) {
  const ids = Array.from(new Set(invoiceIds));
  const result = new Map<number, InvoiceSettlement>();
  if (!ids.length) return result;
  const rows = await queryRows<any>(
    executor,
    sql`
    select i.id,i.total,i."retentionTotal",i."otherRetentionTotal",i."documentDiscountTotal",
      i."creditNoteTotal",i."debitNoteTotal",i."netPayable",coalesce(p.version,'legacy') as policy
    from invoices i left join "invoiceSettlementPolicies" p on p."invoiceId"=i.id
    where i.id in (${sql.join(
      ids.map(id => sql`${id}`),
      sql`, `
    )})`
  );
  for (const row of rows) result.set(row.id, calculateInvoiceSettlement(row));
  return result;
}

/** Called inside the existing receipt/invoice transaction; no browser input selects the policy. */
export async function enrollNewInvoiceSettlement(
  executor: any,
  invoiceId: number,
  actorId?: number
) {
  const [settings] = await queryRows<any>(
    executor,
    sql`select enabled,version from "invoiceSettlementSettings" where id=1 for share`
  );
  if (!settings?.enabled || settings.version !== DOCUMENT_CENTS_POLICY)
    return false;
  const [invoice] = await queryRows<any>(
    executor,
    sql`select * from invoices where id=${invoiceId}`
  );
  if (!invoice || invoice.status !== "borrador")
    throw new Error(
      "La política automática requiere una factura nueva en borrador."
    );
  assertInvoiceSettlementOriginals(invoice);
  const rows = await queryRows<any>(
    executor,
    sql`
    insert into "invoiceSettlementPolicies"("invoiceId",version,source,"activatedById","operationKey")
    values(${invoiceId},${DOCUMENT_CENTS_POLICY},'new_invoice',${actorId ?? null},null)
    on conflict("invoiceId") do nothing returning "invoiceId"`
  );
  return rows.length === 1;
}

const historySql = sql`(
  exists(select 1 from "treasuryPaymentItems" t where t."invoiceId"=i.id)
  or exists(select 1 from "purchaseOrderAdvanceApplications" a where a."invoiceId"=i.id)
)`;

export async function inspectInvoiceSettlementActivation(executor: any) {
  const settings = await queryRows<any>(
    executor,
    sql`select * from "invoiceSettlementSettings" where id=1`
  );
  const existingPolicies = await queryRows<any>(
    executor,
    sql`select * from "invoiceSettlementPolicies" order by "invoiceId"`
  );
  const rows = await queryRows<any>(
    executor,
    sql`
    select i.id,i."invoiceDocumentNumber",i."purchaseOrderId",i."supplierId",i."projectId",i.currency,i.status,
      i.total,i."retentionTotal",i."otherRetentionTotal",i."documentDiscountTotal",i."creditNoteTotal",i."debitNoteTotal",i."netPayable",
      ${historySql} as "hasHistory",
      exists(select 1 from "financialNoteInvoices" n where n."invoiceId"=i.id) as "hasNotes",
      exists(select 1 from "financialNotes" n where n."sourceInvoiceId"=i.id and n.origin<>'retentions' and n.status<>'anulada' and n."deletedAt" is null) as "hasSourceNotes",
      exists(select 1 from "qualityRetentionReleases" q join "invoiceDocumentAdjustments" d on d.id=q."invoiceDocumentAdjustmentId" where d."invoiceId"=i.id) as "hasQualityReleases"
    from invoices i left join "invoiceSettlementPolicies" p on p."invoiceId"=i.id
    where i.status<>'anulada' and p."invoiceId" is null order by i.id`
  );
  const eligibleInvoices: any[] = [],
    protectedInvoices: any[] = [];
  for (const row of rows) {
    let invalidOriginals = false;
    try {
      assertInvoiceSettlementOriginals(row);
    } catch {
      invalidOriginals = true;
    }
    if (
      row.hasHistory ||
      row.hasNotes ||
      row.hasSourceNotes ||
      row.hasQualityReleases ||
      invalidOriginals
    )
      protectedInvoices.push({ ...row, invalidOriginals });
    else
      eligibleInvoices.push({
        ...row,
        ...calculateInvoiceSettlement({
          ...row,
          policy: DOCUMENT_CENTS_POLICY,
        }),
      });
  }
  return {
    settings: settings[0] ?? null,
    eligibleInvoices,
    protectedInvoices,
    existingPolicies,
  };
}
export type InvoiceSettlementActivationPreview = Awaited<
  ReturnType<typeof inspectInvoiceSettlementActivation>
>;

function canonical(value: any): any {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map(k => [k, canonical(value[k])])
    );
  return value;
}
function same(a: unknown, b: unknown) {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}
function summary(before: InvoiceSettlementActivationPreview) {
  const byCurrency: Record<
    string,
    { invoices: number; changed: number; differenceCents: number }
  > = {};
  for (const row of before.eligibleInvoices) {
    const item = (byCurrency[row.currency] ??= {
      invoices: 0,
      changed: 0,
      differenceCents: 0,
    });
    item.invoices++;
    if (row.difference !== 0) item.changed++;
    item.differenceCents += Math.round(row.difference * 100);
  }
  return {
    enrolledCount: before.eligibleInvoices.length,
    changedAmountCount: before.eligibleInvoices.filter(i => i.difference !== 0)
      .length,
    excludedHistoryCount: before.protectedInvoices.length,
    byCurrency,
  };
}

/** Maintenance only. No arbitrary invoice IDs, money or policy values are accepted from a browser. */
export async function activateInvoiceSettlementPolicies(
  executor: any,
  options: {
    apply?: boolean;
    actorId?: number;
    beforeApply?: (before: InvoiceSettlementActivationPreview) => Promise<void>;
  } = {}
) {
  await executor.execute(sql`set local lock_timeout='5s'`);
  await executor.execute(sql`set local statement_timeout='60s'`);
  const [prior] = await queryRows<any>(
    executor,
    sql`select * from "invoiceSettlementActivations" where "operationKey"=${INVOICE_SETTLEMENT_ACTIVATION_KEY}`
  );
  if (prior) {
    const [settings] = await queryRows<any>(
      executor,
      sql`select * from "invoiceSettlementSettings" where id=1`
    );
    if (!settings?.enabled || settings.version !== DOCUMENT_CENTS_POLICY)
      throw new Error(
        "Existe auditoría de activación con configuración distinta; requiere revisión."
      );
    return {
      changed: false,
      alreadyApplied: true,
      operationKey: INVOICE_SETTLEMENT_ACTIVATION_KEY,
      before: await inspectInvoiceSettlementActivation(executor),
      summary: prior.after.summary,
    };
  }
  // Common writer lock order: orders -> advances -> invoices -> settings.
  const initial = await inspectInvoiceSettlementActivation(executor);
  const ids = initial.eligibleInvoices.map(i => i.id),
    orderIds = Array.from(
      new Set(initial.eligibleInvoices.map(i => i.purchaseOrderId))
    );
  if (orderIds.length) {
    const orders = sql.join(
      orderIds.map(id => sql`${id}`),
      sql`, `
    );
    await executor.execute(
      sql`select id from "purchaseOrders" where id in (${orders}) order by id for update`
    );
    await executor.execute(
      sql`select id from "purchaseOrderAdvances" where "purchaseOrderId" in (${orders}) order by id for update`
    );
  }
  if (ids.length)
    await executor.execute(
      sql`select id from invoices where id in (${sql.join(
        ids.map(id => sql`${id}`),
        sql`, `
      )}) order by id for update`
    );
  await executor.execute(
    sql`select id from "invoiceSettlementSettings" where id=1 for update`
  );
  // Another activation may have committed while this transaction waited.
  const [concurrent] = await queryRows<any>(
    executor,
    sql`select * from "invoiceSettlementActivations" where "operationKey"=${INVOICE_SETTLEMENT_ACTIVATION_KEY}`
  );
  if (concurrent) {
    const [settings] = await queryRows<any>(
      executor,
      sql`select * from "invoiceSettlementSettings" where id=1`
    );
    if (!settings?.enabled || settings.version !== DOCUMENT_CENTS_POLICY)
      throw new Error(
        "Existe auditoría de activación con configuración distinta; requiere revisión."
      );
    return {
      changed: false,
      alreadyApplied: true,
      operationKey: INVOICE_SETTLEMENT_ACTIVATION_KEY,
      before: await inspectInvoiceSettlementActivation(executor),
      summary: concurrent.after.summary,
    };
  }
  const before = await inspectInvoiceSettlementActivation(executor);
  if (!same(initial.eligibleInvoices, before.eligibleInvoices))
    throw new Error(
      "Cambió el conjunto de facturas durante la activación; vuelva a ejecutar el diagnóstico."
    );
  if (
    before.settings?.version !== DOCUMENT_CENTS_POLICY ||
    before.settings.enabled
  )
    throw new Error("Configuración de liquidación inesperada.");
  const expected = summary(before);
  if (!options.apply)
    return {
      changed: false,
      alreadyApplied: false,
      operationKey: INVOICE_SETTLEMENT_ACTIVATION_KEY,
      before,
      summary: expected,
    };
  if (options.actorId !== 1 || typeof options.beforeApply !== "function")
    throw new Error(
      "La activación requiere administrador autorizado y respaldo durable."
    );
  const actors = await queryRows<any>(
    executor,
    sql`select id from users where id=1 and email='ed_barah@hotmail.com' and role='admin' and "isActive"=true for share`
  );
  if (actors.length !== 1)
    throw new Error("El administrador autorizado no está activo.");
  await options.beforeApply(before);
  if (!same(before, await inspectInvoiceSettlementActivation(executor)))
    throw new Error("El estado cambió durante el respaldo de activación.");
  await executor.execute(
    sql`update "invoiceSettlementSettings" set enabled=true,"activatedAt"=now(),"activatedById"=${options.actorId} where id=1 and enabled=false`
  );
  if (ids.length)
    await executor.execute(sql`
    insert into "invoiceSettlementPolicies"("invoiceId",version,source,"activatedById","operationKey")
    select i.id,${DOCUMENT_CENTS_POLICY},'unpaid_batch',${options.actorId},${INVOICE_SETTLEMENT_ACTIVATION_KEY}
    from invoices i where i.id in (${sql.join(
      ids.map(id => sql`${id}`),
      sql`, `
    )})`);
  const after = await inspectInvoiceSettlementActivation(executor);
  const created = after.existingPolicies.filter(
    p => p.operationKey === INVOICE_SETTLEMENT_ACTIVATION_KEY
  );
  if (created.length !== ids.length)
    throw new Error("No se habilitó exactamente el conjunto respaldado.");
  if (!same(before.protectedInvoices, after.protectedInvoices))
    throw new Error("Se modificó una factura con historial protegido.");
  await executor.execute(sql`insert into "invoiceSettlementActivations"("operationKey","actorId",before,after)
    values(${INVOICE_SETTLEMENT_ACTIVATION_KEY},${options.actorId},${JSON.stringify(before)}::jsonb,${JSON.stringify({ summary: expected, settings: after.settings, policies: created })}::jsonb)`);
  return {
    changed: true,
    alreadyApplied: false,
    operationKey: INVOICE_SETTLEMENT_ACTIVATION_KEY,
    before,
    after,
    summary: expected,
  };
}
