import { describe, expect, it } from "vitest";
import {
  ARTICLE_COMPACT_SEARCH_FIELD_NAMES,
  ARTICLE_SEARCH_FIELD_NAMES,
} from "./db";

describe("article search fields", () => {
  it("includes fixed asset identifiers used by field teams", () => {
    expect(ARTICLE_SEARCH_FIELD_NAMES).toEqual(
      expect.arrayContaining([
        "itemCode",
        "temporaryItemCode",
        "description",
        "brand",
        "partNumber",
        "fixedAssetSerialNumber",
        "fixedAssetBrand",
        "fixedAssetModel",
        "fixedAssetChassisSeries",
        "fixedAssetMotorSeries",
        "fixedAssetPlateOrCode",
        "fixedAssetObservation",
      ])
    );
  });

  it("normalizes compact searches for codes, serials, chassis, motors and plates", () => {
    expect(ARTICLE_COMPACT_SEARCH_FIELD_NAMES).toEqual(
      expect.arrayContaining([
        "itemCode",
        "temporaryItemCode",
        "brand",
        "partNumber",
        "fixedAssetSerialNumber",
        "fixedAssetModel",
        "fixedAssetBrand",
        "fixedAssetChassisSeries",
        "fixedAssetMotorSeries",
        "fixedAssetPlateOrCode",
      ])
    );
  });
});
