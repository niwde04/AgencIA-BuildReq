/** Reads an explicit source workbook; writes only a reproducible private JSON reference. */
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, extname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import XLSX from "xlsx";
import {
  ARTICLE_DESCRIPTION_MAX_LENGTH,
  normalizeArticleDescription,
} from "../shared/article-descriptions";
import type { FixedAssetExportDescriptionReference } from "../server/fixedAssetExportDescriptions";

const SOURCE_SHEET = "ARTICULOS";
const HEADERS = [
  "Numero de articulo",
  "Tipo de articulo",
  "Descripcion del articulo",
  "Descripcion del articulo completa",
] as const;
// Match normalizeCell in import-fixed-assets-hidalgo.ts before hashing the
// description that the importer actually persisted.
const cellText = (value: unknown) =>
  String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export function parseFixedAssetDescriptionBuildOptions(args: string[]) {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index],
      value = args[index + 1];
    if (
      !["--input", "--output"].includes(flag) ||
      !value ||
      value.startsWith("--") ||
      values.has(flag)
    ) {
      throw new Error(
        "Use --input <fuente.xlsx> --output <referencia.json>, sin opciones repetidas"
      );
    }
    values.set(flag, value);
  }
  if (!values.has("--input") || !values.has("--output")) {
    throw new Error("Debe indicar --input y --output explícitamente");
  }
  const input = resolve(values.get("--input")!),
    output = resolve(values.get("--output")!);
  if (
    extname(input).toLowerCase() !== ".xlsx" ||
    extname(output).toLowerCase() !== ".json" ||
    input.toLowerCase() === output.toLowerCase()
  ) {
    throw new Error(
      "La fuente debe ser .xlsx y el destino un archivo .json diferente"
    );
  }
  if (!existsSync(input) || !statSync(input).isFile())
    throw new Error("El archivo fuente no existe");
  if (existsSync(output) && !statSync(output).isFile())
    throw new Error("El destino debe ser un archivo JSON");
  return { input, output };
}

export function buildFixedAssetDescriptionReference(
  input: string
): FixedAssetExportDescriptionReference {
  const bytes = readFileSync(input);
  const workbook = XLSX.read(bytes, { type: "buffer", cellDates: false });
  const worksheet = workbook.Sheets[SOURCE_SHEET];
  if (!worksheet) throw new Error(`La fuente requiere la hoja ${SOURCE_SHEET}`);
  const headerRows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
    header: 1,
    defval: null,
    blankrows: false,
  });
  const headers = new Set((headerRows[0] ?? []).map(cellText));
  for (const header of HEADERS)
    if (!headers.has(header)) throw new Error(`Falta la columna ${header}`);
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
    defval: null,
    raw: false,
    blankrows: false,
  });
  const records: FixedAssetExportDescriptionReference["records"] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const type = cellText(row["Tipo de articulo"]).toUpperCase();
    if (type !== "ACTIVO" && type !== "3") continue;
    const itemCode = cellText(row["Numero de articulo"]);
    const description = normalizeArticleDescription(
      cellText(row["Descripcion del articulo"])
    );
    const fullDescription = normalizeArticleDescription(
      cellText(row["Descripcion del articulo completa"])
    );
    if (
      !itemCode ||
      !description ||
      itemCode.length > 50 ||
      description.length > ARTICLE_DESCRIPTION_MAX_LENGTH ||
      fullDescription.length > ARTICLE_DESCRIPTION_MAX_LENGTH
    ) {
      throw new Error(
        "La fuente contiene un código o descripción de activo vacío o fuera de longitud"
      );
    }
    if (seen.has(itemCode))
      throw new Error(
        `La fuente contiene el código de activo duplicado ${itemCode}`
      );
    seen.add(itemCode);
    records.push({
      itemCode,
      descriptionHash: createHash("sha256")
        .update(fullDescription || description, "utf8")
        .digest("hex"),
      description,
    });
  }
  if (!records.length) throw new Error("La fuente no contiene activos fijos");
  records.sort((left, right) =>
    left.itemCode < right.itemCode ? -1 : left.itemCode > right.itemCode ? 1 : 0
  );
  return {
    version: 1,
    metadata: {
      sourceBasename: basename(input),
      sheetName: SOURCE_SHEET,
      sourceSHA256: createHash("sha256").update(bytes).digest("hex"),
    },
    records,
  };
}

function main() {
  const { input, output } = parseFixedAssetDescriptionBuildOptions(
    process.argv.slice(2)
  );
  const reference = buildFixedAssetDescriptionReference(input);
  mkdirSync(dirname(output), { recursive: true });
  const temporary = `${output}.${process.pid}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify(reference, null, 2) + "\n", "utf8");
    renameSync(temporary, output);
  } finally {
    if (existsSync(temporary)) rmSync(temporary);
  }
  console.log(
    JSON.stringify({
      records: reference.records.length,
      sourceSHA256: reference.metadata.sourceSHA256,
      output,
    })
  );
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
