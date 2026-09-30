import { and, eq, inArray } from "drizzle-orm";
import { costMatrixEntries } from "../drizzle/cost-matrix-schema";
import { getDb } from "./db";
import type { TreasuryPaymentCostMatrixEntry } from "../shared/treasury-payment-cost-levels";

// One projected lookup per export, restricted to the financial codes in its paid invoices.
export async function loadTreasuryPaymentCostMatrixEntries(
  financialCodes: string[]
): Promise<TreasuryPaymentCostMatrixEntry[]> {
  const codes = Array.from(
    new Set(financialCodes.map(code => code.trim()).filter(Boolean))
  );
  if (!codes.length) return [];
  const db = await getDb();
  if (!db) throw new Error("No se pudo consultar la matriz de costos");
  try {
    return await db
      .select({
        n1: costMatrixEntries.n1,
        nivel1: costMatrixEntries.nivel1,
        n2: costMatrixEntries.n2,
        nivel2: costMatrixEntries.nivel2,
        n3: costMatrixEntries.n3,
        nivel3: costMatrixEntries.nivel3,
        n4: costMatrixEntries.n4,
        nivel4: costMatrixEntries.nivel4,
      })
      .from(costMatrixEntries)
      .where(
        and(
          inArray(costMatrixEntries.n4, codes),
          eq(costMatrixEntries.isActive, true)
        )
      );
  } catch (error) {
    const cause = error as { code?: string; cause?: { code?: string } };
    console.error("[TreasuryPayments] Cost matrix lookup failed", {
      code: cause.cause?.code ?? cause.code,
    });
    throw new Error(
      "No se pudieron consultar los niveles de la matriz de costos. Intente nuevamente."
    );
  }
}
