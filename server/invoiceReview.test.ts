import { describe, expect, it } from "vitest";
import { isTreasuryItemBlockingInvoiceReview } from "./invoiceReview";

describe("invoice review treasury restrictions", () => {
  it("ignores items from cancelled payment batches", () => {
    expect(
      isTreasuryItemBlockingInvoiceReview({
        batchStatus: "anulado",
        itemStatus: "aprobada",
        activeReservation: false,
      })
    ).toBe(false);
  });

  it("ignores a stale reservation flag when the batch is cancelled", () => {
    expect(
      isTreasuryItemBlockingInvoiceReview({
        batchStatus: "anulado",
        itemStatus: "aprobada",
        activeReservation: true,
      })
    ).toBe(false);
  });

  it("blocks items that still reserve the invoice", () => {
    expect(
      isTreasuryItemBlockingInvoiceReview({
        batchStatus: "borrador",
        itemStatus: "incluida",
        activeReservation: true,
      })
    ).toBe(true);
  });

  it.each(["pagada", "con_diferencia", "contabilizada"] as const)(
    "blocks a settled item in status %s even after releasing its reservation",
    itemStatus => {
      expect(
        isTreasuryItemBlockingInvoiceReview({
          batchStatus: "cerrado",
          itemStatus,
          activeReservation: false,
        })
      ).toBe(true);
    }
  );

  it("keeps blocking settled items even if a batch has an inconsistent cancelled status", () => {
    expect(
      isTreasuryItemBlockingInvoiceReview({
        batchStatus: "anulado",
        itemStatus: "contabilizada",
        activeReservation: false,
      })
    ).toBe(true);
  });

  it.each(["excluida", "rechazada_banco"] as const)(
    "allows a released, unsettled item in status %s",
    itemStatus => {
      expect(
        isTreasuryItemBlockingInvoiceReview({
          batchStatus: "cerrado",
          itemStatus,
          activeReservation: false,
        })
      ).toBe(false);
    }
  );
});
