import { sql } from "drizzle-orm";
import {
  bigserial,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

export const inventoryReportSnapshots = pgTable(
  "inventoryReportSnapshots",
  {
    id: serial("id").primaryKey(),
    sourceKey: text("sourceKey")
      .notNull()
      .unique("inventoryReportSnapshots_sourceKey_key"),
    sourceHash: text("sourceHash").notNull(),
    capturedAt: timestamp("capturedAt", { withTimezone: true }).notNull(),
    kind: text("kind").$type<"backup" | "activation">().notNull(),
    rowsCount: integer("rowsCount").notNull(),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
  },
  table => ({
    capturedIdx: index("inventory_report_snapshots_captured_idx").on(
      table.capturedAt,
      table.id
    ),
    sourceHashCheck: check(
      "irs_source_hash_check",
      sql`${table.sourceHash} ~ '^[0-9a-f]{64}$'`
    ),
    kindCheck: check(
      "irs_kind_check",
      sql`${table.kind} in ('backup', 'activation')`
    ),
    rowsCountCheck: check("irs_rows_count_check", sql`${table.rowsCount} >= 0`),
    metadataCheck: check(
      "irs_metadata_check",
      sql`jsonb_typeof(${table.metadata}) = 'object'`
    ),
  })
).enableRLS();

export const inventoryReportSnapshotRows = pgTable(
  "inventoryReportSnapshotRows",
  {
    id: serial("id").primaryKey(),
    snapshotId: integer("snapshotId").notNull(),
    inventoryItemId: integer("inventoryItemId").notNull(),
    rowData: jsonb("rowData").$type<Record<string, unknown>>().notNull(),
  },
  table => ({
    snapshotFk: foreignKey({
      name: "inventoryReportSnapshotRows_snapshotId_fkey",
      columns: [table.snapshotId],
      foreignColumns: [inventoryReportSnapshots.id],
    }).onDelete("restrict"),
    snapshotItemUnique: unique(
      "inventoryReportSnapshotRows_snapshotId_inventoryItemId_key"
    ).on(table.snapshotId, table.inventoryItemId),
    itemCheck: check("irsr_item_id_check", sql`${table.inventoryItemId} > 0`),
    rowCheck: check(
      "irsr_row_data_check",
      sql`jsonb_typeof(${table.rowData}) = 'object' and ${table.rowData}->>'id' is not null and ${table.rowData}->>'id' = ${table.inventoryItemId}::text`
    ),
  })
).enableRLS();

export const inventoryReportStockChanges = pgTable(
  "inventoryReportStockChanges",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    changedAt: timestamp("changedAt", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
    inventoryItemId: integer("inventoryItemId").notNull(),
    beforeRow: jsonb("beforeRow").$type<Record<string, unknown>>(),
    afterRow: jsonb("afterRow").$type<Record<string, unknown>>(),
  },
  table => ({
    timeIdx: index("inventory_report_stock_changes_time_idx").on(
      table.changedAt,
      table.id
    ),
    itemIdx: index("inventory_report_stock_changes_item_idx").on(
      table.inventoryItemId,
      table.id
    ),
    itemCheck: check("irsc_item_id_check", sql`${table.inventoryItemId} > 0`),
    nonemptyCheck: check(
      "irsc_nonempty_check",
      sql`${table.beforeRow} is not null or ${table.afterRow} is not null`
    ),
    beforeCheck: check(
      "irsc_before_row_check",
      sql`${table.beforeRow} is null or (jsonb_typeof(${table.beforeRow}) = 'object' and ${table.beforeRow}->>'id' is not null and ${table.beforeRow}->>'id' = ${table.inventoryItemId}::text)`
    ),
    afterCheck: check(
      "irsc_after_row_check",
      sql`${table.afterRow} is null or (jsonb_typeof(${table.afterRow}) = 'object' and ${table.afterRow}->>'id' is not null and ${table.afterRow}->>'id' = ${table.inventoryItemId}::text)`
    ),
  })
).enableRLS();
