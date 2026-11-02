import { sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { attachments, type InsertAttachment } from "../drizzle/schema";
import {
  purchaseOrderBillingAuthorizations,
  purchaseOrderBillingAuthorizationUses,
} from "../drizzle/purchase-order-billing-schema";
import { getPurchaseOrderContractSummary } from "../shared/purchase-orders";
import {
  billingDate,
  billingToday,
  billingMoneyUnits,
  billingMoneyString,
  canAuthorizePurchaseOrderBilling,
  getContractBillingDecision,
  type PurchaseOrderBillingAuthorization,
} from "../shared/purchase-order-billing";
import { canAccessProject, type ProjectScopedUser } from "./projectAccess";

// The caller supplies the active Drizzle transaction. This module never opens
// another connection, so PO locks cover registration, grant and revocation.
export type BillingDatabase = {
  execute: (query: any) => Promise<any>;
  insert: any;
  update: any;
};
export type BillingActor = ProjectScopedUser & { id: number };
const rowsOf = (value: any): any[] =>
  Array.isArray(value) ? value : (value.rows ?? []);
function failure(
  message: string,
  code:
    | "BAD_REQUEST"
    | "FORBIDDEN"
    | "NOT_FOUND"
    | "CONFLICT"
    | "PRECONDITION_FAILED" = "BAD_REQUEST"
): never {
  throw new TRPCError({ code, message });
}

export async function purchaseOrderBillingReady(db: BillingDatabase) {
  const rows = rowsOf(
    await db.execute(
      sql`select to_regclass('public."purchaseOrderBillingAuthorizations"') is not null and to_regclass('public."purchaseOrderBillingAuthorizationUses"') is not null as ready`
    )
  );
  return rows[0]?.ready === true;
}

function asAuthorization(row: any): PurchaseOrderBillingAuthorization {
  const used = billingMoneyUnits(row.usedAmount ?? "0");
  const max = row.maxAmount === null ? null : billingMoneyUnits(row.maxAmount);
  const until = billingDate(row.authorizedUntil)!;
  return {
    id: Number(row.id),
    purchaseOrderId: Number(row.purchaseOrderId),
    authorizedUntil: until,
    originalExpectedInvoiceCount: Number(row.originalExpectedInvoiceCount),
    additionalInvoiceCount: Number(row.additionalInvoiceCount),
    maxInvoiceCount: Number(row.maxInvoiceCount),
    maxAmount: row.maxAmount,
    usedAmount: billingMoneyString(used),
    remainingAmount:
      max === null
        ? null
        : billingMoneyString(max > used ? max - used : BigInt(0)),
    reason: row.reason,
    supportAttachmentId: Number(row.supportAttachmentId),
    supportFileName: row.supportFileName,
    authorizedById: Number(row.authorizedById),
    authorizedByName: row.authorizedByName ?? "Usuario",
    authorizedAt: new Date(row.authorizedAt).toISOString(),
    revokedAt: row.revokedAt ? new Date(row.revokedAt).toISOString() : null,
    revokedById: row.revokedById ? Number(row.revokedById) : null,
    revokeReason: row.revokeReason,
    isUsable: !row.revokedAt && until >= billingToday(),
  };
}

async function authorizationRows(
  db: BillingDatabase,
  ids: number[],
  history = false
) {
  if (!ids.length) return [];
  return rowsOf(
    await db.execute(sql`
    select a.*, s."fileName" as "supportFileName", u.name as "authorizedByName",
      coalesce((select sum(i.total) from "purchaseOrderBillingAuthorizationUses" x
        join invoices i on i.id=x."invoiceId" where x."authorizationId"=a.id and i.status <> 'anulada'),0)::text as "usedAmount"
    from "purchaseOrderBillingAuthorizations" a
    join attachments s on s.id=a."supportAttachmentId"
    join users u on u.id=a."authorizedById"
    where a."purchaseOrderId" in (${sql.join(
      ids.map(id => sql`${id}`),
      sql`,`
    )})
      ${history ? sql`` : sql`and a."revokedAt" is null`}
    order by a.id desc ${history ? sql`limit 50` : sql``}
  `)
  );
}

export async function getPurchaseOrderBillingMap(
  db: BillingDatabase,
  ids: number[]
) {
  if (!ids.length)
    return {
      ready: true,
      authorizations: new Map<number, PurchaseOrderBillingAuthorization>(),
    };
  const ready = await purchaseOrderBillingReady(db);
  const rows = ready ? await authorizationRows(db, ids) : [];
  return {
    ready,
    authorizations: new Map(
      rows.map(row => [Number(row.purchaseOrderId), asAuthorization(row)])
    ),
  };
}

export async function getPurchaseOrderBillingHistory(
  db: BillingDatabase,
  id: number
) {
  const ready = await purchaseOrderBillingReady(db);
  const history = ready
    ? (await authorizationRows(db, [id], true)).map(asAuthorization)
    : [];
  return {
    ready,
    active: history.find(row => !row.revokedAt) ?? null,
    history,
  };
}

export async function lockPurchaseOrderForBilling(
  db: BillingDatabase,
  id: number
) {
  const rows = rowsOf(
    await db.execute(
      sql`select * from "purchaseOrders" where id=${id} for update`
    )
  );
  if (!rows[0]) return failure("Orden de compra no encontrada", "NOT_FOUND");
  return rows[0];
}

export function assertBillingManager(
  actor: BillingActor,
  order: { projectId: number; appliesContract: boolean; status: string }
) {
  if (
    !canAuthorizePurchaseOrderBilling(actor) ||
    !canAccessProject(actor, order.projectId)
  )
    failure(
      "Solo Administración Central puede autorizar facturación adicional de esta OC",
      "FORBIDDEN"
    );
  if (
    !order.appliesContract ||
    !["emitida", "enviada", "parcialmente_recibida", "recibida"].includes(
      order.status
    )
  )
    failure("La autorización requiere una OC contractual emitida");
}

export async function createPurchaseOrderBillingSupportAttachment(
  db: BillingDatabase,
  data: InsertAttachment,
  actor: BillingActor
) {
  if (
    data.entityType !== "purchase_order" ||
    data.category !== "otro" ||
    data.uploadedById !== actor.id
  )
    failure(
      "El respaldo debe pertenecer a esta orden y al usuario autorizado",
      "FORBIDDEN"
    );
  const order = await lockPurchaseOrderForBilling(db, data.entityId);
  assertBillingManager(actor, order);
  const [created] = await db
    .insert(attachments)
    .values(data)
    .returning({ id: attachments.id });
  return created;
}

export async function grantPurchaseOrderBilling(
  db: BillingDatabase,
  actor: BillingActor,
  input: {
    id: number;
    authorizedUntil: string;
    additionalInvoiceCount: number;
    maxAmount?: string | null;
    reason: string;
    supportAttachmentId: number;
  }
) {
  // Authorization precedes resource reads to avoid leaking IDs to disallowed roles.
  if (!canAuthorizePurchaseOrderBilling(actor))
    failure(
      "Solo Administración Central puede autorizar facturación adicional",
      "FORBIDDEN"
    );
  const order = await lockPurchaseOrderForBilling(db, input.id);
  assertBillingManager(actor, order);
  if (!(await purchaseOrderBillingReady(db)))
    failure(
      "La autorización de facturación requiere instalar su migración",
      "PRECONDITION_FAILED"
    );
  const until = billingDate(input.authorizedUntil),
    end = billingDate(order.contractEndDate);
  if (!until || !end || until < end || until < billingToday())
    failure(
      "La fecha autorizada debe ser igual o posterior al vencimiento original y al día actual"
    );
  if (
    !Number.isInteger(input.additionalInvoiceCount) ||
    input.additionalInvoiceCount < 0 ||
    input.additionalInvoiceCount > 600
  )
    failure("Indique entre 0 y 600 facturas adicionales");
  const reason = input.reason.trim();
  if (reason.length < 10 || reason.length > 2000)
    failure("El motivo debe contener entre 10 y 2000 caracteres");
  const maxAmount =
    input.maxAmount == null || input.maxAmount === ""
      ? null
      : billingMoneyString(billingMoneyUnits(input.maxAmount));
  if (maxAmount !== null && billingMoneyUnits(maxAmount) <= BigInt(0))
    failure("El importe autorizado debe ser mayor que cero");
  const support = rowsOf(
    await db.execute(
      sql`select id from attachments where id=${input.supportAttachmentId} and "entityType"='purchase_order' and "entityId"=${input.id} for key share`
    )
  );
  if (!support.length)
    failure("Seleccione un documento de respaldo adjunto a esta OC");
  const current = await getPurchaseOrderBillingHistory(db, input.id);
  if (current.active)
    failure(
      "Ya existe una autorización activa; revóquela antes de crear otra",
      "CONFLICT"
    );
  const summary = getPurchaseOrderContractSummary(order);
  if (!summary.expectedInvoiceCount)
    failure("La OC no tiene una programación contractual válida");
  const count = Number(
    rowsOf(
      await db.execute(
        sql`select count(*)::int as count from invoices where "purchaseOrderId"=${input.id} and status <> 'anulada'`
      )
    )[0].count
  );
  const maxInvoiceCount =
    summary.expectedInvoiceCount + input.additionalInvoiceCount;
  if (maxInvoiceCount <= count)
    failure(
      "El cupo autorizado debe permitir al menos una factura adicional a las ya registradas"
    );
  const [created] = await db
    .insert(purchaseOrderBillingAuthorizations)
    .values({
      purchaseOrderId: input.id,
      authorizedUntil: until,
      originalExpectedInvoiceCount: summary.expectedInvoiceCount,
      additionalInvoiceCount: input.additionalInvoiceCount,
      maxInvoiceCount,
      maxAmount,
      reason,
      supportAttachmentId: input.supportAttachmentId,
      authorizedById: actor.id,
    })
    .returning({ id: purchaseOrderBillingAuthorizations.id });
  return { id: created.id };
}

export async function revokePurchaseOrderBilling(
  db: BillingDatabase,
  actor: BillingActor,
  input: { id: number; authorizationId: number; reason: string }
) {
  if (!canAuthorizePurchaseOrderBilling(actor))
    failure(
      "Solo Administración Central puede revocar una autorización",
      "FORBIDDEN"
    );
  const order = await lockPurchaseOrderForBilling(db, input.id);
  assertBillingManager(actor, order);
  if (!(await purchaseOrderBillingReady(db)))
    failure(
      "La autorización de facturación requiere instalar su migración",
      "PRECONDITION_FAILED"
    );
  const reason = input.reason.trim();
  if (reason.length < 10 || reason.length > 2000)
    failure("El motivo debe contener entre 10 y 2000 caracteres");
  const changed = rowsOf(
    await db.execute(
      sql`update "purchaseOrderBillingAuthorizations" set "revokedAt"=now(), "revokedById"=${actor.id}, "revokeReason"=${reason} where id=${input.authorizationId} and "purchaseOrderId"=${input.id} and "revokedAt" is null returning id`
    )
  );
  if (!changed.length)
    failure(
      "La autorización no está activa o no pertenece a esta OC",
      "CONFLICT"
    );
  return { success: true };
}

export async function recordPurchaseOrderBillingUse(
  db: BillingDatabase,
  params: {
    authorizationId: number;
    purchaseOrderId: number;
    invoiceId: number;
    receiptId: number;
    documentDate: Date | string;
    contractSummary: any;
    contractEndDate: Date | string;
  }
) {
  const map = await getPurchaseOrderBillingMap(db, [params.purchaseOrderId]);
  const auth = map.authorizations.get(params.purchaseOrderId);
  if (!auth || auth.id !== params.authorizationId)
    failure(
      "La autorización cambió; vuelva a intentar la recepción",
      "CONFLICT"
    );
  const invoice = rowsOf(
    await db.execute(
      sql`select total::text as total from invoices where id=${params.invoiceId} and "purchaseOrderId"=${params.purchaseOrderId}`
    )
  )[0];
  if (!invoice)
    failure("No se encontró la factura de esta recepción", "CONFLICT");
  const decision = getContractBillingDecision({
    contractSummary: { ...params.contractSummary, billingAuthorization: auth },
    contractEndDate: params.contractEndDate,
    documentDate: params.documentDate,
    receiptAmount: invoice.total,
  });
  if (!decision.allowed || decision.authorizationId !== auth.id)
    failure(decision.error ?? "La recepción no corresponde a la autorización");
  await db.insert(purchaseOrderBillingAuthorizationUses).values({
    authorizationId: auth.id,
    invoiceId: params.invoiceId,
    receiptId: params.receiptId,
    amount: invoice.total,
    documentDate: billingDate(params.documentDate)!,
  });
}
