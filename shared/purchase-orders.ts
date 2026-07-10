export const PURCHASE_ORDER_TAX_VALUES = [
  "exe",
  "isv_15",
  "isv_18",
  "isv_4",
] as const;

export type PurchaseOrderTaxCode = string;

export type SalesTaxType = "base" | "additional";

export type SalesTaxFiscalCategory = "exento" | "exonerado" | "gravado";

export type SalesTaxCatalogItem = {
  id?: number;
  taxCode: string;
  description: string;
  shortLabel?: string | null;
  ratePercent: string | number;
  taxType: SalesTaxType;
  fiscalCategory: SalesTaxFiscalCategory;
  isActive?: boolean;
  displayOrder?: number | null;
  appliesToTaxCodes?: string[] | string | null;
};

export type PurchaseOrderTaxBreakdownEntry = {
  taxCode: string;
  label: string;
  shortLabel: string;
  taxType: SalesTaxType;
  fiscalCategory: SalesTaxFiscalCategory;
  ratePercent: number;
  rate: number;
  baseAmount: number;
  amount: number;
  displayOrder: number;
};

export const DEFAULT_PURCHASE_ORDER_TAX_CODE = "exe";

export const DEFAULT_SALES_TAXES: SalesTaxCatalogItem[] = [
  {
    taxCode: "exe",
    description: "EXE - Exento",
    shortLabel: "EXE",
    ratePercent: "0.0000",
    taxType: "base",
    fiscalCategory: "exento",
    isActive: true,
    displayOrder: 10,
    appliesToTaxCodes: [],
  },
  {
    taxCode: "isv_15",
    description: "ISV 15%",
    shortLabel: "ISV 15%",
    ratePercent: "15.0000",
    taxType: "base",
    fiscalCategory: "gravado",
    isActive: true,
    displayOrder: 20,
    appliesToTaxCodes: [],
  },
  {
    taxCode: "isv_18",
    description: "ISV 18%",
    shortLabel: "ISV 18%",
    ratePercent: "18.0000",
    taxType: "base",
    fiscalCategory: "gravado",
    isActive: true,
    displayOrder: 30,
    appliesToTaxCodes: [],
  },
  {
    taxCode: "isv_4",
    description: "ISV 4%",
    shortLabel: "ISV 4%",
    ratePercent: "4.0000",
    taxType: "base",
    fiscalCategory: "gravado",
    isActive: true,
    displayOrder: 40,
    appliesToTaxCodes: [],
  },
];

export const PURCHASE_ORDER_CONTRACT_FREQUENCIES = [
  "semanal",
  "quincenal",
  "mensual",
  "trimestral",
  "semestral",
  "anual",
] as const;

export type PurchaseOrderContractFrequency =
  (typeof PURCHASE_ORDER_CONTRACT_FREQUENCIES)[number];

export const PURCHASE_ORDER_CONTRACT_FREQUENCY_LABELS: Record<
  PurchaseOrderContractFrequency,
  string
> = {
  semanal: "Semanal",
  quincenal: "Quincenal",
  mensual: "Mensual",
  trimestral: "Trimestral",
  semestral: "Semestral",
  anual: "Anual",
};

export const PURCHASE_ORDER_TAX_OPTIONS =
  getPurchaseOrderBaseTaxOptions(DEFAULT_SALES_TAXES);

function normalizeTaxCode(value: string | null | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

function toRatePercent(value: string | number | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toDisplayOrder(value: number | null | undefined, fallback: number) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

export function parsePurchaseOrderAdditionalTaxCodes(
  value: string[] | string | null | undefined
) {
  if (Array.isArray(value)) {
    return value.map(normalizeTaxCode).filter(Boolean);
  }

  if (!value) return [];

  const raw = String(value).trim();
  if (!raw) return [];

  if (raw.startsWith("[")) {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed)
        ? parsed.map(normalizeTaxCode).filter(Boolean)
        : [];
    } catch {
      return [];
    }
  }

  return raw.split(",").map(normalizeTaxCode).filter(Boolean);
}

