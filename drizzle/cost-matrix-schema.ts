import { sql } from "drizzle-orm";
import {
  pgTable,
  serial,
  varchar,
  boolean,
  integer,
  timestamp,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { users } from "./schema";

// Catalog only: job codes deliberately do not reference operational projects.
export const costMatrixEntries = pgTable(
  "costMatrixEntries",
  {
    id: serial("id").primaryKey(),
    matrixCode: varchar("matrixCode", { length: 104 }).notNull(),
    sourceKey: varchar("sourceKey", { length: 200 }),
    jobCode: varchar("jobCode", { length: 20 }).notNull(),
    jobName: varchar("jobName", { length: 500 }).notNull(),
    n1: varchar("n1", { length: 20 }).notNull(),
    nivel1: varchar("nivel1", { length: 500 }).notNull(),
    n2: varchar("n2", { length: 20 }).notNull(),
    nivel2: varchar("nivel2", { length: 500 }).notNull(),
    n3: varchar("n3", { length: 20 }).notNull(),
    nivel3: varchar("nivel3", { length: 500 }).notNull(),
    n4: varchar("n4", { length: 20 }).notNull(),
    nivel4: varchar("nivel4", { length: 500 }).notNull(),
    majorGroup: varchar("majorGroup", { length: 500 }).notNull(),
    flowId: varchar("flowId", { length: 20 }).notNull(),
    flowActivity: varchar("flowActivity", { length: 500 }).notNull(),
    isActive: boolean("isActive").notNull().default(true),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdById: integer("createdById").references(() => users.id, {
      onDelete: "set null",
    }),
    updatedById: integer("updatedById").references(() => users.id, {
      onDelete: "set null",
    }),
  },
  t => [
    uniqueIndex("costMatrixEntries_matrixCode_unique").on(t.matrixCode),
    uniqueIndex("costMatrixEntries_sourceKey_unique").on(t.sourceKey),
    index("costMatrixEntries_filters_idx").on(t.jobCode, t.n1, t.isActive),
    check(
      "costMatrixEntries_code_matches",
      sql`${t.matrixCode} = ${t.jobCode} || '-' || ${t.n1} || '-' || ${t.n2} || '-' || ${t.n3} || '-' || ${t.n4}`
    ),
  ]
).enableRLS();
