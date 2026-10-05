import { invoiceNoteBalanceSql } from "./invoiceMoney";
import { TRPCError } from "@trpc/server";
import { sql, type SQL } from "drizzle-orm";
import { getDb } from "./db";
import { noteRows, type NoteActor } from "./financialNotes";
import { canAccessProject, getProjectScopeIds } from "./projectAccess";
import {
  canReadRetentionDocuments,
  canPrintInvoiceRetention,
  type RetentionSnapshot,
  type RetentionLineSnapshot,
} from "../shared/retention-documents";
import { noteMoneyUnits, sumNoteMoney } from "../shared/financial-notes";
import {
  isValidCai,
  isValidInvoiceNumber,
  isFiscalInvoiceRangeOrdered,
  isInvoiceNumberWithinFiscalRange,
} from "../shared/invoices";
import type { retentionDocuments } from "../drizzle/retention-documents-schema";
import { storageGet } from "./storage";

export type RetentionDocument = typeof retentionDocuments.$inferSelect;
type Executor = { execute: (query: SQL) => Promise<any> };
const fail = (message: string): never => {
  throw new TRPCError({ code: "BAD_REQUEST", message });
};
async function database() {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  return db;
}
export function assertRetentionAccess(user: NoteActor, projectId?: number) {
  if (
    !canReadRetentionDocuments(user) ||
    (projectId !== undefined && !canAccessProject(user, projectId))
  )
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "No tiene acceso a comprobantes de retención",
    });
}
const calendarDate = (v: any): string | null =>
  v == null
    ? null
    : (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10);

