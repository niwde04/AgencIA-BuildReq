import { describe, expect, it } from "vitest";
import {
  isReceiptArticleSubstitution,
  normalizeReceiptArticleIdentity,
  normalizeReceiptArticleValue,
} from "../shared/receipt-substitutions";

describe("receipt article substitutions", () => {
  it("ignores casing and repeated spaces when comparing brand and part", () => {
    expect(
      isReceiptArticleSubstitution({
        requested: { brand: "Fleetguard", partNumber: " LF  14000 NN " },
        received: { brand: " fleetGUARD ", partNumber: "lf 14000 nn" },
      })
    ).toBe(false);
  });

  it("detects a change in either brand or part number", () => {
    expect(
      isReceiptArticleSubstitution({
        requested: { brand: "Fleetguard", partNumber: "LF14000NN" },
        received: { brand: "Donaldson", partNumber: "LF14000NN" },
      })
    ).toBe(true);
    expect(
      isReceiptArticleSubstitution({
        requested: { brand: "Fleetguard", partNumber: "LF14000NN" },
        received: { brand: "Fleetguard", partNumber: "LF14001NN" },
      })
    ).toBe(true);
  });

  it("keeps display casing while trimming and collapsing spaces", () => {
    expect(normalizeReceiptArticleValue("  Fleetguard   Premium ")).toBe(
      "Fleetguard Premium"
    );
    expect(normalizeReceiptArticleIdentity("  SAP   001 ")).toBe("sap 001");
  });
});
