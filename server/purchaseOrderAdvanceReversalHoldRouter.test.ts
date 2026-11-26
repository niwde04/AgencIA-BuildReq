import { afterEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
import * as advances from "./purchaseOrderAdvances";
import { purchaseOrderAdvancesRouter } from "./routers/purchaseOrderAdvances";

const accountant = { id: 51, role: "user", buildreqRole: "contable" };
const request = {
  id: 144,
  reversalId: 23,
  reason: "Autorizar el nuevo pago del anticipo",
  evidenceNote: "Confirmado contra la devolución bancaria documentada",
};

function caller(user: object | null) {
  return purchaseOrderAdvancesRouter.createCaller({
    user,
    req: {},
    res: {},
  } as TrpcContext);
}

afterEach(() => vi.restoreAllMocks());

describe("release purchase order advance reversal hold", () => {
  it("denies release by Administración Central before reading the advance", async () => {
    const read = vi.spyOn(advances, "listPurchaseOrderAdvances");
    const release = vi.spyOn(
      advances,
      "releasePurchaseOrderAdvanceReversalHold"
    );

    await expect(
      caller({
        ...accountant,
        buildreqRole: "administracion_central",
      }).releaseReversalHold(request)
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    expect(read).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
  });

  it("requires the expected reversal and an evidence note", async () => {
    const release = vi.spyOn(
      advances,
      "releasePurchaseOrderAdvanceReversalHold"
    );

    await expect(
      caller(accountant).releaseReversalHold({ ...request, evidenceNote: " " })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller(accountant).releaseReversalHold({ ...request, reversalId: 0 })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    expect(release).not.toHaveBeenCalled();
  });

  it("passes the session actor and the expected hold to the service", async () => {
    vi.spyOn(advances, "listPurchaseOrderAdvances").mockResolvedValue([
      { advance: { projectId: 10 } },
    ]);
    const result = { advanceId: 144, reversalId: 23 };
    const release = vi
      .spyOn(advances, "releasePurchaseOrderAdvanceReversalHold")
      .mockResolvedValue(result);

    await expect(
      caller(accountant).releaseReversalHold({
        ...request,
        reason: ` ${request.reason} `,
        evidenceNote: ` ${request.evidenceNote} `,
      })
    ).resolves.toEqual(result);

    expect(release).toHaveBeenCalledWith({
      advanceId: request.id,
      reversalId: request.reversalId,
      actor: accountant,
      reason: request.reason,
      evidenceNote: request.evidenceNote,
    });
  });
});
