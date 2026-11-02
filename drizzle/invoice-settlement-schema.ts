import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  integer,
  jsonb,
  pgTable,
  serial,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { invoices, users } from "./schema";

export const invoiceSettlementActivations = pgTable(
  "invoiceSettlementActivations",
  {
    id: serial("id").primaryKey(),
    operationKey: varchar("operationKey", { length: 200 }).notNull().unique(),
    actorId: integer("actorId")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .notNull()
      .defaultNow(),
    before: jsonb("before").notNull(),
    after: jsonb("after").notNull(),
  }
);

export const invoiceSettlementSettings = pgTable(
  "invoiceSettlementSettings",
  {
    id: integer("id").primaryKey().default(1),
    enabled: boolean("enabled").notNull().default(false),
    version: varchar("version", { length: 40 })
      .$type<"document_cents_v1">()
      .notNull()
      .default("document_cents_v1"),
    activatedById: integer("activatedById").references(() => users.id, {
      onDelete: "restrict",
    }),
    activatedAt: timestamp("activatedAt", { withTimezone: true }),
  },
  t => ({
    singleton: check("invoice_settlement_settings_singleton", sql`${t.id}=1`),
    version: check(
      "invoice_settlement_settings_version",
      sql`${t.version}='document_cents_v1'`
    ),
    activation: check(
      "invoice_settlement_settings_activation",
      sql`not ${t.enabled} or (${t.activatedById} is not null and ${t.activatedAt} is not null)`
    ),
  })
);

export const invoiceSettlementPolicies = pgTable(
  "invoiceSettlementPolicies",
  {
    invoiceId: integer("invoiceId")
      .primaryKey()
      .references(() => invoices.id, { onDelete: "cascade" }),
    version: varchar("version", { length: 40 })
      .$type<"document_cents_v1">()
      .notNull(),
    source: varchar("source", { length: 20 })
      .$type<"new_invoice" | "unpaid_batch">()
      .notNull(),
    activatedById: integer("activatedById").references(() => users.id, {
      onDelete: "restrict",
    }),
    activatedAt: timestamp("activatedAt", { withTimezone: true })
      .notNull()
      .defaultNow(),
    operationKey: varchar("operationKey", { length: 200 }),
  },
  t => ({
    version: check(
      "invoice_settlement_policy_version",
      sql`${t.version}='document_cents_v1'`
    ),
    source: check(
      "invoice_settlement_policy_source",
      sql`${t.source} in ('new_invoice','unpaid_batch')`
    ),
    batchAudit: check(
      "invoice_settlement_batch_audit",
      sql`${t.source}<>'unpaid_batch' or (${t.operationKey} is not null and ${t.activatedById} is not null)`
    ),
    activationFk: foreignKey({
      columns: [t.operationKey],
      foreignColumns: [invoiceSettlementActivations.operationKey],
      name: "invoice_settlement_policy_activation_fk",
    }).onDelete("restrict"),
  })
);

export type InvoiceSettlementPolicy =
  typeof invoiceSettlementPolicies.$inferSelect;
