import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { basename, resolve } from "node:path";
import { createHash } from "node:crypto";
import * as XLSX from "xlsx";
import { costMatrixFields, deriveCostMatrix } from "../shared/cost-matrix";
import { validateCostMatrixSeed } from "./cost-matrix-import";

const source = process.argv[2];
if (!source) throw new Error("Uso: pnpm cost-matrix:normalize <archivo.xlsx>");
const bytes = readFileSync(source);
const book = XLSX.read(bytes, { type: "buffer" });
const sheet = book.Sheets.Hoja1;
if (!sheet) throw new Error("No se encontró Hoja1");
const table = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
  header: 1,
  raw: true,
  defval: "",
});
const headers = [
  "id.job",
  "jobname",
  "n1",
  "nivel1",
  "n2",
  "nivel2",
  "n3",
  "nivel3",
  "n4",
  "nivel4",
  "cod.matriz",
  "grupo mayor",
  "id.flujo",
  "actividad flujo",
  "flujo.n1",
  "flujo.n2",
  "flujo.n3",
  "flujo.n4",
  "flujo.n5",
];
if (JSON.stringify(table[0]) !== JSON.stringify(headers))
  throw new Error("Encabezados inesperados");
const fields = [
  "jobCode",
  "jobName",
  "n1",
  "nivel1",
  "n2",
  "nivel2",
  "n3",
  "nivel3",
  "n4",
  "nivel4",
  null,
  "majorGroup",
  "flowId",
  "flowActivity",
];
const records = new Map<
  string,
  { row: any; raw: string[]; sourceRows: number[] }
>();
const corrections: {
  row: number;
  field: string;
  previous: string;
  corrected: string;
}[] = [];
for (let i = 1; i < table.length; i++) {
  const raw = table[i].map(cell => String(cell ?? "").trim());
  if (raw.every(v => !v)) throw new Error(`Fila vacía inesperada: ${i + 1}`);
  const base = costMatrixFields.parse(
    Object.fromEntries(
      fields.flatMap((field, col) => (field ? [[field, raw[col]]] : []))
    )
  );
  const derived = deriveCostMatrix(base);
  if (raw[10] !== derived.matrixCode)
    throw new Error(`Código de matriz inconsistente en fila ${i + 1}`);
  const row = { ...base, sourceKey: `br-v1:${derived.matrixCode}` };
  const previous = records.get(derived.matrixCode);
  if (previous) {
    // Only identical source rows may be consolidated, including original calculated labels.
    if (JSON.stringify(previous.raw) !== JSON.stringify(raw))
      throw new Error(`Duplicados contradictorios en fila ${i + 1}`);
    previous.sourceRows.push(i + 1);
  } else records.set(derived.matrixCode, { row, raw, sourceRows: [i + 1] });
  for (let j = 0; j < 5; j++) {
    const corrected = derived[`flow${j + 1}` as "flow1"];
    if (raw[14 + j] !== corrected)
      corrections.push({
        row: i + 1,
        field: headers[14 + j],
        previous: raw[14 + j],
        corrected,
      });
  }
}
const rows = validateCostMatrixSeed(
  Array.from(records.values())
    .map(v => v.row)
    .sort((a, b) =>
      deriveCostMatrix(a).matrixCode.localeCompare(
        deriveCostMatrix(b).matrixCode
      )
    )
);
const seed = JSON.stringify(rows, null, 2) + "\n";
const duplicates = Array.from(records.entries())
  .filter(([, v]) => v.sourceRows.length > 1)
  .map(([matrixCode, value]) => ({
    matrixCode,
    sourceRows: value.sourceRows,
    removed: value.sourceRows.slice(1),
  }));
const report = {
  sourceFile: basename(source),
  sourceSha256: createHash("sha256").update(bytes).digest("hex"),
  sheet: "Hoja1",
  sourceRows: table.length - 1,
  uniqueRecords: rows.length,
  removedDuplicates: duplicates.reduce((n, r) => n + r.removed.length, 0),
  correctedLabels: corrections.length,
  jobs: Object.fromEntries(
    Array.from(new Set(rows.map(r => r.jobCode))).map(code => [
      code,
      rows.filter(r => r.jobCode === code).length,
    ])
  ),
  seedSha256: createHash("sha256").update(seed).digest("hex"),
  duplicates,
  corrections,
};
if (
  report.sourceRows !== 584 ||
  rows.length !== 539 ||
  report.removedDuplicates !== 45 ||
  report.correctedLabels !== 99 ||
  report.jobs["999"] !== 208 ||
  report.jobs["001"] !== 331
)
  throw new Error("El archivo no corresponde a la carga inicial aprobada");
const dir = resolve("data/cost-matrix");
mkdirSync(dir, { recursive: true });
writeFileSync(resolve(dir, "initial.json"), seed);
writeFileSync(
  resolve(dir, "source-report.json"),
  JSON.stringify(report, null, 2) + "\n"
);
console.log(
  JSON.stringify(
    {
      ...report,
      duplicates: duplicates.length,
      corrections: corrections.length,
    },
    null,
    2
  )
);
