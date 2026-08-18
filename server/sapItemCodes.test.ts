import { describe, expect, it } from "vitest";
import {
  extractSapItemGroupCode,
  formatSapItemCode,
  getNextSapItemCode,
} from "../shared/sap-item-codes";
import { allocateNextSapItemCode } from "./sapItemCodeAllocator";

describe("SAP item code sequences", () => {
  it.each([
    ["0101 - COMBUSTIBLES", "0101"],
    ["0101-COMBUSTIBLES", "0101"],
    [" 0702 MAQUINARIA PESADA", "0702"],
  ])("extracts the four-digit group from %s", (itemGroup, expected) => {
    expect(extractSapItemGroupCode(itemGroup)).toBe(expected);
  });

  it.each([null, undefined, "", "FILTROS", "101 - COMBUSTIBLES"])(
    "rejects an item group without a four-digit prefix: %s",
    itemGroup => {
      expect(extractSapItemGroupCode(itemGroup)).toBeNull();
    }
  );

  it("creates a five-digit sequence after the four-digit group", () => {
    expect(formatSapItemCode("0101", 1)).toBe("010100001");
    expect(getNextSapItemCode("0101", "010100001")).toBe("010100002");
    expect(getNextSapItemCode("0905", "090504024")).toBe("090504025");
  });

  it("assigns consecutive codes to multiple new products", () => {
    const first = getNextSapItemCode("0101", "010100005");
    const second = getNextSapItemCode("0101", first);
    const third = getNextSapItemCode("0101", second);

    expect([first, second, third]).toEqual([
      "010100006",
      "010100007",
      "010100008",
    ]);
  });

  it("does not allow crossing the five-digit sequence limit", () => {
    expect(() => getNextSapItemCode("0101", "010199999")).toThrow(
      "agotó su secuencia"
    );
  });

  it("serializes concurrent allocations and returns a unique sequence", async () => {
    const codes = new Set(["010100005"]);
    let lockTail = Promise.resolve();
    const withGroupLock = async <Result>(
      _groupCode: string,
      allocate: () => Promise<Result>
    ) => {
      const previous = lockTail;
      let release = () => undefined;
      lockTail = new Promise<void>(resolve => {
        release = resolve;
      });
      await previous;
      try {
        return await allocate();
      } finally {
        release();
      }
    };

    const allocations = await Promise.all(
      Array.from({ length: 20 }, () =>
        allocateNextSapItemCode({
          itemGroup: "0101 - COMBUSTIBLES",
          withGroupLock,
          findLatestItemCode: async () =>
            Array.from(codes).sort().at(-1) ?? null,
          tryInsert: async itemCode => {
            if (codes.has(itemCode)) return null;
            codes.add(itemCode);
            return itemCode;
          },
        })
      )
    );

    expect(new Set(allocations).size).toBe(20);
    expect(allocations).toEqual(
      Array.from({ length: 20 }, (_, index) =>
        formatSapItemCode("0101", index + 6)
      )
    );
  });

  it("recalculates after an unexpected unique-code conflict", async () => {
    const codes = new Set(["010100005"]);
    let firstAttempt = true;
    const allocated = await allocateNextSapItemCode({
      itemGroup: "0101-COMBUSTIBLES",
      withGroupLock: async (_groupCode, allocate) => allocate(),
      findLatestItemCode: async () => Array.from(codes).sort().at(-1) ?? null,
      tryInsert: async itemCode => {
        if (firstAttempt) {
          firstAttempt = false;
          codes.add(itemCode);
          return null;
        }
        codes.add(itemCode);
        return itemCode;
      },
    });

    expect(allocated).toBe("010100007");
  });
});