export function validateRetentionSnapshot(
  invoice: any,
  lines: RetentionLineSnapshot[],
  options: {
    preserveHistoricalDates?: boolean;
    requireAccounting?: boolean;
  } = {}
) {
  const reviewWarnings: string[] = [];
  const total = noteMoneyUnits(invoice.retentionTotal);
  if (
    total < BigInt(0) ||
    lines.some(l => noteMoneyUnits(l.amount) < BigInt(0))
  )
    fail("La retención no puede ser negativa");
  if (noteMoneyUnits(sumNoteMoney(lines.map(l => l.amount))) !== total)
    fail("La suma de las retenciones no coincide con la factura");
  if (total === BigInt(0)) return reviewWarnings;
  if (!invoice.supplierId || !invoice.supplierRtn)
    fail("La factura con retenciones requiere proveedor y RTN");
  if (
    !isValidInvoiceNumber(invoice.retentionReceiptNumber ?? "") ||
    !isValidCai(invoice.retentionCai ?? "")
  )
    fail(
      "Complete el número fiscal y CAI válidos del comprobante de retención"
    );
  if (
    !isValidInvoiceNumber(invoice.retentionDocumentRangeStart ?? "") ||
    !isValidInvoiceNumber(invoice.retentionDocumentRangeEnd ?? "") ||
    !isFiscalInvoiceRangeOrdered({
      documentRangeStart: invoice.retentionDocumentRangeStart,
      documentRangeEnd: invoice.retentionDocumentRangeEnd,
    }) ||
    !isInvoiceNumberWithinFiscalRange({
      invoiceNumber: invoice.retentionReceiptNumber,
      documentRangeStart: invoice.retentionDocumentRangeStart,
      documentRangeEnd: invoice.retentionDocumentRangeEnd,
    })
  )
    fail("El comprobante de retención debe estar dentro del rango autorizado");
  const date = calendarDate(invoice.retentionDocumentDate);
  const deadline = calendarDate(invoice.retentionEmissionDeadline);
  if (!date || !deadline)
    return fail(
      "Revise las fechas de emisión y límite del comprobante de retención"
    );
  if (date > deadline) {
    if (!options.preserveHistoricalDates)
      fail(
        "Revise las fechas de emisión y límite del comprobante de retención"
      );
    reviewWarnings.push(
      "La fecha de emisión supera el límite autorizado registrado. Se conservaron las fechas originales para revisión contable."
    );
  }
  if (
    options.requireAccounting !== false &&
    (!invoice.accountedAt || !invoice.accountedById)
  )
    fail("Falta el responsable o fecha de contabilización");
  for (const line of lines) {
    if (
      !line.description ||
      line.baseAmount == null ||
      noteMoneyUnits(line.baseAmount) < BigInt(0) ||
      line.percentage == null ||
      noteMoneyUnits(line.percentage) < BigInt(0) ||
      noteMoneyUnits(line.percentage) > BigInt(1000000)
    )
      fail("Cada retención requiere concepto, base y porcentaje válidos");
  }
  return reviewWarnings;
}
async function copyAttachments(
  tx: Executor,
  documentId: number,
  entityType: "invoice" | "financial_note",
  entityId: number
) {
  await tx.execute(sql`insert into "retentionDocumentAttachments" ("documentId","attachmentId","legacyNoteId",snapshot)
    select ${documentId},a.id,${entityType === "financial_note" ? entityId : null}::int,to_jsonb(a)
    from attachments a where a."entityType"=${entityType} and a."entityId"=${entityId}
    on conflict ("documentId","attachmentId") do nothing`);
}
/** Caller owns the invoice transaction and lock. Never adjusts financial balances. */
export async function createInvoiceRetentionDocument(
  tx: Executor,
  invoiceId: number,
  options: {
    preserveHistoricalDates?: boolean;
    printActorId?: number;
    refreshExistingOnly?: boolean;
  } = {}
) {
  const [invoice] = await noteRows(
    tx,
    sql`select i.*,to_char(i."accountedAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') "accountedAtUtc",s.name "supplierName",s.rtn "supplierRtn",coalesce(sc.address,s.address,'') "supplierAddress",p.name "projectName",u.name "actorName"
    from invoices i left join suppliers s on s.id=i."supplierId" join projects p on p.id=i."projectId"
    left join "purchaseOrders" po on po.id=i."purchaseOrderId"
    left join "supplierContacts" sc on sc.id=po."supplierContactId"
    left join users u on u.id=i."accountedById" where i.id=${invoiceId} for update of i`
  );
  if (!invoice) fail("Factura no encontrada");
  const [existing] = await noteRows<RetentionDocument>(
    tx,
    sql`select * from "retentionDocuments" where "invoiceId"=${invoiceId} and status='registrada'`
  );
  if (existing?.snapshot.accountedAt) {
    // Older snapshots did not store the contact address. Enrich the print response only.
    return options.printActorId !== undefined &&
      existing.snapshot.supplierAddress == null
      ? {
          ...existing,
          snapshot: {
            ...existing.snapshot,
            supplierAddress: invoice.supplierAddress,
          },
        }
      : existing;
  }
  if (options.refreshExistingOnly && !existing) return null;
  if (
    invoice.status === "anulada" ||
    noteMoneyUnits(invoice.retentionTotal) === BigInt(0)
  ) {
    if (existing) {
      await tx.execute(
        sql`delete from "retentionDocumentAttachments" where "documentId"=${existing.id}`
      );
      await tx.execute(
        sql`delete from "retentionDocuments" where id=${existing.id} and status='registrada'`
      );
    }
    if (invoice.status === "anulada" && !options.refreshExistingOnly)
      fail("No se puede imprimir la retención de una factura anulada");
    return null;
  }
  const accounted = invoice.status === "registrada";
  if (
    !accounted &&
    options.printActorId === undefined &&
    !options.refreshExistingOnly
  )
    fail("La retención se registra al contabilizar o imprimir la factura");
  if (
    !accounted &&
    !["borrador", "rechazada", "revisada", "pendiente_contabilizar"].includes(
      invoice.status
    )
  )
    fail("La factura no permite imprimir retenciones en este estado");
  const lines = await noteRows<RetentionLineSnapshot>(
    tx,
    sql`select r.*,c."financialGroupCode",g."financialGroupDescription"
    from "invoiceRetentions" r left join "financialNoteConcepts" c on c."retentionCatalogId"=r."retentionCatalogId"
    left join "financialGroups" g on g."financialGroupCode"=c."financialGroupCode"
    where r."invoiceId"=${invoiceId} order by r.id`
  );
  const reviewWarnings = validateRetentionSnapshot(invoice, lines, {
    ...options,
    requireAccounting: accounted,
  });
  const snapshot: RetentionSnapshot = {
    supplierName: invoice.supplierName,
    supplierRtn: invoice.supplierRtn,
    supplierAddress: invoice.supplierAddress,
    projectName: invoice.projectName,
    invoiceDocumentNumber: invoice.invoiceDocumentNumber,
    invoiceNumber: invoice.invoiceNumber,
    cai: invoice.retentionCai,
    documentRangeStart: invoice.retentionDocumentRangeStart,
    documentRangeEnd: invoice.retentionDocumentRangeEnd,
    documentDate: calendarDate(invoice.retentionDocumentDate),
    emissionDeadline: calendarDate(invoice.retentionEmissionDeadline),
    accountedAt: accounted ? invoice.accountedAtUtc : null,
    accountedById: accounted ? invoice.accountedById : null,
    actorName: accounted ? invoice.actorName : null,
    reviewWarnings,
    lines,
    original: {
      invoice,
      invoiceItems: await noteRows(
        tx,
        sql`select * from "invoiceItems" where "invoiceId"=${invoiceId} order by id`
      ),
    },
  };
  const status = "registrada";
  const [document] = existing
    ? await noteRows<RetentionDocument>(
        tx,
        sql`update "retentionDocuments" set status=${status},"projectId"=${invoice.projectId},"supplierId"=${invoice.supplierId},"documentNumber"=${invoice.retentionReceiptNumber},
      currency=${invoice.currency},total=${invoice.retentionTotal},"documentDate"=${snapshot.documentDate}::timestamp,
      snapshot=${JSON.stringify(snapshot)}::jsonb where id=${existing.id} and status='registrada' returning *`
      )
    : await noteRows<RetentionDocument>(
        tx,
        sql`insert into "retentionDocuments"
    ("invoiceId","projectId","supplierId",status,"documentNumber",currency,total,"documentDate","createdById",snapshot)
    values (${invoice.id},${invoice.projectId},${invoice.supplierId},${status},${invoice.retentionReceiptNumber},
      ${invoice.currency},${invoice.retentionTotal},${snapshot.documentDate}::timestamp,${accounted ? invoice.accountedById : options.printActorId},${JSON.stringify(snapshot)}::jsonb) returning *`
      );
  // Supports stay on the source invoice until accounting freezes them.
  if (accounted) await copyAttachments(tx, document.id, "invoice", invoiceId);
  return document;
}

