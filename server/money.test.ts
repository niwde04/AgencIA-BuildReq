import { describe, expect, it } from "vitest";
import {
  decimalToMinorUnits,
  formatDecimalAmount,
  hasAtMostDecimalPlaces,
  roundDecimalAmount,
} from "../shared/money";

describe("decimal money helpers", () => {
  it("rounds exact half cents without IEEE-754 midpoint loss", () => {
    expect(roundDecimalAmount(46_280.3355, 2)).toBe(46_280.34);
    expect(roundDecimalAmount(9_847.335, 2)).toBe(9_847.34);
    expect(roundDecimalAmount(9_573.005, 2)).toBe(9_573.01);
    expect(roundDecimalAmount(317_073.975, 2)).toBe(317_073.98);
  });

  it("rounds negative midpoint values away from zero", () => {
    expect(roundDecimalAmount(-1.005, 2)).toBe(-1.01);
  });

  it("supports exponent notation and integer minor units", () => {
    expect(roundDecimalAmount("1.005e2", 2)).toBe(100.5);
    expect(decimalToMinorUnits("46,280.3355", 2)).toBe(4_628_034);
  });

  it("accepts only values whose extra decimal places are zero", () => {
    expect(hasAtMostDecimalPlaces("100.23", 2)).toBe(true);
    expect(hasAtMostDecimalPlaces("100.2300", 2)).toBe(true);
    expect(hasAtMostDecimalPlaces(0.29, 2)).toBe(true);
    expect(hasAtMostDecimalPlaces("100.231", 2)).toBe(false);
    expect(hasAtMostDecimalPlaces("1e-3", 2)).toBe(false);
  });

  it("formats exact decimal strings without discarding significant digits", () => {
    expect(
      formatDecimalAmount("100.60942500", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 8,
        useGrouping: false,
      })
    ).toBe("100.609425");
    expect(
      formatDecimalAmount("4168.68006811", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 8,
      })
    ).toBe("4,168.68006811");
  });
});
