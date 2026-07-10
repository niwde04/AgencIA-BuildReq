import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  getPurchaseOrderFiscalSummaryRows,
  parsePurchaseOrderAdditionalTaxCodes,
  summarizePurchaseOrderLines,
  type PurchaseOrderTaxCode,
  type SalesTaxCatalogItem,
} from "@shared/purchase-orders";

export type PurchaseOrderItemTaxDraft = {
  quantity: string;
  unitPrice: string;
  subtotal?: string;
  taxCode: PurchaseOrderTaxCode;
  additionalTaxCodes: string[];
};

type PurchaseOrderTaxSelectOption = {
  value: string;
  label: string;
  taxCode: PurchaseOrderTaxCode;
  additionalTaxCodes: string[];
};

function formatSummaryMoney(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return "0.00";
  return parsed.toLocaleString("es-HN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function normalizeTaxOptionCode(value: string | null | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

function getTaxOptionOrder(value: number | null | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getPurchaseOrderTaxSelectOptions(taxes: SalesTaxCatalogItem[]) {
  return taxes
    .filter(tax => tax.isActive !== false)
    .map((tax, index) => ({
      ...tax,
      taxCode: normalizeTaxOptionCode(tax.taxCode),
      label: tax.description || tax.shortLabel || tax.taxCode,
      displayOrder: getTaxOptionOrder(tax.displayOrder, index + 1),
    }))
    .filter(tax => tax.taxCode)
    .sort((left, right) => left.displayOrder - right.displayOrder)
    .map(tax => ({
      value: tax.taxCode,
      label: tax.label,
      taxCode: tax.taxCode,
      additionalTaxCodes: [],
    }));
}

function getSelectedTaxOption(
  draft: PurchaseOrderItemTaxDraft,
  options: PurchaseOrderTaxSelectOption[]
) {
  const normalizedTaxCode = normalizeTaxOptionCode(draft.taxCode);
  const additionalTaxCodes = parsePurchaseOrderAdditionalTaxCodes(
    draft.additionalTaxCodes
  );

  if (additionalTaxCodes.length === 1) {
    const additionalOption = options.find(
      option => option.taxCode === additionalTaxCodes[0]
    );
    if (additionalOption) return additionalOption;
  }

  return (
    options.find(option => option.taxCode === normalizedTaxCode) ?? options[0]
  );
}

export function PurchaseOrderTaxControls({
  draft,
  taxes,
  disabled,
  onChange,
}: {
  draft: PurchaseOrderItemTaxDraft;
  taxes: SalesTaxCatalogItem[];
  disabled?: boolean;
  onChange: (draft: PurchaseOrderItemTaxDraft) => void;
}) {
  const taxOptions = getPurchaseOrderTaxSelectOptions(taxes);
  const selectedOption = getSelectedTaxOption(draft, taxOptions);

  return (
    <div className="min-w-0">
      <Select
        value={selectedOption?.value ?? ""}
        onValueChange={value => {
          const option = taxOptions.find(entry => entry.value === value);
          if (!option) return;
          onChange({
            ...draft,
            taxCode: option.taxCode,
            additionalTaxCodes: option.additionalTaxCodes,
          });
        }}
        disabled={disabled}
      >
        <SelectTrigger className="h-10 w-full min-w-0 text-sm sm:text-base">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {taxOptions.map(option => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function FiscalSummaryCard({
  summary,
  otherChargesTotal = 0,
}: {
  summary: ReturnType<typeof summarizePurchaseOrderLines>;
  otherChargesTotal?: number | string | null;
}) {
  const rows = getPurchaseOrderFiscalSummaryRows(summary);
  const parsedOtherChargesTotal = Number(otherChargesTotal ?? 0);
  const normalizedOtherChargesTotal = Number.isFinite(parsedOtherChargesTotal)
    ? parsedOtherChargesTotal
    : 0;
  const displayRows =
    normalizedOtherChargesTotal > 0
      ? [
          ...rows.filter(row => row.key !== "total"),
          {
            key: "other-charges",
            label: "Otros cargos L.",
            value: normalizedOtherChargesTotal,
            emphasized: false,
          },
          {
            ...rows.find(row => row.key === "total")!,
            value:
              Number(rows.find(row => row.key === "total")?.value ?? 0) +
              normalizedOtherChargesTotal,
          },
        ]
      : rows;

  return (
    <div className="w-full max-w-[420px] overflow-hidden rounded-xl border border-border bg-background text-sm">
      {displayRows.map((row, index) => (
        <div
          key={row.key}
          className={`grid grid-cols-[minmax(max-content,1fr)_auto] items-center border-border ${
            index > 0 ? "border-t" : ""
          } ${row.emphasized ? "font-semibold" : ""}`}
        >
          <span className="whitespace-nowrap px-3 py-2 text-muted-foreground">
            {row.label}
          </span>
          <span className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-foreground">
            {formatSummaryMoney(row.value)}
          </span>
        </div>
      ))}
    </div>
  );
}