/** Updates an already printed retention within the same transaction as its source correction. */
export async function syncInvoiceRetentionDocument(
  tx: Executor,
  invoiceId: number
) {
  return createInvoiceRetentionDocument(tx, invoiceId, {
    refreshExistingOnly: true,
  });
}

/** Printing is a mutation: materialize the saved invoice once and return that exact snapshot. */
export async function prepareInvoiceRetentionPrint(
  invoiceId: number,
  user: NoteActor
) {
  if (!canPrintInvoiceRetention(user))
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "No tiene permisos para imprimir retenciones",
    });
  const db = await database();
  return db.transaction(async tx => {
    const [invoice] = await noteRows<{ projectId: number; status: string }>(
      tx,
      sql`select "projectId",status from invoices where id=${invoiceId} for update`
    );
    if (!invoice)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Factura no encontrada",
      });
    if (!canAccessProject(user, invoice.projectId))
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "No tiene acceso a facturas de otro proyecto",
      });
    if (invoice.status === "anulada")
      fail("No se puede imprimir la retención de una factura anulada");
    const document = await createInvoiceRetentionDocument(tx, invoiceId, {
      printActorId: user.id,
    });
    return document ?? fail("La factura no tiene retenciones para imprimir");
  });
}

export type RetentionListInput = {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: "registrada" | "historico" | "anulada";
  supplierId?: number;
  projectId?: number;
  invoiceId?: number;
  dateFrom?: string;
  dateTo?: string;
  supplierSearch?: string;
  projectSearch?: string;
  invoiceSearch?: string;
};
export async function listRetentionDocuments(
  input: RetentionListInput,
  user: NoteActor
) {
  assertRetentionAccess(user);
  const db = await database();
  const ids = getProjectScopeIds(user);
  const scope =
    ids === undefined
      ? sql`true`
      : sql`d."projectId" = any(${sql.param(ids)}::int[])`;
  const filter = sql`${scope}
    and (${input.status ?? null}::text is null or d.status=${input.status ?? null})
    and (${input.supplierId ?? null}::int is null or d."supplierId"=${input.supplierId ?? null})
    and (${input.projectId ?? null}::int is null or d."projectId"=${input.projectId ?? null})
    and (${input.invoiceId ?? null}::int is null or d."invoiceId"=${input.invoiceId ?? null})
    and (${input.dateFrom ?? null}::date is null or d."documentDate">=${input.dateFrom ?? null}::date)
    and (${input.dateTo ?? null}::date is null or d."documentDate"<${input.dateTo ?? null}::date + interval '1 day')
    and (coalesce(d."documentNumber",'') ilike ${"%" + (input.search ?? "") + "%"} or exists(select 1 from "retentionDocumentAntecedents" a where a."documentId"=d.id and a.snapshot->'note'->>'documentNumber' ilike ${"%" + (input.search ?? "") + "%"}))
    and d.snapshot->>'supplierName' ilike ${"%" + (input.supplierSearch ?? "") + "%"}
    and d.snapshot->>'projectName' ilike ${"%" + (input.projectSearch ?? "") + "%"}
    and (coalesce(d.snapshot->>'invoiceDocumentNumber','') ilike ${"%" + (input.invoiceSearch ?? "") + "%"} or coalesce(d.snapshot->>'invoiceNumber','') ilike ${"%" + (input.invoiceSearch ?? "") + "%"})`;
  const [{ total }] = await noteRows<{ total: number }>(
    db,
    sql`select count(*)::int total from "retentionDocuments" d where ${filter}`
  );
  const pageSize = Math.min(100, Math.max(10, input.pageSize ?? 25));
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, input.page ?? 1), totalPages);
  const items = await noteRows<
    Omit<RetentionDocument, "snapshot"> & {
      supplierName: string;
      projectName: string;
      invoiceNumber: string;
      invoiceDocumentNumber: string;
      requiresReview: boolean;
    }
  >(
    db,
    sql`select d.id,d."invoiceId",d."legacyNoteId",d."supplierId",d."projectId",d.status,d."documentNumber",d.currency,d.total,d."documentDate",d."createdAt",d."createdById",d."voidedAt",d."voidedById",d."voidReason",d."reversalId",
      d.snapshot->>'supplierName' "supplierName",d.snapshot->>'projectName' "projectName",
      d.snapshot->>'invoiceNumber' "invoiceNumber",d.snapshot->>'invoiceDocumentNumber' "invoiceDocumentNumber",
      jsonb_array_length(coalesce(d.snapshot->'reviewWarnings','[]'::jsonb))>0 "requiresReview"
      from "retentionDocuments" d where ${filter} order by d."documentDate" desc nulls last,d.id desc limit ${pageSize} offset ${(page - 1) * pageSize}`
  );
  // Historical amounts never participate in current totals. Currencies stay separate.
  const totals = await noteRows<{ currency: string; total: string }>(
    db,
    sql`select currency,sum(total)::text total from "retentionDocuments" d where ${filter} and status='registrada' group by currency`
  );
  return { items, page, pageSize, total, totalPages, totals };
}
export async function getRetentionDocument(id: number, user: NoteActor) {
  assertRetentionAccess(user);
  const db = await database();
  const [document] = await noteRows<
    RetentionDocument & { voidedByName: string | null }
  >(
    db,
    sql`select d.*,u.name "voidedByName" from "retentionDocuments" d left join users u on u.id=d."voidedById" where d.id=${id}`
  );
  if (!document)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Comprobante no encontrado",
    });
  assertRetentionAccess(user, document.projectId);
  const [antecedents, attachments] = await Promise.all([
    noteRows<{ noteId: number; snapshot: Record<string, any> }>(
      db,
      sql`select "noteId",snapshot from "retentionDocumentAntecedents" where "documentId"=${id} order by "noteId"`
    ),
    document.status === "registrada" && !document.snapshot.accountedAt
      ? noteRows<{
          attachmentId: number;
          legacyNoteId: number | null;
          snapshot: { fileName: string; fileKey: string };
        }>(
          db,
          sql`select id "attachmentId",null::int "legacyNoteId",to_jsonb(a) snapshot
      from attachments a where "entityType"='invoice' and "entityId"=${document.invoiceId} order by id`
        )
      : noteRows<{
          attachmentId: number;
          legacyNoteId: number | null;
          snapshot: { fileName: string; fileKey: string };
        }>(
          db,
          sql`select "attachmentId","legacyNoteId",snapshot from "retentionDocumentAttachments" where "documentId"=${id} order by id`
        ),
  ]);
  return {
    document,
    antecedents,
    attachments: attachments.map(a => ({
      id: a.attachmentId,
      fileName: a.snapshot.fileName,
      legacyNoteId: a.legacyNoteId,
    })),
  };
}
export async function retentionAttachmentUrl(
  documentId: number,
  attachmentId: number,
  user: NoteActor
) {
  const detail = await getRetentionDocument(documentId, user);
  if (!detail.attachments.some(a => a.id === attachmentId))
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Adjunto no encontrado",
    });
  const db = await database();
  const [link] = await noteRows(
    db,
    sql`select snapshot->>'fileKey' "fileKey" from "retentionDocumentAttachments" where "documentId"=${documentId} and "attachmentId"=${attachmentId}`
  );
  if (
    detail.document.status === "registrada" &&
    !detail.document.snapshot.accountedAt
  ) {
    const [attachment] = await noteRows(
      db,
      sql`select "fileKey" from attachments where id=${attachmentId} and "entityType"='invoice' and "entityId"=${detail.document.invoiceId}`
    );
    if (!attachment)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Adjunto no encontrado",
      });
    return storageGet(attachment.fileKey);
  }
  return storageGet(link.fileKey);
}
export async function resolveLegacyRetention(noteId: number, user: NoteActor) {
  assertRetentionAccess(user);
  const db = await database();
  const [link] = await noteRows<{ documentId: number; projectId: number }>(
    db,
    sql`select a."documentId",d."projectId" from "retentionDocumentAntecedents" a join "retentionDocuments" d on d.id=a."documentId" where a."noteId"=${noteId}`
  );
  if (!link) return null;
  assertRetentionAccess(user, link.projectId);
  return { documentId: link.documentId };
}
/** Prevent storage deletion before database FK/trigger checks. */
export async function assertRetentionAttachmentUnchanged(attachmentId: number) {
  const db = await database();
  const rows = await noteRows(
    db,
    sql`select 1 from "retentionDocumentAttachments" where "attachmentId"=${attachmentId} limit 1`
  );
  if (rows.length)
    fail("El adjunto pertenece a un comprobante cerrado y debe conservarse");
}

