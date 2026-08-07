export const INVOICE_RECEIPT_FISCAL_FIELDS = [
  { key: "isFiscalDocument", label: "Documento fiscal", type: "boolean" },
  { key: "invoiceNumber", label: "Número documento", type: "fiscal_number" },
  { key: "cai", label: "CAI", type: "cai" },
  {
    key: "documentRangeStart",
    label: "Rango autorizado inicial",
    type: "fiscal_number",
  },
  {
    key: "documentRangeEnd",
    label: "Rango autorizado final",
    type: "fiscal_number",
  },
  { key: "documentDate", label: "Fecha documento", type: "date" },
  {
    key: "documentDueDate",
    label: "Fecha vencimiento (crédito)",
    type: "date",
  },
  { key: "postingDate", label: "Fecha contabilización", type: "date" },
  { key: "receiptDate", label: "Fecha recepción", type: "date" },
  {
    key: "emissionDeadline",
    label: "Fecha límite de emisión",
    type: "date",
  },
] as const;

export type InvoiceReceiptFiscalField =
  (typeof INVOICE_RECEIPT_FISCAL_FIELDS)[number]["key"];

export type InvoiceReceiptFiscalSnapshot = Partial<
  Record<InvoiceReceiptFiscalField, unknown>
>;

export type InvoiceReceiptFiscalDifference = {
  field: InvoiceReceiptFiscalField;
  label: string;
  receiptValue: string;
  invoiceValue: string;
};

function normalizeDate(value: unknown) {
  if (!value) return "";
  if (typeof value === "string") {
    const match = value.match(/^\d{4}-\d{2}-\d{2}/);
    if (match) return match[0];
  }
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function normalizeFiscalValue(
  value: unknown,
  type: (typeof INVOICE_RECEIPT_FISCAL_FIELDS)[number]["type"]
) {
  if (type === "boolean") return value === true ? "true" : "false";
  if (type === "date") return normalizeDate(value);

  const text = String(value ?? "").trim().toUpperCase();
  if (type === "fiscal_number") return text.replace(/[^0-9]/g, "");
  if (type === "cai") return text.replace(/[^A-Z0-9]/g, "");
  return text;
}

function formatFiscalValue(value: unknown, type: string) {
  if (type === "boolean") return value === true ? "Sí" : "No";
  if (type === "date") {
    const normalizedDate = normalizeDate(value);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedDate)) return "—";
    const [year, month, day] = normalizedDate.split("-");
    return `${day}/${month}/${year}`;
  }
  return String(value ?? "").trim() || "—";
}

export function getInvoiceReceiptFiscalDifferences(
  invoice: InvoiceReceiptFiscalSnapshot,
  receipt: InvoiceReceiptFiscalSnapshot
): InvoiceReceiptFiscalDifference[] {
  return INVOICE_RECEIPT_FISCAL_FIELDS.flatMap(definition => {
    const invoiceValue = normalizeFiscalValue(
      invoice[definition.key],
      definition.type
    );
    const receiptValue = normalizeFiscalValue(
      receipt[definition.key],
      definition.type
    );
    if (invoiceValue === receiptValue) return [];

    return [
      {
        field: definition.key,
        label: definition.label,
        receiptValue: formatFiscalValue(
          receipt[definition.key],
          definition.type
        ),
        invoiceValue: formatFiscalValue(
          invoice[definition.key],
          definition.type
        ),
      },
    ];
  });
}
