import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import {
  invoiceDocumentAdjustments,
  invoices,
  projects,
  purchaseOrderAdvanceApplications,
  qualityRetentionReleases,
  suppliers,
  treasuryPaymentItems,
} from "../drizzle/schema";
import {
  buildQualityRetentionReleaseSummary,
  getQualityRetentionReleasePaymentStatus,
  type QualityRetentionReleaseStatus,
} from "../shared/quality-retention-releases";
import { getDb } from "./db";

const COMMITTED_STATUSES: QualityRetentionReleaseStatus[] = [
  "pending_approval",
  "approved",
  "partially_paid",
  "paid",
];

export class QualityRetentionReleaseRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QualityRetentionReleaseRuleError";
  }
}

function round4(value: number) {
  return Math.round((value + Number.EPSILON) * 10_000) / 10_000;
}

function money(value: string | number | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? round4(parsed) : 0;
}

function moneyString(value: number) {
  return round4(value).toFixed(4);
}

async function getOrdinaryInvoicePaymentMap(
  executor: any,
  invoiceIds: number[]
) {
  const ids = Array.from(new Set(invoiceIds));
  const result = new Map<
    number,
    { netPayable: number; settledAmount: number; isPaid: boolean }
  >();
  if (!ids.length) return result;

  const [invoiceRows, paymentRows, advanceRows] = await Promise.all([
    executor
      .select({ id: invoices.id, netPayable: invoices.netPayable })
      .from(invoices)
      .where(inArray(invoices.id, ids)),
    executor
      .select({
        invoiceId: treasuryPaymentItems.invoiceId,
        bankPaidAmount: treasuryPaymentItems.bankPaidAmount,
      })
      .from(treasuryPaymentItems)
      .where(
        and(
          eq(treasuryPaymentItems.sourceType, "invoice"),
          eq(treasuryPaymentItems.status, "contabilizada"),
          inArray(treasuryPaymentItems.invoiceId, ids)
        )
      ),
    executor
      .select({
        invoiceId: purchaseOrderAdvanceApplications.invoiceId,
        amount: purchaseOrderAdvanceApplications.amount,
      })
      .from(purchaseOrderAdvanceApplications)
      .where(inArray(purchaseOrderAdvanceApplications.invoiceId, ids)),
  ]);

  for (const invoice of invoiceRows) {
    const paid = paymentRows
      .filter((row: any) => row.invoiceId === invoice.id)
      .reduce((sum: number, row: any) => sum + money(row.bankPaidAmount), 0);
    const applied = advanceRows
      .filter((row: any) => row.invoiceId === invoice.id)
      .reduce((sum: number, row: any) => sum + money(row.amount), 0);
    const netPayable = money(invoice.netPayable);
    const settledAmount = round4(paid + applied);
    result.set(invoice.id, {
      netPayable,
      settledAmount,
      isPaid: settledAmount + 0.0001 >= netPayable,
    });
  }
  return result;
}

async function getReleasePaymentMap(
  executor: any,
  releaseIds: number[],
  excludeBatchId?: number
) {
  const result = new Map<
    number,
    { paidAmount: number; reservedAmount: number }
  >();
  if (!releaseIds.length) return result;
  const rows = await executor
    .select({
      releaseId: treasuryPaymentItems.qualityRetentionReleaseId,
      batchId: treasuryPaymentItems.batchId,
      status: treasuryPaymentItems.status,
      activeReservation: treasuryPaymentItems.activeReservation,
      requestedAmount: treasuryPaymentItems.requestedAmount,
      approvedAmount: treasuryPaymentItems.approvedAmount,
      bankPaidAmount: treasuryPaymentItems.bankPaidAmount,
    })
    .from(treasuryPaymentItems)
    .where(inArray(treasuryPaymentItems.qualityRetentionReleaseId, releaseIds));
  for (const id of releaseIds)
    result.set(id, { paidAmount: 0, reservedAmount: 0 });
  for (const row of rows) {
    if (!row.releaseId) continue;
    const current = result.get(row.releaseId) ?? {
      paidAmount: 0,
      reservedAmount: 0,
    };
    if (row.status === "contabilizada") {
      current.paidAmount = round4(
        current.paidAmount + money(row.bankPaidAmount)
      );
    }
    if (row.activeReservation && row.batchId !== excludeBatchId) {
      current.reservedAmount = round4(
        current.reservedAmount +
          money(row.bankPaidAmount ?? row.approvedAmount ?? row.requestedAmount)
      );
    }
    result.set(row.releaseId, current);
  }
  return result;
}