/** Run inside a dedicated migration transaction while source tables are locked. */
export async function reclassifyRetentionDocuments(tx: Executor) {
  await tx.execute(
    sql`lock table invoices,"invoiceRetentions","financialNotes","financialNoteLines","financialNoteInvoices","financialNoteEvents",attachments,"treasuryPaymentItems","purchaseOrderAdvanceApplications" in share row exclusive mode`
  );
  const balances = () =>
    noteRows(
      tx,
      sql`select i.id,i.total,i."retentionTotal",i."otherRetentionTotal",i."documentDiscountTotal",i."creditNoteTotal",i."debitNoteTotal",i."netPayable",${invoiceNoteBalanceSql(sql`i.id`, sql`i."netPayable"`)} as "availableBalance" from invoices i order by i.id`
    );
  const before = await balances();
  const current = await noteRows<{ id: number }>(
    tx,
    sql`select id from invoices where status='registrada' and "retentionTotal">0 order by id`
  );
  const issues: { invoiceId: number; message: string }[] = [];
  let created = 0;
  for (const invoice of current) {
    // Collect incomplete invoices; the caller rolls back every insertion if any fail.
    const [existing] = await noteRows(
      tx,
      sql`select id from "retentionDocuments" where "invoiceId"=${invoice.id} and status='registrada' and snapshot->>'accountedAt' is not null`
    );
    if (existing) continue;
    try {
      await createInvoiceRetentionDocument(tx, invoice.id, {
        preserveHistoricalDates: true,
      });
      created++;
    } catch (error) {
      if (!(error instanceof TRPCError)) throw error;
      issues.push({ invoiceId: invoice.id, message: error.message });
    }
  }
  if (issues.length)
    throw new Error(
      "Migración cancelada; facturas incompletas: " + JSON.stringify(issues)
    );
  const legacy = await noteRows(
    tx,
    sql`select n.*,s.name "supplierName",s.rtn "supplierRtn",p.name "projectName",
    i."invoiceDocumentNumber",i."invoiceNumber" from "financialNotes" n join suppliers s on s.id=n."supplierId"
    join projects p on p.id=n."projectId" left join invoices i on i.id=n."sourceInvoiceId"
    where n.origin='retentions' and not exists(select 1 from "retentionDocumentAntecedents" a where a."noteId"=n.id) order by n.id`
  );
  for (const note of legacy) {
    const [lines, events, allocations, files] = [
      await noteRows(
        tx,
        sql`select * from "financialNoteLines" where "noteId"=${note.id} order by id`
      ),
      await noteRows(
        tx,
        sql`select e.*,u.name "actorName" from "financialNoteEvents" e left join users u on u.id=e."actorId" where "noteId"=${note.id} order by e.id`
      ),
      await noteRows(
        tx,
        sql`select * from "financialNoteInvoices" where "noteId"=${note.id} order by id`
      ),
      await noteRows(
        tx,
        sql`select * from attachments where "entityType"='financial_note' and "entityId"=${note.id} order by id`
      ),
    ];
    const original = { note, lines, events, allocations, attachments: files };
    let [doc] = await noteRows<{ id: number }>(
      tx,
      sql`select id from "retentionDocuments" where "invoiceId"=${note.sourceInvoiceId} and status='registrada'`
    );
    if (!doc) {
      const snapshot: RetentionSnapshot = {
        supplierName: note.supplierName,
        supplierRtn: note.supplierRtn,
        projectName: note.projectName,
        invoiceDocumentNumber: note.invoiceDocumentNumber,
        invoiceNumber: note.invoiceNumber,
        cai: note.cai,
        documentRangeStart: note.documentRangeStart,
        documentRangeEnd: note.documentRangeEnd,
        documentDate: calendarDate(note.documentDate),
        emissionDeadline: calendarDate(note.emissionDeadline),
        accountedAt: null,
        accountedById: null,
        actorName: null,
        lines: lines.map(l => ({
          id: l.id,
          description: l.description,
          retentionCode: l.code,
          baseAmount: null,
          percentage: null,
          amount: l.total,
        })),
        original,
      };
      [doc] = await noteRows(
        tx,
        sql`insert into "retentionDocuments" ("invoiceId","legacyNoteId","projectId","supplierId",status,"documentNumber",currency,total,"documentDate","createdById",snapshot)
        values(${note.sourceInvoiceId},${note.id},${note.projectId},${note.supplierId},'historico',${note.fiscalNumber || note.documentNumber},${note.currency},${note.total},${snapshot.documentDate}::timestamp,${note.createdById},${JSON.stringify(snapshot)}::jsonb) returning id`
      );
    }
    await tx.execute(
      sql`insert into "retentionDocumentAntecedents" ("noteId","documentId",snapshot) values(${note.id},${doc.id},${JSON.stringify(original)}::jsonb) on conflict ("noteId") do nothing`
    );
    await copyAttachments(tx, doc.id, "financial_note", note.id);
  }
  const manualNotes = await noteRows(
    tx,
    sql`select distinct n.id,n."documentNumber",n.status,n.total from "financialNotes" n join "financialNoteLines" l on l."noteId"=n.id
    join "financialNoteConcepts" c on c.id=l."conceptId" where n.origin='manual' and c."retentionCatalogId" is not null order by n.id`
  );
  if (JSON.stringify(before) !== JSON.stringify(await balances()))
    throw new Error("Migración cancelada: los saldos cambiaron");
  const reviewInvoices = await noteRows(
    tx,
    sql`select id "documentId","invoiceId",snapshot->>'invoiceDocumentNumber' "invoiceDocumentNumber",snapshot->'reviewWarnings' warnings from "retentionDocuments" where status='registrada' and jsonb_array_length(coalesce(snapshot->'reviewWarnings','[]'::jsonb))>0 order by "invoiceId"`
  );
  return {
    created,
    reviewInvoices,
    archived: legacy.length,
    invoicesCompared: before.length,
    balancesUnchanged: true,
    manualNotes,
  };
}
