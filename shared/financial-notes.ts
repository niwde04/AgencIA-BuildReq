import { z } from "zod";

export const NOTE_TYPES = ["credit", "debit"] as const;
export type FinancialNoteType = (typeof NOTE_TYPES)[number];
export const NOTE_STATUSES = [
  "borrador",
  "revisada",
  "rechazada",
  "registrada",
  "anulada",
] as const;
export const NOTE_STATUS_LABELS: Record<string, string> = {
  borrador: "Borrador",
  revisada: "En revisión",
  rechazada: "Rechazada",
  registrada: "Contabilizada",
  anulada: "Anulada",
};
export const NOTE_ORIGIN_LABELS: Record<string, string> = {
  manual: "Manual",
  retentions: "Retenciones",
  supplier_return: "Devolución",
};

/** Fixed-point arithmetic: API and database amounts never travel as floats. */
export function noteMoneyUnits(value: string | number): bigint {
  const text = String(value).trim();
  if (!/^\d{1,10}(\.\d{1,4})?$/.test(text)) {
    throw new Error(
      "Ingrese un monto válido, positivo o cero, con máximo cuatro decimales"
    );
  }
  const [whole, fraction = ""] = text.split(".");
  return BigInt(whole) * BigInt(10000) + BigInt(fraction.padEnd(4, "0"));
}

export function noteMoneyString(units: bigint): string {
  const sign = units < BigInt(0) ? "-" : "";
  const absolute = units < BigInt(0) ? -units : units;
  return `${sign}${absolute / BigInt(10000)}.${String(absolute % BigInt(10000)).padStart(4, "0")}`;
}

export function sumNoteMoney(values: Array<string | number>): string {
  return noteMoneyString(
    values.reduce<bigint>(
      (sum, value) => sum + noteMoneyUnits(value),
      BigInt(0)
    )
  );
}

export const noteMoneySchema = z
  .string()
  .trim()
  .refine(value => {
    try {
      noteMoneyUnits(value);
      return true;
    } catch {
      return false;
    }
  }, "Ingrese un monto válido con máximo cuatro decimales");

export const noteLineInputSchema = z.object({
  conceptId: z.number().int().positive(),
  baseAmount: noteMoneySchema,
  taxCode: z.string().trim().max(50).nullable().optional(),
  taxAmount: noteMoneySchema,
  notes: z.string().trim().max(1000).optional(),
});
export const noteAllocationInputSchema = z.object({
  invoiceId: z.number().int().positive(),
  amount: noteMoneySchema,
});
export const noteFiscalSchema = z.object({
  cai: z.string().trim().max(100).default(""),
  fiscalNumber: z.string().trim().max(100).default(""),
  documentRangeStart: z.string().trim().max(100).default(""),
  documentRangeEnd: z.string().trim().max(100).default(""),
  documentDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .or(z.literal(""))
    .default(""),
  documentDueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .or(z.literal(""))
    .default(""),
  emissionDeadline: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .or(z.literal(""))
    .default(""),
  notes: z.string().trim().max(4000).default(""),
});
export const noteDraftSchema = noteFiscalSchema.extend({
  type: z.enum(NOTE_TYPES),
  lines: z.array(noteLineInputSchema).min(1).max(200),
  allocations: z.array(noteAllocationInputSchema).min(1).max(100),
});
export type NoteDraftInput = z.infer<typeof noteDraftSchema>;
export type NoteFiscalInput = z.infer<typeof noteFiscalSchema>;

export function assertNoteAllocationTotals(
  type: FinancialNoteType,
  lines: Array<{ baseAmount: string; taxAmount: string }>,
  allocations: Array<{ invoiceId: number; amount: string }>
) {
  if (!allocations.length || (type === "debit" && allocations.length !== 1))
    throw new Error(
      "La nota de débito debe tener exactamente una factura; la nota de crédito al menos una"
    );
  if (
    new Set(allocations.map(row => row.invoiceId)).size !== allocations.length
  )
    throw new Error("No puede repetir una factura en la nota");
  const total = lines.reduce(
    (sum, line) =>
      sum + noteMoneyUnits(line.baseAmount) + noteMoneyUnits(line.taxAmount),
    BigInt(0)
  );
  if (
    !lines.length ||
    total <= BigInt(0) ||
    lines.some(
      line =>
        noteMoneyUnits(line.baseAmount) + noteMoneyUnits(line.taxAmount) <=
        BigInt(0)
    )
  )
    throw new Error("Cada concepto debe tener un importe mayor que cero");
  if (allocations.some(row => noteMoneyUnits(row.amount) <= BigInt(0)))
    throw new Error(
      "El importe aplicado a cada factura debe ser mayor que cero"
    );
  if (
    total !==
    allocations.reduce(
      (sum, row) => sum + noteMoneyUnits(row.amount),
      BigInt(0)
    )
  )
    throw new Error(
      "El total de los conceptos debe coincidir con el total aplicado a las facturas"
    );
  // Validate aggregate precision as well as each input.
  noteMoneyUnits(noteMoneyString(total));
  return noteMoneyString(total);
}

export function groupNoteRetentions(
  rows: Array<{
    retentionCatalogId: number | null;
    description: string;
    amount: string;
  }>
) {
  const grouped = new Map<
    number,
    { retentionCatalogId: number; description: string; amount: string }
  >();
  for (const row of rows) {
    if (!row.retentionCatalogId)
      throw new Error(
        "La retención debe estar vinculada al catálogo antes de contabilizar"
      );
    const current = grouped.get(row.retentionCatalogId);
    grouped.set(row.retentionCatalogId, {
      ...row,
      retentionCatalogId: row.retentionCatalogId,
      amount: sumNoteMoney([current?.amount ?? "0", row.amount]),
    });
  }
  return Array.from(grouped.values()).filter(
    row => noteMoneyUnits(row.amount) > BigInt(0)
  );
}

type NoteUser = { role?: string | null; buildreqRole?: string | null };
export function canPrepareFinancialNotes(user: NoteUser | null | undefined) {
  return (
    !!user &&
    (user.role === "admin" ||
      ["administracion_central", "administrador_proyecto"].includes(
        user.buildreqRole ?? ""
      ))
  );
}
export function canAccountFinancialNotes(user: NoteUser | null | undefined) {
  return !!user && (user.role === "admin" || user.buildreqRole === "contable");
}
export function canReadFinancialNotes(user: NoteUser | null | undefined) {
  return (
    canPrepareFinancialNotes(user) ||
    canAccountFinancialNotes(user) ||
    ["jefe_bodega_central", "bodeguero_proyecto"].includes(
      user?.buildreqRole ?? ""
    )
  );
}
export function canManageNoteConcepts(user: NoteUser | null | undefined) {
  return canAccountFinancialNotes(user);
}