export async function getQualityRetentionReleaseSnapshots(
  executor: any,
  releaseIds: number[],
  excludeBatchId?: number
) {
  const ids = Array.from(new Set(releaseIds));
  if (!ids.length) {
    throw new QualityRetentionReleaseRuleError(
      "Seleccione al menos una liberación de calidad."
    );
  }
  const rows = await executor
    .select({
      release: qualityRetentionReleases,
      adjustment: invoiceDocumentAdjustments,
      invoice: invoices,
      project: projects,
      supplier: suppliers,
    })
    .from(qualityRetentionReleases)
    .innerJoin(
      invoiceDocumentAdjustments,
      eq(
        qualityRetentionReleases.invoiceDocumentAdjustmentId,
        invoiceDocumentAdjustments.id
      )
    )
    .innerJoin(invoices, eq(invoiceDocumentAdjustments.invoiceId, invoices.id))
    .innerJoin(projects, eq(invoices.projectId, projects.id))
    .leftJoin(suppliers, eq(invoices.supplierId, suppliers.id))
    .where(inArray(qualityRetentionReleases.id, ids))
    .for("update", { of: qualityRetentionReleases });
  if (rows.length !== ids.length) {
    throw new QualityRetentionReleaseRuleError(
      "Una o más liberaciones seleccionadas no existen."
    );
  }
  const [paymentMap, ordinaryPaymentMap] = await Promise.all([
    getReleasePaymentMap(executor, ids, excludeBatchId),
    getOrdinaryInvoicePaymentMap(
      executor,
      rows.map((row: any) => row.invoice.id)
    ),
  ]);
  return rows.map((row: any) => {
    const paid = paymentMap.get(row.release.id) ?? {
      paidAmount: 0,
      reservedAmount: 0,
    };
    const approvedAmount = money(row.release.approvedAmount);
    return {
      ...row,
      ordinaryPayment: ordinaryPaymentMap.get(row.invoice.id),
      money: {
        approvedAmount,
        paidAmount: paid.paidAmount,
        reservedAmount: paid.reservedAmount,
        availableAmount: round4(
          Math.max(0, approvedAmount - paid.paidAmount - paid.reservedAmount)
        ),
      },
    };
  });
}

export async function getQualityRetentionOverview(invoiceId: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [adjustment] = await db
    .select()
    .from(invoiceDocumentAdjustments)
    .where(
      and(
        eq(invoiceDocumentAdjustments.invoiceId, invoiceId),
        eq(invoiceDocumentAdjustments.adjustmentType, "quality_retention")
      )
    )
    .limit(1);
  if (!adjustment) {
    return {
      adjustment: null,
      releases: [],
      summary: {
        originalAmount: 0,
        requestedAmount: 0,
        approvedAmount: 0,
        paidAmount: 0,
        reservedAmount: 0,
        availableAmount: 0,
      },
    };
  }
  const releases = await db
    .select()
    .from(qualityRetentionReleases)
    .where(
      eq(qualityRetentionReleases.invoiceDocumentAdjustmentId, adjustment.id)
    )
    .orderBy(
      desc(qualityRetentionReleases.createdAt),
      desc(qualityRetentionReleases.id)
    );
  const paymentMap = await getReleasePaymentMap(
    db,
    releases.map(release => release.id)
  );
  const enriched = releases.map(release => ({
    ...release,
    paidAmount: paymentMap.get(release.id)?.paidAmount ?? 0,
    reservedAmount: paymentMap.get(release.id)?.reservedAmount ?? 0,
    availableToPayAmount: round4(
      Math.max(
        0,
        money(release.approvedAmount) -
          (paymentMap.get(release.id)?.paidAmount ?? 0) -
          (paymentMap.get(release.id)?.reservedAmount ?? 0)
      )
    ),
  }));
  const originalAmount = money(adjustment.amount);
  return {
    adjustment,
    releases: enriched,
    summary: buildQualityRetentionReleaseSummary(
      originalAmount,
      enriched.map(release => ({
        status: release.status,
        requestedAmount: money(release.requestedAmount),
        approvedAmount: money(release.approvedAmount),
        paidAmount: release.paidAmount,
        reservedAmount: release.reservedAmount,
      }))
    ),
  };
}

