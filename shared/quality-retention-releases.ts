export const QUALITY_RETENTION_RELEASE_STATUS_CODES = [
  "pending_approval",
  "approved",
  "partially_paid",
  "paid",
  "rejected",
  "cancelled",
] as const;

export type QualityRetentionReleaseStatus =
  (typeof QUALITY_RETENTION_RELEASE_STATUS_CODES)[number];

export const QUALITY_RETENTION_RELEASE_STATUS_LABELS: Readonly<
  Record<QualityRetentionReleaseStatus, string>
> = {
  pending_approval: "Pendiente de aprobación",
  approved: "Aprobada",
  partially_paid: "Parcialmente pagada",
  paid: "Pagada",
  rejected: "Rechazada",
  cancelled: "Cancelada",
};

export const ACTIVE_QUALITY_RETENTION_RELEASE_STATUSES = [
  "pending_approval",
  "approved",
  "partially_paid",
  "paid",
] as const;

export function roundQualityRetentionMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 10_000) / 10_000;
}

export function buildQualityRetentionReleaseSummary(
  originalAmount: number,
  releases: Array<{
    status: QualityRetentionReleaseStatus;
    requestedAmount: number;
    approvedAmount?: number | null;
    paidAmount?: number | null;
    reservedAmount?: number | null;
  }>
) {
  const committed = releases.filter(release =>
    ACTIVE_QUALITY_RETENTION_RELEASE_STATUSES.includes(
      release.status as (typeof ACTIVE_QUALITY_RETENTION_RELEASE_STATUSES)[number]
    )
  );
  const requestedAmount = roundQualityRetentionMoney(
    committed.reduce((sum, release) => sum + release.requestedAmount, 0)
  );
  const approvedAmount = roundQualityRetentionMoney(
    committed.reduce(
      (sum, release) => sum + Number(release.approvedAmount ?? 0),
      0
    )
  );
  const paidAmount = roundQualityRetentionMoney(
    committed.reduce((sum, release) => sum + Number(release.paidAmount ?? 0), 0)
  );
  const reservedAmount = roundQualityRetentionMoney(
    committed.reduce(
      (sum, release) => sum + Number(release.reservedAmount ?? 0),
      0
    )
  );
  const committedAmount = roundQualityRetentionMoney(
    committed.reduce(
      (sum, release) =>
        sum +
        (release.status === "pending_approval"
          ? release.requestedAmount
          : Number(release.approvedAmount ?? 0)),
      0
    )
  );
  return {
    originalAmount: roundQualityRetentionMoney(originalAmount),
    requestedAmount,
    approvedAmount,
    paidAmount,
    reservedAmount,
    availableAmount: roundQualityRetentionMoney(
      Math.max(0, originalAmount - committedAmount)
    ),
  };
}

export function getQualityRetentionReleasePaymentStatus(
  approvedAmount: number,
  paidAmount: number
): QualityRetentionReleaseStatus {
  if (paidAmount + 0.0001 >= approvedAmount) return "paid";
  if (paidAmount > 0) return "partially_paid";
  return "approved";
}