export function parsePurchaseOrderTaxBreakdown(
  value: PurchaseOrderTaxBreakdownEntry[] | string | null | undefined
): PurchaseOrderTaxBreakdownEntry[] {
  const rawEntries = Array.isArray(value)
    ? value
    : typeof value === "string" && value.trim().startsWith("[")
      ? (() => {
          try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed : [];
          } catch {
            return [];
          }
        })()
      : [];

  return rawEntries
    .map((entry: any, index: number) => {
      const ratePercent =
        Number(entry?.ratePercent) ||
        (Number.isFinite(Number(entry?.rate)) ? Number(entry.rate) * 100 : 0);
      const rate = Number.isFinite(Number(entry?.rate))
        ? Number(entry.rate)
        : ratePercent / 100;
      const taxCode = normalizeTaxCode(entry?.taxCode);
      if (!taxCode || !Number.isFinite(rate)) return null;
      return {
        taxCode,
        label: String(entry?.label || entry?.shortLabel || taxCode),
        shortLabel: String(entry?.shortLabel || entry?.label || taxCode),
        taxType: entry?.taxType === "additional" ? "additional" : "base",
        fiscalCategory:
          entry?.fiscalCategory === "exonerado"
            ? "exonerado"
            : entry?.fiscalCategory === "exento"
              ? "exento"
              : "gravado",
        ratePercent,
        rate,
        baseAmount: toPurchaseOrderNumber(entry?.baseAmount),
        amount: toPurchaseOrderNumber(entry?.amount),
        displayOrder: toDisplayOrder(entry?.displayOrder, index + 1),
      } satisfies PurchaseOrderTaxBreakdownEntry;
    })
    .filter((entry): entry is PurchaseOrderTaxBreakdownEntry =>
      Boolean(entry)
    )
    .sort((a, b) => a.displayOrder - b.displayOrder);
}

function parseAppliesToTaxCodes(value: string[] | string | null | undefined) {
  return parsePurchaseOrderAdditionalTaxCodes(value);
}

function normalizeCatalog(
  taxes: SalesTaxCatalogItem[] | null | undefined = DEFAULT_SALES_TAXES
) {
  const source = taxes?.length ? taxes : DEFAULT_SALES_TAXES;

  return source
    .filter(tax => tax.isActive !== false)
    .map((tax, index) => {
      const ratePercent = toRatePercent(tax.ratePercent);
      const taxCode = normalizeTaxCode(tax.taxCode);
      return {
        ...tax,
        taxCode,
        description: tax.description || tax.shortLabel || taxCode,
        shortLabel: tax.shortLabel || tax.description || taxCode,
        ratePercent,
        rate: ratePercent / 100,
        displayOrder: toDisplayOrder(tax.displayOrder, index + 1),
        appliesToTaxCodes: parseAppliesToTaxCodes(tax.appliesToTaxCodes),
      };
    })
    .sort((a, b) => a.displayOrder - b.displayOrder);
}

function findTaxByCode(
  taxes: ReturnType<typeof normalizeCatalog>,
  code: string | null | undefined
) {
  const normalized = normalizeTaxCode(code);
  return taxes.find(tax => tax.taxCode === normalized);
}

function findDefaultBaseTax(taxes: ReturnType<typeof normalizeCatalog>) {
  return (
    findTaxByCode(taxes, DEFAULT_PURCHASE_ORDER_TAX_CODE) ??
    taxes.find(tax => tax.taxType === "base") ??
    normalizeCatalog(DEFAULT_SALES_TAXES)[0]
  );
}

export function getPurchaseOrderBaseTaxOptions(
  taxes?: SalesTaxCatalogItem[] | null
) {
  return normalizeCatalog(taxes)
    .filter(tax => tax.taxType === "base")
    .map(tax => ({
      value: tax.taxCode,
      label: tax.description,
      shortLabel: tax.shortLabel,
      rate: tax.rate,
      ratePercent: tax.ratePercent,
      fiscalCategory: tax.fiscalCategory,
      displayOrder: tax.displayOrder,
    }));
}

export function getAdditionalPurchaseOrderTaxOptions(
  baseTaxCode: string | null | undefined,
  taxes?: SalesTaxCatalogItem[] | null
) {
  const normalizedBase = normalizeTaxCode(baseTaxCode);

  return normalizeCatalog(taxes)
    .filter(tax => {
      if (tax.taxType !== "additional") return false;
      if (tax.appliesToTaxCodes.length === 0) return true;
      return tax.appliesToTaxCodes.includes(normalizedBase);
    })
    .map(tax => ({
      value: tax.taxCode,
      label: tax.description,
      shortLabel: tax.shortLabel,
      rate: tax.rate,
      ratePercent: tax.ratePercent,
      fiscalCategory: tax.fiscalCategory,
      displayOrder: tax.displayOrder,
    }));
}

