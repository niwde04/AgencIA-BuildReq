import { sql } from "drizzle-orm";
import {
  pgTable,
  serial,
  integer,
  varchar,
  text,
  boolean,
  timestamp,
  date,
  decimal,
  jsonb,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import {
  projects,
  suppliers,
  invoices,
  taxRetentions,
  financialGroups,
  reverseLogistics,
  users,
} from "./schema";
import type { FinancialNoteType } from "../shared/financial-notes";

export const financialNoteSettings = pgTable(
  "financialNoteSettings",
  {
    id: integer("id").primaryKey().default(1),
    enabled: boolean("enabled").notNull().default(true),
    activatedAt: timestamp("activatedAt", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  table => ({ singleton: check("fn_settings_singleton", sql`${table.id} = 1`) })
);

export const financialNoteConcepts = pgTable(
  "financialNoteConcepts",
  {
    id: serial("id").primaryKey(),
    type: varchar("type", { length: 10 }).$type<FinancialNoteType>().notNull(),
    code: varchar("code", { length: 64 }).notNull(),
    description: varchar("description", { length: 500 }).notNull(),
    applicability: text("applicability").notNull().default(""),
    financialGroupCode: varchar("financialGroupCode", {
      length: 20,
    }).references(() => financialGroups.financialGroupCode, {
      onUpdate: "cascade",
      onDelete: "restrict",
    }),
    retentionCatalogId: integer("retentionCatalogId").references(
      () => taxRetentions.id,
      { onDelete: "restrict" }
    ),
    isActive: boolean("isActive").notNull().default(true),
    allowsTaxOnly: boolean("allowsTaxOnly").notNull().default(false),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  table => ({
    codeUnique: uniqueIndex("fnc_type_code_unique").on(table.type, table.code),
    retentionUnique: uniqueIndex("fnc_retention_unique").on(
      table.retentionCatalogId
    ),
    listIdx: index("fnc_type_active_code_idx").on(
      table.type,
      table.isActive,
      table.code
    ),
    typeCheck: check(
      "fnc_type_check",
      sql`${table.type} in ('credit','debit')`
    ),
    retentionCheck: check(
      "fnc_retention_check",
      sql`${table.retentionCatalogId} is null or ${table.type} = 'credit'`
    ),
  })
);

export const financialNoteSequences = pgTable(
  "financialNoteSequences",
  {
    id: serial("id").primaryKey(),
    projectId: integer("projectId")
      .notNull()
      .references(() => projects.id, { onDelete: "restrict" }),
    type: varchar("type", { length: 10 }).$type<FinancialNoteType>().notNull(),
    lastValue: integer("lastValue").notNull().default(0),
  },
  table => ({
    scopeUnique: uniqueIndex("fns_project_type_unique").on(
      table.projectId,
      table.type
    ),
    valueCheck: check(
      "fns_value_check",
      sql`${table.lastValue} between 0 and 99999999`
    ),
    typeCheck: check(
      "fns_type_check",
      sql`${table.type} in ('credit','debit')`
    ),
  })
);

export const financialNotes = pgTable(
  "financialNotes",
  {
    id: serial("id").primaryKey(),
    type: varchar("type", { length: 10 }).$type<FinancialNoteType>().notNull(),
    origin: varchar("origin", { length: 20 }).notNull().default("manual"),
    documentNumber: varchar("documentNumber", { length: 64 })
      .notNull()
      .unique(),
    requestKey: varchar("requestKey", { length: 100 }).unique(),
    projectId: integer("projectId")
      .notNull()
      .references(() => projects.id, { onDelete: "restrict" }),
    supplierId: integer("supplierId")
      .notNull()
      .references(() => suppliers.id, { onDelete: "restrict" }),
    currency: varchar("currency", { length: 3 }).notNull(),
    status: varchar("status", { length: 15 }).notNull().default("borrador"),
    sourceInvoiceId: integer("sourceInvoiceId").references(() => invoices.id, {
      onDelete: "restrict",
    }),
    sourceReturnId: integer("sourceReturnId").references(
      () => reverseLogistics.id,
      { onDelete: "restrict" }
    ),
    cai: varchar("cai", { length: 100 }),
    fiscalNumber: varchar("fiscalNumber", { length: 100 }),
    documentRangeStart: varchar("documentRangeStart", { length: 100 }),
    documentRangeEnd: varchar("documentRangeEnd", { length: 100 }),
    documentDate: date("documentDate"),
    documentDueDate: date("documentDueDate"),
    emissionDeadline: date("emissionDeadline"),
    notes: text("notes"),
    subtotal: decimal("subtotal", { precision: 14, scale: 4 })
      .notNull()
      .default("0"),
    taxAmount: decimal("taxAmount", { precision: 14, scale: 4 })
      .notNull()
      .default("0"),
    total: decimal("total", { precision: 14, scale: 4 }).notNull().default("0"),
    createdById: integer("createdById")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deletedAt", { withTimezone: true }),
  },
  table => ({
    listIdx: index("fn_type_project_created_idx").on(
      table.type,
      table.projectId,
      table.createdAt.desc(),
      table.id.desc()
    ),
    supplierIdx: index("fn_supplier_status_idx").on(
      table.supplierId,
      table.status
    ),
    fiscalUnique: uniqueIndex("fn_supplier_type_fiscal_unique")
      .on(table.supplierId, table.type, table.fiscalNumber)
      .where(
        sql`${table.fiscalNumber} is not null and ${table.fiscalNumber} <> ''`
      ),
    retentionUnique: uniqueIndex("fn_active_retention_invoice_unique")
      .on(table.sourceInvoiceId)
      .where(
        sql`${table.origin} = 'retentions' and ${table.status} <> 'anulada'`
      ),
    returnUnique: uniqueIndex("fn_source_return_unique").on(
      table.sourceReturnId
    ),
    typeCheck: check("fn_type_check", sql`${table.type} in ('credit','debit')`),
    statusCheck: check(
      "fn_status_check",
      sql`${table.status} in ('borrador','revisada','rechazada','registrada','anulada')`
    ),
    currencyCheck: check(
      "fn_currency_check",
      sql`${table.currency} in ('HNL','USD')`
    ),
    originCheck: check(
      "fn_origin_check",
      sql`(${table.origin} = 'manual' and ${table.sourceInvoiceId} is null and ${table.sourceReturnId} is null) or (${table.origin} = 'retentions' and ${table.type} = 'credit' and ${table.sourceInvoiceId} is not null and ${table.sourceReturnId} is null) or (${table.origin} = 'supplier_return' and ${table.type} = 'credit' and ${table.sourceInvoiceId} is not null and ${table.sourceReturnId} is not null)`
    ),
    totalCheck: check(
      "fn_total_check",
      sql`${table.subtotal} >= 0 and ${table.taxAmount} >= 0 and ${table.total} = ${table.subtotal} + ${table.taxAmount}`
    ),
  })
);

export const financialNoteLines = pgTable(
  "financialNoteLines",
  {
    id: serial("id").primaryKey(),
    noteId: integer("noteId")
      .notNull()
      .references(() => financialNotes.id, { onDelete: "cascade" }),
    conceptId: integer("conceptId")
      .notNull()
      .references(() => financialNoteConcepts.id, { onDelete: "restrict" }),
    code: varchar("code", { length: 64 }).notNull(),
    description: varchar("description", { length: 500 }).notNull(),
    financialGroupCode: varchar("financialGroupCode", { length: 20 }),
    financialGroupDescription: varchar("financialGroupDescription", {
      length: 500,
    }),
    baseAmount: decimal("baseAmount", { precision: 14, scale: 4 }).notNull(),
    taxCode: varchar("taxCode", { length: 50 }),
    taxSnapshot: jsonb("taxSnapshot"),
    taxAmount: decimal("taxAmount", { precision: 14, scale: 4 }).notNull(),
    total: decimal("total", { precision: 14, scale: 4 }).notNull(),
    notes: text("notes"),
  },
  table => ({
    noteIdx: index("fnl_note_idx").on(table.noteId),
    conceptIdx: index("fnl_concept_idx").on(table.conceptId),
    totalCheck: check(
      "fnl_total_check",
      sql`${table.baseAmount} >= 0 and ${table.taxAmount} >= 0 and ${table.total} > 0 and ${table.total} = ${table.baseAmount} + ${table.taxAmount}`
    ),
  })
);

export const financialNoteInvoices = pgTable(
  "financialNoteInvoices",
  {
    id: serial("id").primaryKey(),
    noteId: integer("noteId")
      .notNull()
      .references(() => financialNotes.id, { onDelete: "cascade" }),
    invoiceId: integer("invoiceId")
      .notNull()
      .references(() => invoices.id, { onDelete: "restrict" }),
    amount: decimal("amount", { precision: 14, scale: 4 }).notNull(),
  },
  table => ({
    uniqueInvoice: uniqueIndex("fni_note_invoice_unique").on(
      table.noteId,
      table.invoiceId
    ),
    invoiceIdx: index("fni_invoice_idx").on(table.invoiceId),
    amountCheck: check("fni_amount_check", sql`${table.amount} > 0`),
  })
);

export const financialNoteEvents = pgTable(
  "financialNoteEvents",
  {
    id: serial("id").primaryKey(),
    noteId: integer("noteId")
      .notNull()
      .references(() => financialNotes.id, { onDelete: "restrict" }),
    actorId: integer("actorId")
      .notNull()
      .references(() => users.id),
    action: varchar("action", { length: 40 }).notNull(),
    comment: text("comment"),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  table => ({
    noteIdx: index("fne_note_created_idx").on(table.noteId, table.createdAt),
  })
);
