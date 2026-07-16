import { describe, expect, it } from "vitest";
import {
  consolidateRetentionsForPrint,
  formatRetentionCalendarDate,
  getRetentionCurrencyWord,
  getPrintableRetentionConcepts,
  type RetentionPrintInput,
} from "../client/src/lib/retention-print";

function retention(
  overrides: Partial<RetentionPrintInput> = {}
): RetentionPrintInput {
  return {
    retentionCatalogId: "15",
    retentionCode: "RT15",
    description: "Retención del 15%",
    baseAmount: "100.00",
    percentage: "15.0000",
    ...overrides,
  };
}

describe("preprinted retention concepts", () => {
  it("prints date-only values without subtracting a day", () => {
    expect(formatRetentionCalendarDate("2027-01-10T00:00:00.000Z")).toBe(
      "10/01/2027"
    );
    expect(
      formatRetentionCalendarDate(new Date("2027-01-10T00:00:00.000Z"))
    ).toBe("10/01/2027");
  });

  it("prints the invoice currency name in words", () => {
    expect(getRetentionCurrencyWord("HNL", 2)).toBe("LEMPIRAS");
    expect(getRetentionCurrencyWord("USD", 2)).toBe("DÓLARES");
    expect(getRetentionCurrencyWord("HNL", 1)).toBe("LEMPIRA");
    expect(getRetentionCurrencyWord("USD", 1)).toBe("DÓLAR");
  });

  it("consolidates the same catalog and sums bases and line-rounded amounts", () => {
    const concepts = consolidateRetentionsForPrint([
      retention({ baseAmount: "100.005" }),
      retention({ baseAmount: "200.005" }),
    ]);

    expect(concepts).toHaveLength(1);
    expect(concepts[0]).toMatchObject({
      retentionCatalogId: "15",
      baseAmount: 300.01,
      amount: 45.0014,
      sourceCount: 2,
    });
    expect(concepts[0]?.amount).not.toBe(45.0015);
  });

  it("keeps different catalog concepts separate even with the same rate", () => {
    const concepts = consolidateRetentionsForPrint([
      retention({ retentionCatalogId: "15", retentionCode: "RT15" }),
      retention({ retentionCatalogId: "99", retentionCode: "OTRO15" }),
    ]);

    expect(concepts).toHaveLength(2);
    expect(concepts.map(concept => concept.retentionCode)).toEqual([
      "RT15",
      "OTRO15",
    ]);
  });

  it("uses code, description and rate to group legacy records", () => {
    const concepts = consolidateRetentionsForPrint([
      retention({
        retentionCatalogId: "none",
        retentionCode: " rt15 ",
        description: " Retención del 15% ",
      }),
      retention({
        retentionCatalogId: null,
        retentionCode: "RT15",
        description: "Retención   del 15%",
        baseAmount: "200.00",
      }),
      retention({
        retentionCatalogId: null,
        retentionCode: "RT15",
        description: "Retención especial del 15%",
      }),
      retention({
        retentionCatalogId: null,
        retentionCode: "RT15",
        description: "Retención del 15%",
        percentage: "1",
      }),
    ]);

    expect(concepts).toHaveLength(3);
    expect(concepts[0]).toMatchObject({
      baseAmount: 300,
      amount: 45,
      sourceCount: 2,
    });
  });

  it("preserves the order in which concepts first appear", () => {
    const concepts = consolidateRetentionsForPrint([
      retention({ retentionCatalogId: "3", retentionCode: "RT03" }),
      retention({ retentionCatalogId: "1", retentionCode: "RT01" }),
      retention({ retentionCatalogId: "3", retentionCode: "RT03" }),
      retention({ retentionCatalogId: "2", retentionCode: "RT02" }),
    ]);

    expect(concepts.map(concept => concept.retentionCode)).toEqual([
      "RT03",
      "RT01",
      "RT02",
    ]);
  });

  it("applies the eight-row limit after consolidating concepts", () => {
    const nineConcepts = Array.from({ length: 9 }, (_, index) =>
      retention({
        retentionCatalogId: String(index + 1),
        retentionCode: `RT${index + 1}`,
      })
    );
    const truncated = getPrintableRetentionConcepts(nineConcepts);

    expect(truncated.concepts).toHaveLength(9);
    expect(truncated.printableConcepts).toHaveLength(8);
    expect(truncated.truncated).toBe(true);

    const consolidated = getPrintableRetentionConcepts([
      ...nineConcepts.slice(0, 8),
      retention({ retentionCatalogId: "1", retentionCode: "RT1" }),
    ]);
    expect(consolidated.concepts).toHaveLength(8);
    expect(consolidated.printableConcepts).toHaveLength(8);
    expect(consolidated.truncated).toBe(false);
  });
});