export async function listQualityRetentionReleases(input: {
  projectIds?: number[] | null;
  statuses?: QualityRetentionReleaseStatus[];
  excludeBatchId?: number;
}) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [
    eq(invoiceDocumentAdjustments.adjustmentType, "quality_retention"),
  ];
  if (input.projectIds) {
    conditions.push(
      input.projectIds.length
        ? inArray(invoices.projectId, input.projectIds)
        : eq(invoices.id, -1)
    );
  }
  if (input.statuses?.length) {
    conditions.push(inArray(qualityRetentionReleases.status, input.statuses));
  }
  const rows = await db
    .select({
      release: qualityRetentionReleases,
      adjustment: invoiceDocumentAdjustments,
      invoice: invoices,
      project: projects,
      supplier: suppliers,
    })
    .from(qualityRetentionReleases)
    .innerJoin(
      invoiceDocumentAdjustments,
      eq(
        qualityRetentionReleases.invoiceDocumentAdjustmentId,
        invoiceDocumentAdjustments.id
      )
    )
    .innerJoin(invoices, eq(invoiceDocumentAdjustments.invoiceId, invoices.id))
    .innerJoin(projects, eq(invoices.projectId, projects.id))
    .leftJoin(suppliers, eq(invoices.supplierId, suppliers.id))
    .where(and(...conditions))
    .orderBy(
      desc(qualityRetentionReleases.createdAt),
      desc(qualityRetentionReleases.id)
    );
  const paymentMap = await getReleasePaymentMap(
    db,
    rows.map(row => row.release.id),
    input.excludeBatchId
  );
  return rows.map(row => {
    const payment = paymentMap.get(row.release.id) ?? {
      paidAmount: 0,
      reservedAmount: 0,
    };
    const approvedAmount = money(row.release.approvedAmount);
    return {
      ...row,
      paidAmount: payment.paidAmount,
      reservedAmount: payment.reservedAmount,
      availableToPayAmount: round4(
        Math.max(
          0,
          approvedAmount - payment.paidAmount - payment.reservedAmount
        )
      ),
    };
  });
}

export async function getQualityRetentionReleaseById(releaseId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await listQualityRetentionReleases({});
  return rows.find(row => row.release.id === releaseId);
}

