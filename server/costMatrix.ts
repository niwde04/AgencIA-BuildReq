import { and, asc, eq, ilike, or, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getDb } from "./db";
import { costMatrixEntries as entries } from "../drizzle/cost-matrix-schema";
import {
  deriveCostMatrix,
  type CostMatrixFields,
  type CostMatrixListInput,
} from "../shared/cost-matrix";

async function database() {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Base de datos no disponible",
    });
  return db;
}
function notFound() {
  return new TRPCError({
    code: "NOT_FOUND",
    message: "Registro de matriz no encontrado",
  });
}
function handleWriteError(error: unknown): never {
  const cause = error as { code?: string; cause?: { code?: string } };
  if (cause.code === "23505" || cause.cause?.code === "23505")
    throw new TRPCError({
      code: "CONFLICT",
      message: "Ya existe un registro con ese código de matriz",
    });
  throw error;
}
export async function listCostMatrix(input: CostMatrixListInput) {
  const db = await database();
  const search = input.search?.replace(/[\\%_]/g, "\\$&");
  const where = and(
    input.jobCode ? eq(entries.jobCode, input.jobCode) : undefined,
    input.n1 ? eq(entries.n1, input.n1) : undefined,
    input.flowActivity
      ? eq(entries.flowActivity, input.flowActivity)
      : undefined,
    input.isActive !== undefined
      ? eq(entries.isActive, input.isActive)
      : undefined,
    search
      ? or(
          ...[
            entries.matrixCode,
            entries.jobName,
            entries.nivel1,
            entries.nivel2,
            entries.nivel3,
            entries.nivel4,
            entries.majorGroup,
            entries.flowId,
            entries.flowActivity,
          ].map(column => ilike(column, `%${search}%`))
        )
      : undefined
  );
  return db.transaction(
    async tx => {
      const [{ total }] = await tx
        .select({ total: sql<number>`count(*)::int` })
        .from(entries)
        .where(where);
      const totalPages = Math.max(1, Math.ceil(total / input.pageSize));
      const page = Math.min(input.page, totalPages);
      const items = await tx
        .select()
        .from(entries)
        .where(where)
        .orderBy(asc(entries.matrixCode), asc(entries.id))
        .limit(input.pageSize)
        .offset((page - 1) * input.pageSize);
      return {
        items: items.map(deriveCostMatrix),
        total,
        page,
        pageSize: input.pageSize,
        totalPages,
      };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" }
  );
}
export async function getCostMatrix(id: number) {
  const db = await database();
  const [entry] = await db.select().from(entries).where(eq(entries.id, id));
  if (!entry) throw notFound();
  return deriveCostMatrix(entry);
}
export async function costMatrixFilterOptions() {
  const db = await database();
  const [jobs, levels, activities] = await Promise.all([
    db
      .selectDistinct({ code: entries.jobCode, name: entries.jobName })
      .from(entries)
      .orderBy(asc(entries.jobCode), asc(entries.jobName)),
    db
      .selectDistinct({ code: entries.n1, name: entries.nivel1 })
      .from(entries)
      .orderBy(asc(entries.n1), asc(entries.nivel1)),
    db
      .selectDistinct({ name: entries.flowActivity })
      .from(entries)
      .orderBy(asc(entries.flowActivity)),
  ]);
  // A code may have several descriptions; the filter still selects the whole code.
  const unique = <T extends { code: string }>(rows: T[]) =>
    rows.filter((r, i) => rows.findIndex(v => v.code === r.code) === i);
  return { jobs: unique(jobs), levels: unique(levels), activities };
}
function storedFields(input: CostMatrixFields) {
  return { ...input, matrixCode: deriveCostMatrix(input).matrixCode };
}
export async function createCostMatrix(
  input: CostMatrixFields,
  actorId: number
) {
  const db = await database();
  try {
    const [entry] = await db
      .insert(entries)
      .values({
        ...storedFields(input),
        createdById: actorId,
        updatedById: actorId,
      })
      .returning();
    return deriveCostMatrix(entry);
  } catch (error) {
    return handleWriteError(error);
  }
}
export async function updateCostMatrix(
  id: number,
  input: CostMatrixFields,
  actorId: number
) {
  const db = await database();
  try {
    const [entry] = await db
      .update(entries)
      .set({
        ...storedFields(input),
        updatedAt: new Date(),
        updatedById: actorId,
      })
      .where(eq(entries.id, id))
      .returning();
    if (!entry) throw notFound();
    return deriveCostMatrix(entry);
  } catch (error) {
    return handleWriteError(error);
  }
}
export async function setCostMatrixActive(
  id: number,
  isActive: boolean,
  actorId: number
) {
  const db = await database();
  const [entry] = await db
    .update(entries)
    .set({ isActive, updatedAt: new Date(), updatedById: actorId })
    .where(eq(entries.id, id))
    .returning();
  if (!entry) throw notFound();
  return deriveCostMatrix(entry);
}
