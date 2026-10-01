import { canReadRetentionDocuments } from "../shared/retention-documents";
import { invoiceNoteBalanceSql } from "./invoiceMoney";
import { TRPCError } from "@trpc/server";
import { sql, type SQL } from "drizzle-orm";
import { getDb } from "./db";
import {
  canAccessProject,
  getProjectScopeIds,
  type ProjectScopedUser,
} from "./projectAccess";
import {
  financialNotes,
  financialNoteConcepts,
  financialNoteLines,
} from "../drizzle/financial-notes-schema";
import {
  assertNoteAllocationTotals,
  canAccountFinancialNotes,
  canPrepareFinancialNotes,
  canReadFinancialNotes,
  noteMoneyString,
  noteMoneyUnits,
  sumNoteMoney,
  type FinancialNoteType,
  type NoteDraftInput,
  type NoteFiscalInput,
} from "../shared/financial-notes";
import {
  isValidCai,
  isValidInvoiceNumber,
  isFiscalInvoiceRangeOrdered,
  isInvoiceNumberWithinFiscalRange,
  formatCaiInput,
  formatInvoiceNumberInput,
} from "../shared/invoices";
import { calculatePurchaseOrderLineAmounts } from "../shared/purchase-orders";

type Executor = { execute: (query: SQL) => Promise<any> };
export type NoteActor = ProjectScopedUser & { id: number };
export type FinancialNote = typeof financialNotes.$inferSelect;
export type NoteConcept = typeof financialNoteConcepts.$inferSelect & {
  financialGroupDescription?: string | null;
};
export type NoteLine = typeof financialNoteLines.$inferSelect;
type InvoiceRow = {
  id: number;
  supplierId: number;
  projectId: number;
  currency: string;
  status: string;
  createdAt: Date;
  invoiceDocumentNumber: string;
  netPayable: string;
  retentionTotal: string;
};
function bad(message: string): never {
  throw new TRPCError({ code: "BAD_REQUEST", message });
}
export async function noteRows<T = any>(
  executor: Executor,
  query: SQL
): Promise<T[]> {
  const result = await executor.execute(query);
  // PostgreSQL date columns are calendar dates, not instants.
  for (const row of result.rows)
    for (const key of ["documentDate", "documentDueDate", "emissionDeadline"]) {
      const value = row[key];
      if (value instanceof Date)
        row[key] = [
          value.getFullYear(),
          String(value.getMonth() + 1).padStart(2, "0"),
          String(value.getDate()).padStart(2, "0"),
        ].join("-");
    }
  return result.rows as T[];
}
async function database() {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  return db;
}
function scope(user: NoteActor, column: SQL) {
  const ids = getProjectScopeIds(user);
  return ids === undefined
    ? sql`true`
    : sql`${column} = any(${sql.param(ids)}::int[])`;
}
export function assertFinancialNoteAccess(
  note: Pick<FinancialNote, "projectId" | "status"> & { origin?: string },
  user: NoteActor,
  action: "view" | "prepare" | "account" = "view"
) {
  if (note.origin === "retentions") {
    if (action !== "view") bad("Este antecedente está cerrado; consúltelo en Retenciones");
    if (!canReadRetentionDocuments(user)) throw new TRPCError({ code: "FORBIDDEN", message: "No tiene acceso a retenciones" });
  }
  const allowed =
    action === "prepare"
      ? canPrepareFinancialNotes(user)
      : action === "account"
        ? canAccountFinancialNotes(user)
        : canReadFinancialNotes(user);
  if (!allowed || !canAccessProject(user, note.projectId))
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "No tiene permisos para esta nota o su proyecto",
    });
  if (
    action === "view" &&
    ["revisada", "registrada"].includes(note.status) &&
    !canPrepareFinancialNotes(user) &&
    !canAccountFinancialNotes(user)
  )
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "No tiene acceso a notas en revisión o contabilizadas",
    });
}
async function enabled(tx: Executor) {
  const [settings] = await noteRows(
    tx,
    sql`select "enabled", "activatedAt" from "financialNoteSettings" where id = 1`
  );
  if (!settings?.enabled)
    bad("Las nuevas operaciones de notas están deshabilitadas");
  return settings;
}
async function event(
  tx: Executor,
  noteId: number,
  actorId: number,
  action: string,
  comment?: string
) {
  await tx.execute(
    sql`insert into "financialNoteEvents" ("noteId","actorId",action,comment) values (${noteId},${actorId},${action},${comment || null})`
  );
}

