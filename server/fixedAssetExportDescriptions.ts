import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { normalizeArticleDescription } from "../shared/article-descriptions";

export type FixedAssetExportDescriptionReference = {
  version: 1;
  metadata: {
    sourceBasename: string;
    sheetName: string;
    sourceSHA256: string;
  };
  records: Array<{
    itemCode: string;
    descriptionHash: string;
    description: string;
  }>;
};

function loadDescriptionReference() {
  // The source module uses server/data; the bundled entry point lives in dist.
  // Docker already packages server/, so the data never needs a public URL.
  const file = [
    new URL("./data/fixed-asset-export-descriptions.json", import.meta.url),
    new URL(
      "../server/data/fixed-asset-export-descriptions.json",
      import.meta.url
    ),
  ].find(candidate => existsSync(candidate));
  if (!file)
    throw new Error(
      "Falta la referencia privada de descripciones de activos fijos"
    );
  const reference = JSON.parse(
    readFileSync(file, "utf8")
  ) as FixedAssetExportDescriptionReference;
  if (
    reference.version !== 1 ||
    !reference.metadata?.sourceBasename ||
    !reference.metadata.sheetName ||
    !/^[0-9a-f]{64}$/.test(reference.metadata.sourceSHA256) ||
    !Array.isArray(reference.records)
  )
    throw new Error(
      "La referencia de descripciones de activos fijos no es válida"
    );

  const byCode = new Map<
    string,
    FixedAssetExportDescriptionReference["records"][number]
  >();
  for (const record of reference.records) {
    if (
      typeof record.itemCode !== "string" ||
      !record.itemCode ||
      typeof record.description !== "string" ||
      !record.description ||
      !/^[0-9a-f]{64}$/.test(record.descriptionHash) ||
      byCode.has(record.itemCode)
    )
      throw new Error(
        "La referencia de activos contiene un código duplicado o un registro inválido"
      );
    byCode.set(record.itemCode, record);
  }
  return byCode;
}

const descriptionByCode = loadDescriptionReference();

/** Only the dedicated export may use the verified short source description. */
export function getFixedAssetExportDescription(article: {
  itemCode: string;
  description: string;
  tipoArticulo: number;
}): string {
  if (article.tipoArticulo !== 3) return article.description;
  const reference = descriptionByCode.get(article.itemCode);
  if (!reference) return article.description;
  const currentHash = createHash("sha256")
    .update(normalizeArticleDescription(article.description), "utf8")
    .digest("hex");
  return currentHash === reference.descriptionHash
    ? reference.description
    : article.description;
}
