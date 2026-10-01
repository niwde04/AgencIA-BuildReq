import { sql } from "drizzle-orm";
import {
  pgTable,
  serial,
  integer,
  varchar,
  decimal,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
  check,
  text,
  bigint,
} from "drizzle-orm/pg-core";
import { invoices, suppliers, projects, users, attachments } from "./schema";
import { financialNotes } from "./financial-notes-schema";
import type { RetentionSnapshot } from "../shared/retention-documents";

export const invoiceAccountingReversals = pgTable(
  "invoiceAccountingReversals",
  {
    id: serial("id").primaryKey(),
    invoiceId: integer("invoiceId")
      .notNull()
      .references(() => invoices.id, { onDelete: "restrict" }),
    actorId: integer("actorId")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    reason: text("reason").notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .notNull()
      .defaultNow(),
    transactionId: bigint("transactionId", { mode: "bigint" })
      .notNull()
      .default(sql`txid_current()`),
    invoiceSnapshot: jsonb("invoiceSnapshot")
      .$type<Record<string, unknown>>()
      .notNull(),
  },
  t => ({
    historyIdx: index("iar_invoice_history_idx").on(t.invoiceId, t.id.desc()),
    reasonCheck: check(
      "invoiceAccountingReversals_reason_check",
      sql`length(btrim(${t.reason})) between 5 and 2000`
    ),
    snapshotCheck: check(
      "invoiceAccountingReversals_invoiceSnapshot_check",
      sql`${t.invoiceSnapshot}->>'status' = 'registrada'`
    ),
  })
);

export const retentionDocuments = pgTable(
  "retentionDocuments",
  {
    id: serial("id").primaryKey(),
    invoiceId: integer("invoiceId").references(() => invoices.id, {
      onDelete: "restrict",
    }),
    legacyNoteId: integer("legacyNoteId")
      .references(() => financialNotes.id, { onDelete: "restrict" })
      .unique(),
    projectId: integer("projectId")
      .notNull()
      .references(() => projects.id, { onDelete: "restrict" }),
    supplierId: integer("supplierId")
      .notNull()
      .references(() => suppliers.id, { onDelete: "restrict" }),
    status: varchar("status", { length: 15 })
      .$type<"registrada" | "historico" | "anulada">()
      .notNull(),
    documentNumber: varchar("documentNumber", { length: 100 }),
    currency: varchar("currency", { length: 3 }).notNull(),
    total: decimal("total", { precision: 14, scale: 4 }).notNull(),
    documentDate: timestamp("documentDate"),
    createdById: integer("createdById").references(() => users.id, {
      onDelete: "restrict",
    }),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .notNull()
      .defaultNow(),
    snapshot: jsonb("snapshot").$type<RetentionSnapshot>().notNull(),
    voidedAt: timestamp("voidedAt", { withTimezone: true }),
    voidedById: integer("voidedById").references(() => users.id, {
      onDelete: "restrict",
    }),
    voidReason: text("voidReason"),
    reversalId: integer("reversalId").references(
      () => invoiceAccountingReversals.id,
      { onDelete: "restrict" }
    ),
  },
  t => ({
    invoiceUnique: uniqueIndex("rd_current_invoice_unique")
      .on(t.invoiceId)
      .where(sql`${t.status} = 'registrada'`),
    pageIdx: index("rd_date_page_idx").on(t.documentDate.desc(), t.id.desc()),
    supplierIdx: index("rd_supplier_idx").on(t.supplierId, t.id),
    projectIdx: index("rd_project_idx").on(t.projectId, t.id),
    statusCheck: check(
      "rd_status_check",
      sql`${t.status} in ('registrada','historico','anulada')`
    ),
    currentCheck: check(
      "rd_current_check",
      sql`${t.status} <> 'registrada' or (${t.invoiceId} is not null and ${t.legacyNoteId} is null and ${t.total} > 0 and ${t.documentNumber} is not null)`
    ),
    voidCheck: check(
      "rd_void_check",
      sql`(${t.status} = 'anulada' and ${t.voidedAt} is not null and ${t.voidedById} is not null and ${t.reversalId} is not null and length(btrim(${t.voidReason})) between 5 and 2000) or (${t.status} <> 'anulada' and ${t.voidedAt} is null and ${t.voidedById} is null and ${t.reversalId} is null and ${t.voidReason} is null)`
    ),
  })
);
export const retentionDocumentAntecedents = pgTable(
  "retentionDocumentAntecedents",
  {
    noteId: integer("noteId")
      .primaryKey()
      .references(() => financialNotes.id, { onDelete: "restrict" }),
    documentId: integer("documentId")
      .notNull()
      .references(() => retentionDocuments.id, { onDelete: "restrict" }),
    snapshot: jsonb("snapshot").$type<Record<string, any>>().notNull(),
  },
  t => ({ documentIdx: index("rda_document_idx").on(t.documentId) })
);
export const retentionDocumentAttachments = pgTable(
  "retentionDocumentAttachments",
  {
    id: serial("id").primaryKey(),
    documentId: integer("documentId")
      .notNull()
      .references(() => retentionDocuments.id, { onDelete: "restrict" }),
    attachmentId: integer("attachmentId")
      .notNull()
      .references(() => attachments.id, { onDelete: "restrict" }),
    legacyNoteId: integer("legacyNoteId").references(() => financialNotes.id, {
      onDelete: "restrict",
    }),
    snapshot: jsonb("snapshot")
      .$type<{
        fileName: string;
        fileKey: string;
        mimeType: string | null;
        category: string | null;
      }>()
      .notNull(),
  },
  t => ({
    linkUnique: uniqueIndex("rdatt_link_unique").on(
      t.documentId,
      t.attachmentId
    ),
    attachmentIdx: index("rdatt_attachment_idx").on(t.attachmentId),
  })
);