export async function listNoteConcepts(input: {
  type: FinancialNoteType;
  search?: string;
  isActive?: boolean;
  page?: number;
  pageSize?: number;
}) {
  const db = await database();
  const pageSize = input.pageSize ?? 25;
  const filter = sql`c."retentionCatalogId" is null and c.type = ${input.type} and (${input.isActive ?? null}::boolean is null or c."isActive" = ${input.isActive ?? null}) and (c.code ilike ${`%${input.search ?? ""}%`} or c.description ilike ${`%${input.search ?? ""}%`})`;
  const [{ total }] = await noteRows(
    db,
    sql`select count(*)::int total from "financialNoteConcepts" c where ${filter}`
  );
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(input.page ?? 1, totalPages);
  const items = await noteRows<NoteConcept>(
    db,
    sql`select c.*, g."financialGroupDescription" from "financialNoteConcepts" c left join "financialGroups" g on g."financialGroupCode" = c."financialGroupCode" where ${filter} order by c.code, c.id limit ${pageSize} offset ${(page - 1) * pageSize}`
  );
  return { items, total: total as number, page, pageSize, totalPages };
}
export type ConceptInput = {
  type: FinancialNoteType;
  code: string;
  description: string;
  applicability: string;
  financialGroupCode?: string | null;
  isActive: boolean;
  allowsTaxOnly: boolean;
};
export async function saveNoteConcept(input: ConceptInput, id?: number) {
  const db = await database();
  return db.transaction(async tx => {
    if (input.financialGroupCode) {
      const [group] = await noteRows(
        tx,
        sql`select 1 from "financialGroups" where "financialGroupCode" = ${input.financialGroupCode} and "isActive"`
      );
      if (!group) bad("Seleccione un grupo financiero activo");
    }
    if (id) {
      const [existing] = await noteRows<NoteConcept>(
        tx,
        sql`select * from "financialNoteConcepts" where id = ${id} for update`
      );
      if (!existing || existing.type !== input.type)
        bad("Concepto no encontrado");
      if (
        existing.retentionCatalogId &&
        (input.code !== existing.code || input.allowsTaxOnly)
      )
        bad(
          "El código de este concepto se administra desde su retención de origen"
        );
      const [updated] = await noteRows<NoteConcept>(
        tx,
        sql`update "financialNoteConcepts" set code = ${input.code}, description = ${input.description}, applicability = ${input.applicability}, "financialGroupCode" = ${input.financialGroupCode || null}, "isActive" = ${input.isActive}, "allowsTaxOnly" = ${input.allowsTaxOnly}, "updatedAt" = now() where id = ${id} returning *`
      );
      return updated;
    }
    const [created] = await noteRows<NoteConcept>(
      tx,
      sql`insert into "financialNoteConcepts" (type,code,description,applicability,"financialGroupCode","isActive","allowsTaxOnly") values (${input.type},${input.code},${input.description},${input.applicability},${input.financialGroupCode || null},${input.isActive},${input.allowsTaxOnly}) returning *`
    );
    return created;
  });
}
export async function removeNoteConcept(id: number) {
  const db = await database();
  return db.transaction(async tx => {
    const [concept] = await noteRows<NoteConcept>(
      tx,
      sql`select * from "financialNoteConcepts" where id = ${id} for update`
    );
    if (!concept) bad("Concepto no encontrado");
    const [used] = await noteRows(
      tx,
      sql`select 1 from "financialNoteLines" where "conceptId" = ${id} limit 1`
    );
    if (used)
      await tx.execute(
        sql`update "financialNoteConcepts" set "isActive" = false, "updatedAt" = now() where id = ${id}`
      );
    else
      await tx.execute(
        sql`delete from "financialNoteConcepts" where id = ${id}`
      );
    return { deactivated: !!used };
  });
}
export async function syncRetentionConcept(
  tx: Executor,
  retentionId: number,
  financialGroupCode?: string | null
) {
  if (financialGroupCode) {
    const [group] = await noteRows(
      tx,
      sql`select 1 from "financialGroups" g
          where g."financialGroupCode" = ${financialGroupCode}
            and (g."isActive" or exists (
              select 1 from "financialNoteConcepts" c
              where c."retentionCatalogId" = ${retentionId}
                and c."financialGroupCode" = g."financialGroupCode"
            ))
          for share of g`
    );
    if (!group) bad("Seleccione un grupo financiero activo");
  }
  // Omitted fields preserve existing assignments, including older API clients
  // and automatic invoice synchronization. Explicit null clears the assignment.
  await tx.execute(
    sql`insert into "financialNoteConcepts" (type,code,description,applicability,"retentionCatalogId","isActive","financialGroupCode")
        select 'credit','NC-' || "taxCode",description,coalesce(note,''),id,"isActive",${financialGroupCode ?? null}
        from "taxRetentions" where id = ${retentionId}
        on conflict ("retentionCatalogId") do update set
          code = excluded.code,
          "financialGroupCode" = case when ${financialGroupCode !== undefined}
            then excluded."financialGroupCode" else "financialNoteConcepts"."financialGroupCode" end,
          "updatedAt" = now()`
  );
}

async function allocateNumber(
  tx: Executor,
  projectId: number,
  type: FinancialNoteType
) {
  const [project] = await noteRows(
    tx,
    sql`select code from projects where id = ${projectId}`
  );
  if (!project?.code?.trim())
    bad("El proyecto no tiene código para el consecutivo");
  const prefix = type === "credit" ? "NC" : "ND";
  await tx.execute(sql`insert into "financialNoteSequences" ("projectId",type,"lastValue") select ${projectId},${type},coalesce(max(value),0) from (
    select substring("documentNumber" from '-([0-9]{8})$')::int value from "financialNotes" where "projectId" = ${projectId} and type = ${type}
    union all select substring("sapDocumentNumber" from '-([0-9]{8})$')::int from "reverseLogistics" where "sourceProjectId" = ${projectId} and ${type} = 'credit' and "sapDocumentNumber" like 'NC-%'
  ) historic on conflict ("projectId",type) do nothing`);
  for (;;) {
    const [sequence] = await noteRows(
      tx,
      sql`update "financialNoteSequences" set "lastValue" = "lastValue" + 1 where "projectId" = ${projectId} and type = ${type} and "lastValue" < 99999999 returning "lastValue"`
    );
    if (!sequence) bad("El proyecto agotó el consecutivo de notas");
    const number = `${prefix}-${project.code.trim()}-${String(sequence.lastValue).padStart(8, "0")}`;
    const [taken] = await noteRows(
      tx,
      sql`select 1 from "financialNotes" where "documentNumber" = ${number} union all select 1 from "reverseLogistics" where "sapDocumentNumber" = ${number} limit 1`
    );
    if (!taken) return number;
  }
}

