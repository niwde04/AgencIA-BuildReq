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
} from "drizzle-orm/pg-core";
import { invoices, suppliers, projects, users, attachments } from "./schema";
import { financialNotes } from "./financial-notes-schema";
import type { RetentionSnapshot } from "../shared/retention-documents";

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
      .$type<"registrada" | "historico">()
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
      sql`${t.status} in ('registrada','historico')`
    ),
    currentCheck: check(
      "rd_current_check",
      sql`${t.status} <> 'registrada' or (${t.invoiceId} is not null and ${t.legacyNoteId} is null and ${t.total} > 0 and ${t.documentNumber} is not null)`
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
