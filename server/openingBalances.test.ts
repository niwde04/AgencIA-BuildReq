import { afterEach, describe, expect, it, vi } from "vitest";
import {
  normalizeOpeningBalanceItems,
  openingBalanceItemSchema,
} from "../shared/opening-balances";
import { openingBalancesRouter } from "./routers/openingBalances";
import type { TrpcContext } from "./_core/context";
import * as db from "./db";

const item = {
  sapItemCode: "090501425",
  itemName: "PIÑÓN",
  quantity: "2.50",
  projectId: 2,
  storageLocation: " A1 ",
};
const context = (role = "admin", buildreqRole = "administracion_central") =>
  ({
    user: { id: 1, role, buildreqRole },
    req: { headers: {} },
    res: {},
  }) as unknown as TrpcContext;
afterEach(() => vi.restoreAllMocks());

describe("opening balance destination validation", () => {
  it("preserves per-line destinations and trims locations", () => {
    expect(
      normalizeOpeningBalanceItems(
        [item, { ...item, projectId: undefined, storageLocation: " " }],
        1
      )
    ).toMatchObject([
      { projectId: 2, storageLocation: "A1", quantity: "2.50" },
      { projectId: 1, storageLocation: null },
    ]);
  });
  it.each(["0", "-1", "NaN", "Infinity", "10000000000", "0.001", "1abc"])(
    "rejects unsafe quantity %s",
    quantity => {
      expect(
        openingBalanceItemSchema.safeParse({ ...item, quantity }).success
      ).toBe(false);
    }
  );
  it("rejects an invalid project or overlong location", () => {
    expect(
      openingBalanceItemSchema.safeParse({ ...item, projectId: 0 }).success
    ).toBe(false);
    expect(
      openingBalanceItemSchema.safeParse({
        ...item,
        storageLocation: "x".repeat(256),
      }).success
    ).toBe(false);
  });
  it("passes line destinations through create and append endpoints", async () => {
    const create = vi
      .spyOn(db, "createOpeningBalance")
      .mockResolvedValue({ id: 1, balanceNumber: "SI-001", warehouseId: 1 });
    const append = vi
      .spyOn(db, "addOpeningBalanceItems")
      .mockResolvedValue({ success: true, addedItems: 1 });
    const caller = openingBalancesRouter.createCaller(context());
    await caller.create({ warehouseId: 1, items: [item] });
    await caller.addItems({ id: 1, items: [item] });
    expect(create.mock.calls[0][1][0]).toMatchObject({
      projectId: 2,
      storageLocation: "A1",
    });
    expect(append.mock.calls[0][1][0]).toMatchObject({
      projectId: 2,
      storageLocation: "A1",
    });
  });
  it("denies destination suggestions and posting to users without opening balance permissions", async () => {
    const locations = vi.spyOn(db, "listOpeningBalanceStorageLocations");
    const append = vi.spyOn(db, "addOpeningBalanceItems");
    const caller = openingBalancesRouter.createCaller(
      context("user", "ingeniero_residente")
    );
    await expect(
      caller.storageLocations({ warehouseId: 1, projectId: 2 })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      caller.addItems({ id: 1, items: [item] })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(locations).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();
  });
});