export async function getFinancialNote(id: number, user: NoteActor) {
  const db = await database();
  const [note] = await noteRows<
    FinancialNote & {
      supplierName: string;
      supplierRtn: string;
      projectName: string;
      sourceReturnNumber: string | null;
    }
  >(
    db,
    sql`select n.*, s.name "supplierName", s.rtn "supplierRtn", p.name "projectName", r."returnNumber" "sourceReturnNumber" from "financialNotes" n join suppliers s on s.id=n."supplierId" join projects p on p.id=n."projectId" left join "reverseLogistics" r on r.id=n."sourceReturnId" where n.id=${id} and (n."deletedAt" is null or n.origin='retentions')`
  );
  if (!note)
    throw new TRPCError({ code: "NOT_FOUND", message: "Nota no encontrada" });
  assertFinancialNoteAccess(note, user);
  const [lines, allocations, events] = await Promise.all([
    noteRows<NoteLine>(
      db,
      sql`select l.*,c."allowsTaxOnly",c."retentionCatalogId" from "financialNoteLines" l join "financialNoteConcepts" c on c.id=l."conceptId" where l."noteId"=${id} order by l.id`
    ),
    noteRows<{
      invoiceId: number;
      amount: string;
      invoiceDocumentNumber: string;
      invoiceNumber: string;
      netPayable: string;
      status: string;
    }>(
      db,
      sql`select a."invoiceId",a.amount,i."invoiceDocumentNumber",i."invoiceNumber",i."netPayable",i.status from "financialNoteInvoices" a join invoices i on i.id=a."invoiceId" where a."noteId"=${id} order by a.id`
    ),
    noteRows<{
      id: number;
      action: string;
      comment: string | null;
      createdAt: Date;
      actorName: string;
    }>(
      db,
      sql`select e.*,u.name "actorName" from "financialNoteEvents" e join users u on u.id=e."actorId" where e."noteId"=${id} order by e.id`
    ),
  ]);
  const balances = await noteRows<{ invoiceId: number; available: string }>(
    db,
    sql`select i.id "invoiceId", ${invoiceNoteBalanceSql(sql`i.id`, sql`i."netPayable"`)}::numeric(14,4)::text available
      from invoices i where i.id=any(${sql.param(allocations.map(a => a.invoiceId))}::int[])`
  );
  const retentionDocumentId = note.origin === "retentions"
    ? (await (await import("./retentionDocuments")).resolveLegacyRetention(note.id, user))?.documentId ?? null
    : null;
  return {
    retentionDocumentId,
    note,
    lines,
    allocations: allocations.map(a => ({
      ...a,
      available:
        balances.find(b => b.invoiceId === a.invoiceId)?.available ?? "0.0000",
    })),
    events,
  };
}

export async function listFinancialNotes(
  input: {
    type: FinancialNoteType;
    page?: number;
    pageSize?: number;
    search?: string;
    status?: string;
    origin?: string;
    projectId?: number;
    supplierId?: number;
    invoiceId?: number;
    dateFrom?: string;
    dateTo?: string;
  },
  user: NoteActor
) {
  if (!canReadFinancialNotes(user))
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "No tiene acceso a notas",
    });
  const db = await database();
  const pageSize = input.pageSize ?? 25;
  const restricted =
    !canPrepareFinancialNotes(user) && !canAccountFinancialNotes(user);
  const filter = sql`n.origin <> 'retentions' and n.type=${input.type} and n."deletedAt" is null and ${scope(user, sql`n."projectId"`)}
    and (${input.projectId ?? null}::int is null or n."projectId"=${input.projectId ?? null})
    and (${input.supplierId ?? null}::int is null or n."supplierId"=${input.supplierId ?? null})
    and (${input.status ?? null}::text is null or n.status=${input.status ?? null})
    and (${input.origin ?? null}::text is null or n.origin=${input.origin ?? null})
    and (${!restricted} or n.status not in ('revisada','registrada'))
    and (${input.invoiceId ?? null}::int is null or exists(select 1 from "financialNoteInvoices" a where a."noteId"=n.id and a."invoiceId"=${input.invoiceId ?? null}))
    and (${input.dateFrom ?? null}::date is null or n."createdAt">=${input.dateFrom ?? null}::date)
    and (${input.dateTo ?? null}::date is null or n."createdAt"<${input.dateTo ?? null}::date + interval '1 day')
    and (n."documentNumber" ilike ${`%${input.search ?? ""}%`} or n."fiscalNumber" ilike ${`%${input.search ?? ""}%`} or s.name ilike ${`%${input.search ?? ""}%`})`;
  const [{ total }] = await noteRows(
    db,
    sql`select count(*)::int total from "financialNotes" n join suppliers s on s.id=n."supplierId" where ${filter}`
  );
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(input.page ?? 1, totalPages);
  const items = await noteRows<
    FinancialNote & { supplierName: string; projectName: string }
  >(
    db,
    sql`select n.id,n.type,n.origin,n."documentNumber",n."fiscalNumber",n.status,n."projectId",n."supplierId",n.currency,n.total,n."createdAt",s.name "supplierName",p.name "projectName" from "financialNotes" n join suppliers s on s.id=n."supplierId" join projects p on p.id=n."projectId" where ${filter} order by n."createdAt" desc,n.id desc limit ${pageSize} offset ${(page - 1) * pageSize}`
  );
  return { items, total: total as number, page, pageSize, totalPages };
}

