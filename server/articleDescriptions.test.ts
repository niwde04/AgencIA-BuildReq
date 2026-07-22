import { describe, expect, it } from "vitest";
import {
  normalizeArticleDescription,
  normalizeOptionalArticleDescription,
  uppercaseArticleDescription,
} from "@shared/article-descriptions";

describe("article description normalization", () => {
  it("uppercases descriptions while preserving accents, numbers and punctuation", () => {
    expect(normalizeArticleDescription("  Grúa ñandú 3-ch/24-bit  ")).toBe(
      "GRÚA ÑANDÚ 3-CH/24-BIT"
    );
  });

  it("keeps in-progress form spacing while uppercasing", () => {
    expect(uppercaseArticleDescription("  Cemento gris ")).toBe(
      "  CEMENTO GRIS "
    );
  });

  it("preserves null and undefined optional descriptions", () => {
    expect(normalizeOptionalArticleDescription(null)).toBeNull();
    expect(normalizeOptionalArticleDescription(undefined)).toBeUndefined();
  });
});
