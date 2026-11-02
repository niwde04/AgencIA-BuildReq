import { sql } from "drizzle-orm";
import {
  pgTable,
  serial,
  integer,
  text,
  date,
  decimal,
  timestamp,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import {
  purchaseOrders,
  invoices,
  receipts,
  attachments,
  users,
} from "./schema";

export const purchaseOrderBillingAuthorizations = pgTable(
  "purchaseOrderBillingAuthorizations",
  {
    id: serial("id").primaryKey(),
    purchaseOrderId: integer("purchaseOrderId")
      .notNull()
      .references(() => purchaseOrders.id, { onDelete: "restrict" }),
    authorizedUntil: date("authorizedUntil").notNull(),
    originalExpectedInvoiceCount: integer(
      "originalExpectedInvoiceCount"
    ).notNull(),
    additionalInvoiceCount: integer("additionalInvoiceCount").notNull(),
    maxInvoiceCount: integer("maxInvoiceCount").notNull(),
    maxAmount: decimal("maxAmount", { precision: 18, scale: 4 }),
    reason: text("reason").notNull(),
    supportAttachmentId: integer("supportAttachmentId")
      .notNull()
      .references(() => attachments.id, { onDelete: "restrict" }),
    authorizedById: integer("authorizedById")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    authorizedAt: timestamp("authorizedAt", { withTimezone: true })
      .notNull()
      .defaultNow(),
    revokedAt: timestamp("revokedAt", { withTimezone: true }),
    revokedById: integer("revokedById").references(() => users.id, {
      onDelete: "restrict",
    }),
    revokeReason: text("revokeReason"),
  },
  t => ({
    activeUnique: uniqueIndex("poba_active_order_unique")
      .on(t.purchaseOrderId)
      .where(sql`${t.revokedAt} is null`),
    orderHistory: index("poba_order_history_idx").on(
      t.purchaseOrderId,
      t.id.desc()
    ),
    limitsCheck: check(
      "poba_limits_check",
      sql`${t.originalExpectedInvoiceCount} > 0 and ${t.additionalInvoiceCount} between 0 and 600 and ${t.maxInvoiceCount} = ${t.originalExpectedInvoiceCount} + ${t.additionalInvoiceCount}`
    ),
    amountCheck: check(
      "poba_amount_check",
      sql`${t.maxAmount} is null or ${t.maxAmount} > 0`
    ),
    reasonCheck: check(
      "poba_reason_check",
      sql`length(btrim(${t.reason})) between 10 and 2000`
    ),
    revokeCheck: check(
      "poba_revoke_check",
      sql`(${t.revokedAt} is null and ${t.revokedById} is null and ${t.revokeReason} is null) or (${t.revokedAt} is not null and ${t.revokedById} is not null and ${t.revokeReason} is not null and length(btrim(${t.revokeReason})) between 10 and 2000)`
    ),
  })
);

export const purchaseOrderBillingAuthorizationUses = pgTable(
  "purchaseOrderBillingAuthorizationUses",
  {
    id: serial("id").primaryKey(),
    authorizationId: integer("authorizationId")
      .notNull()
      .references(() => purchaseOrderBillingAuthorizations.id, {
        onDelete: "restrict",
      }),
    invoiceId: integer("invoiceId")
      .notNull()
      .references(() => invoices.id, { onDelete: "restrict" })
      .unique(),
    receiptId: integer("receiptId")
      .notNull()
      .references(() => receipts.id, { onDelete: "restrict" })
      .unique(),
    amount: decimal("amount", { precision: 18, scale: 4 }).notNull(),
    documentDate: date("documentDate").notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  t => ({
    authorizationIdx: index("pobau_authorization_idx").on(t.authorizationId),
    amountCheck: check("pobau_amount_check", sql`${t.amount} >= 0`),
  })
);