// Payments already accounted and active bank reservations are disjoint here.
export async function invoiceNoteAvailable(tx: Executor, invoiceId: number) {
  const [row] = await noteRows<{ available: string }>(
    tx,
    sql`select ${invoiceNoteBalanceSql(sql`i.id`, sql`i."netPayable"`)}::numeric(14,4)::text available from invoices i where i.id=${invoiceId}`
  );
  return row?.available ?? "0.0000";
}
export async function eligibleNoteInvoices(
  input: {
    type: FinancialNoteType;
    search?: string;
    projectId?: number;
    supplierId?: number;
    currency?: string;
    page?: number;
    pageSize?: number;
  },
  user: NoteActor
) {
  if (!canPrepareFinancialNotes(user))
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "No tiene permisos para preparar notas",
    });
  const db = await database();
  const pageSize = input.pageSize ?? 25;
  const page = input.page ?? 1;
  const filter = sql`i.status='registrada' and i."supplierId" is not null and ${scope(user, sql`i."projectId"`)}
    and (${input.projectId ?? null}::int is null or i."projectId"=${input.projectId ?? null}) and (${input.supplierId ?? null}::int is null or i."supplierId"=${input.supplierId ?? null})
    and (${input.currency ?? null}::text is null or i.currency=${input.currency ?? null})
    and (i."invoiceDocumentNumber" ilike ${`%${input.search ?? ""}%`} or i."invoiceNumber" ilike ${`%${input.search ?? ""}%`} or s.name ilike ${`%${input.search ?? ""}%`})`;
  // Aggregate only the bounded candidates; no query per invoice.
  const items = await noteRows<{
    id: number;
    invoiceDocumentNumber: string;
    invoiceNumber: string;
    supplierId: number;
    projectId: number;
    currency: string;
    supplierName: string;
    projectName: string;
    available: string;
  }>(
    db,
    sql`with candidates as (select i.id,i."invoiceDocumentNumber",i."invoiceNumber",i."supplierId",i."projectId",i.currency,i."netPayable",s.name "supplierName",p.name "projectName" from invoices i join suppliers s on s.id=i."supplierId" join projects p on p.id=i."projectId" where ${filter} order by i.id desc limit ${pageSize} offset ${(page - 1) * pageSize}) select c.*, ${invoiceNoteBalanceSql(sql`c.id`, sql`c."netPayable"`)}::numeric(14,4)::text available from candidates c order by c.id desc`
  );
  const [{ total }] = await noteRows(
    db,
    sql`select count(*)::int total from invoices i join suppliers s on s.id=i."supplierId" where ${filter}`
  );
  return {
    items,
    total: total as number,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

async function lockInvoices(tx: Executor, ids: number[]) {
  return noteRows<InvoiceRow>(
    tx,
    sql`select id,"supplierId","projectId",currency,status,"createdAt","invoiceDocumentNumber","netPayable","retentionTotal" from invoices where id=any(${sql.param(Array.from(new Set(ids)).sort((a, b) => a - b))}::int[]) order by id for update`
  );
}
function validateInvoices(
  rows: InvoiceRow[],
  ids: number[],
  user?: NoteActor,
  allowDraft = false
) {
  if (!rows.length || rows.length !== new Set(ids).size)
    bad("Una de las facturas no existe");
  const first = rows[0];
  for (const row of rows) {
    if (user && !canAccessProject(user, row.projectId))
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "No tiene acceso al proyecto de una factura",
      });
    if (
      !row.supplierId ||
      row.supplierId !== first.supplierId ||
      row.projectId !== first.projectId ||
      row.currency !== first.currency
    )
      bad("Las facturas deben ser del mismo proveedor, proyecto y moneda");
    if (
      row.status === "anulada" ||
      (!allowDraft && row.status !== "registrada")
    )
      bad("Seleccione facturas contabilizadas y vigentes");
  }
  return first;
}

async function saveFiscal(tx: Executor, id: number, input: NoteFiscalInput) {
  const cai = input.cai ? formatCaiInput(input.cai) : null;
  const number = input.fiscalNumber
    ? formatInvoiceNumberInput(input.fiscalNumber)
    : null;
  const start = input.documentRangeStart
    ? formatInvoiceNumberInput(input.documentRangeStart)
    : null;
  const end = input.documentRangeEnd
    ? formatInvoiceNumberInput(input.documentRangeEnd)
    : null;
  if (cai && !isValidCai(cai)) bad("El CAI no tiene un formato válido");
  for (const value of [number, start, end])
    if (value && !isValidInvoiceNumber(value))
      bad("El número fiscal o rango no tiene un formato válido");
  await tx.execute(
    sql`update "financialNotes" set cai=${cai},"fiscalNumber"=${number},"documentRangeStart"=${start},"documentRangeEnd"=${end},"documentDate"=${input.documentDate || null}::date,"documentDueDate"=${input.documentDueDate || null}::date,"emissionDeadline"=${input.emissionDeadline || null}::date,notes=${input.notes || null},"updatedAt"=now() where id=${id}`
  );
}
export function assertNoteFiscalReady(
  note: Pick<
    FinancialNote,
    | "cai"
    | "fiscalNumber"
    | "documentRangeStart"
    | "documentRangeEnd"
    | "documentDate"
    | "documentDueDate"
    | "emissionDeadline"
  >
) {
  if (
    !note.cai ||
    !isValidCai(note.cai) ||
    !note.fiscalNumber ||
    !isValidInvoiceNumber(note.fiscalNumber) ||
    !note.documentRangeStart ||
    !isValidInvoiceNumber(note.documentRangeStart) ||
    !note.documentRangeEnd ||
    !isValidInvoiceNumber(note.documentRangeEnd)
  )
    bad("Complete el CAI, número fiscal y rango autorizado de la nota");
  if (
    !isFiscalInvoiceRangeOrdered(note) ||
    !isInvoiceNumberWithinFiscalRange({
      ...note,
      invoiceNumber: note.fiscalNumber,
    })
  )
    bad("El número fiscal debe estar dentro de un rango autorizado válido");
  if (!note.documentDate || !note.documentDueDate || !note.emissionDeadline)
    bad("Complete las fechas de emisión, vencimiento y límite de emisión");
  if (note.documentDate > note.emissionDeadline)
    bad("La fecha de emisión supera el límite autorizado");
  if (note.documentDueDate < note.documentDate)
    bad("El vencimiento no puede ser anterior a la emisión");
}

