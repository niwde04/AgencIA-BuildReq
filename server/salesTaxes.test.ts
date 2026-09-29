import { afterEach, describe, expect, it, vi } from "vitest";
import * as db from "./db";
import { taxesRouter } from "./routers/taxes";
const input = {
  taxCode: "isv_15",
  description: "ISV 15%",
  shortLabel: "ISV 15%",
  ratePercent: "15",
  taxType: "base" as const,
  fiscalCategory: "gravado" as const,
  isActive: true,
  displayOrder: 20,
};
const caller = (role = "contable") =>
  taxesRouter.createCaller({
    user: { id: 1, role: "user", buildreqRole: role },
  } as any);
afterEach(() => vi.restoreAllMocks());
describe("sales tax financial group API", () => {
  it("allows authorized assignments and trims the financial code", async () => {
    const save = vi
      .spyOn(db, "createSalesTax")
      .mockResolvedValue({ id: 1 } as any);
    await caller().create({ ...input, financialGroupCode: " FG-TAX1 " });
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ financialGroupCode: "FG-TAX1" })
    );
  });
  it("preserves omitted fields and passes null for explicit removal", async () => {
    const save = vi
      .spyOn(db, "updateSalesTax")
      .mockResolvedValue({ id: 1 } as any);
    await caller().update({ ...input, id: 1 });
    expect(save).toHaveBeenLastCalledWith(
      1,
      expect.objectContaining({ financialGroupCode: undefined })
    );
    await caller().update({ ...input, id: 1, financialGroupCode: null });
    expect(save).toHaveBeenLastCalledWith(
      1,
      expect.objectContaining({ financialGroupCode: null })
    );
  });
  it("denies readers and malformed group values before persistence", async () => {
    const save = vi
      .spyOn(db, "updateSalesTax")
      .mockResolvedValue({ id: 1 } as any);
    await expect(
      caller("bodeguero_proyecto").update({
        ...input,
        id: 1,
        financialGroupCode: "FG-TAX1",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    for (const financialGroupCode of ["", " ", "x".repeat(21)])
      await expect(
        caller().update({ ...input, id: 1, financialGroupCode })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(save).not.toHaveBeenCalled();
  });
});