export function normalizePurchaseOrderTaxCode(
  value: string | null | undefined,
  taxes?: SalesTaxCatalogItem[] | null
): PurchaseOrderTaxCode {
  const catalog = normalizeCatalog(taxes);
  const tax = findTaxByCode(catalog, value);
  return tax ? tax.taxCode : findDefaultBaseTax(catalog).taxCode;
}

export function normalizePurchaseOrderAdditionalTaxCodes(
  value: string[] | string | null | undefined,
  baseTaxCode: string | null | undefined,
  taxes?: SalesTaxCatalogItem[] | null
) {
  const requested = new Set(parsePurchaseOrderAdditionalTaxCodes(value));
  return getAdditionalPurchaseOrderTaxOptions(baseTaxCode, taxes)
    .filter(option => requested.has(option.value))
    .map(option => option.value);
}

export function getPurchaseOrderTaxSelectionError(params: {
  taxCode?: string | null;
  additionalTaxCodes?: string[] | string | null;
  taxes?: SalesTaxCatalogItem[] | null;
}) {
  const catalog = normalizeCatalog(params.taxes);
  const primaryTax = findTaxByCode(catalog, params.taxCode);
  if (!primaryTax) {
    return "Seleccione un impuesto válido";
  }

  const requestedAdditional = parsePurchaseOrderAdditionalTaxCodes(
    params.additionalTaxCodes
  );
  for (const code of requestedAdditional) {
    const additionalTax = findTaxByCode(catalog, code);
    if (!additionalTax || additionalTax.taxType !== "additional") {
      return `El impuesto adicional ${code} no existe o no está activo`;
    }
    if (
      additionalTax.appliesToTaxCodes.length > 0 &&
      !additionalTax.appliesToTaxCodes.includes(primaryTax.taxCode)
    ) {
      return `${additionalTax.shortLabel} solo aplica a ${additionalTax.appliesToTaxCodes.join(", ")}`;
    }
  }

  return null;
}

export function getPurchaseOrderTaxMeta(
  value: string | null | undefined,
  taxes?: SalesTaxCatalogItem[] | null
) {
  const catalog = normalizeCatalog(taxes);
  const taxCode = normalizePurchaseOrderTaxCode(value, catalog);
  const tax = findTaxByCode(catalog, taxCode) ?? findDefaultBaseTax(catalog);
  return {
    value: tax.taxCode,
    label: tax.description,
    shortLabel: tax.shortLabel,
    rate: tax.rate,
    ratePercent: tax.ratePercent,
    fiscalCategory: tax.fiscalCategory,
    displayOrder: tax.displayOrder,
  };
}

export function toPurchaseOrderNumber(
  value: string | number | null | undefined
) {
  const parsed =
    typeof value === "number"
      ? value
      : value === null || value === undefined || value === ""
      ? 0
      : Number(String(value).replace(/,/g, "").trim());

  return Number.isFinite(parsed) ? parsed : 0;
}

export function roundPurchaseOrderMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 10000) / 10000;
}