async function prepareLines(
  tx: Executor,
  type: FinancialNoteType,
  lines: NoteDraftInput["lines"],
  previous: NoteLine[] = []
) {
  const concepts = await noteRows<NoteConcept>(
    tx,
    sql`select c.*,g."financialGroupDescription" from "financialNoteConcepts" c left join "financialGroups" g on g."financialGroupCode"=c."financialGroupCode" where c.id=any(${sql.param(lines.map(l => l.conceptId))}::int[]) for share of c`
  );
  const taxCodes = lines.flatMap(l => (l.taxCode ? [l.taxCode] : []));
  const taxes = await noteRows(
    tx,
    sql`select * from "salesTaxes" where "taxCode"=any(${sql.param(taxCodes)}::text[]) and "isActive"`
  );
  const availableSnapshots = [...previous];
  return lines.map(line => {
    const unchanged = availableSnapshots.findIndex(
      saved =>
        saved.conceptId === line.conceptId &&
        noteMoneyUnits(saved.baseAmount) === noteMoneyUnits(line.baseAmount) &&
        (saved.taxCode || null) === (line.taxCode || null) &&
        noteMoneyUnits(saved.taxAmount) === noteMoneyUnits(line.taxAmount)
    );
    if (unchanged >= 0) {
      const saved = availableSnapshots.splice(unchanged, 1)[0];
      return { ...saved, notes: line.notes || null };
    }
    const concept = concepts.find(c => c.id === line.conceptId);
    if (!concept || concept.type !== type || !concept.isActive)
      bad("Seleccione un concepto activo del tipo de nota correspondiente");
    if (concept.retentionCatalogId) bad("Los conceptos de retención se utilizan desde Facturas");
    const tax = taxes.find(t => t.taxCode === line.taxCode);
    if (line.taxCode && !tax) bad("Seleccione un impuesto activo");
    if (
      concept.retentionCatalogId &&
      noteMoneyUnits(line.taxAmount) !== BigInt(0)
    )
      bad("Los conceptos de retención no admiten ISV adicional");
    if (noteMoneyUnits(line.baseAmount) === BigInt(0) && !concept.allowsTaxOnly)
      bad("Solo los conceptos de corrección de impuesto admiten base cero");
    if (!concept.allowsTaxOnly) {
      const calculated = calculatePurchaseOrderLineAmounts({
        quantity: 1,
        unitPrice: Number(line.baseAmount),
        taxCode: line.taxCode ?? undefined,
        taxes: taxes,
      });
      const expected = tax
        ? noteMoneyUnits(calculated.taxAmount.toFixed(4))
        : BigInt(0);
      if (noteMoneyUnits(line.taxAmount) !== expected)
        bad("El ISV no coincide con la base y el impuesto seleccionado");
    }
    return {
      conceptId: concept.id,
      code: concept.code,
      description: concept.description,
      financialGroupCode: concept.financialGroupCode,
      financialGroupDescription: concept.financialGroupDescription ?? null,
      baseAmount: noteMoneyString(noteMoneyUnits(line.baseAmount)),
      taxCode: line.taxCode || null,
      taxSnapshot: tax ?? null,
      taxAmount: noteMoneyString(noteMoneyUnits(line.taxAmount)),
      total: sumNoteMoney([line.baseAmount, line.taxAmount]),
      notes: line.notes || null,
    };
  });
}
async function replaceLines(
  tx: Executor,
  id: number,
  lines: Array<Omit<NoteLine, "id" | "noteId">>
) {
  await tx.execute(sql`delete from "financialNoteLines" where "noteId"=${id}`);
  if (lines.length)
    await tx.execute(
      sql`insert into "financialNoteLines" ("noteId","conceptId",code,description,"financialGroupCode","financialGroupDescription","baseAmount","taxCode","taxSnapshot","taxAmount",total,notes) values ${sql.join(
        lines.map(
          l =>
            sql`(${id},${l.conceptId},${l.code},${l.description},${l.financialGroupCode},${l.financialGroupDescription},${l.baseAmount},${l.taxCode},${JSON.stringify(l.taxSnapshot)}::jsonb,${l.taxAmount},${l.total},${l.notes})`
        ),
        sql`,`
      )}`
    );
  await tx.execute(
    sql`update "financialNotes" set subtotal=${sumNoteMoney(lines.map(l => l.baseAmount))},"taxAmount"=${sumNoteMoney(lines.map(l => l.taxAmount))},total=${sumNoteMoney(lines.map(l => l.total))},"updatedAt"=now() where id=${id}`
  );
}
async function replaceAllocations(
  tx: Executor,
  id: number,
  allocations: NoteDraftInput["allocations"]
) {
  await tx.execute(
    sql`delete from "financialNoteInvoices" where "noteId"=${id}`
  );
  if (allocations.length)
    await tx.execute(
      sql`insert into "financialNoteInvoices" ("noteId","invoiceId",amount) values ${sql.join(
        allocations.map(a => sql`(${id},${a.invoiceId},${a.amount})`),
        sql`,`
      )}`
    );
}