export async function requestQualityRetentionRelease(input: {
  invoiceId: number;
  requestedAmount: number;
  justification: string;
  requestedById: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  return db.transaction(async tx => {
    const [row] = await tx
      .select({ adjustment: invoiceDocumentAdjustments, invoice: invoices })
      .from(invoiceDocumentAdjustments)
      .innerJoin(
        invoices,
        eq(invoiceDocumentAdjustments.invoiceId, invoices.id)
      )
      .where(
        and(
          eq(invoiceDocumentAdjustments.invoiceId, input.invoiceId),
          eq(invoiceDocumentAdjustments.adjustmentType, "quality_retention")
        )
      )
      .limit(1)
      .for("update", { of: invoiceDocumentAdjustments });
    if (!row || money(row.adjustment.amount) <= 0) {
      throw new QualityRetentionReleaseRuleError(
        "La factura no tiene retención de calidad disponible."
      );
    }
    if (row.invoice.status !== "registrada") {
      throw new QualityRetentionReleaseRuleError(
        "La factura debe estar contabilizada antes de solicitar una liberación."
      );
    }
    const payment = (
      await getOrdinaryInvoicePaymentMap(tx, [input.invoiceId])
    ).get(input.invoiceId);
    if (!payment?.isPaid) {
      throw new QualityRetentionReleaseRuleError(
        "El neto ordinario de la factura debe estar completamente pagado antes de solicitar la liberación."
      );
    }
    const releases = await tx
      .select()
      .from(qualityRetentionReleases)
      .where(
        eq(
          qualityRetentionReleases.invoiceDocumentAdjustmentId,
          row.adjustment.id
        )
      )
      .orderBy(asc(qualityRetentionReleases.id))
      .for("update");
    if (releases.some(release => release.status === "pending_approval")) {
      throw new QualityRetentionReleaseRuleError(
        "Ya existe una solicitud pendiente de aprobación para esta factura."
      );
    }
    const requestedAmount = money(input.requestedAmount);
    const committed = releases
      .filter(release => COMMITTED_STATUSES.includes(release.status))
      .reduce(
        (sum, release) =>
          sum +
          (release.status === "pending_approval"
            ? money(release.requestedAmount)
            : money(release.approvedAmount)),
        0
      );
    const available = round4(
      Math.max(0, money(row.adjustment.amount) - committed)
    );
    if (requestedAmount <= 0 || requestedAmount > available + 0.0001) {
      throw new QualityRetentionReleaseRuleError(
        `El monto solicitado debe ser mayor que cero y no superar ${available.toFixed(2)}.`
      );
    }
    const [created] = await tx
      .insert(qualityRetentionReleases)
      .values({
        invoiceDocumentAdjustmentId: row.adjustment.id,
        requestedAmount: moneyString(requestedAmount),
        justification: input.justification.trim(),
        requestedById: input.requestedById,
      })
      .returning();
    return created;
  });
}

export async function decideQualityRetentionRelease(input: {
  releaseId: number;
  approved: boolean;
  approvedAmount?: number;
  comment: string;
  decidedById: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  return db.transaction(async tx => {
    const snapshots = await getQualityRetentionReleaseSnapshots(tx, [
      input.releaseId,
    ]);
    const snapshot = snapshots[0]!;
    if (snapshot.release.status !== "pending_approval") {
      throw new QualityRetentionReleaseRuleError(
        "La solicitud ya no está pendiente de aprobación."
      );
    }
    if (!snapshot.ordinaryPayment?.isPaid) {
      throw new QualityRetentionReleaseRuleError(
        "El neto ordinario de la factura debe estar completamente pagado para aprobar."
      );
    }
    const now = new Date();
    if (!input.approved) {
      const [updated] = await tx
        .update(qualityRetentionReleases)
        .set({
          status: "rejected",
          approvedAmount: null,
          decisionComment: input.comment.trim(),
          decidedById: input.decidedById,
          decidedAt: now,
          updatedAt: now,
        })
        .where(eq(qualityRetentionReleases.id, input.releaseId))
        .returning();
      return updated;
    }
    const approvedAmount = money(input.approvedAmount);
    const requestedAmount = money(snapshot.release.requestedAmount);
    if (approvedAmount <= 0 || approvedAmount > requestedAmount + 0.0001) {
      throw new QualityRetentionReleaseRuleError(
        "El monto aprobado debe ser mayor que cero y no superar el monto solicitado."
      );
    }
    const otherReleases = await tx
      .select()
      .from(qualityRetentionReleases)
      .where(
        and(
          eq(
            qualityRetentionReleases.invoiceDocumentAdjustmentId,
            snapshot.adjustment.id
          ),
          ne(qualityRetentionReleases.id, input.releaseId)
        )
      )
      .orderBy(asc(qualityRetentionReleases.id))
      .for("update");
    const otherCommitted = otherReleases
      .filter(release => COMMITTED_STATUSES.includes(release.status))
      .reduce(
        (sum, release) =>
          sum +
          (release.status === "pending_approval"
            ? money(release.requestedAmount)
            : money(release.approvedAmount)),
        0
      );
    if (
      otherCommitted + approvedAmount >
      money(snapshot.adjustment.amount) + 0.0001
    ) {
      throw new QualityRetentionReleaseRuleError(
        "La aprobación supera el saldo retenido disponible."
      );
    }
    const [updated] = await tx
      .update(qualityRetentionReleases)
      .set({
        status: "approved",
        approvedAmount: moneyString(approvedAmount),
        decisionComment: input.comment.trim() || null,
        decidedById: input.decidedById,
        decidedAt: now,
        updatedAt: now,
      })
      .where(eq(qualityRetentionReleases.id, input.releaseId))
      .returning();
    return updated;
  });
}

export async function cancelQualityRetentionRelease(input: {
  releaseId: number;
  reason: string;
  cancelledById: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  return db.transaction(async tx => {
    const snapshots = await getQualityRetentionReleaseSnapshots(tx, [
      input.releaseId,
    ]);
    const snapshot = snapshots[0]!;
    if (!["pending_approval", "approved"].includes(snapshot.release.status)) {
      throw new QualityRetentionReleaseRuleError(
        "Solo se puede cancelar una solicitud pendiente o aprobada sin pagos."
      );
    }
    if (snapshot.money.paidAmount > 0 || snapshot.money.reservedAmount > 0) {
      throw new QualityRetentionReleaseRuleError(
        "No se puede cancelar una liberación con pagos o reservas activas."
      );
    }
    const now = new Date();
    const [updated] = await tx
      .update(qualityRetentionReleases)
      .set({
        status: "cancelled",
        cancellationReason: input.reason.trim(),
        cancelledById: input.cancelledById,
        cancelledAt: now,
        updatedAt: now,
      })
      .where(eq(qualityRetentionReleases.id, input.releaseId))
      .returning();
    return updated;
  });
}

export async function syncQualityRetentionReleasePaymentStatus(
  executor: any,
  releaseId: number
) {
  const [release] = await executor
    .select()
    .from(qualityRetentionReleases)
    .where(eq(qualityRetentionReleases.id, releaseId))
    .limit(1)
    .for("update");
  if (!release?.approvedAmount) return release;
  const paymentMap = await getReleasePaymentMap(executor, [releaseId]);
  const paidAmount = paymentMap.get(releaseId)?.paidAmount ?? 0;
  const approvedAmount = money(release.approvedAmount);
  const status = getQualityRetentionReleasePaymentStatus(
    approvedAmount,
    paidAmount
  );
  const [updated] = await executor
    .update(qualityRetentionReleases)
    .set({ status, updatedAt: new Date() })
    .where(eq(qualityRetentionReleases.id, releaseId))
    .returning();
  return updated;
}
