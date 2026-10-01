import { afterEach, describe, expect, it, vi } from "vitest";
import { appRouter } from "./routers";
import * as db from "./db";
import * as reversals from "./invoiceReversals";
import { canRevertAccountedInvoices } from "../shared/invoices";

const authorized = {
  id: 193,
  role: "admin",
  email: "ed_barah@hotmail.com",
  isActive: true,
};
const caller = (user: any) =>
  appRouter.createCaller({ user, req: {}, res: {} } as any);
afterEach(() => vi.restoreAllMocks());
describe("invoice reversal authorization", () => {
  it.each([
    { role: "admin", email: "otro@buildreq.com" },
    { role: "user", email: "ed_barah@hotmail.com", buildreqRole: "contable" },
    { ...authorized, isActive: false },
    { role: "admin" },
  ])(
    "denies reversal for %o before reading or changing any invoice",
    async user => {
      const read = vi.spyOn(db, "getInvoiceById");
      const write = vi.spyOn(reversals, "revertInvoiceToTreasury");
      await expect(
        caller(user).invoices.revertToTreasury({
          id: 1884,
          reason: "Corregir factura",
        })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(read).not.toHaveBeenCalled();
      expect(write).not.toHaveBeenCalled();
    }
  );
  it("requires authentication", async () => {
    await expect(
      caller(null).invoices.revertToTreasury({
        id: 1884,
        reason: "Corregir factura",
      })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
  it.each(["", "    ", "corto".repeat(401)])(
    "rejects missing or excessive reasons",
    async reason => {
      const write = vi.spyOn(reversals, "revertInvoiceToTreasury");
      await expect(
        caller(authorized).invoices.revertToTreasury({ id: 1884, reason })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(write).not.toHaveBeenCalled();
    }
  );
  it("uses the authenticated actor and trimmed reason, including canonical email normalization", async () => {
    vi.spyOn(db, "getInvoiceById").mockResolvedValue({
      invoice: { id: 1884, projectId: 22, status: "registrada" },
    } as any);
    const result = {
      id: 1884,
      status: "pendiente_contabilizar" as const,
      reversalId: 1,
      voidedRetentionCount: 1,
    };
    const write = vi
      .spyOn(reversals, "revertInvoiceToTreasury")
      .mockResolvedValue(result);
    expect(
      await caller({
        ...authorized,
        email: " ED_BARAH@HOTMAIL.COM ",
      }).invoices.revertToTreasury({
        id: 1884,
        reason: "  Corregir factura  ",
        actorId: 999,
      } as any)
    ).toEqual(result);
    expect(write).toHaveBeenCalledWith(1884, 193, "Corregir factura");
    expect(
      canRevertAccountedInvoices({
        ...authorized,
        email: " ED_BARAH@HOTMAIL.COM ",
      })
    ).toBe(true);
  });
  it("rejects nonexistent invoices without attempting a write", async () => {
    vi.spyOn(db, "getInvoiceById").mockResolvedValue(null);
    const write = vi.spyOn(reversals, "revertInvoiceToTreasury");
    await expect(
      caller(authorized).invoices.revertToTreasury({
        id: 1884,
        reason: "Corregir factura",
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(write).not.toHaveBeenCalled();
  });
  it("does not reveal reversal history outside the caller's project", async () => {
    vi.spyOn(db, "getInvoiceById").mockResolvedValue({
      invoice: { id: 1884, projectId: 22, status: "borrador" },
    } as any);
    const history = vi.spyOn(reversals, "getInvoiceReversalHistory");
    await expect(
      caller({
        id: 3,
        role: "user",
        buildreqRole: "administrador_proyecto",
        assignedProjectId: 1,
      }).invoices.reversalHistory({ id: 1884 })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(history).not.toHaveBeenCalled();
  });
});
