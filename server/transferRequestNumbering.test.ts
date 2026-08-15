import { describe, expect, it, vi } from "vitest";
import { findAvailableProjectScopedDocumentNumber } from "./db";

describe("transfer request numbering", () => {
  it("keeps the project sequence after its visible code changes", async () => {
    await expect(
      findAvailableProjectScopedDocumentNumber({
        prefix: "ST",
        projectCode: "001B",
        existingNumbers: [
          "ST-001-00000011",
          "ST-023-00000012",
          "SC-001B-00000099",
        ],
        isDocumentNumberTaken: vi.fn().mockResolvedValue(false),
      })
    ).resolves.toBe("ST-001B-00000013");
  });

  it("skips document numbers already used by another project", async () => {
    const takenNumbers = new Set(["ST-023-00000007", "ST-023-00000008"]);
    const isDocumentNumberTaken = vi.fn(async (documentNumber: string) =>
      takenNumbers.has(documentNumber)
    );

    await expect(
      findAvailableProjectScopedDocumentNumber({
        prefix: "ST",
        projectCode: "023",
        existingNumbers: [
          "ST-018-00000004",
          "ST-023-00000005",
          "ST-006-00000006",
        ],
        isDocumentNumberTaken,
      })
    ).resolves.toBe("ST-023-00000009");

    expect(isDocumentNumberTaken.mock.calls.map(([value]) => value)).toEqual([
      "ST-023-00000007",
      "ST-023-00000008",
      "ST-023-00000009",
    ]);
  });
});