export function calculatePurchaseOrderLineAmounts(params: {
  quantity: string | number | null | undefined;
  unitPrice?: string | number | null | undefined;
  subtotal?: string | number | null | undefined;
  taxCode?: string | null | undefined;
  additionalTaxCodes?: string[] | string | null | undefined;
  taxBreakdown?: PurchaseOrderTaxBreakdownEntry[] | string | null | undefined;
  taxes?: SalesTaxCatalogItem[] | null | undefined;
}) {
  const quantity = toPurchaseOrderNumber(params.quantity);
  const unitPrice = toPurchaseOrderNumber(params.unitPrice);
  const hasExplicitSubtotal =
    params.subtotal !== null &&
    params.subtotal !== undefined &&
    params.subtotal !== "";
  const catalog = normalizeCatalog(params.taxes);
  const snapshotBreakdown = parsePurchaseOrderTaxBreakdown(params.taxBreakdown);
  const useSnapshot = snapshotBreakdown.length > 0 && !params.taxes;
  const catalogTax = getPurchaseOrderTaxMeta(params.taxCode, catalog);
  const snapshotBaseTax = snapshotBreakdown.find(
    entry => entry.taxType === "base"
  );
  const tax = snapshotBaseTax
    ? {
        value: snapshotBaseTax.taxCode,
        label: snapshotBaseTax.label,
        shortLabel: snapshotBaseTax.shortLabel,
        rate: snapshotBaseTax.rate,
        ratePercent: snapshotBaseTax.ratePercent,
        fiscalCategory: snapshotBaseTax.fiscalCategory,
        displayOrder: snapshotBaseTax.displayOrder,
      }
    : catalogTax;
  const additionalTaxCodes = useSnapshot
    ? snapshotBreakdown
        .filter(entry => entry.taxType === "additional")
        .map(entry => entry.taxCode)
    : normalizePurchaseOrderAdditionalTaxCodes(
        params.additionalTaxCodes,
        tax.value,
        catalog
      );
  const subtotal = roundPurchaseOrderMoney(
    hasExplicitSubtotal
      ? toPurchaseOrderNumber(params.subtotal)
      : quantity * unitPrice
  );
  const appliedTaxes = useSnapshot
    ? snapshotBreakdown
    : [
        ...(tax.rate > 0
          ? [
              {
                taxCode: tax.value,
                label: tax.label,
                shortLabel: tax.shortLabel,
                taxType: "base" as const,
                fiscalCategory: tax.fiscalCategory,
                ratePercent: tax.ratePercent,
                rate: tax.rate,
                displayOrder: tax.displayOrder,
              },
            ]
          : []),
        ...additionalTaxCodes
          .map(code => findTaxByCode(catalog, code))
          .filter((tax): tax is NonNullable<typeof tax> => Boolean(tax))
          .map(tax => ({
            taxCode: tax.taxCode,
            label: tax.description,
            shortLabel: tax.shortLabel,
            taxType: "additional" as const,
            fiscalCategory: tax.fiscalCategory,
            ratePercent: tax.ratePercent,
            rate: tax.rate,
            displayOrder: tax.displayOrder,
          })),
      ];
  const taxBreakdown = appliedTaxes.map(entry => ({
    ...entry,
    baseAmount: subtotal,
    amount: roundPurchaseOrderMoney(subtotal * entry.rate),
  }));
  const taxAmount = roundPurchaseOrderMoney(
    taxBreakdown.reduce((sum, entry) => sum + entry.amount, 0)
  );
  const total = roundPurchaseOrderMoney(subtotal + taxAmount);

  return {
    quantity,
    unitPrice,
    taxCode: tax.value,
    taxLabel: tax.label,
    taxShortLabel: tax.shortLabel,
    taxRate: tax.rate,
    taxRatePercent: tax.ratePercent,
    taxFiscalCategory: tax.fiscalCategory,
    additionalTaxCodes,
    taxBreakdown,
    subtotal,
    taxAmount,
    total,
  };
}

