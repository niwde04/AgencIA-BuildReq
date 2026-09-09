import { describe, expect, it } from "vitest";
import {
  assertConfirmedTransferCanBeCancelled,
  ConfirmedTransferCancellationError,
} from "./confirmedTransferCancellation";

const validState = {
  transferStatus: "confirmado",
  transferRequestStatus: "convertida",
  reverseLogisticId: null,
  activeReceiptCount: 0,
  items: [
    {
      itemName: "LLANTA 11.00R22.5",
      receivedQuantity: "0.00",
      returnedToOriginQuantity: "0.00",
      receiptClosed: false,
    },
  ],
  requestItems: [
    {
      itemName: "LLANTA 11.00R22.5",
      assignedFlow: "traslado_proyecto",
      status: "pendiente",
      deliveredQuantity: "0.00",
      dispatchedQuantity: "0.00",
    },
  ],
};

describe("confirmed transfer cancellation", () => {
  it("allows an untouched confirmed transfer", () => {
    expect(() =>
      assertConfirmedTransferCanBeCancelled(validState)
    ).not.toThrow();
  });

  it("rejects a transfer with a saved receipt", () => {
    expect(() =>
      assertConfirmedTransferCanBeCancelled({
        ...validState,
        activeReceiptCount: 1,
      })
    ).toThrowError(
      new ConfirmedTransferCancellationError(
        "INVALID_STATE",
        "No se puede anular porque ya existe una recepción guardada para este traslado"
      )
    );
  });

  it("rejects a transfer item with received quantity", () => {
    expect(() =>
      assertConfirmedTransferCanBeCancelled({
        ...validState,
        items: [
          {
            ...validState.items[0],
            receivedQuantity: "1.00",
          },
        ],
      })
    ).toThrow("ya tiene recepción, devolución o cierre registrado");
  });

  it("rejects a requisition item that changed flow", () => {
    expect(() =>
      assertConfirmedTransferCanBeCancelled({
        ...validState,
        requestItems: [
          {
            ...validState.requestItems[0],
            assignedFlow: "despacho_bodega",
          },
        ],
      })
    ).toThrow("ya cambió de flujo o tiene movimiento registrado");
  });
});
