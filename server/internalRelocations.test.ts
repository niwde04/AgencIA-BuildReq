import { describe, expect, it } from "vitest";
import {
  getTransferMovementKind,
  getInternalRelocationDestinationError,
  isInternalRelocationLine,
  isSameTransferScope,
  normalizeStorageLocation,
  sameStorageLocation,
} from "@shared/internal-relocations";
import { assertValidTransferConversionDestination } from "./transferConversionValidation";
import { assertAggregatedTransferStockAvailability } from "./db";

const request = {
  projectId: 1,
  destinationType: "proyecto",
  destinationProjectId: 1,
  destinationWarehouseId: 10,
  materialRequestId: null,
  reverseLogisticId: null,
  notes: "Regularización de ubicación",
};
const line = {
  itemName: "FILTRO SIMULADO",
  quantity: "3.00",
  sourceProjectId: 1,
  sourceWarehouseId: 10,
  sourceStorageLocation: "4B4",
  materialRequestItemId: null,
};

describe("internal relocation scope and identity", () => {
  it("recognizes a standalone same-project same-warehouse line", () => {
    expect(isSameTransferScope(request, line)).toBe(true);
    expect(isInternalRelocationLine(request, line)).toBe(true);
    expect(getTransferMovementKind(request, [line])).toBe("internal");
  });

  it("keeps ordinary project and warehouse transfers outside internal relocation", () => {
    const otherWarehouse = { ...line, sourceWarehouseId: 20 };
    const otherProject = { ...line, sourceProjectId: 2 };
    expect(isInternalRelocationLine(request, otherWarehouse)).toBe(false);
    expect(isInternalRelocationLine(request, otherProject)).toBe(false);
    expect(
      getTransferMovementKind(request, [otherWarehouse, otherProject])
    ).toBe("transfer");
  });

  it("detects mixed line scopes instead of inferring from the header", () => {
    expect(
      getTransferMovementKind(request, [line, { ...line, sourceProjectId: 2 }])
    ).toBe("mixed");
  });

  it("ignores unconfirmed zero-quantity rows when classifying a document", () => {
    expect(
      getTransferMovementKind(request, [
        line,
        { ...line, sourceProjectId: 2, quantity: "0.00" },
      ])
    ).toBe("internal");
  });

  it("does not mistake an alternate physical destination warehouse for the source", () => {
    expect(isSameTransferScope(request, line, 20)).toBe(false);
    expect(
      getInternalRelocationDestinationError(request, line, 20, "4B5")
    ).toBeTruthy();
  });

  it.each([null, "", "  ", "4B4", " 4b4 "])(
    "rejects an unidentified or identical target %j",
    location => {
      expect(
        getInternalRelocationDestinationError(request, line, 10, location)
      ).toBeTruthy();
    }
  );

  it("allows an identified new target and unlocated source", () => {
    expect(
      getInternalRelocationDestinationError(request, line, 10, "4B5")
    ).toBeNull();
    expect(
      getInternalRelocationDestinationError(
        request,
        { ...line, sourceStorageLocation: null },
        10,
        "4B5"
      )
    ).toBeNull();
  });

  it.each([
    { ...request, materialRequestId: 20 },
    { ...request, materialRequestId: undefined },
    { ...request, reverseLogisticId: 20 },
    { ...request, destinationType: "bodega_central" },
  ])(
    "does not treat a linked or unclassified request as internal: %o",
    linked => {
      expect(isInternalRelocationLine(linked, line)).toBe(false);
    }
  );

  it("does not admit a requisition-linked line in a standalone request", () => {
    expect(
      isInternalRelocationLine(request, { ...line, materialRequestItemId: 20 })
    ).toBe(false);
  });

  it("distinguishes explicit unclassified stock from a missing legacy source project", () => {
    expect(
      isSameTransferScope(request, { ...line, sourceProjectId: null })
    ).toBe(false);
    expect(
      isSameTransferScope(request, { ...line, sourceProjectId: undefined })
    ).toBe(true);
  });

  it("normalizes only the existing storage-location identity semantics", () => {
    expect(normalizeStorageLocation(" 4B4 ")).toBe("4B4");
    expect(normalizeStorageLocation("  ")).toBeNull();
    expect(sameStorageLocation(" 4B4 ", "4b4")).toBe(true);
    expect(sameStorageLocation(null, " ")).toBe(true);
    expect(sameStorageLocation("4B4", "4B5")).toBe(false);
  });

  it("accepts an internal conversion with an explicit standalone request and reason", () => {
    expect(() =>
      assertValidTransferConversionDestination({
        ...request,
        fallbackSourceProjectId: 1,
        items: [line],
      } as any)
    ).not.toThrow();
  });

  it.each([
    0.001,
    "0.001",
    "1.234",
    "NaN",
    Number.NaN,
    Number.POSITIVE_INFINITY,
    "1e-3",
    "1,25",
  ])(
    "rejects an internal quantity that cannot be stored at two decimals: %j",
    quantity => {
      expect(() =>
        assertValidTransferConversionDestination({
          ...request,
          fallbackSourceProjectId: 1,
          items: [{ ...line, quantity }],
        } as any)
      ).toThrow();
    }
  );

  it("accepts a positive fractional quantity at the supported precision", () => {
    expect(() =>
      assertValidTransferConversionDestination({
        ...request,
        fallbackSourceProjectId: 1,
        items: [{ ...line, quantity: "0.25" }],
      } as any)
    ).not.toThrow();
  });

  it("keeps a same-scope requisition conversion prohibited", () => {
    expect(() =>
      assertValidTransferConversionDestination({
        ...request,
        materialRequestId: 77,
        fallbackSourceProjectId: 1,
        items: [line],
      } as any)
    ).toThrow();
  });

  it("rejects mixing an internal line with an ordinary transfer", () => {
    expect(() =>
      assertValidTransferConversionDestination({
        ...request,
        fallbackSourceProjectId: 1,
        items: [line, { ...line, sourceWarehouseId: 20 }],
      } as any)
    ).toThrow();
  });

  it("rejects an internal conversion without a meaningful reason", () => {
    expect(() =>
      assertValidTransferConversionDestination({
        ...request,
        notes: " ",
        fallbackSourceProjectId: 1,
        items: [line],
      } as any)
    ).toThrow();
  });

  it("checks the sum of quantities sharing an origin, including case variants", async () => {
    const item = { itemName: "FILTRO SIMULADO", sapItemCode: "SIM-001" };
    const entry = {
      item,
      transferQuantity: 6,
      sourceProjectId: 1,
      sourceWarehouseId: 10,
      sourceStorageLocation: "4B4",
    };
    await expect(
      assertAggregatedTransferStockAvailability(
        [
          entry,
          { ...entry, transferQuantity: 5, sourceStorageLocation: " 4b4 " },
        ],
        async () => 10
      )
    ).rejects.toThrow("solicitado total: 11.00");
  });
});