export function summarizePurchaseOrderLines(
  lines: Array<{
    quantity: string | number | null | undefined;
    unitPrice?: string | number | null | undefined;
    subtotal?: string | number | null | undefined;
    taxCode?: string | null | undefined;
    additionalTaxCodes?: string[] | string | null | undefined;
    taxBreakdown?: PurchaseOrderTaxBreakdownEntry[] | string | null | undefined;
  }>
  ,
  taxes?: SalesTaxCatalogItem[] | null
) {
  const catalog = normalizeCatalog(taxes);
  const taxSummarySeed = catalog.map(tax => ({
    taxCode: tax.taxCode,
    label: tax.description,
    shortLabel: tax.shortLabel,
    ratePercent: tax.ratePercent,
    displayOrder: tax.displayOrder,
    fiscalCategory: tax.fiscalCategory,
    value: 0,
  }));

  return lines.reduce(
    (summary, line) => {
      const amounts = calculatePurchaseOrderLineAmounts({
        ...line,
        taxes: catalog,
      });

      summary.subtotal = roundPurchaseOrderMoney(
        summary.subtotal + amounts.subtotal
      );
      summary.totalIsv = roundPurchaseOrderMoney(
        summary.totalIsv + amounts.taxAmount
      );
      summary.totalIsv15 = roundPurchaseOrderMoney(
        summary.totalIsv15 +
          amounts.taxBreakdown
            .filter(entry => entry.taxCode === "isv_15")
            .reduce((sum, entry) => sum + entry.amount, 0)
      );
      summary.totalIsv18 = roundPurchaseOrderMoney(
        summary.totalIsv18 +
          amounts.taxBreakdown
            .filter(entry => entry.taxCode === "isv_18")
            .reduce((sum, entry) => sum + entry.amount, 0)
      );
      summary.totalIsv4 = roundPurchaseOrderMoney(
        summary.totalIsv4 +
          amounts.taxBreakdown
            .filter(entry => entry.taxCode === "isv_4")
            .reduce((sum, entry) => sum + entry.amount, 0)
      );
      summary.totalExempt = roundPurchaseOrderMoney(
        summary.totalExempt +
          (amounts.taxRate === 0 && amounts.taxFiscalCategory === "exento"
            ? amounts.subtotal
            : 0)
      );
      summary.totalExonerated = roundPurchaseOrderMoney(
        summary.totalExonerated +
          (amounts.taxRate === 0 && amounts.taxFiscalCategory === "exonerado"
            ? amounts.subtotal
            : 0)
      );
      summary.totalTaxed15 = roundPurchaseOrderMoney(
        summary.totalTaxed15 +
          (amounts.taxCode === "isv_15" ? amounts.subtotal : 0)
      );
      summary.totalTaxed18 = roundPurchaseOrderMoney(
        summary.totalTaxed18 +
          (amounts.taxCode === "isv_18" ? amounts.subtotal : 0)
      );

      let baseTaxRow = summary.taxedRows.find(
        row => row.taxCode === amounts.taxCode
      );
      if (
        !baseTaxRow &&
        amounts.taxFiscalCategory === "gravado" &&
        amounts.taxRate > 0
      ) {
        baseTaxRow = {
          taxCode: amounts.taxCode,
          label: amounts.taxLabel,
          shortLabel: amounts.taxShortLabel,
          ratePercent: amounts.taxRatePercent,
          displayOrder: 999,
          fiscalCategory: amounts.taxFiscalCategory,
          value: 0,
        };
        summary.taxedRows.push(baseTaxRow);
      }
      if (baseTaxRow && amounts.taxFiscalCategory === "gravado") {
        baseTaxRow.value = roundPurchaseOrderMoney(
          baseTaxRow.value + amounts.subtotal
        );
      }

      for (const entry of amounts.taxBreakdown) {
        let taxRow = summary.taxRows.find(
          row => row.taxCode === entry.taxCode
        );
        if (!taxRow) {
          taxRow = {
            taxCode: entry.taxCode,
            label: entry.label,
            shortLabel: entry.shortLabel,
            ratePercent: entry.ratePercent,
            displayOrder: entry.displayOrder,
            fiscalCategory: entry.fiscalCategory,
            value: 0,
          };
          summary.taxRows.push(taxRow);
          summary.taxRows.sort((a, b) => a.displayOrder - b.displayOrder);
        }
        if (taxRow) {
          taxRow.value = roundPurchaseOrderMoney(taxRow.value + entry.amount);
        }
      }

      summary.total = roundPurchaseOrderMoney(summary.total + amounts.total);

      return summary;
    },
    {
      subtotal: 0,
      totalIsv: 0,
      totalIsv15: 0,
      totalIsv18: 0,
      totalIsv4: 0,
      totalExonerated: 0,
      totalExempt: 0,
      totalTaxed15: 0,
      totalTaxed18: 0,
      taxedRows: taxSummarySeed.filter(
        row =>
          catalog.find(tax => tax.taxCode === row.taxCode)?.taxType ===
            "base" && row.fiscalCategory === "gravado"
      ).map(row => ({ ...row })),
      taxRows: taxSummarySeed.filter(
        row =>
          (catalog.find(tax => tax.taxCode === row.taxCode)?.ratePercent ??
            0) > 0
      ).map(row => ({ ...row })),
      total: 0,
    }
  );
}

export function getPurchaseOrderFiscalSummaryRows(
  summary: ReturnType<typeof summarizePurchaseOrderLines>
) {
  return [
    {
      key: "subtotal",
      label: "Sub-total L.",
      value: summary.subtotal,
      emphasized: false,
    },
    {
      key: "exonerated",
      label: "Importe exonerado L.",
      value: summary.totalExonerated,
      emphasized: false,
    },
    {
      key: "exempt",
      label: "Importe exento L.",
      value: summary.totalExempt,
      emphasized: false,
    },
    ...summary.taxedRows.map(row => ({
      key: `taxed-${row.taxCode}`,
      label: `Importe gravado ${row.shortLabel.replace(/^ISV\s*/i, "")} L.`,
      value: row.value,
      emphasized: false,
    })),
    ...summary.taxRows.map(row => ({
      key: `isv-${row.taxCode}`,
      label: `I.S.V. ${row.shortLabel.replace(/^ISV\s*/i, "")} L.`,
      value: row.value,
      emphasized: false,
    })),
    {
      key: "total",
      label: "Total a pagar L.",
      value: summary.total,
      emphasized: true,
    },
  ];
}