export async function createFinancialNote(
  input: NoteDraftInput & { requestKey: string },
  user: NoteActor
) {
  if (!canPrepareFinancialNotes(user))
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "No tiene permisos para crear notas",
    });
  assertNoteAllocationTotals(input.type, input.lines, input.allocations);
  const db = await database();
  return db.transaction(async tx => {
    await enabled(tx);
    const key = `${user.id}:${input.requestKey}`;
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`financial-note-request:${key}`},0))`
    );
    const [existing] = await noteRows<FinancialNote>(
      tx,
      sql`select * from "financialNotes" where "requestKey"=${key}`
    );
    if (existing) {
      assertFinancialNoteAccess(existing, user, "prepare");
      return { id: existing.id, documentNumber: existing.documentNumber };
    }
    const invoiceRows = await lockInvoices(
      tx,
      input.allocations.map(a => a.invoiceId)
    );
    const first = validateInvoices(
      invoiceRows,
      input.allocations.map(a => a.invoiceId),
      user
    );
    const lines = await prepareLines(tx, input.type, input.lines);
    if (input.type === "credit")
      for (const allocation of input.allocations)
        await assertAvailable(tx, allocation.invoiceId, allocation.amount);
    const number = await allocateNumber(tx, first.projectId, input.type);
    const [note] = await noteRows<FinancialNote>(
      tx,
      sql`insert into "financialNotes" (type,origin,"documentNumber","requestKey","projectId","supplierId",currency,"createdById") values (${input.type},'manual',${number},${key},${first.projectId},${first.supplierId},${first.currency},${user.id}) returning *`
    );
    await saveFiscal(tx, note.id, input);
    await replaceLines(tx, note.id, lines);
    await replaceAllocations(tx, note.id, input.allocations);
    await event(tx, note.id, user.id, "creada");
    return { id: note.id, documentNumber: number };
  });
}
async function assertAvailable(
  tx: Executor,
  invoiceId: number,
  amount: string
) {
  const available = await invoiceNoteAvailable(tx, invoiceId);
  if (
    Number(available) < 0 ||
    noteMoneyUnits(amount) > noteMoneyUnits(available)
  )
    bad(`El crédito supera el saldo disponible de la factura (${available})`);
}

/** Invoice locks always precede note locks, including automatic invoice hooks. */
async function lockNote(
  tx: Executor,
  id: number,
  user: NoteActor,
  additionalInvoiceIds: number[] = []
) {
  const initial = await noteRows<{ invoiceId: number }>(
    tx,
    sql`select "invoiceId" from "financialNoteInvoices" where "noteId"=${id}`
  );
  const lockedIds = Array.from(
    new Set([...initial.map(a => a.invoiceId), ...additionalInvoiceIds])
  );
  const invoices = await lockInvoices(tx, lockedIds);
  const [note] = await noteRows<FinancialNote>(
    tx,
    sql`select * from "financialNotes" where id=${id} and "deletedAt" is null for update`
  );
  if (!note)
    throw new TRPCError({ code: "NOT_FOUND", message: "Nota no encontrada" });
  assertFinancialNoteAccess(note, user);
  const allocations = await noteRows<{ invoiceId: number; amount: string }>(
    tx,
    sql`select "invoiceId",amount from "financialNoteInvoices" where "noteId"=${id} order by "invoiceId"`
  );
  if (allocations.some(a => !lockedIds.includes(a.invoiceId)))
    throw new TRPCError({
      code: "CONFLICT",
      message: "La nota cambió; actualice e intente nuevamente",
    });
  return { note, allocations, invoices };
}
export async function updateFinancialNote(
  id: number,
  input: NoteDraftInput,
  user: NoteActor
) {
  const db = await database();
  return db.transaction(async tx => {
    await enabled(tx);
    const { note } = await lockNote(
      tx,
      id,
      user,
      input.allocations.map(a => a.invoiceId)
    );
    assertFinancialNoteAccess(note, user, "prepare");
    if (!["borrador", "rechazada"].includes(note.status))
      bad("Solo se editan borradores o notas rechazadas");
    if (input.type !== note.type) bad("No puede cambiar el tipo de la nota");
    if (note.origin === "retentions") {
      const existingLines = await noteRows<NoteLine>(
        tx,
        sql`select * from "financialNoteLines" where "noteId"=${id} order by id`
      );
      const existingAllocations = await noteRows<{
        invoiceId: number;
        amount: string;
      }>(
        tx,
        sql`select "invoiceId",amount from "financialNoteInvoices" where "noteId"=${id} order by id`
      );
      const normalized = (
        ls: Array<{
          conceptId: number;
          baseAmount: string;
          taxCode?: string | null;
          taxAmount: string;
        }>
      ) =>
        JSON.stringify(
          ls.map(l => [
            l.conceptId,
            noteMoneyString(noteMoneyUnits(l.baseAmount)),
            l.taxCode || null,
            noteMoneyString(noteMoneyUnits(l.taxAmount)),
          ])
        );
      if (
        normalized(input.lines) !== normalized(existingLines) ||
        JSON.stringify(
          input.allocations.map(a => [
            a.invoiceId,
            noteMoneyString(noteMoneyUnits(a.amount)),
          ])
        ) !==
          JSON.stringify(
            existingAllocations.map(a => [
              a.invoiceId,
              noteMoneyString(noteMoneyUnits(a.amount)),
            ])
          )
      )
        bad(
          "Los conceptos y montos de retenciones se modifican desde la factura"
        );
    } else {
      assertNoteAllocationTotals(input.type, input.lines, input.allocations);
      const rows = await lockInvoices(
        tx,
        input.allocations.map(a => a.invoiceId)
      );
      const first = validateInvoices(
        rows,
        input.allocations.map(a => a.invoiceId),
        user,
        note.origin === "supplier_return"
      );
      if (
        first.projectId !== note.projectId ||
        first.supplierId !== note.supplierId ||
        first.currency !== note.currency
      )
        bad(
          "No puede cambiar proveedor, proyecto o moneda de una nota existente"
        );
      if (
        note.origin === "supplier_return" &&
        (input.allocations.length !== 1 ||
          input.allocations[0].invoiceId !== note.sourceInvoiceId)
      )
        bad("La devolución debe conservar su factura de origen");
      if (note.origin === "manual" && note.type === "credit")
        for (const allocation of input.allocations)
          await assertAvailable(tx, allocation.invoiceId, allocation.amount);
      const previous = await noteRows<NoteLine>(
        tx,
        sql`select * from "financialNoteLines" where "noteId"=${id} order by id`
      );
      const lines = await prepareLines(tx, note.type, input.lines, previous);
      await replaceLines(tx, id, lines);
      await replaceAllocations(tx, id, input.allocations);
    }
    await saveFiscal(tx, id, input);
    await event(tx, id, user.id, "editada");
    return { id };
  });
}

export async function recalculateInvoiceNotes(
  tx: Executor,
  invoiceIds: number[]
) {
  for (const id of Array.from(new Set(invoiceIds)).sort((a, b) => a - b)) {
    await tx.execute(
      sql`with totals as (select coalesce(sum(a.amount) filter(where n.type='credit' and n.origin<>'retentions'),0) credit,coalesce(sum(a.amount) filter(where n.type='debit'),0) debit from "financialNoteInvoices" a join "financialNotes" n on n.id=a."noteId" where a."invoiceId"=${id} and n.status='registrada' and n."deletedAt" is null) update invoices i set "creditNoteTotal"=t.credit,"debitNoteTotal"=t.debit,"netPayable"=i.total-i."retentionTotal"-i."otherRetentionTotal"-i."documentDiscountTotal"-t.credit+t.debit,"updatedAt"=now() from totals t where i.id=${id}`
    );
  }
}
export async function transitionFinancialNote(
  id: number,
  action: "review" | "account" | "reject" | "void" | "remove",
  comment: string | undefined,
  user: NoteActor
) {
  const db = await database();
  return db.transaction(async tx => {
    if (action !== "void" && action !== "remove") await enabled(tx);
    const { note, allocations, invoices } = await lockNote(tx, id, user);
    assertFinancialNoteAccess(
      note,
      user,
      ["account", "reject", "void"].includes(action) ? "account" : "prepare"
    );
    if (action === "review" || action === "account") {
      if (
        action === "review" &&
        !["borrador", "rechazada"].includes(note.status)
      )
        bad("Solo se envían borradores o notas rechazadas");
      if (action === "account" && note.status !== "revisada")
        bad("Solo se contabilizan notas en revisión");
      const first = validateInvoices(
        invoices,
        allocations.map(a => a.invoiceId),
        user
      );
      if (
        first.projectId !== note.projectId ||
        first.supplierId !== note.supplierId ||
        first.currency !== note.currency
      )
        bad(
          "La factura cambió de proveedor, proyecto o moneda; corrija la nota antes de continuar"
        );
      assertNoteFiscalReady(note);
      const lines = await noteRows<NoteLine>(
        tx,
        sql`select * from "financialNoteLines" where "noteId"=${id}`
      );
      assertNoteAllocationTotals(note.type, lines, allocations);
      const [attached] = await noteRows(
        tx,
        sql`select 1 from attachments where "entityType"='financial_note' and "entityId"=${id} limit 1`
      );
      if (!attached)
        bad("Adjunte al menos un archivo antes de enviar la nota a revisión");
      if (note.type === "credit" && note.origin !== "retentions")
        for (const a of allocations)
          await assertAvailable(tx, a.invoiceId, a.amount);
    }
    if (action === "reject" && note.status !== "revisada")
      bad("Solo se rechazan notas en revisión");
    if (
      (action === "reject" || action === "void") &&
      (!comment || comment.trim().length < 5)
    )
      bad("Ingrese un motivo de al menos cinco caracteres");
    if (action === "void" && note.status === "anulada") return { id };
    if (
      action === "remove" &&
      (!["borrador", "rechazada"].includes(note.status) ||
        note.origin !== "manual")
    )
      bad("Solo puede eliminar borradores manuales o rechazados");
    const next =
      action === "review"
        ? "revisada"
        : action === "account"
          ? "registrada"
          : action === "reject"
            ? "rechazada"
            : action === "void"
              ? "anulada"
              : note.status;
    await tx.execute(
      sql`update "financialNotes" set status=${next},"updatedAt"=now(),"deletedAt"=${action === "remove" ? new Date() : null} where id=${id}`
    );
    if (
      action === "account" ||
      (action === "void" && note.status === "registrada")
    ) {
      await recalculateInvoiceNotes(
        tx,
        allocations.map(a => a.invoiceId)
      );
      // Cancelling a debit cannot invalidate money already committed or paid.
      for (const a of allocations)
        if (Number(await invoiceNoteAvailable(tx, a.invoiceId)) < 0)
          bad(
            "La operación dejaría un saldo menor que los pagos, anticipos o reservas existentes"
          );
    }
    await event(
      tx,
      id,
      user.id,
      action === "remove" ? "eliminada" : next,
      comment
    );
    return { id };
  });
}

export async function lookupNoteFiscalRange(
  input: { type: FinancialNoteType; supplierId: number; fiscalNumber: string },
  user: NoteActor
) {
  if (!canPrepareFinancialNotes(user))
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "No tiene permisos para preparar notas",
    });
  const db = await database();
  const rows = await noteRows<FinancialNote>(
    db,
    sql`select n.* from "financialNotes" n where n.type=${input.type} and n."supplierId"=${input.supplierId} and n.status='registrada' and ${scope(user, sql`n."projectId"`)} order by n.id desc limit 50`
  );
  const match = rows.find(n =>
    isInvoiceNumberWithinFiscalRange({
      invoiceNumber: input.fiscalNumber,
      documentRangeStart: n.documentRangeStart,
      documentRangeEnd: n.documentRangeEnd,
    })
  );
  return match
    ? {
        cai: match.cai,
        documentRangeStart: match.documentRangeStart,
        documentRangeEnd: match.documentRangeEnd,
        emissionDeadline: match.emissionDeadline,
      }
    : null;
}

/** Retired compatibility entry point for old maintenance scripts. */
export async function syncInvoiceRetentionNote(tx: Executor, invoiceId: number, actorId: number, options: { create?: boolean } = {}): Promise<{id:number; documentNumber:string} | undefined> {
  bad("La generación de notas de retención fue retirada. Ejecute la migración de comprobantes de retención.");
}

export async function createSupplierReturnNote(
  tx: Executor,
  returnId: number,
  actorId: number
) {
  await enabled(tx);
  const [source] = await noteRows(
    tx,
    sql`select r.*,i.id "invoiceId" from "reverseLogistics" r join invoices i on i."receiptId"=r."sourceReceiptId" where r.id=${returnId}`
  );
  if (!source)
    bad("La devolución debe tener una recepción con factura de origen");
  const [invoice] = await lockInvoices(tx, [source.invoiceId]);
  validateInvoices([invoice], [invoice.id], undefined, true);
  const [existing] = await noteRows<FinancialNote>(
    tx,
    sql`select * from "financialNotes" where "sourceReturnId"=${returnId}`
  );
  if (existing)
    return { id: existing.id, documentNumber: existing.documentNumber };
  const rows = await noteRows(
    tx,
    sql`select r.id,r.quantity,r."sourceReceiptItemId",i.subtotal,i."taxAmount",i.quantity "invoiceQuantity",i."taxCode",i."taxBreakdown" from "reverseLogisticsItems" r left join "invoiceItems" i on i."receiptItemId"=r."sourceReceiptItemId" and i."invoiceId"=${invoice.id} where r."reverseLogisticId"=${returnId} order by r.id`
  );
  if (
    !rows.length ||
    rows.some(r => !r.sourceReceiptItemId || !r.invoiceQuantity)
  )
    bad(
      "Seleccione el renglón de recepción de cada material devuelto antes de generar la nota"
    );
  const [concept] = await noteRows<NoteConcept>(
    tx,
    sql`select c.*,g."financialGroupDescription" from "financialNoteConcepts" c left join "financialGroups" g on g."financialGroupCode"=c."financialGroupCode" where c.type='credit' and c.code='NC-C01' and c."isActive"`
  );
  if (!concept) bad("Active el concepto NC-C01 para procesar devoluciones");
  const lines = rows.map(row => {
    const quantity = noteMoneyUnits(row.quantity);
    const originalQuantity = noteMoneyUnits(row.invoiceQuantity);
    if (quantity <= BigInt(0) || quantity > originalQuantity)
      return bad(
        "La cantidad devuelta no puede superar la cantidad del renglón recibido"
      );
    const proportion = (amount: string) =>
      noteMoneyString(
        (noteMoneyUnits(amount) * quantity + originalQuantity / BigInt(2)) /
          originalQuantity
      );
    const baseAmount = proportion(row.subtotal);
    const taxAmount = proportion(row.taxAmount);
    return {
      conceptId: concept.id,
      code: concept.code,
      description: concept.description,
      financialGroupCode: concept.financialGroupCode,
      financialGroupDescription: concept.financialGroupDescription ?? null,
      baseAmount,
      taxCode: row.taxCode,
      taxSnapshot: row.taxBreakdown,
      taxAmount,
      total: sumNoteMoney([baseAmount, taxAmount]),
      notes: `Devolución ${source.returnNumber}; renglón ${row.sourceReceiptItemId}`,
    };
  });
  const number = await allocateNumber(tx, invoice.projectId, "credit");
  const [note] = await noteRows<FinancialNote>(
    tx,
    sql`insert into "financialNotes" (type,origin,"documentNumber","projectId","supplierId",currency,"sourceInvoiceId","sourceReturnId","createdById",notes) values ('credit','supplier_return',${number},${invoice.projectId},${invoice.supplierId},${invoice.currency},${invoice.id},${returnId},${actorId},${source.justification}) returning *`
  );
  await replaceLines(tx, note.id, lines);
  await replaceAllocations(tx, note.id, [
    { invoiceId: invoice.id, amount: sumNoteMoney(lines.map(l => l.total)) },
  ]);
  await event(
    tx,
    note.id,
    actorId,
    "creada",
    `Devolución ${source.returnNumber}`
  );
  return { id: note.id, documentNumber: note.documentNumber };
}

export async function createFinancialNoteAttachment(
  data: {
    entityId: number;
    fileName: string;
    fileKey: string;
    fileUrl: string;
    mimeType: string;
    fileSize: number;
    category?: string;
    uploadedById: number;
  },
  user: NoteActor
) {
  const db = await database();
  return db.transaction(async tx => {
    const { note } = await lockNote(tx, data.entityId, user);
    assertFinancialNoteAccess(note, user, "prepare");
    if (!["borrador", "rechazada"].includes(note.status))
      bad("Solo puede modificar adjuntos de notas en borrador o rechazadas");
    const [attachment] = await noteRows<{ id: number }>(
      tx,
      sql`insert into attachments ("entityType","entityId","fileName","fileKey","fileUrl","mimeType","fileSize",category,"uploadedById") values ('financial_note',${data.entityId},${data.fileName},${data.fileKey},${data.fileUrl},${data.mimeType},${data.fileSize},${data.category ?? "otro"},${data.uploadedById}) returning id`
    );
    await event(tx, note.id, user.id, "adjunto_agregado", data.fileName);
    return attachment;
  });
}
export async function deleteFinancialNoteAttachment(
  attachmentId: number,
  user: NoteActor
) {
  const db = await database();
  return db.transaction(async tx => {
    const [attachment] = await noteRows(
      tx,
      sql`select * from attachments where id=${attachmentId} and "entityType"='financial_note'`
    );
    if (!attachment) bad("Adjunto no encontrado");
    const { note } = await lockNote(tx, attachment.entityId, user);
    assertFinancialNoteAccess(note, user, "prepare");
    if (!["borrador", "rechazada"].includes(note.status))
      bad("Solo puede modificar adjuntos de notas en borrador o rechazadas");
    await tx.execute(sql`delete from attachments where id=${attachmentId}`);
    await event(tx, note.id, user.id, "adjunto_eliminado", attachment.fileName);
    return { fileKey: attachment.fileKey as string };
  });
}

export async function mapSupplierReturnReceiptItems(
  id: number,
  mappings: Array<{ itemId: number; sourceReceiptItemId: number }>,
  user: NoteActor
) {
  if (user.role !== "admin" && user.buildreqRole !== "jefe_bodega_central")
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Solo Bodega Central puede vincular los renglones de devolución",
    });
  const db = await database();
  return db.transaction(async tx => {
    const [source] = await noteRows(
      tx,
      sql`select * from "reverseLogistics" where id=${id} for update`
    );
    if (
      !source ||
      source.status !== "pendiente" ||
      source.returnType !== "devolucion_proveedor" ||
      !canAccessProject(user, source.sourceProjectId)
    )
      bad("La devolución no está disponible para vincular renglones");
    const items = await noteRows(
      tx,
      sql`select id from "reverseLogisticsItems" where "reverseLogisticId"=${id}`
    );
    if (
      mappings.length !== items.length ||
      new Set(mappings.map(m => m.itemId)).size !== items.length
    )
      bad("Seleccione un renglón para cada material");
    for (const mapping of mappings) {
      if (!items.some(i => i.id === mapping.itemId))
        bad("Material ajeno a la devolución");
      const [receiptItem] = await noteRows(
        tx,
        sql`select id from "receiptItems" where id=${mapping.sourceReceiptItemId} and "receiptId"=${source.sourceReceiptId}`
      );
      if (!receiptItem)
        bad("El renglón seleccionado no pertenece a la recepción origen");
      await tx.execute(
        sql`update "reverseLogisticsItems" set "sourceReceiptItemId"=${mapping.sourceReceiptItemId} where id=${mapping.itemId}`
      );
    }
    return { success: true };
  });
}
