import { describe, expect, it } from "vitest";
import {
  buildQualityRetentionReleaseSummary,
  getQualityRetentionReleasePaymentStatus,
} from "../shared/quality-retention-releases";

describe("liberaciones de retención de calidad", () => {
  it("reserva el monto solicitado mientras espera aprobación", () => {
    expect(
      buildQualityRetentionReleaseSummary(100, [
        { status: "pending_approval", requestedAmount: 40 },
      ])
    ).toEqual({
      originalAmount: 100,
      requestedAmount: 40,
      approvedAmount: 0,
      paidAmount: 0,
      reservedAmount: 0,
      availableAmount: 60,
    });
  });

  it("devuelve al disponible la diferencia de una aprobación reducida", () => {
    const summary = buildQualityRetentionReleaseSummary(100, [
      { status: "approved", requestedAmount: 80, approvedAmount: 55 },
    ]);
    expect(summary.requestedAmount).toBe(80);
    expect(summary.approvedAmount).toBe(55);
    expect(summary.availableAmount).toBe(45);
  });

  it("excluye rechazadas y canceladas del saldo comprometido", () => {
    const summary = buildQualityRetentionReleaseSummary(100, [
      { status: "rejected", requestedAmount: 30 },
      { status: "cancelled", requestedAmount: 20, approvedAmount: 20 },
      {
        status: "paid",
        requestedAmount: 25,
        approvedAmount: 25,
        paidAmount: 25,
      },
    ]);
    expect(summary.availableAmount).toBe(75);
    expect(summary.paidAmount).toBe(25);
  });

  it("mantiene cuatro decimales y determina pagos parciales", () => {
    expect(
      buildQualityRetentionReleaseSummary(10.1234, [
        {
          status: "approved",
          requestedAmount: 3.3333,
          approvedAmount: 3.3333,
          reservedAmount: 1.1111,
        },
      ]).availableAmount
    ).toBe(6.7901);
    expect(getQualityRetentionReleasePaymentStatus(50, 0)).toBe("approved");
    expect(getQualityRetentionReleasePaymentStatus(50, 20)).toBe(
      "partially_paid"
    );
    expect(getQualityRetentionReleasePaymentStatus(50, 50)).toBe("paid");
  });
});
