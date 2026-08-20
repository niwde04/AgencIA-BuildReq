import { describe, expect, it } from "vitest";
import { normalizeUnitValue, UNITS } from "../shared/units";

describe("units", () => {
  it.each([
    ["UNIDAD", "und"],
    ["galón", "gal"],
    ["Libras", "lb"],
    ["Litros", "lt"],
    ["Metros", "m"],
    ["Tonelada", "ton"],
  ])("normalizes the legacy alias %s", (input, expected) => {
    expect(normalizeUnitValue(input)).toBe(expected);
  });

  it("keeps the additional units observed in current operations", () => {
    expect(UNITS.map(unit => unit.value)).toEqual(
      expect.arrayContaining([
        "juego",
        "kit",
        "paquete",
        "resma",
        "cuarto",
        "barril",
        "yarda",
      ])
    );
  });
});