export function formatPurchaseOrderCurrency(
  value: string | number | null | undefined
) {
  return new Intl.NumberFormat("es-HN", {
    style: "currency",
    currency: "HNL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(toPurchaseOrderNumber(value));
}

function toContractDate(value: string | Date | null | undefined) {
  if (!value) return null;
  const date =
    typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? new Date(
          Number(value.slice(0, 4)),
          Number(value.slice(5, 7)) - 1,
          Number(value.slice(8, 10)),
          12
        )
      : value instanceof Date
        ? value
        : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function addMonthsClamped(date: Date, months: number) {
  const targetMonthStart = new Date(
    date.getFullYear(),
    date.getMonth() + months,
    1,
    12
  );
  const lastDay = new Date(
    targetMonthStart.getFullYear(),
    targetMonthStart.getMonth() + 1,
    0
  ).getDate();
  targetMonthStart.setDate(Math.min(date.getDate(), lastDay));
  return targetMonthStart;
}

export function normalizePurchaseOrderContractFrequency(
  value: string | null | undefined
): PurchaseOrderContractFrequency | null {
  return PURCHASE_ORDER_CONTRACT_FREQUENCIES.includes(
    value as PurchaseOrderContractFrequency
  )
    ? (value as PurchaseOrderContractFrequency)
    : null;
}

export function calculateContractPaymentDates(params: {
  frequency?: string | null;
  firstPaymentDate?: string | Date | null;
  endDate?: string | Date | null;
}) {
  const frequency = normalizePurchaseOrderContractFrequency(params.frequency);
  const firstPaymentDate = toContractDate(params.firstPaymentDate);
  const endDate = toContractDate(params.endDate);

  if (!frequency || !firstPaymentDate || !endDate || firstPaymentDate > endDate) {
    return [];
  }

  const dates: Date[] = [];
  let cursor = firstPaymentDate;
  let guard = 0;

  while (cursor <= endDate && guard < 600) {
    dates.push(cursor);
    if (frequency === "semanal") {
      cursor = addDays(cursor, 7);
    } else if (frequency === "quincenal") {
      cursor = addDays(cursor, 15);
    } else {
      const months =
        frequency === "mensual"
          ? 1
          : frequency === "trimestral"
            ? 3
            : frequency === "semestral"
              ? 6
              : 12;
      cursor = addMonthsClamped(cursor, months);
    }
    guard += 1;
  }

  return dates;
}

export function getPurchaseOrderContractSummary(params: {
  appliesContract?: boolean | null;
  contractPaymentFrequency?: string | null;
  contractFirstPaymentDate?: string | Date | null;
  contractEndDate?: string | Date | null;
  registeredInvoiceCount?: number | string | null;
  now?: Date;
}) {
  const appliesContract = params.appliesContract === true;
  const paymentDates = appliesContract
    ? calculateContractPaymentDates({
        frequency: params.contractPaymentFrequency,
        firstPaymentDate: params.contractFirstPaymentDate,
        endDate: params.contractEndDate,
      })
    : [];
  const registeredInvoiceCount = Math.max(
    Number(params.registeredInvoiceCount ?? 0) || 0,
    0
  );
  const expectedInvoiceCount = paymentDates.length;
  const remainingInvoiceCount = Math.max(
    expectedInvoiceCount - registeredInvoiceCount,
    0
  );
  const now = toContractDate(params.now ?? new Date()) ?? new Date();
  const endDate = toContractDate(params.contractEndDate);
  const daysUntilEnd = endDate
    ? Math.ceil((endDate.getTime() - now.getTime()) / 86_400_000)
    : null;
  const isExpired = endDate ? daysUntilEnd !== null && daysUntilEnd < 0 : false;
  const expiresSoon =
    endDate && daysUntilEnd !== null
      ? !isExpired && daysUntilEnd <= 30
      : false;
  const isFullyInvoiced =
    appliesContract &&
    expectedInvoiceCount > 0 &&
    registeredInvoiceCount >= expectedInvoiceCount;

  return {
    appliesContract,
    paymentDates,
    expectedInvoiceCount,
    registeredInvoiceCount,
    remainingInvoiceCount,
    daysUntilEnd,
    expiresSoon,
    isExpired,
    isFullyInvoiced,
    statusLabel: appliesContract
      ? `Pendiente ${registeredInvoiceCount} de ${expectedInvoiceCount}`
      : "",
  };
}
