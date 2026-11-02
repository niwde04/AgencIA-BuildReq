import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { normalizeArticleDescription } from "../shared/article-descriptions";
import {
  getFixedAssetExportDescription,
  type FixedAssetExportDescriptionReference,
} from "./fixedAssetExportDescriptions";
import { parseFixedAssetDescriptionBuildOptions } from "../scripts/build-fixed-asset-export-descriptions";

const reference = JSON.parse(
  readFileSync(
    new URL("./data/fixed-asset-export-descriptions.json", import.meta.url),
    "utf8"
  )
) as FixedAssetExportDescriptionReference;
const auditedRows = (
  JSON.parse(
    readFileSync(
      new URL(
        "../reports/fixed-assets-imports/hidalgo-description-complete-apply.json",
        import.meta.url
      ),
      "utf8"
    )
  ) as {
    updatedRows: Array<{
      itemCode: string;
      description: string;
      previous: { description: string };
    }>;
  }
).updatedRows;
const byCode = new Map(auditedRows.map(row => [row.itemCode, row]));
const exportDescription = (
  itemCode: string,
  description = byCode.get(itemCode)!.description,
  tipoArticulo = 3
) => getFixedAssetExportDescription({ itemCode, description, tipoArticulo });

describe("verified short fixed asset export descriptions", () => {
  it("uses the original short name of the reported applicator", () => {
    expect(exportDescription("020100001")).toBe("APLICADOR BITUMEN HIERRO");
  });

  it("resolves the two WYCO assets by their own exact code and known description", () => {
    const first = byCode.get("020100181")!,
      second = byCode.get("020100182")!;
    expect(first.description).not.toBe(second.description);
    expect(exportDescription(first.itemCode)).toBe("VIBRADOR CONCRETO");
    expect(exportDescription(second.itemCode)).toBe("VIBRADOR CONCRETO");
    expect(exportDescription(first.itemCode, second.description)).toBe(
      second.description
    );
  });

  it("preserves a legitimate brand in the short name rather than stripping it", () => {
    expect(exportDescription("020100007")).toBe("BOMBA TRANSFERENCIA BEARCAT");
    expect(exportDescription("070200001")).toBe(
      "ZARANDA VIBRATORIA TRIO INCLINED SCREEN 25HP"
    );
    expect(byCode.get("070200001")!.description).not.toContain("TRIO");
  });

  it("covers all 461 audited codes with the exact full-name fingerprint and canonical short name", () => {
    expect(reference.metadata).toEqual({
      sourceBasename: "Articulos BuildReq Activos Fijos 06072026.xlsx",
      sheetName: "ARTICULOS",
      sourceSHA256:
        "1458d918df4a2e7b91f98cb040f76990fe35a7704b181fdbbfdbae17a9192412",
    });
    expect(reference.records).toHaveLength(461);
    expect(auditedRows).toHaveLength(461);
    expect(new Set(reference.records.map(row => row.itemCode)).size).toBe(461);
    for (const record of reference.records) {
      const audited = byCode.get(record.itemCode)!;
      expect(audited).toBeDefined();
      expect(record.descriptionHash).toBe(
        createHash("sha256")
          .update(normalizeArticleDescription(audited.description), "utf8")
          .digest("hex")
      );
      expect(record.description).toBe(
        normalizeArticleDescription(audited.previous.description)
      );
      expect(exportDescription(record.itemCode)).toBe(record.description);
    }
  });

  it("accepts only the same trim and uppercase normalization used by the catalog", () => {
    const description = `  ${byCode.get("020100001")!.description.toLowerCase()}  `;
    expect(exportDescription("020100001", description)).toBe(
      "APLICADOR BITUMEN HIERRO"
    );
  });

  it.each([
    "APLICADOR BITUMEN HIERRO CORREGIDO POR EL USUARIO",
    "APLICADOR BITUMEN HIERRO GENERICA MODELO NUEVO SERIE CHASIS 1113",
    "APLICADOR  BITUMEN HIERRO GENERICA TX50150 SERIE CHASIS 1113",
    "",
  ])("keeps changed catalog descriptions literally (%s)", description => {
    expect(exportDescription("020100001", description)).toBe(description);
  });

  it("does not infer a name from brand, model or series on an unknown code", () => {
    const description = "Equipo WYCO W419500 SERIE CHASIS 012110A166 año 2026";
    expect(exportDescription("CUSTOM-WYCO", description)).toBe(description);
    expect(exportDescription("020100001 ", description)).toBe(description);
  });

  it.each([1, 2])(
    "keeps non asset article type %s unchanged even with a known code",
    tipoArticulo => {
      const description = byCode.get("020100001")!.description;
      expect(exportDescription("020100001", description, tipoArticulo)).toBe(
        description
      );
    }
  );

  it("does not modify the article or source data when preparing the export", () => {
    const article = {
      itemCode: "020100001",
      description: byCode.get("020100001")!.description,
      tipoArticulo: 3,
    };
    const before = { ...article };
    getFixedAssetExportDescription(article);
    expect(article).toEqual(before);
  });
});

describe("description reference build options", () => {
  const input = fileURLToPath(
    new URL("../Plantilla_Articulos_BuildReq.xlsx", import.meta.url)
  );
  it("requires explicit source and JSON destination and resolves their paths", () => {
    expect(
      parseFixedAssetDescriptionBuildOptions([
        "--input",
        input,
        "--output",
        ".tmp/descriptions-reference.json",
      ])
    ).toEqual({ input, output: resolve(".tmp/descriptions-reference.json") });
  });
  it.each([
    [],
    ["--input", input],
    ["--output", "reference.json"],
    ["--input", input, "--output", "reference.xlsx"],
    ["--input", input, "--input", input, "--output", "reference.json"],
    ["--input", input, "--output", "reference.json", "--apply", "true"],
    ["--input", "missing-source.xlsx", "--output", "reference.json"],
  ])(
    "rejects missing, duplicate or unsupported options without writing (%j)",
    args => {
      expect(() => parseFixedAssetDescriptionBuildOptions(args)).toThrow();
    }
  );
});
