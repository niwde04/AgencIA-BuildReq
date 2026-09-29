import { describe, expect, it, vi, afterEach } from "vitest";
import * as db from "./db";
import { retentionsRouter } from "./routers/retentions";

const input = {
  taxCode: " rt01 ",
  description: " Retención ",
  ratePercent: "1",
  isActive: true,
};
const caller = (role = "contable") =>
  retentionsRouter.createCaller({
    user: { id: 1, role: "user", buildreqRole: role },
  } as any);
afterEach(() => vi.restoreAllMocks());

describe("retention financial group API", () => {
  it("lets accountants assign a trimmed financial group", async () => {
    const save = vi
      .spyOn(db, "createTaxRetention")
      .mockResolvedValue({ id: 10 } as any);
    await caller().create({ ...input, financialGroupCode: " 5101 " });
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ taxCode: "RT01", financialGroupCode: "5101" })
    );
  });
  it("distinguishes an omitted group from explicit removal", async () => {
    const save = vi
      .spyOn(db, "updateTaxRetention")
      .mockResolvedValue({ id: 10 } as any);
    await caller().update({ ...input, id: 10 });
    expect(save).toHaveBeenLastCalledWith(
      10,
      expect.objectContaining({ financialGroupCode: undefined })
    );
    await caller().update({ ...input, id: 10, financialGroupCode: null });
    expect(save).toHaveBeenLastCalledWith(
      10,
      expect.objectContaining({ financialGroupCode: null })
    );
  });
  it("denies writes to readers and rejects invalid group payloads before persistence", async () => {
    const save = vi
      .spyOn(db, "updateTaxRetention")
      .mockResolvedValue({ id: 10 } as any);
    await expect(
      caller("administrador_proyecto").update({
        ...input,
        id: 10,
        financialGroupCode: "5101",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    for (const financialGroupCode of ["", " ", "x".repeat(21)]) {
      await expect(
        caller().update({ ...input, id: 10, financialGroupCode })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    expect(save).not.toHaveBeenCalled();
  });
});
