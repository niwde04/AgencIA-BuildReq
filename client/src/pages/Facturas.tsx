import { trpc } from "@/lib/trpc";
import { DataPagination } from "@/components/DataPagination";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useAuth } from "@/_core/hooks/useAuth";
import { downloadSystemInvoicesWorkbook } from "@/lib/dmc-export";
import { getPrintLogoMarkup, printWindowWhenReady } from "@/lib/print-logo";
import { getReadablePrintStyles } from "@/lib/readable-print-styles";
import {
  calculateRetentionPrintAmount,
  formatRetentionCalendarDate,
  getRetentionCurrencyWord,
  getPrintableRetentionConcepts,
} from "@/lib/retention-print";
import { DocumentAttachmentsPanel } from "@/components/DocumentAttachmentsPanel";
import {
  DocumentItemsAccordionPanel,
  DocumentItemsAccordionTrigger,
} from "@/components/DocumentItemsAccordion";
import { DocumentNumberButton } from "@/components/DocumentNumberButton";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Printer,
  RotateCcw,
  Search,
  Save,
  Send,
  Trash2,
  XCircle,
} from "lucide-react";
import {
  Fragment,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";
import {
  formatPurchaseOrderCurrency,
  getPurchaseCurrencyLabel,
  getPurchaseCurrencySymbol,
  type PurchaseCurrency,
} from "@shared/purchase-orders";
import {
  CAI_FORMAT_EXAMPLE,
  EMISSION_DEADLINE_ISSUE_MESSAGE,
  INVOICE_NUMBER_FORMAT_EXAMPLE,
  formatCaiInput,
  formatInvoiceNumberInput,
  hasEmissionDeadlineIssue,
  isFiscalInvoiceRangeOrdered,
  isInvoiceNumberWithinFiscalRange,
  isValidCai,
  isValidInvoiceNumber,
} from "@shared/invoices";
import {
  ASSET_CONDITION_LABELS,
  ASSET_CONDITION_VALUES,
  normalizeFixedAssetDetails,
  parseFixedAssetDetails,
  type FixedAssetDetail,
} from "@shared/fixed-assets";
import { QUALITY_RETENTION_RELEASE_STATUS_LABELS } from "@shared/quality-retention-releases";
import {
  isAccountPaymentAllowedRetention,
  isMissingCpcRequiredRetention,
  requiresMissingCpcRetention,
} from "@shared/supplier-documents";
import {
  buildInvoiceAdvanceBalance,
  getTreasuryPaymentStatus,
  roundTreasuryMoney,
} from "@shared/treasury";
import {
  calculateInvoiceDocumentAdjustments,
  calculateInvoiceNetPayable,
  getInvoiceBaseIsvAmount,
  getInvoiceDocumentAdjustment,
} from "@shared/invoice-document-adjustments";

const PAGE_SIZE = 50;
const STATUS_LABELS: Record<string, string> = {
  borrador: "Borrador",
  revisada: "Enviada a revisión",
  rechazada: "Rechazada",
  registrada: "Contabilizada",
  anulada: "Anulada",
};

const STATUS_COLORS: Record<string, string> = {
  borrador: "border-slate-300 bg-slate-50 text-slate-700",
  revisada: "border-blue-300 bg-blue-50 text-blue-700",
  rechazada: "border-rose-300 bg-rose-50 text-rose-700",
  registrada: "border-emerald-300 bg-emerald-50 text-emerald-700",
  anulada: "border-rose-300 bg-rose-50 text-rose-700",
};
const EMISSION_DEADLINE_ISSUE_COLOR =
  "border-rose-300 bg-rose-50 text-rose-700";
const SAVED_BUTTON_CLASS =
  "border-emerald-200 bg-emerald-50 text-emerald-700 shadow-none hover:bg-emerald-100 hover:text-emerald-800 disabled:bg-emerald-50 disabled:text-emerald-700 disabled:opacity-100";
const RETENTION_DOCUMENT_NUMBER_PLACEHOLDER = "000-000-00-00000000";
const RETENTION_CAI_PLACEHOLDER = "000000-000000-000000-000000-000000-00";

type InvoiceDraft = {
  isFiscalDocument: boolean;
  cai: string;
  invoiceNumber: string;
  documentRangeStart: string;
  documentRangeEnd: string;
  documentDate: string;
  documentDueDate: string;
  postingDate: string;
  receiptDate: string;
  emissionDeadline: string;
  retentionReceiptNumber: string;
  retentionCai: string;
  retentionDocumentRangeStart: string;
  retentionDocumentRangeEnd: string;
  retentionEmissionDeadline: string;
  retentionDocumentDate: string;
  hasOceExemption: boolean;
  oceNumber: string;
  oceResolutionNumber: string;
  oceResolutionDate: string;
  oceExemptAmount: string;
  oceExemptAmount15: string;
  oceExemptAmount18: string;
  dmcForeignSection: "" | "fyduca" | "importacion";
  dmcForeignIdentification: string;
  dmcFyducaNumber: string;
  dmcDuaNumber: string;
  dmcImportOutsideCentralAmerica: boolean;
  notes: string;
};

type FiscalRangeAutofill = Pick<
  InvoiceDraft,
  "cai" | "documentRangeStart" | "documentRangeEnd" | "emissionDeadline"
> & {
  invoiceNumber: string;
};

type RetentionFiscalRangeAutofill = Pick<
  InvoiceDraft,
  | "retentionCai"
  | "retentionDocumentRangeStart"
  | "retentionDocumentRangeEnd"
  | "retentionEmissionDeadline"
> & {
  retentionReceiptNumber: string;
};

type InvoiceActionFeedback = {
  invoiceSavedId: number | null;
  retentionsSavedId: number | null;
  documentAdjustmentsSavedId: number | null;
  reviewSentId: number | null;
};

type DocumentAdjustmentDraft = {
  qualityRetentionPercent: string;
  qualityRetentionAmount: string;
  qualityRetentionInputMode: "percentage" | "amount";
  advanceAmortizationPercent: string;
  advanceAmortizationAmount: string;
  advanceAmortizationInputMode: "percentage" | "amount";
  promptPaymentPercent: string;
  promptPaymentAmount: string;
  promptPaymentInputMode: "percentage" | "amount";
  tcEnabled: boolean;
};

type RetentionDraft = {
  invoiceItemId?: number | null;
  itemName?: string | null;
  retentionCatalogId: string;
  retentionCode?: string | null;
  retentionErpCode?: string | null;
  description: string;
  baseAmount: string;
  percentage: string;
  amount: string;
};

type RetentionOption = {
  id: number;
  taxCode: string;
  description: string;
  ratePercent: string | number;
  isActive?: boolean;
  erpCode?: string | null;
  disabledReason?: string | null;
};

type InvoiceAssetDraft = {
  isFixedAsset: boolean;
  isLeasing: boolean;
  lineObservation: string;
  dmcDestination: "" | "costo" | "gasto" | "no_deducible";
  assetDetails: FixedAssetDetail[];
};

const ASSET_DETAIL_OPTIONAL_FIELDS: Array<{
  key: keyof FixedAssetDetail;
  label: string;
  placeholder: string;
}> = [
  { key: "brand", label: "Marca", placeholder: "Marca" },
  { key: "color", label: "Color", placeholder: "Color" },
  { key: "model", label: "Modelo", placeholder: "Modelo" },
  { key: "chassisSeries", label: "Serie chasis", placeholder: "Serie chasis" },
  { key: "motorSeries", label: "Serie motor", placeholder: "Serie motor" },
  { key: "plateOrCode", label: "Placa/código", placeholder: "Placa o código" },
];

function getPositiveIntegerQuantity(value: string | number | null | undefined) {
  const quantity = Number(value ?? 0);
  return Number.isFinite(quantity) && quantity > 0 && Number.isInteger(quantity)
    ? quantity
    : 0;
}

function getAssetDetailSummary(detail: FixedAssetDetail) {
  return [
    detail.serialNumber ? `Serie ${detail.serialNumber}` : null,
    ASSET_CONDITION_LABELS[detail.condition],
    detail.color ? `Color ${detail.color}` : null,
    detail.brand ? `Marca ${detail.brand}` : null,
    detail.model ? `Modelo ${detail.model}` : null,
    detail.chassisSeries ? `Chasis ${detail.chassisSeries}` : null,
    detail.motorSeries ? `Motor ${detail.motorSeries}` : null,
    detail.plateOrCode ? `Placa/código ${detail.plateOrCode}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

type InvoiceFixedAssetArticle = {
  id?: number;
  temporaryItemCode?: string | null;
  itemCode?: string | null;
  fixedAssetStatus?: string | null;
  fixedAssetSerialNumber?: string | null;
  fixedAssetCondition?: FixedAssetDetail["condition"] | null;
  fixedAssetColor?: string | null;
  fixedAssetModel?: string | null;
  fixedAssetBrand?: string | null;
  fixedAssetChassisSeries?: string | null;
  fixedAssetMotorSeries?: string | null;
  fixedAssetPlateOrCode?: string | null;
};

type InvoiceAssetBreakdownRow = FixedAssetDetail & {
  temporaryItemCode?: string | null;
  itemCode?: string | null;
  fixedAssetStatus?: string | null;
};

function getInvoiceFixedAssetArticles(item: any): InvoiceFixedAssetArticle[] {
  return Array.isArray(item?.fixedAssetArticles) ? item.fixedAssetArticles : [];
}

function getInvoiceAssetBreakdownRows(
  item: any,
  fallbackDetails: FixedAssetDetail[]
): InvoiceAssetBreakdownRow[] {
  const articles = getInvoiceFixedAssetArticles(item);
  const quantity = Number(item?.quantity ?? 0);
  const isSingleUnitLine =
    Number.isFinite(quantity) && quantity <= 1 && fallbackDetails.length <= 1;
  if (isSingleUnitLine) {
    const currentCode = String(item?.currentSapItemCode ?? "").trim();
    const fallbackDetail = fallbackDetails[0];
    const matchingArticle =
      articles.find(article => {
        const articleCode = String(article.itemCode ?? "").trim();
        const temporaryCode = String(article.temporaryItemCode ?? "").trim();
        const serialNumber = String(
          article.fixedAssetSerialNumber ?? ""
        ).trim();
        return (
          (currentCode &&
            (articleCode === currentCode || temporaryCode === currentCode)) ||
          (fallbackDetail?.serialNumber &&
            serialNumber === fallbackDetail.serialNumber)
        );
      }) ?? articles[0];

    if (matchingArticle) {
      return [
        {
          serialNumber:
            matchingArticle.fixedAssetSerialNumber ??
            fallbackDetail?.serialNumber ??
            "",
          condition:
            matchingArticle.fixedAssetCondition ??
            fallbackDetail?.condition ??
            "nuevo",
          color: matchingArticle.fixedAssetColor ?? fallbackDetail?.color ?? "",
          model: matchingArticle.fixedAssetModel ?? fallbackDetail?.model ?? "",
          brand: matchingArticle.fixedAssetBrand ?? fallbackDetail?.brand ?? "",
          chassisSeries:
            matchingArticle.fixedAssetChassisSeries ??
            fallbackDetail?.chassisSeries ??
            "",
          motorSeries:
            matchingArticle.fixedAssetMotorSeries ??
            fallbackDetail?.motorSeries ??
            "",
          plateOrCode:
            matchingArticle.fixedAssetPlateOrCode ??
            fallbackDetail?.plateOrCode ??
            "",
          temporaryItemCode: matchingArticle.temporaryItemCode ?? "",
          itemCode: matchingArticle.itemCode ?? currentCode,
          fixedAssetStatus: matchingArticle.fixedAssetStatus ?? "resuelto",
        },
      ];
    }

    return fallbackDetails.map(detail => ({
      ...detail,
      temporaryItemCode: "",
      itemCode: currentCode,
      fixedAssetStatus: item?.isFixedAsset ? "resuelto" : null,
    }));
  }

  if (articles.length > 0) {
    return articles.map(article => ({
      serialNumber: article.fixedAssetSerialNumber ?? "",
      condition: article.fixedAssetCondition ?? "nuevo",
      color: article.fixedAssetColor ?? "",
      model: article.fixedAssetModel ?? "",
      brand: article.fixedAssetBrand ?? "",
      chassisSeries: article.fixedAssetChassisSeries ?? "",
      motorSeries: article.fixedAssetMotorSeries ?? "",
      plateOrCode: article.fixedAssetPlateOrCode ?? "",
      temporaryItemCode: article.temporaryItemCode ?? "",
      itemCode: article.itemCode ?? "",
      fixedAssetStatus: article.fixedAssetStatus ?? "pendiente",
    }));
  }

  return fallbackDetails.map(detail => ({
    ...detail,
    temporaryItemCode: "",
    itemCode: "",
    fixedAssetStatus: item?.isFixedAsset ? "pendiente" : null,
  }));
}

function getFixedAssetStatusLabel(status: string | null | undefined) {
  const normalized = String(status ?? "")
    .trim()
    .toLowerCase();
  if (normalized === "resuelto") return "Resuelto";
  if (normalized === "pendiente") return "Pendiente";
  return normalized || "Pendiente";
}

function getFixedAssetStatusBadgeClass(status: string | null | undefined) {
  return String(status ?? "")
    .trim()
    .toLowerCase() === "resuelto"
    ? "border-emerald-300 text-emerald-700"
    : "border-amber-300 text-amber-700";
}

function getInvoiceAssetDisplayCode(
  asset: InvoiceAssetBreakdownRow,
  item: any
) {
  return (
    String(asset.itemCode ?? "").trim() ||
    String(asset.temporaryItemCode ?? "").trim() ||
    String(item.currentSapItemCode ?? "").trim() ||
    String(item.originalSapItemCode ?? "").trim() ||
    "—"
  );
}

function getInvoiceUnitAmount(
  value: string | number | null | undefined,
  unitCount: number
) {
  const count = Math.max(unitCount, 1);
  return toNumber(value) / count;
}

function InvoiceAssetUnitDetailsPanel({
  asset,
  unitNumber,
}: {
  asset: InvoiceAssetBreakdownRow;
  unitNumber: number;
}) {
  return (
    <div className="rounded-md border border-border/70 bg-background p-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold">Unidad {unitNumber}</span>
        <Badge
          variant="outline"
          className={getFixedAssetStatusBadgeClass(asset.fixedAssetStatus)}
        >
          {getFixedAssetStatusLabel(asset.fixedAssetStatus)}
        </Badge>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="space-y-1.5">
          <Label>Número de serie</Label>
          <Input
            value={asset.serialNumber}
            disabled
            placeholder="Serie"
            className="disabled:cursor-default disabled:opacity-100"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Condición</Label>
          <Select value={asset.condition} disabled>
            <SelectTrigger className="disabled:cursor-default disabled:opacity-100">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ASSET_CONDITION_VALUES.map(condition => (
                <SelectItem key={condition} value={condition}>
                  {ASSET_CONDITION_LABELS[condition]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {ASSET_DETAIL_OPTIONAL_FIELDS.map(field => (
          <div key={field.key} className="space-y-1.5">
            <Label>{field.label}</Label>
            <Input
              value={String(asset[field.key] ?? "")}
              disabled
              placeholder={field.placeholder}
              className="disabled:cursor-default disabled:opacity-100"
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function InvoiceLineRetentionCell({
  item,
  lineRetentions,
  availableRetentionOptions,
  canEditRetentions,
  canAddLineRetention,
  hasPendingRetentions,
  isSavingRetentions,
  saveRetentionsDisabled,
  onAddLineRetention,
  onSaveRetentions,
}: {
  item: any;
  lineRetentions: RetentionDraft[];
  availableRetentionOptions: RetentionOption[];
  canEditRetentions: boolean;
  canAddLineRetention: boolean;
  hasPendingRetentions: boolean;
  isSavingRetentions: boolean;
  saveRetentionsDisabled: boolean;
  onAddLineRetention: (item: any, retentionCatalogId: string) => void;
  onSaveRetentions: () => void;
}) {
  return (
    <td className="min-w-[300px] p-3">
      {item.allowsTaxWithholding !== false ? (
        <div className="space-y-2">
          {lineRetentions.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {lineRetentions.map(retention => (
                <Badge
                  key={`${retention.invoiceItemId}-${retention.retentionCatalogId}`}
                  variant="outline"
                  className="border-emerald-300 text-emerald-700"
                >
                  {retention.retentionCode} - {retention.description}
                </Badge>
              ))}
            </div>
          ) : canEditRetentions ? null : (
            <Badge
              variant="outline"
              className="border-amber-300 text-amber-700"
            >
              Sin retención
            </Badge>
          )}

          {canEditRetentions ? (
            canAddLineRetention ? (
              <Select
                key={`${item.id}-${lineRetentions
                  .map(retention => retention.retentionCatalogId)
                  .join("-")}`}
                onValueChange={value => onAddLineRetention(item, value)}
              >
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Agregar retención" />
                </SelectTrigger>
                <SelectContent>
                  {availableRetentionOptions.map(option => (
                    <SelectItem
                      key={option.id}
                      value={String(option.id)}
                      disabled={Boolean(option.disabledReason)}
                    >
                      {option.taxCode} — {option.description} (
                      {Number(option.ratePercent).toLocaleString("es-HN", {
                        maximumFractionDigits: 4,
                      })}
                      %)
                      {option.disabledReason ? " — No disponible" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <p className="text-xs text-muted-foreground">
                {lineRetentions.length >= 2
                  ? "Máximo 2 retenciones"
                  : "Sin retenciones disponibles"}
              </p>
            )
          ) : null}

          {canEditRetentions &&
          hasPendingRetentions &&
          lineRetentions.length > 0 ? (
            <Button
              type="button"
              size="sm"
              onClick={onSaveRetentions}
              disabled={isSavingRetentions || saveRetentionsDisabled}
            >
              <Save className="mr-2 h-4 w-4" />
              {isSavingRetentions ? "Guardando..." : "Guardar retenciones"}
            </Button>
          ) : null}
        </div>
      ) : (
        <Badge variant="outline" className="border-slate-300 text-slate-600">
          No aplica
        </Badge>
      )}
    </td>
  );
}

function DocumentAdjustmentPercentageRow({
  label,
  description,
  baseAmount,
  percentage,
  amount,
  currencySymbol,
  disabled,
  onPercentageChange,
  onAmountChange,
}: {
  label: string;
  description: string;
  baseAmount: number;
  percentage: string;
  amount: string;
  currencySymbol: string;
  disabled: boolean;
  onPercentageChange: (value: string) => void;
  onAmountChange: (value: string) => void;
}) {
  return (
    <div className="grid gap-3 rounded-lg border border-border/70 p-3 md:grid-cols-[minmax(220px,1fr)_150px_130px_150px] md:items-end">
      <div>
        <p className="font-medium">{label}</p>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="space-y-1.5">
        <Label>Base</Label>
        <Input
          value={`${currencySymbol} ${baseAmount.toLocaleString("es-HN", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 4,
          })}`}
          disabled
          className="text-right disabled:cursor-default disabled:opacity-100"
        />
      </div>
      <div className="space-y-1.5">
        <Label>Porcentaje</Label>
        <div className="relative">
          <Input
            type="number"
            min="0"
            max="100"
            step="0.01"
            inputMode="decimal"
            value={percentage}
            disabled={disabled}
            onChange={event => onPercentageChange(event.target.value)}
            className="pr-8 text-right"
          />
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
            %
          </span>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>Monto</Label>
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
            {currencySymbol}
          </span>
          <Input
            type="number"
            min="0"
            max={baseAmount}
            step="0.0001"
            inputMode="decimal"
            value={amount}
            disabled={disabled}
            onChange={event => onAmountChange(event.target.value)}
            className="pl-8 text-right font-semibold"
          />
        </div>
      </div>
    </div>
  );
}

function formatSupplierRtnLabel(supplier?: any | null) {
  const rtn = String(supplier?.rtn ?? "").trim();
  return rtn || "RTN no configurado";
}

function formatUserReference(user: any, fallbackId?: number | null) {
  const name = String(user?.name ?? "").trim();
  if (name) return name;

  const email = String(user?.email ?? "").trim();
  if (email) return email;

  return fallbackId ? `Usuario #${fallbackId}` : "Usuario no identificado";
}

function getUserLabel(user: any, fallback = "—") {
  return user?.name?.trim?.() || user?.email?.trim?.() || fallback;
}

function dateInputValue(value: string | Date | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function formatDateLabel(value: string | Date | null | undefined) {
  return formatRetentionCalendarDate(value) || "—";
}

function formatExchangeRateLabel(value: string | number | null | undefined) {
  const raw = String(value ?? "");
  return raw.includes(".") ? raw.replace(/0+$/, "").replace(/\.$/, "") : raw;
}

function formatDateTimeLabel(value: string | Date | null | undefined) {
  if (!value) return "Pendiente";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Pendiente"
    : date.toLocaleString("es-HN", {
        dateStyle: "short",
        timeStyle: "short",
      });
}

function toNumber(value: string | number | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toMoneyNumber(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return 0;
  const parsed =
    typeof value === "number"
      ? value
      : Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 10000) / 10000;
}

function formatMoneyInput(value: string | number | null | undefined) {
  const parsed = toMoneyNumber(value);
  return parsed > 0 ? parsed.toFixed(2) : "";
}

function formatDocumentAdjustmentPercent(
  value: string | number | null | undefined,
  maximumFractionDigits = 2
) {
  const parsed = toMoneyNumber(value);
  if (parsed <= 0) return "";
  const [whole, fraction = ""] = parsed
    .toFixed(maximumFractionDigits)
    .split(".");
  const normalizedFraction = fraction.replace(/0+$/, "").padEnd(2, "0");
  return normalizedFraction ? `${whole}.${normalizedFraction}` : whole;
}

function formatDocumentAdjustmentAmount(
  value: string | number | null | undefined
) {
  const parsed = toMoneyNumber(value);
  if (parsed <= 0) return "";
  const [whole, fraction = ""] = parsed.toFixed(4).split(".");
  const normalizedFraction = fraction.replace(/0+$/, "").padEnd(2, "0");
  return normalizedFraction ? `${whole}.${normalizedFraction}` : whole;
}

function parseDocumentAdjustmentPercent(value: string, label: string) {
  const trimmed = value.trim();
  if (!trimmed) return 0;
  if (!/^\d{1,3}(?:\.\d{0,2})?$/.test(trimmed)) {
    toast.error(`${label} acepta como máximo dos decimales`);
    return null;
  }
  const percentage = Number(trimmed);
  if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
    toast.error(`${label} debe estar entre 0 y 100`);
    return null;
  }
  return percentage;
}

function parseDocumentAdjustmentAmount(
  value: string,
  label: string,
  baseAmount: number
) {
  const trimmed = value.trim();
  if (!trimmed) return 0;
  if (!/^\d+(?:\.\d{0,4})?$/.test(trimmed)) {
    toast.error(`${label} acepta como máximo cuatro decimales`);
    return null;
  }
  const amount = Number(trimmed);
  if (!Number.isFinite(amount) || amount < 0) {
    toast.error(`${label} debe ser mayor o igual a cero`);
    return null;
  }
  if (amount - baseAmount > 0.000001) {
    toast.error(`${label} no puede exceder el subtotal de la factura`);
    return null;
  }
  return roundMoney(amount);
}

function parseTaxBreakdown(value: unknown) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function calculateOceExemptAmountSuggestion(detail: any) {
  const items = Array.isArray(detail?.items) ? detail.items : [];
  const subtotal = toMoneyNumber(detail?.invoice?.subtotal);
  const taxAmount = toMoneyNumber(detail?.invoice?.taxAmount);
  let exemptAmount = 0;

  for (const item of items) {
    const itemSubtotal = toMoneyNumber(item?.subtotal);
    const breakdown = parseTaxBreakdown(item?.taxBreakdown);
    const baseRows = breakdown.filter(
      (entry: any) => entry?.taxType === "base"
    );

    if (baseRows.length === 0) {
      const itemTaxAmount = toMoneyNumber(item?.taxAmount);
      if (
        !["isv_15", "isv_18", "isv_4"].includes(String(item?.taxCode ?? "")) &&
        itemTaxAmount === 0
      ) {
        exemptAmount += itemSubtotal;
      }
      continue;
    }

    for (const entry of baseRows) {
      const ratePercent = toMoneyNumber(entry?.ratePercent);
      if (ratePercent === 0) {
        exemptAmount += toMoneyNumber(entry?.baseAmount ?? itemSubtotal);
      }
    }
  }

  if (exemptAmount <= 0 && subtotal > 0 && taxAmount === 0) {
    exemptAmount = subtotal;
  }

  return roundMoney(Math.min(exemptAmount, subtotal || exemptAmount));
}

function getInvoiceRequestNumbers(row: any) {
  const requests = Array.isArray(row?.materialRequests)
    ? row.materialRequests
    : [];
  return Array.from(
    new Set(
      requests
        .map((request: any) => String(request?.requestNumber ?? "").trim())
        .filter(Boolean)
    )
  );
}

function formatInvoiceRequestNumbers(row: any) {
  const requestNumbers = getInvoiceRequestNumbers(row);
  return requestNumbers.length > 0 ? requestNumbers.join(", ") : "—";
}

function formatInvoiceRequestedBy(row: any) {
  const users = Array.isArray(row.requestedByUsers)
    ? row.requestedByUsers
    : row.requestedBy
      ? [row.requestedBy]
      : [];
  const labels = Array.from(
    new Set(users.map((user: any) => getUserLabel(user, "")).filter(Boolean))
  );
  return labels.length > 0 ? labels.join(", ") : "—";
}

function formatInvoiceCreatedBy(row: any) {
  return getUserLabel(
    row.createdBy,
    row.receipt?.receivedById ? `Usuario #${row.receipt.receivedById}` : "—"
  );
}

function getRetentionAmount(draft: RetentionDraft) {
  return calculateRetentionPrintAmount(draft.baseAmount, draft.percentage);
}

function getInvoiceHasEmissionDeadlineIssue(invoice: any) {
  return hasEmissionDeadlineIssue({
    isFiscalDocument: invoice?.isFiscalDocument,
    documentDate: invoice?.documentDate,
    emissionDeadline: invoice?.emissionDeadline,
  });
}

function getInvoiceStatusLabel(invoice: any) {
  if (getInvoiceHasEmissionDeadlineIssue(invoice)) {
    return invoice?.status === "borrador"
      ? "Borrador con alerta"
      : `${STATUS_LABELS[invoice?.status] || invoice?.status} con alerta`;
  }
  return STATUS_LABELS[invoice.status] || invoice.status;
}

function getInvoiceStatusColor(invoice: any) {
  return getInvoiceHasEmissionDeadlineIssue(invoice)
    ? EMISSION_DEADLINE_ISSUE_COLOR
    : STATUS_COLORS[invoice.status] || "";
}

function getInvoiceStatusNote(invoice: any) {
  if (invoice?.status === "rechazada") {
    const note = String(invoice.rejectionComment ?? "").trim();
    return note ? { label: "Motivo", text: note } : null;
  }

  if (invoice?.status === "anulada") {
    const note = String(invoice.voidReason ?? "").trim();
    return {
      label: "Motivo",
      text: note || "Sin motivo registrado",
    };
  }

  return null;
}

function getInvoiceHistoryRows(invoice: any) {
  if (!invoice) return [];

  const rows: Array<{
    label: string;
    date?: string | Date | null;
    state: "done" | "pending" | "danger";
  }> = [
    {
      label: "Factura creada",
      date: invoice.createdAt,
      state: "done",
    },
  ];

  if (invoice.reviewedAt) {
    rows.push({
      label: "Enviada a revisión",
      date: invoice.reviewedAt,
      state: "done",
    });
  } else if (invoice.status === "borrador" || invoice.status === "rechazada") {
    rows.push({
      label: "Pendiente de envío",
      state: "pending",
    });
  }

  if (invoice.rejectedAt) {
    rows.push({
      label: "Factura rechazada",
      date: invoice.rejectedAt,
      state: "danger",
    });
  }

  if (invoice.accountedAt) {
    rows.push({
      label: "Factura contabilizada",
      date: invoice.accountedAt,
      state: "done",
    });
  } else if (invoice.status === "revisada") {
    rows.push({
      label: "Pendiente de contabilizar",
      state: "pending",
    });
  }

  if (invoice.voidedAt) {
    rows.push({
      label: "Factura anulada",
      date: invoice.voidedAt,
      state: "danger",
    });
  }

  return rows;
}

function emptyRetention(total: string | number, item?: any): RetentionDraft {
  return {
    invoiceItemId: item?.id ?? null,
    itemName: item?.itemName ?? null,
    retentionCatalogId: "none",
    retentionCode: null,
    retentionErpCode: null,
    description: "",
    baseAmount: String(total ?? "0.00"),
    percentage: "",
    amount: "",
  };
}

function getFriendlyMutationError(message: string) {
  try {
    const parsed = JSON.parse(message);
    if (!Array.isArray(parsed)) return message;
    const issue = parsed[0];
    const path = Array.isArray(issue?.path) ? issue.path.join(".") : "";
    const issueMessage =
      typeof issue?.message === "string" ? issue.message : "";

    if (path.includes("description")) {
      return "Ingresa la descripción de cada retención";
    }
    if (path.includes("retentionCatalogId")) {
      return "Seleccione una retención válida";
    }
    if (path.includes("percentage")) {
      return "Ingresa un porcentaje mayor que cero";
    }
    if (path.includes("baseAmount")) {
      return "Ingresa una base de retención válida";
    }
    if (path.includes("amount")) {
      return "Ingresa un monto mayor que cero";
    }
    if (path.includes("cai")) {
      return (
        issueMessage || `El CAI debe tener el formato ${CAI_FORMAT_EXAMPLE}`
      );
    }
    if (path.includes("invoiceNumber")) {
      return (
        issueMessage ||
        `El número documento debe tener el formato ${INVOICE_NUMBER_FORMAT_EXAMPLE}`
      );
    }
    if (path.includes("retentionReceiptNumber")) {
      return (
        issueMessage ||
        `El comprobante de retención debe tener el formato ${INVOICE_NUMBER_FORMAT_EXAMPLE}`
      );
    }
    if (path.includes("documentRangeStart")) {
      return (
        issueMessage ||
        `El rango autorizado inicial debe tener el formato ${INVOICE_NUMBER_FORMAT_EXAMPLE}`
      );
    }
    if (path.includes("documentRangeEnd")) {
      return (
        issueMessage ||
        `El rango autorizado final debe tener el formato ${INVOICE_NUMBER_FORMAT_EXAMPLE}`
      );
    }

    return issueMessage || message;
  } catch {
    return message;
  }
}

function escapePrintHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatRetentionPrintDate(value: string | Date | null | undefined) {
  return formatRetentionCalendarDate(value);
}

function formatRetentionPrintNumber(value: string | number | null | undefined) {
  return toNumber(value).toLocaleString("es-HN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatInvoicePrintDate(value: string | Date | null | undefined) {
  return formatRetentionPrintDate(value) || "-";
}

function formatInvoicePrintMoney(value: string | number | null | undefined) {
  return formatRetentionPrintNumber(value);
}

function formatInvoicePrintQuantity(value: string | number | null | undefined) {
  return toNumber(value).toLocaleString("es-HN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function wordsUnderThousand(value: number): string {
  const units = [
    "",
    "uno",
    "dos",
    "tres",
    "cuatro",
    "cinco",
    "seis",
    "siete",
    "ocho",
    "nueve",
  ];
  const teens: Record<number, string> = {
    10: "diez",
    11: "once",
    12: "doce",
    13: "trece",
    14: "catorce",
    15: "quince",
    16: "dieciseis",
    17: "diecisiete",
    18: "dieciocho",
    19: "diecinueve",
    20: "veinte",
    21: "veintiuno",
    22: "veintidos",
    23: "veintitres",
    24: "veinticuatro",
    25: "veinticinco",
    26: "veintiseis",
    27: "veintisiete",
    28: "veintiocho",
    29: "veintinueve",
  };
  const tens = [
    "",
    "",
    "veinte",
    "treinta",
    "cuarenta",
    "cincuenta",
    "sesenta",
    "setenta",
    "ochenta",
    "noventa",
  ];
  const hundreds = [
    "",
    "ciento",
    "doscientos",
    "trescientos",
    "cuatrocientos",
    "quinientos",
    "seiscientos",
    "setecientos",
    "ochocientos",
    "novecientos",
  ];

  if (value === 0) return "";
  if (value === 100) return "cien";
  if (value < 10) return units[value];
  if (value < 30) return teens[value];
  if (value < 100) {
    const ten = Math.floor(value / 10);
    const unit = value % 10;
    return unit ? `${tens[ten]} y ${units[unit]}` : tens[ten];
  }

  const hundred = Math.floor(value / 100);
  const rest = value % 100;
  return rest
    ? `${hundreds[hundred]} ${wordsUnderThousand(rest)}`
    : hundreds[hundred];
}

function integerToSpanishWords(value: number): string {
  if (value === 0) return "cero";

  const millions = Math.floor(value / 1_000_000);
  const thousands = Math.floor((value % 1_000_000) / 1_000);
  const rest = value % 1_000;
  const parts: string[] = [];

  if (millions > 0) {
    parts.push(
      millions === 1
        ? "un millon"
        : `${integerToSpanishWords(millions)} millones`
    );
  }
  if (thousands > 0) {
    parts.push(
      thousands === 1 ? "mil" : `${wordsUnderThousand(thousands)} mil`
    );
  }
  if (rest > 0) {
    parts.push(wordsUnderThousand(rest));
  }

  return parts.join(" ");
}

function amountToSpanishCurrency(value: number, currency: PurchaseCurrency) {
  const centsTotal = Math.max(0, Math.round(value * 100));
  const units = Math.floor(centsTotal / 100);
  const cents = centsTotal % 100;
  const unitLabel = getRetentionCurrencyWord(currency, units);
  return `${integerToSpanishWords(units).toUpperCase()} ${unitLabel} CON ${String(cents).padStart(2, "0")}/100`;
}

function InvoiceAssetDetailsEditor({
  invoiceId,
  item,
  canEdit,
}: {
  invoiceId: number;
  item: any;
  canEdit: boolean;
}) {
  const utils = trpc.useUtils();
  const [draft, setDraft] = useState<InvoiceAssetDraft>({
    isFixedAsset: item.isFixedAsset === true,
    isLeasing: item.isLeasing === true,
    lineObservation: item.lineObservation ?? "",
    dmcDestination: item.dmcDestination ?? "",
    assetDetails: parseFixedAssetDetails(item.assetDetails),
  });
  const updateAssetDetailsMutation =
    trpc.invoices.updateItemAssetDetails.useMutation({
      onSuccess: () => {
        toast.success("Datos de activo actualizados");
        void utils.invoices.invalidate();
        void utils.invoices.getById.invalidate({ id: invoiceId });
      },
      onError: error => toast.error(getFriendlyMutationError(error.message)),
    });

  useEffect(() => {
    setDraft({
      isFixedAsset: item.isFixedAsset === true,
      isLeasing: item.isLeasing === true,
      lineObservation: item.lineObservation ?? "",
      dmcDestination: item.dmcDestination ?? "",
      assetDetails: parseFixedAssetDetails(item.assetDetails),
    });
  }, [
    item.id,
    item.isFixedAsset,
    item.isLeasing,
    item.lineObservation,
    item.dmcDestination,
    item.assetDetails,
  ]);

  const assetUnitCount = getPositiveIntegerQuantity(item.quantity);
  const assetDetails = draft.isFixedAsset
    ? normalizeFixedAssetDetails(draft.assetDetails, assetUnitCount)
    : [];

  const updateAssetDetail = (
    index: number,
    field: keyof FixedAssetDetail,
    value: string
  ) => {
    setDraft(current => {
      const details = normalizeFixedAssetDetails(
        current.assetDetails,
        assetUnitCount
      );
      details[index] = {
        ...details[index],
        [field]: value,
      };
      return {
        ...current,
        assetDetails: details,
      };
    });
  };

  const handleSave = () => {
    if (!canEdit) return;
    if (draft.isFixedAsset && assetUnitCount === 0) {
      toast.error("Activo fijo requiere cantidad entera mayor que cero");
      return;
    }
    if (draft.isFixedAsset) {
      const missingIndex = assetDetails.findIndex(
        detail => !detail.serialNumber.trim() || !detail.condition
      );
      if (missingIndex >= 0) {
        toast.error(
          `Complete serie y condición de la unidad ${missingIndex + 1}`
        );
        return;
      }
    }

    updateAssetDetailsMutation.mutate({
      id: invoiceId,
      invoiceItemId: item.id,
      isFixedAsset: draft.isFixedAsset,
      isLeasing: draft.isFixedAsset ? draft.isLeasing : false,
      lineObservation: draft.lineObservation.trim() || undefined,
      dmcDestination: draft.dmcDestination || null,
      assetDetails: draft.isFixedAsset ? assetDetails : [],
    });
  };

  return (
    <div className="space-y-4 rounded-lg border border-border/70 bg-background p-3">
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm font-medium">
          <Checkbox
            checked={draft.isFixedAsset}
            disabled={
              !canEdit ||
              (!draft.isFixedAsset &&
                (assetUnitCount === 0 || item.targetType !== "activo_fijo"))
            }
            onCheckedChange={checked =>
              setDraft(current => ({
                ...current,
                isFixedAsset: checked === true,
                isLeasing: checked === true ? current.isLeasing : false,
                assetDetails:
                  checked === true
                    ? normalizeFixedAssetDetails(
                        current.assetDetails,
                        assetUnitCount
                      )
                    : [],
              }))
            }
          />
          Activo fijo
        </label>
        {!draft.isFixedAsset &&
        (assetUnitCount === 0 || item.targetType !== "activo_fijo") ? (
          <span className="text-xs text-muted-foreground bg-muted/50 px-2 py-0.5 rounded border border-border/50">
            {item.targetType !== "activo_fijo"
              ? "Solo disponible para productos de tipo Activo Fijo"
              : "Solo disponible con cantidad entera mayor que cero"}
          </span>
        ) : null}
        {draft.isFixedAsset ? (
          <label className="flex items-center gap-2 text-sm font-medium">
            <Checkbox
              checked={draft.isLeasing}
              disabled={!canEdit}
              onCheckedChange={checked =>
                setDraft(current => ({
                  ...current,
                  isLeasing: checked === true,
                }))
              }
            />
            Leasing
          </label>
        ) : null}
        {draft.isFixedAsset ? (
          <Badge variant="outline" className="border-blue-300 text-blue-700">
            {assetDetails.length} unidad(es) con serie
          </Badge>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label>Clasificación DMC</Label>
        <Select
          value={draft.dmcDestination || "none"}
          disabled={!canEdit}
          onValueChange={value =>
            setDraft(current => ({
              ...current,
              dmcDestination:
                value === "none"
                  ? ""
                  : (value as InvoiceAssetDraft["dmcDestination"]),
            }))
          }
        >
          <SelectTrigger>
            <SelectValue placeholder="Seleccione el destino contable" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Sin clasificar</SelectItem>
            <SelectItem value="costo">Costo</SelectItem>
            <SelectItem value="gasto">Gasto</SelectItem>
            <SelectItem value="no_deducible">No deducible</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Requerido para generar el DMC 527.
        </p>
      </div>

      <div className="space-y-2">
        <Label>Observación de línea</Label>
        <Textarea
          rows={2}
          value={draft.lineObservation}
          disabled={!canEdit}
          onChange={event =>
            setDraft(current => ({
              ...current,
              lineObservation: event.target.value,
            }))
          }
          placeholder="Observaciones de esta línea de factura"
        />
      </div>

      {draft.isFixedAsset ? (
        assetUnitCount === 0 ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            La cantidad de la línea debe ser entera y mayor que cero para
            capturar unidades de activo fijo.
          </div>
        ) : (
          <div className="space-y-3">
            <div className="overflow-hidden rounded-lg border border-border/70">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1320px] border-collapse text-sm">
                  <thead className="bg-muted/40">
                    <tr className="border-b border-border/70 text-left text-xs font-semibold text-muted-foreground">
                      <th className="w-16 px-3 py-2.5">Unidad</th>
                      <th className="min-w-[160px] px-2 py-2.5">
                        Número de serie
                      </th>
                      <th className="w-32 px-2 py-2.5">Condición</th>
                      {ASSET_DETAIL_OPTIONAL_FIELDS.map(field => (
                        <th
                          key={field.key}
                          className="min-w-[145px] px-2 py-2.5"
                        >
                          {field.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {assetDetails.map((detail, index) => (
                      <tr
                        key={`${item.id}-asset-${index}`}
                        className="border-b border-border/60 last:border-b-0"
                      >
                        <td className="px-3 py-2 font-semibold">{index + 1}</td>
                        <td className="px-2 py-2">
                          <Input
                            className="h-9"
                            aria-label={`Número de serie de la unidad ${index + 1}`}
                            value={detail.serialNumber}
                            disabled={!canEdit}
                            onChange={event =>
                              updateAssetDetail(
                                index,
                                "serialNumber",
                                event.target.value
                              )
                            }
                            placeholder="Ej. SN123456"
                          />
                        </td>
                        <td className="px-2 py-2">
                          <Select
                            value={detail.condition}
                            disabled={!canEdit}
                            onValueChange={value =>
                              updateAssetDetail(index, "condition", value)
                            }
                          >
                            <SelectTrigger
                              className="h-9"
                              aria-label={`Condición de la unidad ${index + 1}`}
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {ASSET_CONDITION_VALUES.map(condition => (
                                <SelectItem key={condition} value={condition}>
                                  {ASSET_CONDITION_LABELS[condition]}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </td>
                        {ASSET_DETAIL_OPTIONAL_FIELDS.map(field => (
                          <td key={field.key} className="px-2 py-2">
                            <Input
                              className="h-9"
                              aria-label={`${field.label} de la unidad ${index + 1}`}
                              value={String(detail[field.key] ?? "")}
                              disabled={!canEdit}
                              onChange={event =>
                                updateAssetDetail(
                                  index,
                                  field.key,
                                  event.target.value
                                )
                              }
                              placeholder={field.placeholder}
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="border-t border-border/70 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                Mostrando {assetDetails.length} de {assetUnitCount} unidad(es)
              </div>
            </div>
          </div>
        )
      ) : null}

      {canEdit ? (
        <Button
          type="button"
          variant="outline"
          onClick={handleSave}
          disabled={updateAssetDetailsMutation.isPending}
        >
          <Save className="mr-2 h-4 w-4" />
          Guardar datos de línea
        </Button>
      ) : null}
    </div>
  );
}

export default function Facturas() {
  const utils = trpc.useUtils();
  const [location, setLocation] = useLocation();
  const { user } = useAuth();
  const userRole = (user as any)?.buildreqRole;
  const isAccountant = userRole === "contable";
  const canAccountInvoices = isAccountant || user?.role === "admin";
  const canEditInvoices =
    user?.role === "admin" ||
    userRole === "administracion_central" ||
    userRole === "administrador_proyecto";
  const canReviewInvoices = canEditInvoices;
  const canOpenTreasuryBatches =
    user?.role === "admin" ||
    userRole === "administracion_central" ||
    userRole === "administrador_proyecto" ||
    userRole === "contable" ||
    userRole === "financiero";
  const canExportInternalReport =
    userRole === "administracion_central" ||
    userRole === "administrador_proyecto" ||
    userRole === "contable";
  const [selectedId, setSelectedId] = useState<number | null>(() => {
    const requestedId = Number(
      new URLSearchParams(window.location.search).get("editar")
    );
    return Number.isInteger(requestedId) && requestedId > 0
      ? requestedId
      : null;
  });
  const [expandedItemsId, setExpandedItemsId] = useState<number | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [projectFilter, setProjectFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const debouncedSearchTerm = useDebouncedValue(searchTerm);
  const { data: projects } = trpc.projects.list.useQuery();
  const projectOptions = useMemo(
    () =>
      [...(projects ?? [])].sort(
        (left: any, right: any) =>
          String(left.code ?? "").localeCompare(
            String(right.code ?? ""),
            "es-HN",
            { numeric: true, sensitivity: "base" }
          ) ||
          String(left.name ?? "").localeCompare(
            String(right.name ?? ""),
            "es-HN",
            { sensitivity: "base" }
          )
      ),
    [projects]
  );
  const [isExportingInternalReport, setIsExportingInternalReport] =
    useState(false);
  const [accountingComment, setAccountingComment] = useState("");
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectionComment, setRejectionComment] = useState("");
  const [correctionDialogOpen, setCorrectionDialogOpen] = useState(false);
  const [correctionReason, setCorrectionReason] = useState("");
  const [qualityReleaseDialogOpen, setQualityReleaseDialogOpen] =
    useState(false);
  const [qualityReleaseAmount, setQualityReleaseAmount] = useState("");
  const [qualityReleaseJustification, setQualityReleaseJustification] =
    useState("");
  const [invoiceDraft, setInvoiceDraft] = useState<InvoiceDraft>({
    isFiscalDocument: true,
    cai: "",
    invoiceNumber: "",
    documentRangeStart: "",
    documentRangeEnd: "",
    documentDate: "",
    documentDueDate: "",
    postingDate: "",
    receiptDate: "",
    emissionDeadline: "",
    retentionReceiptNumber: "",
    retentionCai: "",
    retentionDocumentRangeStart: "",
    retentionDocumentRangeEnd: "",
    retentionEmissionDeadline: "",
    retentionDocumentDate: "",
    hasOceExemption: false,
    oceNumber: "",
    oceResolutionNumber: "",
    oceResolutionDate: "",
    oceExemptAmount: "",
    oceExemptAmount15: "",
    oceExemptAmount18: "",
    dmcForeignSection: "",
    dmcForeignIdentification: "",
    dmcFyducaNumber: "",
    dmcDuaNumber: "",
    dmcImportOutsideCentralAmerica: false,
    notes: "",
  });
  useEffect(() => {
    const query = location.includes("?") ? location.split("?")[1] : "";
    const requestedId = Number(new URLSearchParams(query).get("editar"));
    if (Number.isInteger(requestedId) && requestedId > 0) {
      setSelectedId(requestedId);
    }
  }, [location]);
  const oceExemptAmountTouchedRef = useRef(false);
  const fiscalRangeAutofillRef = useRef<FiscalRangeAutofill | null>(null);
  const lastFiscalRangeLookupKeyRef = useRef("");
  const retentionFiscalRangeAutofillRef =
    useRef<RetentionFiscalRangeAutofill | null>(null);
  const lastRetentionFiscalRangeLookupKeyRef = useRef("");
  const retentionDraftInvoiceIdRef = useRef<number | null>(null);
  const retentionDraftsDirtyRef = useRef(false);
  const [retentionDrafts, setRetentionDrafts] = useState<RetentionDraft[]>([]);
  const [retentionsDirty, setRetentionsDirty] = useState(false);
  const [documentAdjustmentDraft, setDocumentAdjustmentDraft] =
    useState<DocumentAdjustmentDraft>({
      qualityRetentionPercent: "",
      qualityRetentionAmount: "",
      qualityRetentionInputMode: "percentage",
      advanceAmortizationPercent: "",
      advanceAmortizationAmount: "",
      advanceAmortizationInputMode: "percentage",
      promptPaymentPercent: "",
      promptPaymentAmount: "",
      promptPaymentInputMode: "percentage",
      tcEnabled: false,
    });
  const [actionFeedback, setActionFeedback] = useState<InvoiceActionFeedback>({
    invoiceSavedId: null,
    retentionsSavedId: null,
    documentAdjustmentsSavedId: null,
    reviewSentId: null,
  });
  const [attachmentState, setAttachmentState] = useState({
    count: 0,
    isLoading: false,
  });
  const clearInvoiceSavedFeedback = useCallback(() => {
    setActionFeedback(current =>
      current.invoiceSavedId === null
        ? current
        : { ...current, invoiceSavedId: null }
    );
  }, []);
  const clearRetentionsSavedFeedback = useCallback(() => {
    setActionFeedback(current =>
      current.retentionsSavedId === null
        ? current
        : { ...current, retentionsSavedId: null }
    );
  }, []);
  const clearDocumentAdjustmentsSavedFeedback = useCallback(() => {
    setActionFeedback(current =>
      current.documentAdjustmentsSavedId === null
        ? current
        : { ...current, documentAdjustmentsSavedId: null }
    );
  }, []);
  const updateInvoiceDraft = useCallback(
    (updater: SetStateAction<InvoiceDraft>) => {
      clearInvoiceSavedFeedback();
      setInvoiceDraft(updater);
    },
    [clearInvoiceSavedFeedback]
  );
  const updateRetentionDrafts = useCallback(
    (updater: SetStateAction<RetentionDraft[]>) => {
      clearRetentionsSavedFeedback();
      retentionDraftsDirtyRef.current = true;
      setRetentionsDirty(true);
      setRetentionDrafts(updater);
    },
    [clearRetentionsSavedFeedback]
  );
  const updateDocumentAdjustmentDraft = useCallback(
    (updater: SetStateAction<DocumentAdjustmentDraft>) => {
      clearDocumentAdjustmentsSavedFeedback();
      setDocumentAdjustmentDraft(updater);
    },
    [clearDocumentAdjustmentsSavedFeedback]
  );
  const listFilters = useMemo(
    () => ({
      projectId: projectFilter === "all" ? undefined : Number(projectFilter),
      status:
        statusFilter === "all"
          ? undefined
          : (statusFilter as
              | "borrador"
              | "revisada"
              | "rechazada"
              | "registrada"
              | "anulada"),
      search: debouncedSearchTerm.trim() || undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      page,
      pageSize: PAGE_SIZE,
    }),
    [dateFrom, dateTo, debouncedSearchTerm, page, projectFilter, statusFilter]
  );

  const {
    data: invoicesPage,
    isLoading,
    isPlaceholderData,
  } = trpc.invoices.listPage.useQuery(listFilters, {
    placeholderData: previousData => previousData,
  });
  const invoices = invoicesPage?.items ?? [];
  const { data: detail, isLoading: detailLoading } =
    trpc.invoices.getById.useQuery(
      { id: selectedId ?? 0 },
      { enabled: selectedId !== null }
    );
  const { data: qualityReleaseOverview } =
    trpc.qualityRetentionReleases.byInvoice.useQuery(
      { invoiceId: selectedId ?? 0 },
      {
        enabled: selectedId !== null && detail?.invoice.status === "registrada",
      }
    );
  const retentionPolicy =
    detail?.retentionPolicy ??
    (detail?.supplier?.allowsTaxWithholding !== false ? "manual" : "none");
  const shouldShowRetentionFiscalData = retentionPolicy !== "none";
  const {
    data: expandedItemsDetail,
    isLoading: isLoadingExpandedItems,
    error: expandedItemsError,
  } = trpc.invoices.getById.useQuery(
    { id: expandedItemsId ?? 0 },
    { enabled: expandedItemsId !== null }
  );
  const selectedInvoiceCurrency: PurchaseCurrency =
    detail?.invoice.currency ?? "HNL";
  const formatSelectedInvoiceCurrency = (
    value: string | number | null | undefined
  ) => formatPurchaseOrderCurrency(value, selectedInvoiceCurrency);
  const { data: activeRetentionOptions } =
    trpc.retentions.activeOptions.useQuery(undefined, {
      enabled: selectedId !== null,
    });
  const canLookupFiscalRange =
    selectedId !== null &&
    canEditInvoices &&
    (detail?.invoice.status === "borrador" ||
      detail?.invoice.status === "rechazada");
  const updateMutation = trpc.invoices.update.useMutation({
    onSuccess: (_data, variables) => {
      toast.success("Factura actualizada");
      setActionFeedback(current => ({
        ...current,
        invoiceSavedId: variables.id,
      }));
      void utils.invoices.invalidate();
      void utils.invoices.getById.invalidate({ id: variables.id });
    },
    onError: error => toast.error(getFriendlyMutationError(error.message)),
  });
  const fiscalRangeLookupMutation =
    trpc.invoices.lookupFiscalDocumentRange.useMutation({
      onSuccess: (range, variables) => {
        const lookupInvoiceNumber = formatInvoiceNumberInput(
          variables.invoiceNumber
        );
        const previousAutofill = fiscalRangeAutofillRef.current;

        updateInvoiceDraft(current => {
          if (
            !current.isFiscalDocument ||
            formatInvoiceNumberInput(current.invoiceNumber) !==
              lookupInvoiceNumber
          ) {
            return current;
          }

          if (!range) {
            if (!previousAutofill) return current;
            const next = { ...current };
            let changed = false;
            (
              [
                "cai",
                "documentRangeStart",
                "documentRangeEnd",
                "emissionDeadline",
              ] as const
            ).forEach(field => {
              if (next[field] === previousAutofill[field]) {
                next[field] = "";
                changed = true;
              }
            });
            fiscalRangeAutofillRef.current = null;
            return changed ? next : current;
          }

          const nextAutofill: FiscalRangeAutofill = {
            invoiceNumber: lookupInvoiceNumber,
            cai: range.cai ?? "",
            documentRangeStart: range.documentRangeStart ?? "",
            documentRangeEnd: range.documentRangeEnd ?? "",
            emissionDeadline: dateInputValue(range.emissionDeadline),
          };
          const next = { ...current };
          let changed = false;
          (
            [
              "cai",
              "documentRangeStart",
              "documentRangeEnd",
              "emissionDeadline",
            ] as const
          ).forEach(field => {
            const canApply =
              !next[field].trim() ||
              Boolean(
                previousAutofill && next[field] === previousAutofill[field]
              );
            if (canApply && next[field] !== nextAutofill[field]) {
              next[field] = nextAutofill[field];
              changed = true;
            }
          });
          fiscalRangeAutofillRef.current = nextAutofill;
          return changed ? next : current;
        });
      },
      onError: () => {
        fiscalRangeAutofillRef.current = null;
      },
    });
  const retentionFiscalRangeLookupMutation =
    trpc.invoices.lookupRetentionFiscalDocumentRange.useMutation({
      onSuccess: (range, variables) => {
        const lookupReceiptNumber = formatInvoiceNumberInput(
          variables.retentionReceiptNumber
        );
        const previousAutofill = retentionFiscalRangeAutofillRef.current;

        updateInvoiceDraft(current => {
          if (
            !shouldShowRetentionFiscalData ||
            formatInvoiceNumberInput(current.retentionReceiptNumber) !==
              lookupReceiptNumber
          ) {
            return current;
          }

          if (!range) {
            if (!previousAutofill) return current;
            const next = { ...current };
            let changed = false;
            (
              [
                "retentionCai",
                "retentionDocumentRangeStart",
                "retentionDocumentRangeEnd",
                "retentionEmissionDeadline",
              ] as const
            ).forEach(field => {
              if (next[field] === previousAutofill[field]) {
                next[field] = "";
                changed = true;
              }
            });
            retentionFiscalRangeAutofillRef.current = null;
            return changed ? next : current;
          }

          const nextAutofill: RetentionFiscalRangeAutofill = {
            retentionReceiptNumber: lookupReceiptNumber,
            retentionCai: range.cai ?? "",
            retentionDocumentRangeStart: range.documentRangeStart ?? "",
            retentionDocumentRangeEnd: range.documentRangeEnd ?? "",
            retentionEmissionDeadline: dateInputValue(range.emissionDeadline),
          };
          const next = { ...current };
          let changed = false;
          (
            [
              "retentionCai",
              "retentionDocumentRangeStart",
              "retentionDocumentRangeEnd",
              "retentionEmissionDeadline",
            ] as const
          ).forEach(field => {
            const canApply =
              !next[field].trim() ||
              Boolean(
                previousAutofill && next[field] === previousAutofill[field]
              );
            if (canApply && next[field] !== nextAutofill[field]) {
              next[field] = nextAutofill[field];
              changed = true;
            }
          });
          retentionFiscalRangeAutofillRef.current = nextAutofill;
          return changed ? next : current;
        });
      },
      onError: () => {
        retentionFiscalRangeAutofillRef.current = null;
      },
    });
  const replaceRetentionsMutation = trpc.invoices.replaceRetentions.useMutation(
    {
      onSuccess: (_data, variables) => {
        toast.success("Retenciones actualizadas");
        retentionDraftsDirtyRef.current = false;
        setRetentionsDirty(false);
        setActionFeedback(current => ({
          ...current,
          retentionsSavedId: variables.id,
        }));
        void utils.invoices.invalidate();
        void utils.invoices.getById.invalidate({ id: variables.id });
      },
      onError: error => toast.error(getFriendlyMutationError(error.message)),
    }
  );
  const replaceDocumentAdjustmentsMutation =
    trpc.invoices.replaceDocumentAdjustments.useMutation({
      onSuccess: (_data, variables) => {
        toast.success("Retenciones y descuentos actualizados");
        setActionFeedback(current => ({
          ...current,
          documentAdjustmentsSavedId: variables.id,
        }));
        void utils.invoices.invalidate();
        void utils.invoices.getById.invalidate({ id: variables.id });
      },
      onError: error => toast.error(getFriendlyMutationError(error.message)),
    });
  const requestQualityReleaseMutation =
    trpc.qualityRetentionReleases.request.useMutation({
      onSuccess: () => {
        toast.success("Solicitud de liberación enviada");
        setQualityReleaseDialogOpen(false);
        setQualityReleaseAmount("");
        setQualityReleaseJustification("");
        if (selectedId) {
          void utils.qualityRetentionReleases.byInvoice.invalidate({
            invoiceId: selectedId,
          });
        }
        void utils.qualityRetentionReleases.list.invalidate();
      },
      onError: error => toast.error(getFriendlyMutationError(error.message)),
    });
  const reviewMutation = trpc.invoices.review.useMutation({
    onSuccess: (_data, variables) => {
      toast.success("Factura enviada a revisión");
      setActionFeedback(current => ({
        ...current,
        reviewSentId: variables.id,
      }));
      void utils.invoices.invalidate();
      void utils.invoices.getById.invalidate({ id: variables.id });
    },
    onError: error => toast.error(getFriendlyMutationError(error.message)),
  });
  const accountMutation = trpc.invoices.account.useMutation({
    onSuccess: () => {
      toast.success("Factura contabilizada");
      setAccountingComment("");
      void utils.invoices.invalidate();
      if (selectedId)
        void utils.invoices.getById.invalidate({ id: selectedId });
      setSelectedId(null);
    },
    onError: error => toast.error(getFriendlyMutationError(error.message)),
  });
  const rejectMutation = trpc.invoices.reject.useMutation({
    onSuccess: () => {
      toast.success("Factura rechazada");
      setRejectDialogOpen(false);
      setRejectionComment("");
      void utils.invoices.invalidate();
      if (selectedId)
        void utils.invoices.getById.invalidate({ id: selectedId });
      setSelectedId(null);
    },
    onError: error => toast.error(getFriendlyMutationError(error.message)),
  });
  const correctReceiptMutation = trpc.invoices.correctReceipt.useMutation({
    onSuccess: result => {
      const replacementReceipt = (result as any).replacementReceipt;
      toast.success(
        replacementReceipt?.receiptNumber
          ? `Recepción anulada. Borrador ${replacementReceipt.receiptNumber} listo para corregir.`
          : "Recepción anulada y borrador creado para corregir."
      );
      setCorrectionDialogOpen(false);
      setCorrectionReason("");
      void Promise.all([
        utils.invoices.invalidate(),
        utils.receipts.invalidate(),
        utils.purchaseOrders.invalidate(),
        utils.materialRequests.invalidate(),
        selectedId
          ? utils.invoices.getById.invalidate({ id: selectedId })
          : Promise.resolve(),
      ]);
      setSelectedId(null);
      if (replacementReceipt?.id) {
        setLocation(`/recepciones?editar=${replacementReceipt.id}`);
      }
    },
    onError: error => toast.error(getFriendlyMutationError(error.message)),
  });
  useEffect(() => {
    if (selectedId !== null) return;
    retentionDraftInvoiceIdRef.current = null;
    retentionDraftsDirtyRef.current = false;
    setRetentionsDirty(false);
    setCorrectionDialogOpen(false);
    setCorrectionReason("");
    setActionFeedback({
      invoiceSavedId: null,
      retentionsSavedId: null,
      documentAdjustmentsSavedId: null,
      reviewSentId: null,
    });
  }, [selectedId]);
  useEffect(() => {
    if (!detail?.invoice) return;
    oceExemptAmountTouchedRef.current = false;
    fiscalRangeAutofillRef.current = null;
    lastFiscalRangeLookupKeyRef.current = "";
    retentionFiscalRangeAutofillRef.current = null;
    lastRetentionFiscalRangeLookupKeyRef.current = "";
    setInvoiceDraft({
      isFiscalDocument: detail.invoice.isFiscalDocument ?? true,
      cai: detail.invoice.cai ?? "",
      invoiceNumber: detail.invoice.invoiceNumber ?? "",
      documentRangeStart: detail.invoice.documentRangeStart ?? "",
      documentRangeEnd: detail.invoice.documentRangeEnd ?? "",
      documentDate: dateInputValue(detail.invoice.documentDate),
      documentDueDate: dateInputValue(detail.invoice.documentDueDate),
      postingDate: dateInputValue(detail.invoice.postingDate),
      receiptDate: dateInputValue(detail.invoice.receiptDate),
      emissionDeadline: dateInputValue(detail.invoice.emissionDeadline),
      retentionReceiptNumber: detail.invoice.retentionReceiptNumber ?? "",
      retentionCai: detail.invoice.retentionCai ?? "",
      retentionDocumentRangeStart:
        detail.invoice.retentionDocumentRangeStart ?? "",
      retentionDocumentRangeEnd: detail.invoice.retentionDocumentRangeEnd ?? "",
      retentionEmissionDeadline: dateInputValue(
        detail.invoice.retentionEmissionDeadline
      ),
      retentionDocumentDate: dateInputValue(
        detail.invoice.retentionDocumentDate ??
          detail.invoice.documentDate ??
          detail.invoice.postingDate ??
          detail.invoice.receiptDate
      ),
      hasOceExemption: detail.invoice.hasOceExemption === true,
      oceNumber: detail.invoice.oceNumber ?? "",
      oceResolutionNumber: detail.invoice.oceResolutionNumber ?? "",
      oceResolutionDate: dateInputValue(detail.invoice.oceResolutionDate),
      oceExemptAmount: formatMoneyInput(detail.invoice.oceExemptAmount),
      oceExemptAmount15: formatMoneyInput(detail.invoice.oceExemptAmount15),
      oceExemptAmount18: formatMoneyInput(detail.invoice.oceExemptAmount18),
      dmcForeignSection: detail.invoice.dmcForeignSection ?? "",
      dmcForeignIdentification: detail.invoice.dmcForeignIdentification ?? "",
      dmcFyducaNumber: detail.invoice.dmcFyducaNumber ?? "",
      dmcDuaNumber: detail.invoice.dmcDuaNumber ?? "",
      dmcImportOutsideCentralAmerica:
        detail.invoice.dmcImportOutsideCentralAmerica === true,
      notes: detail.invoice.notes ?? "",
    });
    const storedRetentionDrafts = (detail.retentions ?? []).map(
      (retention: any) => ({
        invoiceItemId: retention.invoiceItemId ?? null,
        itemName:
          detail.items?.find((item: any) => item.id === retention.invoiceItemId)
            ?.itemName ?? null,
        retentionCatalogId: retention.retentionCatalogId
          ? String(retention.retentionCatalogId)
          : "none",
        retentionCode: retention.retentionCode ?? null,
        retentionErpCode: retention.retentionErpCode ?? null,
        description: retention.description ?? "",
        baseAmount: String(retention.baseAmount ?? "0.00"),
        percentage: String(retention.percentage ?? ""),
        amount: String(retention.amount ?? "0.00"),
      })
    );
    const detailInvoiceId = Number(detail.invoice.id);
    const isDifferentInvoice =
      retentionDraftInvoiceIdRef.current !== detailInvoiceId;
    retentionDraftInvoiceIdRef.current = detailInvoiceId;
    if (isDifferentInvoice || !retentionDraftsDirtyRef.current) {
      retentionDraftsDirtyRef.current = false;
      setRetentionsDirty(false);
      setRetentionDrafts(storedRetentionDrafts);
    }
    const adjustments = detail.documentAdjustments ?? [];
    const qualityRetention = getInvoiceDocumentAdjustment(
      adjustments,
      "quality_retention"
    );
    const advanceAmortization = getInvoiceDocumentAdjustment(
      adjustments,
      "advance_amortization"
    );
    const promptPayment = getInvoiceDocumentAdjustment(
      adjustments,
      "prompt_payment_discount"
    );
    const qualityRetentionInputMode =
      qualityRetention?.inputMode === "amount" ? "amount" : "percentage";
    const advanceAmortizationInputMode =
      advanceAmortization?.inputMode === "amount" ? "amount" : "percentage";
    const promptPaymentInputMode =
      promptPayment?.inputMode === "amount" ? "amount" : "percentage";
    setDocumentAdjustmentDraft({
      qualityRetentionPercent: formatDocumentAdjustmentPercent(
        qualityRetention?.percentage
      ),
      qualityRetentionAmount: formatDocumentAdjustmentAmount(
        qualityRetention?.amount
      ),
      qualityRetentionInputMode,
      advanceAmortizationPercent: formatDocumentAdjustmentPercent(
        advanceAmortization?.percentage
      ),
      advanceAmortizationAmount: formatDocumentAdjustmentAmount(
        advanceAmortization?.amount
      ),
      advanceAmortizationInputMode,
      promptPaymentPercent: formatDocumentAdjustmentPercent(
        promptPayment?.percentage
      ),
      promptPaymentAmount: formatDocumentAdjustmentAmount(
        promptPayment?.amount
      ),
      promptPaymentInputMode,
      tcEnabled: Boolean(
        getInvoiceDocumentAdjustment(adjustments, "tc_discount")
      ),
    });
  }, [detail]);

  useEffect(() => {
    if (!detail?.invoice) return;
    setAccountingComment("");
    setRejectionComment("");
    setRejectDialogOpen(false);
    setCorrectionReason("");
    setCorrectionDialogOpen(false);
    setActionFeedback({
      invoiceSavedId: null,
      retentionsSavedId: null,
      documentAdjustmentsSavedId: null,
      reviewSentId: null,
    });
  }, [detail?.invoice?.id]);

  useEffect(() => {
    if (
      !selectedId ||
      !canLookupFiscalRange ||
      !invoiceDraft.isFiscalDocument ||
      !isValidInvoiceNumber(invoiceDraft.invoiceNumber)
    ) {
      const previousAutofill = fiscalRangeAutofillRef.current;
      if (previousAutofill) {
        updateInvoiceDraft(current => {
          const next = { ...current };
          let changed = false;
          (
            [
              "cai",
              "documentRangeStart",
              "documentRangeEnd",
              "emissionDeadline",
            ] as const
          ).forEach(field => {
            if (next[field] === previousAutofill[field]) {
              next[field] = "";
              changed = true;
            }
          });
          return changed ? next : current;
        });
        fiscalRangeAutofillRef.current = null;
      }
      lastFiscalRangeLookupKeyRef.current = "";
      return;
    }

    const lookupInvoiceNumber = formatInvoiceNumberInput(
      invoiceDraft.invoiceNumber
    );
    const lookupKey = `${selectedId}:${lookupInvoiceNumber}`;
    if (lastFiscalRangeLookupKeyRef.current === lookupKey) return;

    lastFiscalRangeLookupKeyRef.current = lookupKey;
    fiscalRangeLookupMutation.mutate({
      id: selectedId,
      invoiceNumber: lookupInvoiceNumber,
    });
  }, [
    canLookupFiscalRange,
    fiscalRangeLookupMutation,
    invoiceDraft.invoiceNumber,
    invoiceDraft.isFiscalDocument,
    selectedId,
    updateInvoiceDraft,
  ]);

  useEffect(() => {
    if (
      !selectedId ||
      !canLookupFiscalRange ||
      !shouldShowRetentionFiscalData ||
      !isValidInvoiceNumber(invoiceDraft.retentionReceiptNumber)
    ) {
      const previousAutofill = retentionFiscalRangeAutofillRef.current;
      if (previousAutofill) {
        updateInvoiceDraft(current => {
          const next = { ...current };
          let changed = false;
          (
            [
              "retentionCai",
              "retentionDocumentRangeStart",
              "retentionDocumentRangeEnd",
              "retentionEmissionDeadline",
            ] as const
          ).forEach(field => {
            if (next[field] === previousAutofill[field]) {
              next[field] = "";
              changed = true;
            }
          });
          return changed ? next : current;
        });
        retentionFiscalRangeAutofillRef.current = null;
      }
      lastRetentionFiscalRangeLookupKeyRef.current = "";
      return;
    }

    const lookupReceiptNumber = formatInvoiceNumberInput(
      invoiceDraft.retentionReceiptNumber
    );
    const lookupKey = `${selectedId}:${lookupReceiptNumber}`;
    if (lastRetentionFiscalRangeLookupKeyRef.current === lookupKey) return;

    lastRetentionFiscalRangeLookupKeyRef.current = lookupKey;
    retentionFiscalRangeLookupMutation.mutate({
      id: selectedId,
      retentionReceiptNumber: lookupReceiptNumber,
    });
  }, [
    canLookupFiscalRange,
    invoiceDraft.retentionReceiptNumber,
    retentionFiscalRangeLookupMutation,
    selectedId,
    shouldShowRetentionFiscalData,
    updateInvoiceDraft,
  ]);

  const filteredInvoices = invoices;

  useEffect(
    () => setPage(1),
    [dateFrom, dateTo, debouncedSearchTerm, projectFilter, statusFilter]
  );
  useEffect(() => {
    if (
      !isPlaceholderData &&
      invoicesPage?.page &&
      invoicesPage.page !== page
    ) {
      setPage(invoicesPage.page);
    }
  }, [invoicesPage?.page, isPlaceholderData, page]);

  const retentionOptions = useMemo(() => {
    const optionMap = new Map<number, RetentionOption>();
    ((activeRetentionOptions ?? []) as RetentionOption[]).forEach(option => {
      optionMap.set(option.id, option);
    });

    retentionDrafts.forEach(draft => {
      if (draft.retentionCatalogId === "none") return;
      const id = Number(draft.retentionCatalogId);
      if (!Number.isFinite(id) || optionMap.has(id)) return;
      optionMap.set(id, {
        id,
        taxCode: draft.retentionCode || `RET-${id}`,
        description: draft.description || "Retención guardada",
        ratePercent: draft.percentage || "0",
        isActive: false,
        erpCode: draft.retentionErpCode ?? null,
      });
    });

    return Array.from(optionMap.values()).sort((a, b) =>
      a.taxCode.localeCompare(b.taxCode)
    );
  }, [activeRetentionOptions, retentionDrafts]);

  const retentionTotal = retentionDrafts.reduce(
    (sum, retention) => sum + getRetentionAmount(retention),
    0
  );
  const invoiceOtherChargesTotal = (detail?.otherCharges ?? []).reduce(
    (sum: number, charge: any) => sum + toNumber(charge.amount),
    0
  );
  const invoiceTotal = toNumber(detail?.invoice.total);
  const documentBaseIsvAmount = getInvoiceBaseIsvAmount(detail?.items ?? []);
  const documentAdjustmentPreview = calculateInvoiceDocumentAdjustments({
    subtotal: detail?.invoice.subtotal,
    baseIsvAmount: documentBaseIsvAmount,
    input: {
      qualityRetentionPercent:
        documentAdjustmentDraft.qualityRetentionInputMode === "percentage"
          ? documentAdjustmentDraft.qualityRetentionPercent
          : undefined,
      qualityRetentionAmount:
        documentAdjustmentDraft.qualityRetentionInputMode === "amount"
          ? documentAdjustmentDraft.qualityRetentionAmount
          : undefined,
      advanceAmortizationPercent:
        documentAdjustmentDraft.advanceAmortizationInputMode === "percentage"
          ? documentAdjustmentDraft.advanceAmortizationPercent
          : undefined,
      advanceAmortizationAmount:
        documentAdjustmentDraft.advanceAmortizationInputMode === "amount"
          ? documentAdjustmentDraft.advanceAmortizationAmount
          : undefined,
      promptPaymentPercent:
        documentAdjustmentDraft.promptPaymentInputMode === "percentage"
          ? documentAdjustmentDraft.promptPaymentPercent
          : undefined,
      promptPaymentAmount:
        documentAdjustmentDraft.promptPaymentInputMode === "amount"
          ? documentAdjustmentDraft.promptPaymentAmount
          : undefined,
      tcEnabled: documentAdjustmentDraft.tcEnabled,
    },
  });
  const qualityRetentionAdjustment = getInvoiceDocumentAdjustment(
    documentAdjustmentPreview.calculations,
    "quality_retention"
  );
  const advanceAmortizationAdjustment = getInvoiceDocumentAdjustment(
    documentAdjustmentPreview.calculations,
    "advance_amortization"
  );
  const promptPaymentAdjustment = getInvoiceDocumentAdjustment(
    documentAdjustmentPreview.calculations,
    "prompt_payment_discount"
  );
  const tcDiscountAdjustment = getInvoiceDocumentAdjustment(
    documentAdjustmentPreview.calculations,
    "tc_discount"
  );
  const otherRetentionTotal = documentAdjustmentPreview.otherRetentionTotal;
  const documentDiscountTotal = documentAdjustmentPreview.documentDiscountTotal;
  const storedDocumentAdjustments = detail?.documentAdjustments ?? [];
  const hasDocumentAdjustmentChanged = (
    adjustmentType: Parameters<typeof getInvoiceDocumentAdjustment>[1]
  ) => {
    const previewAdjustment = getInvoiceDocumentAdjustment(
      documentAdjustmentPreview.calculations,
      adjustmentType
    );
    const storedAdjustment = getInvoiceDocumentAdjustment(
      storedDocumentAdjustments,
      adjustmentType
    );
    if (!previewAdjustment || !storedAdjustment) {
      return Boolean(previewAdjustment) !== Boolean(storedAdjustment);
    }
    const storedInputMode =
      storedAdjustment.inputMode === "amount" ? "amount" : "percentage";
    return (
      previewAdjustment.inputMode !== storedInputMode ||
      Math.abs(
        Number(previewAdjustment.percentage) -
          Number(storedAdjustment.percentage ?? 0)
      ) > 0.00000001 ||
      Math.abs(
        Number(previewAdjustment.amount) - Number(storedAdjustment.amount ?? 0)
      ) > 0.00001
    );
  };
  const documentAdjustmentsDirty =
    Boolean(detail?.invoice) &&
    (hasDocumentAdjustmentChanged("quality_retention") ||
      hasDocumentAdjustmentChanged("advance_amortization") ||
      hasDocumentAdjustmentChanged("prompt_payment_discount") ||
      hasDocumentAdjustmentChanged("tc_discount"));
  const withholdingBase = (detail?.items ?? [])
    .filter((item: any) => item.allowsTaxWithholding !== false)
    .reduce((sum: number, item: any) => sum + toNumber(item.subtotal), 0);
  const accountPaymentCertificate = detail?.accountPaymentCertificate ?? null;
  const hasValidAccountPaymentCertificate =
    accountPaymentCertificate?.status === "vigente";
  const isMissingCpcRetentionRequired = requiresMissingCpcRetention({
    isFiscalDocument: detail?.invoice.isFiscalDocument,
    certificateStatus: accountPaymentCertificate?.status,
    retentionPolicy,
    withholdingBase,
  });
  const hasRequiredMissingCpcRetention = retentionDrafts.some(retention =>
    isMissingCpcRequiredRetention({
      taxCode: retention.retentionCode,
      ratePercent: retention.percentage,
    })
  );
  const isMissingRequiredCpcRetention =
    isMissingCpcRetentionRequired && !hasRequiredMissingCpcRetention;
  const supplierAllowsTaxWithholding = retentionPolicy === "manual";
  const supplierSubjectToAccountPayments =
    hasValidAccountPaymentCertificate ||
    detail?.supplier?.subjectToAccountPayments !== false;
  const hasAvailableRt15Retention = retentionOptions.some(option =>
    isAccountPaymentAllowedRetention(option)
  );
  const hasAvailableRequiredCpcRetention = retentionOptions.some(option =>
    isMissingCpcRequiredRetention(option)
  );
  const canRetainSelectedInvoice =
    (retentionPolicy === "rt15_only"
      ? hasAvailableRt15Retention
      : isMissingCpcRetentionRequired
        ? hasAvailableRequiredCpcRetention
        : supplierAllowsTaxWithholding) && withholdingBase > 0;
  const retentionDisabledReason =
    retentionPolicy === "rt15_only" && !hasAvailableRt15Retention
      ? "La retención RT15 (15%) no está disponible en el catálogo."
      : isMissingCpcRetentionRequired && !hasAvailableRequiredCpcRetention
        ? "La retención RT01 (1%) no está disponible en el catálogo."
        : retentionPolicy !== "rt15_only" && !supplierAllowsTaxWithholding
          ? "El proveedor no permite retención de impuestos."
          : withholdingBase <= 0
            ? "La factura no tiene líneas habilitadas para retención."
            : "";
  const incompatibleAccountPaymentRetentions = hasValidAccountPaymentCertificate
    ? retentionDrafts.filter(
        retention =>
          !isAccountPaymentAllowedRetention({
            taxCode: retention.retentionCode,
            ratePercent: retention.percentage,
          })
      )
    : [];
  const accountPaymentCertificateLabel = !accountPaymentCertificate
    ? "Sin constancia para la emisión"
    : accountPaymentCertificate.status === "vigente"
      ? `Vigente a la emisión · vence ${formatDateLabel(accountPaymentCertificate.expirationDate)}`
      : accountPaymentCertificate.status === "futuro"
        ? `Aún no vigente · inicia ${formatDateLabel(accountPaymentCertificate.documentDate)}`
        : accountPaymentCertificate.status === "vencido"
          ? `Vencida al emitir · venció ${formatDateLabel(accountPaymentCertificate.expirationDate)}`
          : "Sin vencimiento válido";
  const netPayable = Math.max(invoiceTotal - retentionTotal, 0);
  const adjustedNetPayable = Math.max(
    0,
    calculateInvoiceNetPayable({
      total: invoiceTotal,
      fiscalRetentionTotal: retentionTotal,
      otherRetentionTotal,
      documentDiscountTotal,
    })
  );
  const appliedAdvanceAmount = Math.max(
    0,
    Number(detail?.appliedAdvanceAmount ?? 0)
  );
  const registeredSupplierAdvanceAmount = Math.max(
    0,
    Number(detail?.purchaseOrderAdvanceSummary?.requestedAmount ?? 0)
  );
  const hasRegisteredSupplierAdvance =
    Number(detail?.purchaseOrderAdvanceSummary?.count ?? 0) > 0;
  const invoiceAdvanceBalance = buildInvoiceAdvanceBalance({
    invoiceStatus: detail?.invoice.status ?? "borrador",
    netPayable: adjustedNetPayable,
    appliedAdvanceAmount,
    availableAccountedAdvanceAmount:
      detail?.purchaseOrderAdvanceSummary?.unappliedAmount,
  });
  const displayedAppliedAdvanceAmount =
    invoiceAdvanceBalance.displayedAppliedAmount;
  const balanceAfterAdvance = invoiceAdvanceBalance.balanceAfterAdvance;
  const isPendingAdvanceApplication =
    invoiceAdvanceBalance.isPendingApplication;
  const treasuryPayments = detail?.treasuryPayments ?? [];
  const treasuryPaidAmount = roundTreasuryMoney(
    treasuryPayments.reduce(
      (sum, payment) => sum + Number(payment.amount ?? 0),
      0
    )
  );
  const treasuryPaymentStatus = getTreasuryPaymentStatus(
    adjustedNetPayable,
    treasuryPaidAmount + appliedAdvanceAmount
  );
  const treasuryPaymentStatusLabel =
    treasuryPaymentStatus === "pagada"
      ? "Pagada"
      : treasuryPaymentStatus === "parcialmente_pagada"
        ? "Parcialmente pagada"
        : "Pendiente de pagar";
  const treasuryPaymentStatusClass =
    treasuryPaymentStatus === "pagada"
      ? "border-emerald-300 bg-emerald-50 text-emerald-700"
      : treasuryPaymentStatus === "parcialmente_pagada"
        ? "border-amber-300 bg-amber-50 text-amber-700"
        : "border-slate-300 bg-slate-50 text-slate-700";
  const balanceAfterTreasuryPayments = roundTreasuryMoney(
    Math.max(0, balanceAfterAdvance - treasuryPaidAmount)
  );
  const showTreasuryPaymentStatus =
    detail?.invoice.status === "registrada" || treasuryPayments.length > 0;
  const printInvoiceAdvanceBalance = buildInvoiceAdvanceBalance({
    invoiceStatus: detail?.invoice.status ?? "borrador",
    netPayable,
    appliedAdvanceAmount,
    availableAccountedAdvanceAmount:
      detail?.purchaseOrderAdvanceSummary?.unappliedAmount,
  });
  const handlePrintInvoiceDetail = () => {
    if (!detail?.invoice) return;

    const invoice = detail.invoice;
    const printNumber = invoice.invoiceDocumentNumber || `FT-${invoice.id}`;
    const supplierLabel = detail.supplier
      ? detail.supplier.name || "Proveedor pendiente"
      : "Proveedor pendiente";
    const projectLabel = detail.project
      ? `${detail.project.code} - ${detail.project.name}`
      : "Proyecto no identificado";
    const purchaseOrderLabel = detail.purchaseOrder?.orderNumber || "-";
    const receiptLabel = detail.receipt?.receiptNumber || "-";
    const requestedByLabel = formatInvoiceRequestedBy(detail);
    const createdByLabel = formatInvoiceCreatedBy(detail);
    const documentTypeLabel =
      invoiceDraft.isFiscalDocument !== false
        ? "Factura"
        : "Documento extranjero";
    const observations =
      invoiceDraft.notes?.trim() || invoice.notes?.trim() || "-";

    const getLineRetentionLabel = (itemId: number) => {
      const lineRetentions = retentionDrafts.filter(
        retention => retention.invoiceItemId === itemId
      );
      if (lineRetentions.length === 0) return "";
      return lineRetentions
        .map(retention =>
          [
            retention.retentionCode,
            retention.description,
            `${getPurchaseCurrencySymbol(
              selectedInvoiceCurrency
            )} ${formatInvoicePrintMoney(getRetentionAmount(retention))}`,
          ]
            .filter(Boolean)
            .join(" - ")
        )
        .join("; ");
    };

    const getTargetLabel = (item: any) => {
      if (item.targetType === "activo_fijo") {
        return ["Activo fijo:", item.fixedAssetSapItemCode, item.fixedAssetName]
          .filter(Boolean)
          .join(" ");
      }
      if (item.targetType === "subproyecto") {
        return item.subProjectId
          ? `Subproyecto #${item.subProjectId}`
          : "Subproyecto";
      }
      return "-";
    };

    const itemRows = (detail.items ?? [])
      .map((item: any) => {
        const assetBreakdownRows = getInvoiceAssetBreakdownRows(
          item,
          parseFixedAssetDetails(item.assetDetails)
        );
        const primaryAsset = assetBreakdownRows[0];
        const itemCode =
          getInvoiceAssetDisplayCode(primaryAsset ?? {}, item) ||
          item.currentSapItemCode ||
          item.originalSapItemCode ||
          "-";
        const partOrSerial =
          primaryAsset?.serialNumber ||
          primaryAsset?.plateOrCode ||
          item.currentSapItemCode ||
          item.originalSapItemCode ||
          "-";
        const lineRetentionLabel = getLineRetentionLabel(item.id);
        const lineObservationHtml = item.lineObservation?.trim()
          ? `<div class="line-note">${escapePrintHtml(item.lineObservation)}</div>`
          : "";
        const retentionHtml = lineRetentionLabel
          ? `<div class="line-note"><strong>Retención:</strong> ${escapePrintHtml(
              lineRetentionLabel
            )}</div>`
          : "";
        const assetHtml =
          item.isFixedAsset || item.isLeasing || assetBreakdownRows.length > 0
            ? `
              <div class="asset-meta">
                <strong>Activo fijo${item.isLeasing ? " / Leasing" : ""}</strong>
                ${assetBreakdownRows
                  .map((asset, index) => {
                    const summary = getAssetDetailSummary(asset);
                    const displayCode = getInvoiceAssetDisplayCode(asset, item);
                    return `<div>Unidad ${index + 1}: ${escapePrintHtml(
                      [displayCode, summary].filter(Boolean).join(" - ")
                    )}</div>`;
                  })
                  .join("")}
              </div>
            `
            : "";

        return `
          <tr>
            <td>${escapePrintHtml(itemCode)}</td>
            <td>${escapePrintHtml(item.itemName)}${lineObservationHtml}${retentionHtml}${assetHtml}</td>
            <td>${escapePrintHtml(projectLabel)}</td>
            <td>${escapePrintHtml(getTargetLabel(item))}</td>
            <td class="center">${escapePrintHtml(partOrSerial)}</td>
            <td class="numeric">${escapePrintHtml(formatInvoicePrintQuantity(item.quantity))}</td>
            <td class="center">${escapePrintHtml(item.unit || "-")}</td>
            <td class="numeric">${escapePrintHtml(formatInvoicePrintMoney(item.unitPrice))}</td>
            <td class="numeric">${escapePrintHtml(formatInvoicePrintMoney(item.subtotal))}</td>
          </tr>
        `;
      })
      .join("");

    const otherChargeRows = (detail.otherCharges ?? [])
      .map(
        (charge: any) => `
          <tr class="charge-row">
            <td>-</td>
            <td><strong>Otros cargos:</strong> ${escapePrintHtml(charge.concept)}</td>
            <td class="center">-</td>
            <td class="center">-</td>
            <td class="center">-</td>
            <td class="numeric">-</td>
            <td class="center">-</td>
            <td class="numeric">-</td>
            <td class="numeric">${escapePrintHtml(formatInvoicePrintMoney(charge.amount))}</td>
          </tr>
        `
      )
      .join("");

    const invoiceSummaryCurrency = selectedInvoiceCurrency;
    const summaryRows = [
      { label: `Sub-total ${invoiceSummaryCurrency}`, value: invoice.subtotal },
      ...(invoiceOtherChargesTotal > 0
        ? [
            {
              label: `Otros cargos ${invoiceSummaryCurrency}`,
              value: invoiceOtherChargesTotal,
            },
          ]
        : []),
      { label: `I.S.V. ${invoiceSummaryCurrency}`, value: invoice.taxAmount },
      {
        label: `Total factura ${invoiceSummaryCurrency}`,
        value: invoice.total,
      },
      {
        label: `Total retenciones ${invoiceSummaryCurrency}`,
        value: retentionTotal,
      },
      {
        label: `Neto a pagar ${invoiceSummaryCurrency}`,
        value: netPayable,
      },
      ...(hasRegisteredSupplierAdvance
        ? [
            {
              label: `Anticipo a proveedor registrado (informativo) ${invoiceSummaryCurrency}`,
              value: registeredSupplierAdvanceAmount,
            },
          ]
        : []),
      {
        label: `${
          printInvoiceAdvanceBalance.isPendingApplication
            ? "Anticipo aplicado al contabilizar"
            : "Anticipo aplicado"
        } ${invoiceSummaryCurrency}`,
        value: printInvoiceAdvanceBalance.displayedAppliedAmount,
      },
      {
        label: `Saldo pendiente ${invoiceSummaryCurrency}`,
        value: printInvoiceAdvanceBalance.balanceAfterAdvance,
        emphasized: true,
      },
    ]
      .map(
        row => `
          <tr class="${row.emphasized ? "emphasized" : ""}">
            <td>${escapePrintHtml(row.label)}</td>
            <td class="numeric">${escapePrintHtml(formatInvoicePrintMoney(row.value))}</td>
          </tr>
        `
      )
      .join("");

    const printWindow = window.open("", "_blank", "width=840,height=1000");
    if (!printWindow) {
      toast.error("No se pudo abrir la ventana de impresión");
      return;
    }

    printWindow.document.open();
    printWindow.document.write(`
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>${escapePrintHtml(printNumber)}</title>
          <style>
            @page { size: A4 portrait; margin: 7mm; }
            * { box-sizing: border-box; }
            body {
              background: #fff;
              color: #000;
              font-family: Arial, Helvetica, sans-serif;
              font-size: 9.5px;
              margin: 0;
            }
            .sheet {
              margin: 0 auto;
              max-width: 196mm;
              padding: 0 1mm 3mm;
            }
            .header {
              align-items: start;
              display: grid;
              gap: 8px;
              grid-template-columns: 82px 1fr 108px;
            }
            .logo {
              display: block;
              height: 44px;
              margin-left: 2px;
              object-fit: contain;
              width: 64px;
            }
            .title {
              color: #000;
              font-size: 11.5px;
              font-weight: 800;
              line-height: 1.25;
              text-align: center;
              text-transform: uppercase;
            }
            .company {
              color: #000;
              font-size: 13px;
              margin-bottom: 2px;
            }
            .document-number {
              border: 4px double #222;
              color: #000;
              font-size: 12px;
              font-weight: 800;
              margin-top: 1mm;
              padding: 3px 6px;
              text-align: center;
            }
            .meta {
              display: grid;
              gap: 10px;
              grid-template-columns: 1fr 1fr;
              margin-top: 6mm;
            }
            .meta-column {
              display: grid;
              gap: 3px;
            }
            .field {
              display: grid;
              gap: 4px;
              grid-template-columns: 112px 1fr;
              min-height: 12px;
            }
            .meta-column.right .field {
              grid-template-columns: 104px 1fr;
            }
            .label {
              font-weight: 800;
            }
            .value {
              font-weight: 700;
              overflow-wrap: anywhere;
            }
            table {
              border-collapse: collapse;
              margin-top: 4mm;
              table-layout: fixed;
              width: 100%;
            }
            th {
              border-bottom: 2px solid #111;
              border-top: 2px solid #111;
              font-size: 8.5px;
              font-weight: 800;
              padding: 3px 4px;
              text-align: left;
            }
            td {
              border-bottom: 1px solid #111;
              padding: 3px 4px;
              overflow-wrap: anywhere;
              vertical-align: top;
            }
            .line-note,
            .asset-meta {
              color: #000;
              font-size: 8px;
              line-height: 1.25;
              margin-top: 1px;
            }
            .charge-row td {
              font-weight: 800;
            }
            .center { text-align: center; }
            .numeric {
              font-variant-numeric: tabular-nums;
              text-align: right;
            }
            .summary {
              display: grid;
              grid-template-columns: 1fr minmax(280px, 300px);
              margin-top: 0;
            }
            .summary-table {
              border-collapse: collapse;
              grid-column: 2;
              margin-top: 0;
              table-layout: auto;
              width: 100%;
            }
            .summary-table td {
              border-bottom: 1px solid #111;
              font-weight: 800;
              padding: 3px 4px;
              white-space: nowrap;
            }
            .summary-table .emphasized td {
              font-size: 10px;
            }
            .summary-table td:first-child {
              min-width: 170px;
            }
            .signatures {
              display: grid;
              grid-template-columns: 220px;
              justify-content: center;
              margin-top: 10mm;
            }
            .signature-line {
              border-top: 2px solid #111;
              font-weight: 700;
              padding-top: 4px;
              text-align: center;
            }
            .signature-name {
              min-height: 12px;
              margin-bottom: 2px;
            }
            @media print {
              .sheet { max-width: none; padding: 0; }
            }
            ${getReadablePrintStyles()}
          </style>
        </head>
        <body>
          <main class="sheet">
            <section class="header">
              ${getPrintLogoMarkup()}
              <div class="title">
                <div class="company">HIDALGO E HIDALGO HONDURAS S.A. DE C.V.</div>
                <div>${escapePrintHtml(projectLabel)}</div>
                <div>FACTURA</div>
              </div>
              <div class="document-number">${escapePrintHtml(printNumber)}</div>
            </section>

            <section class="meta">
              <div class="meta-column">
                <div class="field">
                  <div class="label">Fecha Documento:</div>
                  <div class="value">${escapePrintHtml(formatInvoicePrintDate(invoiceDraft.documentDate || invoice.documentDate))}</div>
                </div>
                <div class="field">
                  <div class="label">Fecha Vencimiento (crédito):</div>
                  <div class="value">${escapePrintHtml(formatInvoicePrintDate(invoiceDraft.documentDueDate || invoice.documentDueDate))}</div>
                </div>
                <div class="field">
                  <div class="label">No Pedido:</div>
                  <div class="value">${escapePrintHtml(purchaseOrderLabel)}</div>
                </div>
                <div class="field">
                  <div class="label">Recepción:</div>
                  <div class="value">${escapePrintHtml(receiptLabel)}</div>
                </div>
                <div class="field">
                  <div class="label">Job:</div>
                  <div class="value">${escapePrintHtml(projectLabel)}</div>
                </div>
                <div class="field">
                  <div class="label">Solicitado por:</div>
                  <div class="value">${escapePrintHtml(requestedByLabel)}</div>
                </div>
                <div class="field">
                  <div class="label">Registrado por:</div>
                  <div class="value">${escapePrintHtml(createdByLabel)}</div>
                </div>
                <div class="field">
                  <div class="label">Fecha Ingreso:</div>
                  <div class="value">${escapePrintHtml(formatInvoicePrintDate(invoiceDraft.receiptDate || invoice.receiptDate))}</div>
                </div>
              </div>
              <div class="meta-column right">
                <div class="field">
                  <div class="label">Proveedor:</div>
                  <div class="value">${escapePrintHtml(supplierLabel)}</div>
                </div>
                <div class="field">
                  <div class="label">RTN Proveedor:</div>
                  <div class="value">${escapePrintHtml(formatSupplierRtnLabel(detail.supplier))}</div>
                </div>
                <div class="field">
                  <div class="label">Tipo Documento:</div>
                  <div class="value">${escapePrintHtml(documentTypeLabel)}</div>
                </div>
                <div class="field">
                  <div class="label">No Documento:</div>
                  <div class="value">${escapePrintHtml(invoiceDraft.invoiceNumber || invoice.invoiceNumber || "-")}</div>
                </div>
                <div class="field">
                  <div class="label">Moneda:</div>
                  <div class="value">${escapePrintHtml(
                    getPurchaseCurrencyLabel(selectedInvoiceCurrency)
                  )}</div>
                </div>
                <div class="field">
                  <div class="label">Precios:</div>
                  <div class="value">${
                    invoice.pricesIncludeTax === true
                      ? "INCLUYEN ISV"
                      : "SIN ISV"
                  }</div>
                </div>
                <div class="field">
                  <div class="label">Rango Autorizado Inicial:</div>
                  <div class="value">${escapePrintHtml(invoiceDraft.documentRangeStart || invoice.documentRangeStart || "-")}</div>
                </div>
                <div class="field">
                  <div class="label">Rango Autorizado Final:</div>
                  <div class="value">${escapePrintHtml(invoiceDraft.documentRangeEnd || invoice.documentRangeEnd || "-")}</div>
                </div>
                <div class="field">
                  <div class="label">Referencia:</div>
                  <div class="value">Compra</div>
                </div>
                <div class="field">
                  <div class="label">Observacion:</div>
                  <div class="value">${escapePrintHtml(observations)}</div>
                </div>
              </div>
            </section>

            <table>
              <thead>
                <tr>
                  <th style="width: 11%;">Código Empresa</th>
                  <th style="width: 20%;">Descripción</th>
                  <th style="width: 14%;">Bodega ingreso</th>
                  <th style="width: 15%;">Destino</th>
                  <th style="width: 13%;" class="center">No. Parte/No. Serie</th>
                  <th style="width: 7%;" class="numeric">Cantidad</th>
                  <th style="width: 7%;" class="center">U Medida</th>
                  <th style="width: 7%;" class="numeric">${
                    invoice.pricesIncludeTax === true
                      ? "Valor U c/ISV"
                      : "Valor U"
                  }</th>
                  <th style="width: 6%;" class="numeric">${
                    invoice.pricesIncludeTax === true ? "Base" : "Valor T"
                  }</th>
                </tr>
              </thead>
              <tbody>
                ${itemRows || `<tr><td colspan="9">Sin ítems</td></tr>`}
                ${otherChargeRows}
              </tbody>
            </table>

            <section class="summary">
              <table class="summary-table">
                <tbody>${summaryRows}</tbody>
              </table>
            </section>

            <section class="signatures">
              <div class="signature-line">
                <div class="signature-name">${escapePrintHtml(createdByLabel)}</div>
                <div>Elaborado</div>
              </div>
            </section>
          </main>
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindowWhenReady(printWindow);
  };

  const isRejected = detail?.invoice.status === "rechazada";
  const isDraft = detail?.invoice.status === "borrador" || isRejected;
  const isReviewed = detail?.invoice.status === "revisada";
  const isAccounted = detail?.invoice.status === "registrada";
  const isVoided = detail?.invoice.status === "anulada";
  const canEditSelectedInvoice = canEditInvoices && isDraft;
  const canEditRetentions = canEditSelectedInvoice && canRetainSelectedInvoice;
  const canEditDocumentAdjustments =
    (canEditInvoices && isDraft) || (canAccountInvoices && isReviewed);
  const canManageInvoiceAttachments = canReviewInvoices && isDraft;
  const canReviewSelectedInvoice = canReviewInvoices && isDraft;
  const canAccountSelectedInvoice = canAccountInvoices && isReviewed;
  const canCorrectSelectedReceipt =
    canEditInvoices &&
    Boolean(detail?.receipt) &&
    !isAccounted &&
    (isDraft || isReviewed);
  const canRequestQualityRelease =
    isAccounted &&
    Boolean(qualityReleaseOverview?.adjustment) &&
    (user?.role === "admin" || userRole === "administrador_proyecto") &&
    Number(qualityReleaseOverview?.summary.availableAmount ?? 0) > 0 &&
    !(qualityReleaseOverview?.releases ?? []).some(
      release => release.status === "pending_approval"
    );
  const replacementReceiptId = detail?.receipt?.replacementReceiptId ?? null;
  const invoiceSaveConfirmed =
    selectedId !== null && actionFeedback.invoiceSavedId === selectedId;
  const retentionsSaveConfirmed =
    selectedId !== null && actionFeedback.retentionsSavedId === selectedId;
  const documentAdjustmentsSaveConfirmed =
    selectedId !== null &&
    actionFeedback.documentAdjustmentsSavedId === selectedId;
  const reviewSendConfirmed =
    selectedId !== null && actionFeedback.reviewSentId === selectedId;
  const handleInvoiceAttachmentsState = useCallback(
    (state: { attachments: any[]; isLoading: boolean }) => {
      setAttachmentState(current => {
        const next = {
          count: state.attachments.length,
          isLoading: state.isLoading,
        };
        return current.count === next.count &&
          current.isLoading === next.isLoading
          ? current
          : next;
      });
    },
    []
  );

  const validateRetentionFiscalDraft = (required: boolean) => {
    const receiptNumber = invoiceDraft.retentionReceiptNumber.trim();
    const cai = invoiceDraft.retentionCai.trim();
    const rangeStart = invoiceDraft.retentionDocumentRangeStart.trim();
    const rangeEnd = invoiceDraft.retentionDocumentRangeEnd.trim();

    if (required && !receiptNumber) {
      toast.error("Ingrese el número de comprobante de retención");
      return false;
    }
    if (receiptNumber && !isValidInvoiceNumber(receiptNumber)) {
      toast.error(
        `El comprobante de retención debe tener el formato ${INVOICE_NUMBER_FORMAT_EXAMPLE}`
      );
      return false;
    }
    if (required && !cai) {
      toast.error("Ingrese el CAI del comprobante de retención");
      return false;
    }
    if (cai && !isValidCai(cai)) {
      toast.error(
        `El CAI del comprobante de retención debe tener el formato ${CAI_FORMAT_EXAMPLE}`
      );
      return false;
    }
    if (required && !rangeStart) {
      toast.error(
        "Ingrese el rango autorizado inicial del comprobante de retención"
      );
      return false;
    }
    if (rangeStart && !isValidInvoiceNumber(rangeStart)) {
      toast.error(
        `El rango inicial del comprobante de retención debe tener el formato ${INVOICE_NUMBER_FORMAT_EXAMPLE}`
      );
      return false;
    }
    if (required && !rangeEnd) {
      toast.error(
        "Ingrese el rango autorizado final del comprobante de retención"
      );
      return false;
    }
    if (rangeEnd && !isValidInvoiceNumber(rangeEnd)) {
      toast.error(
        `El rango final del comprobante de retención debe tener el formato ${INVOICE_NUMBER_FORMAT_EXAMPLE}`
      );
      return false;
    }
    if (
      rangeStart &&
      rangeEnd &&
      isValidInvoiceNumber(rangeStart) &&
      isValidInvoiceNumber(rangeEnd) &&
      !isFiscalInvoiceRangeOrdered({
        documentRangeStart: rangeStart,
        documentRangeEnd: rangeEnd,
      })
    ) {
      toast.error(
        "El rango final del comprobante de retención debe ser mayor o igual al inicial"
      );
      return false;
    }
    if (
      receiptNumber &&
      rangeStart &&
      rangeEnd &&
      isValidInvoiceNumber(receiptNumber) &&
      isValidInvoiceNumber(rangeStart) &&
      isValidInvoiceNumber(rangeEnd) &&
      !isInvoiceNumberWithinFiscalRange({
        invoiceNumber: receiptNumber,
        documentRangeStart: rangeStart,
        documentRangeEnd: rangeEnd,
      })
    ) {
      toast.error(
        "El comprobante de retención debe estar dentro del rango autorizado"
      );
      return false;
    }
    if (required && !invoiceDraft.retentionEmissionDeadline) {
      toast.error(
        "Seleccione la fecha límite de emisión del comprobante de retención"
      );
      return false;
    }
    if (required && !invoiceDraft.retentionDocumentDate) {
      toast.error("Seleccione la fecha del comprobante de retención");
      return false;
    }
    return true;
  };

  const validateInvoiceDraft = () => {
    if (invoiceDraft.isFiscalDocument && !invoiceDraft.cai.trim()) {
      toast.error("Ingresa el CAI del documento");
      return false;
    }
    if (invoiceDraft.isFiscalDocument && !isValidCai(invoiceDraft.cai)) {
      toast.error(`El CAI debe tener el formato ${CAI_FORMAT_EXAMPLE}`);
      return false;
    }
    if (invoiceDraft.isFiscalDocument && !invoiceDraft.invoiceNumber.trim()) {
      toast.error("Ingresa el número documento");
      return false;
    }
    if (
      invoiceDraft.isFiscalDocument &&
      !isValidInvoiceNumber(invoiceDraft.invoiceNumber)
    ) {
      toast.error(
        `El número documento debe tener el formato ${INVOICE_NUMBER_FORMAT_EXAMPLE}`
      );
      return false;
    }
    if (
      invoiceDraft.isFiscalDocument &&
      !invoiceDraft.documentRangeStart.trim()
    ) {
      toast.error("Ingresa el rango autorizado inicial");
      return false;
    }
    if (
      invoiceDraft.isFiscalDocument &&
      !isValidInvoiceNumber(invoiceDraft.documentRangeStart)
    ) {
      toast.error(
        `El rango autorizado inicial debe tener el formato ${INVOICE_NUMBER_FORMAT_EXAMPLE}`
      );
      return false;
    }
    if (
      invoiceDraft.isFiscalDocument &&
      !invoiceDraft.documentRangeEnd.trim()
    ) {
      toast.error("Ingresa el rango autorizado final");
      return false;
    }
    if (
      invoiceDraft.isFiscalDocument &&
      !isValidInvoiceNumber(invoiceDraft.documentRangeEnd)
    ) {
      toast.error(
        `El rango autorizado final debe tener el formato ${INVOICE_NUMBER_FORMAT_EXAMPLE}`
      );
      return false;
    }
    if (
      invoiceDraft.isFiscalDocument &&
      !isFiscalInvoiceRangeOrdered({
        documentRangeStart: invoiceDraft.documentRangeStart,
        documentRangeEnd: invoiceDraft.documentRangeEnd,
      })
    ) {
      toast.error(
        "El rango autorizado final debe ser mayor o igual al inicial"
      );
      return false;
    }
    if (
      invoiceDraft.isFiscalDocument &&
      !isInvoiceNumberWithinFiscalRange({
        invoiceNumber: invoiceDraft.invoiceNumber,
        documentRangeStart: invoiceDraft.documentRangeStart,
        documentRangeEnd: invoiceDraft.documentRangeEnd,
      })
    ) {
      toast.error("El número documento debe estar dentro del rango autorizado");
      return false;
    }
    if (invoiceDraft.isFiscalDocument && !invoiceDraft.documentDueDate) {
      toast.error("Selecciona la fecha de vencimiento (crédito)");
      return false;
    }
    if (invoiceDraft.isFiscalDocument && !invoiceDraft.emissionDeadline) {
      toast.error("Selecciona la fecha límite de emisión");
      return false;
    }
    if (!validateRetentionFiscalDraft(retentionDrafts.length > 0)) return false;
    if (invoiceDraft.hasOceExemption) {
      const exemptAmount15 = toMoneyNumber(invoiceDraft.oceExemptAmount15);
      const exemptAmount18 = toMoneyNumber(invoiceDraft.oceExemptAmount18);
      const exemptAmount = exemptAmount15 + exemptAmount18;
      const invoiceSubtotal = toMoneyNumber(detail?.invoice?.subtotal);
      if (!invoiceDraft.oceNumber.trim()) {
        toast.error("Ingrese el número OCE");
        return false;
      }
      if (!invoiceDraft.oceResolutionNumber.trim()) {
        toast.error("Ingrese el número de resolución OCE");
        return false;
      }
      if (!invoiceDraft.oceResolutionDate) {
        toast.error("Seleccione la fecha de resolución OCE");
        return false;
      }
      if (exemptAmount <= 0) {
        toast.error("Ingrese un importe exento mayor que cero");
        return false;
      }
      if (invoiceSubtotal > 0 && exemptAmount > invoiceSubtotal) {
        toast.error("El importe exento no puede exceder el subtotal");
        return false;
      }
    }
    if (invoiceDraft.dmcForeignSection) {
      if (!invoiceDraft.dmcForeignIdentification.trim()) {
        toast.error("Ingrese la identificación extranjera");
        return false;
      }
      if (
        invoiceDraft.dmcForeignSection === "fyduca" &&
        !invoiceDraft.dmcFyducaNumber.trim()
      ) {
        toast.error("Ingrese el número FYDUCA");
        return false;
      }
      if (
        invoiceDraft.dmcForeignSection === "importacion" &&
        !invoiceDraft.dmcDuaNumber.trim()
      ) {
        toast.error("Ingrese el número DUA");
        return false;
      }
    }

    return true;
  };

  const buildInvoiceUpdatePayload = (id: number) => ({
    id,
    isFiscalDocument: invoiceDraft.isFiscalDocument,
    cai: invoiceDraft.cai.trim()
      ? invoiceDraft.isFiscalDocument
        ? formatCaiInput(invoiceDraft.cai)
        : invoiceDraft.cai.trim()
      : undefined,
    invoiceNumber: invoiceDraft.invoiceNumber.trim()
      ? invoiceDraft.isFiscalDocument
        ? formatInvoiceNumberInput(invoiceDraft.invoiceNumber)
        : invoiceDraft.invoiceNumber.trim()
      : undefined,
    documentRangeStart: invoiceDraft.documentRangeStart.trim()
      ? invoiceDraft.isFiscalDocument
        ? formatInvoiceNumberInput(invoiceDraft.documentRangeStart)
        : invoiceDraft.documentRangeStart.trim()
      : undefined,
    documentRangeEnd: invoiceDraft.documentRangeEnd.trim()
      ? invoiceDraft.isFiscalDocument
        ? formatInvoiceNumberInput(invoiceDraft.documentRangeEnd)
        : invoiceDraft.documentRangeEnd.trim()
      : undefined,
    documentDate: invoiceDraft.documentDate,
    documentDueDate: invoiceDraft.documentDueDate,
    postingDate: invoiceDraft.postingDate,
    receiptDate: invoiceDraft.receiptDate,
    emissionDeadline: invoiceDraft.emissionDeadline,
    retentionReceiptNumber: invoiceDraft.retentionReceiptNumber.trim()
      ? formatInvoiceNumberInput(invoiceDraft.retentionReceiptNumber)
      : undefined,
    retentionCai: invoiceDraft.retentionCai.trim()
      ? formatCaiInput(invoiceDraft.retentionCai)
      : undefined,
    retentionDocumentRangeStart: invoiceDraft.retentionDocumentRangeStart.trim()
      ? formatInvoiceNumberInput(invoiceDraft.retentionDocumentRangeStart)
      : undefined,
    retentionDocumentRangeEnd: invoiceDraft.retentionDocumentRangeEnd.trim()
      ? formatInvoiceNumberInput(invoiceDraft.retentionDocumentRangeEnd)
      : undefined,
    retentionEmissionDeadline: invoiceDraft.retentionEmissionDeadline,
    retentionDocumentDate: invoiceDraft.retentionDocumentDate,
    hasOceExemption: invoiceDraft.hasOceExemption,
    oceNumber: invoiceDraft.hasOceExemption
      ? invoiceDraft.oceNumber.trim()
      : undefined,
    oceResolutionNumber: invoiceDraft.hasOceExemption
      ? invoiceDraft.oceResolutionNumber.trim()
      : undefined,
    oceResolutionDate: invoiceDraft.hasOceExemption
      ? invoiceDraft.oceResolutionDate
      : undefined,
    oceExemptAmount: invoiceDraft.hasOceExemption
      ? String(
          toMoneyNumber(invoiceDraft.oceExemptAmount15) +
            toMoneyNumber(invoiceDraft.oceExemptAmount18)
        )
      : "0",
    oceExemptAmount15: invoiceDraft.hasOceExemption
      ? String(toMoneyNumber(invoiceDraft.oceExemptAmount15))
      : undefined,
    oceExemptAmount18: invoiceDraft.hasOceExemption
      ? String(toMoneyNumber(invoiceDraft.oceExemptAmount18))
      : undefined,
    dmcForeignSection: invoiceDraft.dmcForeignSection || null,
    dmcForeignIdentification:
      invoiceDraft.dmcForeignIdentification.trim() || undefined,
    dmcFyducaNumber: invoiceDraft.dmcFyducaNumber.trim() || undefined,
    dmcDuaNumber: invoiceDraft.dmcDuaNumber.trim() || undefined,
    dmcImportOutsideCentralAmerica: invoiceDraft.dmcImportOutsideCentralAmerica,
    notes: invoiceDraft.notes,
  });

  const handleSaveInvoice = () => {
    if (!selectedId) return;
    if (!validateInvoiceDraft()) return;

    setActionFeedback(current => ({ ...current, invoiceSavedId: null }));
    updateMutation.mutate(buildInvoiceUpdatePayload(selectedId));
  };

  const getLineRetentionDrafts = (itemId: number) =>
    retentionDrafts.filter(retention => retention.invoiceItemId === itemId);

  const getAvailableLineRetentionOptions = (itemId: number) => {
    const selectedRetentionIds = new Set(
      getLineRetentionDrafts(itemId).map(
        retention => retention.retentionCatalogId
      )
    );
    return retentionOptions
      .filter(option => !selectedRetentionIds.has(String(option.id)))
      .map(option => ({
        ...option,
        disabledReason:
          hasValidAccountPaymentCertificate &&
          !isAccountPaymentAllowedRetention(option)
            ? "No disponible: la constancia vigente solo permite RT15"
            : null,
      }));
  };

  const sortRetentionDrafts = (drafts: RetentionDraft[]) =>
    [...drafts].sort((a, b) => {
      const lineComparison = (a.invoiceItemId ?? 0) - (b.invoiceItemId ?? 0);
      if (lineComparison !== 0) return lineComparison;
      return (a.retentionCode ?? "").localeCompare(b.retentionCode ?? "");
    });

  const handleAddLineRetention = (item: any, value: string) => {
    const existingLineRetentions = getLineRetentionDrafts(item.id);
    if (existingLineRetentions.length >= 2) {
      toast.error("Este producto ya tiene dos retenciones");
      return;
    }
    if (
      existingLineRetentions.some(
        retention => retention.retentionCatalogId === value
      )
    ) {
      toast.error("Esta retención ya está aplicada a este producto");
      return;
    }

    const selectedOption = retentionOptions.find(
      option => String(option.id) === value
    );
    if (!selectedOption) return;
    if (
      hasValidAccountPaymentCertificate &&
      !isAccountPaymentAllowedRetention(selectedOption)
    ) {
      toast.error(
        "La constancia de pagos a cuenta vigente solo permite RT15 (15%)"
      );
      return;
    }

    updateRetentionDrafts(current => {
      const currentLineRetentions = current.filter(
        retention => retention.invoiceItemId === item.id
      );
      if (currentLineRetentions.length >= 2) return current;
      if (
        currentLineRetentions.some(
          retention => retention.retentionCatalogId === value
        )
      ) {
        return current;
      }

      return sortRetentionDrafts([
        ...current,
        {
          ...emptyRetention(item.subtotal, item),
          retentionCatalogId: value,
          retentionCode: selectedOption.taxCode,
          retentionErpCode: selectedOption.erpCode ?? null,
          description: selectedOption.description,
          percentage: String(selectedOption.ratePercent),
          baseAmount: String(item.subtotal ?? "0.0000"),
        },
      ]);
    });
  };

  const handleSaveRetentions = () => {
    if (!selectedId) return;
    if (incompatibleAccountPaymentRetentions.length > 0) {
      toast.error(
        "Retire las retenciones incompatibles; la constancia vigente solo permite RT15 (15%)"
      );
      return;
    }
    if (retentionDrafts.length > 0 && !canRetainSelectedInvoice) {
      toast.error(
        retentionDisabledReason || "La factura no permite retenciones"
      );
      return;
    }
    if (!validateRetentionFiscalDraft(retentionDrafts.length > 0)) return;
    const lineRetentionCounts = new Map<number, number>();
    const lineRetentionCatalogs = new Set<string>();
    for (let index = 0; index < retentionDrafts.length; index += 1) {
      const retention = retentionDrafts[index];
      const lineItem = retention.invoiceItemId
        ? detail?.items?.find(
            (item: any) => item.id === retention.invoiceItemId
          )
        : null;
      const allowedBase = lineItem
        ? toNumber(lineItem.subtotal)
        : withholdingBase;
      const retentionLabel = lineItem?.itemName
        ? ` de ${lineItem.itemName}`
        : retentionDrafts.length > 1
          ? ` #${index + 1}`
          : "";
      if (retention.retentionCatalogId === "none") {
        toast.error(`Seleccione la retención${retentionLabel}`);
        return;
      }
      if (retention.invoiceItemId) {
        const currentCount =
          (lineRetentionCounts.get(retention.invoiceItemId) ?? 0) + 1;
        lineRetentionCounts.set(retention.invoiceItemId, currentCount);
        if (currentCount > 2) {
          toast.error(
            `El producto${retentionLabel} no puede tener más de dos retenciones`
          );
          return;
        }

        const duplicateKey = `${retention.invoiceItemId}:${retention.retentionCatalogId}`;
        if (lineRetentionCatalogs.has(duplicateKey)) {
          toast.error(
            `La retención${retentionLabel} está repetida para el mismo producto`
          );
          return;
        }
        lineRetentionCatalogs.add(duplicateKey);
      }
      if (lineItem && lineItem.allowsTaxWithholding === false) {
        toast.error(`La línea ${lineItem.itemName} no permite retención`);
        return;
      }
      if (toNumber(retention.baseAmount) <= 0) {
        toast.error(
          `La base de la retención${retentionLabel} debe ser mayor que cero`
        );
        return;
      }
      if (toNumber(retention.baseAmount) - allowedBase > 0.000001) {
        toast.error(
          lineItem
            ? `La base de la retención${retentionLabel} no puede exceder el subtotal de la línea`
            : `La base de la retención${retentionLabel} no puede exceder la base imponible`
        );
        return;
      }
      if (toNumber(retention.percentage) <= 0) {
        toast.error(
          `La tasa de la retención${retentionLabel} debe ser mayor que cero`
        );
        return;
      }
      if (getRetentionAmount(retention) <= 0) {
        toast.error(
          `El monto de la retención${retentionLabel} debe ser mayor que cero`
        );
        return;
      }
    }
    if (retentionTotal - withholdingBase > 0.000001) {
      toast.error("Las retenciones no pueden exceder la base imponible");
      return;
    }
    if (retentionTotal - invoiceTotal > 0.000001) {
      toast.error("Las retenciones no pueden exceder el total de la factura");
      return;
    }
    setActionFeedback(current => ({ ...current, retentionsSavedId: null }));
    replaceRetentionsMutation.mutate({
      id: selectedId,
      retentionReceiptNumber: invoiceDraft.retentionReceiptNumber.trim()
        ? formatInvoiceNumberInput(invoiceDraft.retentionReceiptNumber)
        : undefined,
      retentionCai: invoiceDraft.retentionCai.trim()
        ? formatCaiInput(invoiceDraft.retentionCai)
        : undefined,
      retentionDocumentRangeStart:
        invoiceDraft.retentionDocumentRangeStart.trim()
          ? formatInvoiceNumberInput(invoiceDraft.retentionDocumentRangeStart)
          : undefined,
      retentionDocumentRangeEnd: invoiceDraft.retentionDocumentRangeEnd.trim()
        ? formatInvoiceNumberInput(invoiceDraft.retentionDocumentRangeEnd)
        : undefined,
      retentionEmissionDeadline:
        invoiceDraft.retentionEmissionDeadline || undefined,
      retentionDocumentDate: invoiceDraft.retentionDocumentDate || undefined,
      retentions: retentionDrafts.map(retention => ({
        invoiceItemId: retention.invoiceItemId ?? undefined,
        retentionCatalogId: Number(retention.retentionCatalogId),
        baseAmount: String(toNumber(retention.baseAmount)),
      })),
    });
  };

  const handleSaveDocumentAdjustments = () => {
    if (!selectedId) return;
    const subtotal = toMoneyNumber(detail?.invoice.subtotal);
    const qualityRetentionPercent =
      documentAdjustmentDraft.qualityRetentionInputMode === "percentage"
        ? parseDocumentAdjustmentPercent(
            documentAdjustmentDraft.qualityRetentionPercent,
            "Retención de calidad"
          )
        : 0;
    const qualityRetentionAmount =
      documentAdjustmentDraft.qualityRetentionInputMode === "amount"
        ? parseDocumentAdjustmentAmount(
            documentAdjustmentDraft.qualityRetentionAmount,
            "El monto de retención de calidad",
            subtotal
          )
        : undefined;
    if (qualityRetentionPercent === null || qualityRetentionAmount === null)
      return;
    const advanceAmortizationPercent =
      documentAdjustmentDraft.advanceAmortizationInputMode === "percentage"
        ? parseDocumentAdjustmentPercent(
            documentAdjustmentDraft.advanceAmortizationPercent,
            "Amortización de anticipo"
          )
        : 0;
    const advanceAmortizationAmount =
      documentAdjustmentDraft.advanceAmortizationInputMode === "amount"
        ? parseDocumentAdjustmentAmount(
            documentAdjustmentDraft.advanceAmortizationAmount,
            "El monto de amortización de anticipo",
            subtotal
          )
        : undefined;
    if (
      advanceAmortizationPercent === null ||
      advanceAmortizationAmount === null
    )
      return;
    const promptPaymentPercent =
      documentAdjustmentDraft.promptPaymentInputMode === "percentage"
        ? parseDocumentAdjustmentPercent(
            documentAdjustmentDraft.promptPaymentPercent,
            "Pronto pago"
          )
        : 0;
    const promptPaymentAmount =
      documentAdjustmentDraft.promptPaymentInputMode === "amount"
        ? parseDocumentAdjustmentAmount(
            documentAdjustmentDraft.promptPaymentAmount,
            "El monto de pronto pago",
            subtotal
          )
        : undefined;
    if (promptPaymentPercent === null || promptPaymentAmount === null) return;

    const calculated = calculateInvoiceDocumentAdjustments({
      subtotal,
      baseIsvAmount: documentBaseIsvAmount,
      input: {
        qualityRetentionPercent,
        qualityRetentionAmount,
        advanceAmortizationPercent,
        advanceAmortizationAmount,
        promptPaymentPercent,
        promptPaymentAmount,
        tcEnabled: documentAdjustmentDraft.tcEnabled,
      },
    });
    const nextNetPayable = calculateInvoiceNetPayable({
      total: invoiceTotal,
      fiscalRetentionTotal: retentionTotal,
      otherRetentionTotal: calculated.otherRetentionTotal,
      documentDiscountTotal: calculated.documentDiscountTotal,
    });
    if (nextNetPayable < -0.000001) {
      toast.error(
        "Las retenciones y descuentos no pueden exceder el total de la factura"
      );
      return;
    }

    setActionFeedback(current => ({
      ...current,
      documentAdjustmentsSavedId: null,
    }));
    replaceDocumentAdjustmentsMutation.mutate({
      id: selectedId,
      qualityRetentionPercent,
      qualityRetentionAmount,
      advanceAmortizationPercent,
      advanceAmortizationAmount,
      promptPaymentPercent,
      promptPaymentAmount,
      tcEnabled: documentAdjustmentDraft.tcEnabled,
    });
  };

  const handlePrintRetentionCertificate = () => {
    if (!detail || retentionDrafts.length === 0 || retentionTotal <= 0) {
      toast.error("Esta factura no tiene retenciones para imprimir");
      return;
    }
    const retentionReceiptNumber =
      invoiceDraft.retentionReceiptNumber.trim() ||
      detail.invoice.retentionReceiptNumber ||
      "";
    if (!retentionReceiptNumber.trim()) {
      toast.error("Ingrese el número de comprobante de retención");
      return;
    }

    const invoice = detail.invoice;
    const supplier = (detail.supplier ?? {}) as Record<string, any>;
    const supplierContact = (detail.supplierContact ?? {}) as Record<
      string,
      any
    >;
    const supplierName = supplier?.name ?? "Proveedor";
    const supplierRtn =
      supplier?.rtn ??
      supplier?.taxId ??
      supplier?.rtnNumber ??
      supplier?.supplierRtn ??
      "";
    const supplierAddress =
      supplierContact?.address ??
      supplier?.address ??
      supplier?.direccion ??
      supplier?.location ??
      "";
    const documentNumber =
      invoice.invoiceNumber || invoice.invoiceDocumentNumber || "";
    const documentDate = formatRetentionPrintDate(
      invoice.documentDate ?? invoice.receiptDate ?? invoice.postingDate
    );
    const { printableConcepts, truncated } =
      getPrintableRetentionConcepts(retentionDrafts);

    if (truncated) {
      toast.warning(
        "El formato preimpreso solo tiene espacio para los primeros 8 conceptos de retención"
      );
    }

    const rowsHtml = printableConcepts
      .map((retentionConcept, index) => {
        const top = 52 + index * 7.7;
        const rate = toNumber(retentionConcept.percentage).toLocaleString(
          "es-HN",
          {
            minimumFractionDigits: 0,
            maximumFractionDigits: 4,
          }
        );
        return `
          <div class="cell row-date" style="top:${top}mm">${escapePrintHtml(documentDate)}</div>
          <div class="cell row-desc" style="top:${top}mm">${escapePrintHtml(retentionConcept.description || retentionConcept.retentionCode || "Retención")}</div>
          <div class="cell row-type" style="top:${top}mm">Factura</div>
          <div class="cell row-doc" style="top:${top}mm">${escapePrintHtml(documentNumber)}</div>
          <div class="cell row-base" style="top:${top}mm">${formatRetentionPrintNumber(retentionConcept.baseAmount)}</div>
          <div class="cell row-rate" style="top:${top}mm">${escapePrintHtml(rate)}%</div>
          <div class="cell row-amount" style="top:${top}mm">${formatRetentionPrintNumber(retentionConcept.amount)}</div>
        `;
      })
      .join("");

    const totalRetained = printableConcepts.reduce(
      (sum, retentionConcept) => sum + retentionConcept.amount,
      0
    );
    const amountWords = amountToSpanishCurrency(
      totalRetained,
      selectedInvoiceCurrency
    );
    const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>&#8203;</title>
    <style>
      @page {
        size: letter;
        margin: 0 !important;
      }
      * {
        box-sizing: border-box;
      }
      html,
      body {
        margin: 0;
        padding: 0;
        width: 216mm;
        height: 279mm;
      }
      body {
        font-family: Arial, Helvetica, sans-serif;
        color: #000;
        background: white;
      }
      .page {
        position: relative;
        width: 216mm;
        height: 279mm;
        margin: 0 auto;
        background: white;
      }
      .field,
      .cell {
        position: absolute;
        overflow: hidden;
        font-size: 10pt;
        line-height: 1.1;
        white-space: nowrap;
      }
      .multiline {
        white-space: normal;
        line-height: 1.12;
      }
      .right {
        text-align: right;
      }
      .center {
        text-align: center;
      }
      .supplier-name {
        left: 19mm;
        top: 16.5mm;
        width: 126mm;
        font-weight: 600;
      }
      .supplier-rtn {
        left: 158mm;
        top: 14.5mm;
        width: 47mm;
      }
      .print-date {
        left: 170mm;
        top: 4.8mm;
        width: 32mm;
      }
      .invoice-cai {
        left: 56mm;
        top: 23.3mm;
        width: 143mm;
      }
      .supplier-address {
        left: 25mm;
        top: 30mm;
        width: 174mm;
      }
      .row-date {
        left: 5mm;
        width: 19mm;
        text-align: center;
        font-size: 8.4pt;
      }
      .row-desc {
        left: 27mm;
        width: 32mm;
        white-space: normal;
        font-size: 8.2pt;
      }
      .row-type {
        left: 61mm;
        width: 24mm;
        text-align: center;
        font-size: 8.3pt;
      }
      .row-doc {
        left: 87mm;
        width: 39mm;
        text-align: center;
        font-size: 8.2pt;
      }
      .row-base {
        left: 128mm;
        width: 24mm;
        text-align: right;
        font-size: 8.4pt;
      }
      .row-rate {
        left: 155mm;
        width: 17mm;
        text-align: center;
        font-size: 8.4pt;
      }
      .row-amount {
        left: 174mm;
        width: 28mm;
        text-align: right;
        font-size: 8.4pt;
        font-weight: 600;
      }
      .total-retained {
        left: 171mm;
        top: 102mm;
        width: 28mm;
        font-size: 9.4pt;
        font-weight: 700;
      }
      .amount-words {
        left: 35mm;
        top: 109mm;
        width: 98mm;
        font-size: 8.8pt;
        line-height: 1.18;
        font-weight: 600;
      }
      @media screen {
        .page {
          margin: 0 auto;
          box-shadow: 0 12px 32px rgba(15, 23, 42, 0.18);
        }
      }
      @media print {
        body {
          background: white;
        }
        .page {
          margin: 0;
          box-shadow: none;
        }
      }
    </style>
  </head>
  <body>
    <div class="page">
      <div class="field print-date">${escapePrintHtml(documentDate)}</div>
      <div class="field supplier-name">${escapePrintHtml(supplierName)}</div>
      <div class="field supplier-rtn">${escapePrintHtml(supplierRtn)}</div>
      <div class="field invoice-cai">${escapePrintHtml(invoice.cai || "")}</div>
      <div class="field supplier-address multiline">${escapePrintHtml(supplierAddress)}</div>
      ${rowsHtml}
      <div class="field total-retained right">${escapePrintHtml(
        getPurchaseCurrencySymbol(selectedInvoiceCurrency)
      )} ${formatRetentionPrintNumber(totalRetained)}</div>
      <div class="field amount-words multiline">${escapePrintHtml(amountWords)}</div>
    </div>
    <script>
      window.addEventListener("load", () => {
        window.focus();
        setTimeout(() => window.print(), 250);
      });
    </script>
  </body>
</html>`;

    const printWindow = window.open("", "_blank", "width=920,height=720");
    if (!printWindow) {
      toast.error("No se pudo abrir la ventana de impresión");
      return;
    }
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
  };

  const handleReviewInvoice = () => {
    if (!selectedId) return;
    if (documentAdjustmentsDirty) {
      toast.error(
        "Guarde las retenciones y descuentos por documento antes de registrar la factura"
      );
      return;
    }
    if (attachmentState.count === 0) {
      toast.error("Adjunte al menos un archivo antes de enviar a revisión");
      return;
    }
    if (!validateInvoiceDraft()) return;

    const invoiceId = selectedId;
    setActionFeedback(current => ({ ...current, reviewSentId: null }));
    updateMutation
      .mutateAsync(buildInvoiceUpdatePayload(invoiceId))
      .then(() => {
        reviewMutation.mutate({ id: invoiceId });
      })
      .catch(() => {
        // updateMutation already shows the friendly error toast.
      });
  };

  const handleAccountInvoice = () => {
    if (!selectedId) return;
    if (documentAdjustmentsDirty) {
      toast.error(
        "Guarde las retenciones y descuentos por documento antes de contabilizar"
      );
      return;
    }
    accountMutation.mutate({
      id: selectedId,
      accountingComment: accountingComment.trim() || undefined,
    });
  };

  const handleRejectInvoice = () => {
    if (!selectedId) return;
    if (rejectionComment.trim().length < 5) {
      toast.error("Escribe un comentario de rechazo de al menos 5 caracteres");
      return;
    }
    rejectMutation.mutate({
      id: selectedId,
      rejectionComment: rejectionComment.trim(),
    });
  };

  const handleCorrectReceipt = () => {
    if (!selectedId) return;
    if (correctionReason.trim().length < 5) {
      toast.error("Escribe un motivo de corrección de al menos 5 caracteres");
      return;
    }
    correctReceiptMutation.mutate({
      id: selectedId,
      reason: correctionReason.trim(),
    });
  };

  const exportInternalInvoicesReport = async () => {
    if (isExportingInternalReport) return;
    setIsExportingInternalReport(true);
    try {
      const payload = await utils.reports.systemInvoices.fetch({
        projectId: projectFilter === "all" ? null : Number(projectFilter),
        dateFrom: dateFrom || null,
        dateTo: dateTo || null,
        search: debouncedSearchTerm.trim() || null,
        status:
          statusFilter === "all"
            ? null
            : (statusFilter as
                | "borrador"
                | "revisada"
                | "rechazada"
                | "registrada"
                | "anulada"),
      });
      if (payload.summary.invoiceLineCount === 0) {
        toast.error("No hay facturas para generar el libro interno");
        return;
      }
      await downloadSystemInvoicesWorkbook(payload);
      toast.success(
        `Libro interno generado con ${payload.summary.invoiceLineCount.toLocaleString("es-HN")} línea(s)`
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "No se pudo generar el libro interno de facturas"
      );
    } finally {
      setIsExportingInternalReport(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1>Facturas</h1>
          <p className="text-sm text-muted-foreground">
            Documentos generados desde recepciones de órdenes de compra.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canExportInternalReport ? (
            <Button
              type="button"
              onClick={() => void exportInternalInvoicesReport()}
              disabled={
                isLoading || !invoicesPage?.total || isExportingInternalReport
              }
              className="gap-2"
            >
              <Download className="h-4 w-4" />
              {isExportingInternalReport ? "Generando..." : "Exportar Excel"}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchTerm}
            onChange={event => setSearchTerm(event.target.value)}
            placeholder="Buscar por factura, OC, recepción, REQ, artículo, requiriente, creador, proveedor o proyecto..."
            className="h-10 pl-9"
          />
        </div>
        <div className="grid w-full grid-cols-2 gap-2 lg:w-[330px]">
          <div className="space-y-1">
            <Label htmlFor="invoice-date-from" className="text-xs">
              Desde
            </Label>
            <Input
              id="invoice-date-from"
              type="date"
              value={dateFrom}
              max={dateTo || undefined}
              onChange={event => {
                const value = event.target.value;
                setDateFrom(value);
                if (value && dateTo && value > dateTo) setDateTo(value);
              }}
              className="h-10"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="invoice-date-to" className="text-xs">
              Hasta
            </Label>
            <Input
              id="invoice-date-to"
              type="date"
              value={dateTo}
              min={dateFrom || undefined}
              onChange={event => {
                const value = event.target.value;
                setDateTo(value);
                if (value && dateFrom && value < dateFrom) setDateFrom(value);
              }}
              className="h-10"
            />
          </div>
        </div>
        <Select value={projectFilter} onValueChange={setProjectFilter}>
          <SelectTrigger className="h-10 w-full lg:w-64">
            <SelectValue placeholder="Todos los proyectos" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los proyectos</SelectItem>
            {projectOptions.map((project: any) => (
              <SelectItem key={project.id} value={String(project.id)}>
                {project.code} - {project.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-10 w-full lg:w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los estados</SelectItem>
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">
              Cargando facturas...
            </div>
          ) : !filteredInvoices.length ? (
            <div className="p-8 text-center text-muted-foreground">
              No hay facturas registradas
            </div>
          ) : (
            <div className="relative isolate max-w-full overflow-x-auto">
              <table className="w-full min-w-[2360px] border-separate border-spacing-0 text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Documento
                    </th>
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Artículos
                    </th>
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      No. factura fiscal
                    </th>
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Fecha documento
                    </th>
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Proveedor
                    </th>
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Origen
                    </th>
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Req.
                    </th>
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Requiriente
                    </th>
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Creada por
                    </th>
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Fechas
                    </th>
                    <th className="p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Total
                    </th>
                    <th className="p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Retenciones fiscales
                    </th>
                    <th className="p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Otras retenciones
                    </th>
                    <th className="p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Descuentos
                    </th>
                    <th className="p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Neto
                    </th>
                    <th className="min-w-[280px] p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Estado
                    </th>
                    <th className="sticky right-0 z-30 w-[112px] min-w-[112px] border-l border-border/60 bg-card p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground shadow-[-10px_0_14px_-12px_rgba(0,0,0,0.55)]">
                      Acciones
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredInvoices.map((row: any) => {
                    const statusNote = getInvoiceStatusNote(row.invoice);
                    const itemsExpanded = expandedItemsId === row.invoice.id;

                    return (
                      <Fragment key={row.invoice.id}>
                        <tr className="border-b border-border last:border-0">
                          <td className="p-3">
                            <DocumentNumberButton
                              onClick={() => setSelectedId(row.invoice.id)}
                              ariaLabel={`Abrir ${row.invoice.invoiceDocumentNumber}`}
                            >
                              {row.invoice.invoiceDocumentNumber}
                            </DocumentNumberButton>
                          </td>
                          <td className="p-3">
                            <DocumentItemsAccordionTrigger
                              expanded={itemsExpanded}
                              count={
                                itemsExpanded
                                  ? expandedItemsDetail?.items?.length
                                  : undefined
                              }
                              onToggle={() =>
                                setExpandedItemsId(
                                  itemsExpanded ? null : row.invoice.id
                                )
                              }
                            />
                          </td>
                          <td className="p-3 font-medium">
                            {row.invoice.invoiceNumber || "—"}
                          </td>
                          <td className="p-3">
                            {formatDateLabel(row.invoice.documentDate)}
                          </td>
                          <td className="p-3">
                            <span className="font-medium">
                              {row.supplier?.name || "Proveedor pendiente"}
                            </span>
                          </td>
                          <td className="p-3">
                            <div>{row.purchaseOrder?.orderNumber || "OC"}</div>
                            <div className="text-xs text-muted-foreground">
                              {row.receipt?.receiptNumber || "Recepción"}
                            </div>
                          </td>
                          <td className="p-3 font-medium">
                            {formatInvoiceRequestNumbers(row)}
                          </td>
                          <td className="p-3 text-xs">
                            {formatInvoiceRequestedBy(row)}
                          </td>
                          <td className="p-3 text-xs">
                            {formatInvoiceCreatedBy(row)}
                          </td>
                          <td className="p-3">
                            <div>
                              {formatDateLabel(row.invoice.documentDueDate)}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              Límite emisión:{" "}
                              {formatDateLabel(row.invoice.emissionDeadline)}
                            </div>
                          </td>
                          <td className="p-3 text-right font-medium">
                            {formatPurchaseOrderCurrency(
                              row.invoice.total,
                              row.invoice.currency ?? "HNL"
                            )}
                          </td>
                          <td className="p-3 text-right font-medium">
                            {formatPurchaseOrderCurrency(
                              row.invoice.retentionTotal,
                              row.invoice.currency ?? "HNL"
                            )}
                          </td>
                          <td className="p-3 text-right font-medium">
                            {formatPurchaseOrderCurrency(
                              row.invoice.otherRetentionTotal,
                              row.invoice.currency ?? "HNL"
                            )}
                          </td>
                          <td className="p-3 text-right font-medium">
                            {formatPurchaseOrderCurrency(
                              row.invoice.documentDiscountTotal,
                              row.invoice.currency ?? "HNL"
                            )}
                          </td>
                          <td className="p-3 text-right font-semibold">
                            {formatPurchaseOrderCurrency(
                              row.invoice.netPayable,
                              row.invoice.currency ?? "HNL"
                            )}
                          </td>
                          <td className="min-w-[280px] max-w-[320px] p-3 align-top">
                            <div className="max-w-72">
                              <Badge
                                variant="outline"
                                className={`max-w-full text-xs ${getInvoiceStatusColor(row.invoice)}`}
                              >
                                {getInvoiceStatusLabel(row.invoice)}
                              </Badge>
                              {statusNote ? (
                                <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-snug text-muted-foreground">
                                  <span className="font-medium text-foreground/70">
                                    {statusNote.label}:
                                  </span>{" "}
                                  {statusNote.text}
                                </p>
                              ) : null}
                            </div>
                          </td>
                          <td className="sticky right-0 z-20 w-[112px] min-w-[112px] border-l border-border/60 bg-card p-3 text-right align-top shadow-[-10px_0_14px_-12px_rgba(0,0,0,0.55)]">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setSelectedId(row.invoice.id)}
                            >
                              Ver
                            </Button>
                          </td>
                        </tr>
                        {itemsExpanded ? (
                          <tr className="border-b border-border">
                            <td colSpan={17} className="p-0">
                              <DocumentItemsAccordionPanel
                                items={expandedItemsDetail?.items}
                                isLoading={isLoadingExpandedItems}
                                error={expandedItemsError}
                              />
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {invoicesPage ? (
            <DataPagination
              page={invoicesPage.page}
              pageSize={invoicesPage.pageSize}
              total={invoicesPage.total}
              totalPages={invoicesPage.totalPages}
              onPageChange={setPage}
            />
          ) : null}
        </CardContent>
      </Card>

      <Dialog
        open={selectedId !== null}
        onOpenChange={open => {
          if (!open) setSelectedId(null);
        }}
      >
        <DialogContent className="scrollbar-visible max-h-[calc(100vh-0.75rem)] w-[calc(100vw-0.5rem)] max-w-[calc(100vw-0.5rem)] overflow-x-hidden overflow-y-auto rounded-lg p-0 sm:max-h-[calc(100vh-1.5rem)] sm:w-[calc(100vw-2rem)] sm:max-w-[1580px]">
          <DialogHeader className="min-w-0 border-b border-border/70 px-4 py-4 pr-16 sm:px-6 sm:pr-20">
            <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex min-w-0 flex-wrap items-center gap-3">
                <DialogTitle className="min-w-0 break-words text-2xl font-bold tracking-tight sm:text-3xl">
                  {detail?.invoice.invoiceDocumentNumber || "Factura"}
                </DialogTitle>
                {detail?.invoice.status ? (
                  <Badge
                    variant="outline"
                    className={`text-sm ${getInvoiceStatusColor(detail.invoice)}`}
                  >
                    {getInvoiceStatusLabel(detail.invoice)}
                  </Badge>
                ) : null}
              </div>
              {detail ? (
                <div className="flex max-w-full flex-wrap items-center justify-start gap-2 pr-1 sm:pr-3 lg:justify-end lg:pr-0">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handlePrintInvoiceDetail}
                  >
                    <Printer className="mr-2 h-4 w-4" />
                    Imprimir
                  </Button>
                  {canCorrectSelectedReceipt ? (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setCorrectionDialogOpen(true)}
                      disabled={correctReceiptMutation.isPending}
                    >
                      <RotateCcw className="mr-2 h-4 w-4" />
                      Corregir recepción
                    </Button>
                  ) : null}
                  {canReviewSelectedInvoice ? (
                    <Button
                      onClick={handleReviewInvoice}
                      variant={reviewSendConfirmed ? "outline" : "default"}
                      className={
                        reviewSendConfirmed ? SAVED_BUTTON_CLASS : undefined
                      }
                      disabled={
                        updateMutation.isPending ||
                        reviewMutation.isPending ||
                        reviewSendConfirmed ||
                        documentAdjustmentsDirty ||
                        attachmentState.isLoading ||
                        attachmentState.count === 0
                      }
                    >
                      {reviewSendConfirmed ? (
                        <CheckCircle2 className="mr-2 h-4 w-4" />
                      ) : (
                        <Send className="mr-2 h-4 w-4" />
                      )}
                      {updateMutation.isPending
                        ? "Guardando..."
                        : reviewMutation.isPending
                          ? "Enviando..."
                          : reviewSendConfirmed
                            ? "Enviada a revisión"
                            : "Registrar Factura"}
                    </Button>
                  ) : null}
                  {canAccountSelectedInvoice ? (
                    <>
                      <Button
                        onClick={handleAccountInvoice}
                        disabled={
                          accountMutation.isPending || documentAdjustmentsDirty
                        }
                      >
                        <CheckCircle2 className="mr-2 h-4 w-4" />
                        {accountMutation.isPending
                          ? "Contabilizando..."
                          : "Contabilizar"}
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => setRejectDialogOpen(true)}
                        disabled={rejectMutation.isPending}
                      >
                        <XCircle className="mr-2 h-4 w-4" />
                        Rechazar
                      </Button>
                    </>
                  ) : null}
                </div>
              ) : null}
            </div>
          </DialogHeader>

          {detailLoading || !detail ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              Cargando factura...
            </div>
          ) : (
            <div className="grid min-w-0 gap-4 p-4 sm:p-6 xl:grid-cols-[minmax(0,1fr)_360px]">
              <main className="min-w-0 space-y-4">
                {getInvoiceHasEmissionDeadlineIssue(detail.invoice) ? (
                  <div className="flex items-start gap-2 rounded-lg border border-rose-300 bg-rose-50 p-4 text-sm text-rose-700">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <div>
                      <p className="font-semibold">
                        {EMISSION_DEADLINE_ISSUE_MESSAGE}
                      </p>
                      <p>
                        Esta factura está pendiente de corrección, pero tiene
                        problema en la fecha límite de emisión.
                      </p>
                    </div>
                  </div>
                ) : null}

                {isMissingRequiredCpcRetention && !isVoided ? (
                  <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <div>
                      <p className="font-semibold">
                        Retención RT01 (1%) requerida
                      </p>
                      <p>
                        El proveedor no tiene una CPC vigente para la fecha de
                        emisión {formatDateLabel(detail.invoice.documentDate)}.
                        Registre la retención antes de enviar o contabilizar la
                        factura.
                      </p>
                    </div>
                  </div>
                ) : null}

                {isRejected && detail.invoice.rejectionComment ? (
                  <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
                    <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    <div>
                      <p className="font-semibold">Motivo de rechazo</p>
                      <p className="whitespace-pre-wrap">
                        {detail.invoice.rejectionComment}
                      </p>
                    </div>
                  </div>
                ) : null}

                {isVoided ? (
                  <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-rose-300 bg-rose-50 p-4 text-sm text-rose-800">
                    <div className="flex min-w-0 items-start gap-2">
                      <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
                      <div className="min-w-0">
                        <p className="font-semibold">
                          Factura anulada por corrección de recepción
                        </p>
                        <p className="whitespace-pre-wrap">
                          {detail.invoice.voidReason || "Sin motivo registrado"}
                        </p>
                        <p className="mt-1 text-xs text-rose-700">
                          {formatUserReference(
                            (detail as any).voidedBy,
                            detail.invoice.voidedById
                          )}{" "}
                          · {formatDateTimeLabel(detail.invoice.voidedAt)}
                        </p>
                      </div>
                    </div>
                    {replacementReceiptId ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="border-rose-300 bg-white text-rose-800 hover:bg-rose-100"
                        onClick={() =>
                          setLocation(
                            `/recepciones?editar=${replacementReceiptId}`
                          )
                        }
                      >
                        Abrir recepción corregida
                      </Button>
                    ) : null}
                  </div>
                ) : null}

                <div className="grid min-w-0 gap-3 md:grid-cols-12">
                  <div className="min-w-0 rounded-lg border border-border/70 bg-muted/20 p-4 md:col-span-4">
                    <Label className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                      Proveedor
                    </Label>
                    <p className="mt-2 break-words font-semibold">
                      {detail.supplier
                        ? `${detail.supplier.supplierCode} — ${detail.supplier.name}`
                        : "Proveedor pendiente"}
                    </p>
                    {detail.supplier ? (
                      <p className="mt-1 break-words text-sm text-muted-foreground">
                        RTN: {formatSupplierRtnLabel(detail.supplier)}
                      </p>
                    ) : null}
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Badge
                        variant="outline"
                        className={`text-xs ${
                          isMissingCpcRetentionRequired
                            ? "border-amber-300 text-amber-700"
                            : retentionPolicy === "rt15_only"
                              ? "border-blue-300 text-blue-700"
                              : supplierAllowsTaxWithholding
                                ? "border-emerald-300 text-emerald-700"
                                : "border-amber-300 text-amber-700"
                        }`}
                      >
                        {isMissingCpcRetentionRequired
                          ? "Requiere RT01 (1%)"
                          : retentionPolicy === "rt15_only"
                            ? "Solo RT15 (15%)"
                            : supplierAllowsTaxWithholding
                              ? "Permite retención"
                              : "No permite retención"}
                      </Badge>
                      <Badge
                        variant="outline"
                        className={`text-xs ${
                          supplierSubjectToAccountPayments
                            ? "border-blue-300 text-blue-700"
                            : "border-slate-300 text-slate-600"
                        }`}
                      >
                        {supplierSubjectToAccountPayments
                          ? "Sujeto a pagos a cuenta"
                          : "No sujeto a pagos a cuenta"}
                      </Badge>
                    </div>
                  </div>
                  <div className="min-w-0 rounded-lg border border-border/70 bg-muted/20 p-4 md:col-span-4">
                    <Label className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                      Origen
                    </Label>
                    <p className="mt-2 break-words font-semibold">
                      {detail.purchaseOrder?.orderNumber || "OC"}
                    </p>
                    <p className="break-words text-sm text-muted-foreground">
                      {detail.receipt?.receiptNumber || "Recepción"}
                    </p>
                  </div>
                  <div className="min-w-0 rounded-lg border border-border/70 bg-muted/20 p-4 md:col-span-4">
                    <Label className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                      Proyecto
                    </Label>
                    <p className="mt-2 break-words font-semibold">
                      {detail.project
                        ? `${detail.project.code} — ${detail.project.name}`
                        : "Proyecto pendiente"}
                    </p>
                  </div>
                  <div className="min-w-0 rounded-lg border border-border/70 bg-muted/20 p-4 md:col-span-4">
                    <Label className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                      Moneda
                    </Label>
                    <p className="mt-2 break-words font-semibold">
                      {getPurchaseCurrencyLabel(selectedInvoiceCurrency)}
                    </p>
                    {selectedInvoiceCurrency === "USD" ? (
                      <p className="break-words text-sm text-muted-foreground">
                        1 USD ={" "}
                        {formatExchangeRateLabel(detail.invoice.exchangeRate)}{" "}
                        HNL · {formatDateLabel(detail.invoice.exchangeRateDate)}
                      </p>
                    ) : null}
                    <Badge variant="outline" className="mt-2 text-xs">
                      {detail.invoice.pricesIncludeTax === true
                        ? "Precios incluyen ISV"
                        : "Precios sin ISV"}
                    </Badge>
                  </div>
                </div>

                <section className="min-w-0 rounded-lg border border-border/70">
                  <div className="flex flex-wrap items-center gap-3 border-b border-border/70 px-4 py-3">
                    <h3 className="font-semibold">Información de la factura</h3>
                    <Badge variant="outline" className="text-xs">
                      {invoiceDraft.isFiscalDocument ? "Fiscal" : "Extranjero"}
                    </Badge>
                  </div>
                  <div className="space-y-4 p-4">
                    <div className="flex flex-wrap items-center gap-3">
                      <Checkbox
                        id="invoice-fiscal-document"
                        checked={invoiceDraft.isFiscalDocument}
                        disabled={!canEditSelectedInvoice}
                        onCheckedChange={checked =>
                          updateInvoiceDraft(current => ({
                            ...current,
                            isFiscalDocument: checked === true,
                            cai:
                              checked === true
                                ? formatCaiInput(current.cai)
                                : current.cai,
                            invoiceNumber:
                              checked === true
                                ? formatInvoiceNumberInput(
                                    current.invoiceNumber
                                  )
                                : current.invoiceNumber,
                            documentRangeStart:
                              checked === true
                                ? formatInvoiceNumberInput(
                                    current.documentRangeStart
                                  )
                                : current.documentRangeStart,
                            documentRangeEnd:
                              checked === true
                                ? formatInvoiceNumberInput(
                                    current.documentRangeEnd
                                  )
                                : current.documentRangeEnd,
                            retentionReceiptNumber:
                              checked === true
                                ? formatInvoiceNumberInput(
                                    current.retentionReceiptNumber
                                  )
                                : current.retentionReceiptNumber,
                          }))
                        }
                      />
                      <Label htmlFor="invoice-fiscal-document">
                        Documento fiscal
                      </Label>
                    </div>
                    <div className="rounded-md border border-border/70 bg-muted/10 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="space-y-1">
                          <Label htmlFor="invoice-oce-exemption">
                            Compra con OCE / Exenta
                          </Label>
                          <p className="text-xs text-muted-foreground">
                            Orden de compra exenta para compras no gravadas con
                            ISV.
                          </p>
                        </div>
                        <Switch
                          id="invoice-oce-exemption"
                          checked={invoiceDraft.hasOceExemption}
                          disabled={!canEditSelectedInvoice}
                          onCheckedChange={checked => {
                            const enabled = checked === true;
                            if (!enabled) {
                              oceExemptAmountTouchedRef.current = false;
                            }
                            const suggestedAmount = formatMoneyInput(
                              calculateOceExemptAmountSuggestion(detail)
                            );
                            updateInvoiceDraft(current => ({
                              ...current,
                              hasOceExemption: enabled,
                              oceNumber: enabled ? current.oceNumber : "",
                              oceResolutionNumber: enabled
                                ? current.oceResolutionNumber
                                : "",
                              oceResolutionDate: enabled
                                ? current.oceResolutionDate
                                : "",
                              oceExemptAmount: enabled
                                ? !oceExemptAmountTouchedRef.current &&
                                  toMoneyNumber(current.oceExemptAmount) <= 0
                                  ? suggestedAmount
                                  : current.oceExemptAmount
                                : "",
                              oceExemptAmount15: enabled
                                ? toMoneyNumber(current.oceExemptAmount15) > 0
                                  ? current.oceExemptAmount15
                                  : suggestedAmount
                                : "",
                              oceExemptAmount18: enabled
                                ? current.oceExemptAmount18
                                : "",
                            }));
                          }}
                        />
                      </div>
                      {invoiceDraft.hasOceExemption ? (
                        <div className="mt-4 grid min-w-0 gap-3 md:grid-cols-3">
                          <div className="space-y-2">
                            <Label>No. OCE</Label>
                            <Input
                              value={invoiceDraft.oceNumber}
                              disabled={!canEditSelectedInvoice}
                              onChange={event =>
                                updateInvoiceDraft(current => ({
                                  ...current,
                                  oceNumber: event.target.value,
                                }))
                              }
                              placeholder="Número de orden de compra exenta"
                              maxLength={100}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>No. resolución</Label>
                            <Input
                              value={invoiceDraft.oceResolutionNumber}
                              disabled={!canEditSelectedInvoice}
                              onChange={event =>
                                updateInvoiceDraft(current => ({
                                  ...current,
                                  oceResolutionNumber: event.target.value,
                                }))
                              }
                              placeholder="No. resolución OCE"
                              maxLength={100}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>Fecha de la resolución</Label>
                            <Input
                              type="date"
                              value={invoiceDraft.oceResolutionDate}
                              disabled={!canEditSelectedInvoice}
                              onChange={event =>
                                updateInvoiceDraft(current => ({
                                  ...current,
                                  oceResolutionDate: event.target.value,
                                }))
                              }
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>Importe exonerado 15%</Label>
                            <Input
                              type="number"
                              min="0"
                              step="0.01"
                              value={invoiceDraft.oceExemptAmount15}
                              disabled={!canEditSelectedInvoice}
                              onChange={event => {
                                oceExemptAmountTouchedRef.current = true;
                                updateInvoiceDraft(current => ({
                                  ...current,
                                  oceExemptAmount15: event.target.value,
                                }));
                              }}
                              placeholder="0.00"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>Importe exonerado 18%</Label>
                            <Input
                              type="number"
                              min="0"
                              step="0.01"
                              value={invoiceDraft.oceExemptAmount18}
                              disabled={!canEditSelectedInvoice}
                              onChange={event => {
                                oceExemptAmountTouchedRef.current = true;
                                updateInvoiceDraft(current => ({
                                  ...current,
                                  oceExemptAmount18: event.target.value,
                                }));
                              }}
                              placeholder="0.00"
                            />
                          </div>
                        </div>
                      ) : null}
                    </div>
                    <div className="rounded-md border border-border/70 bg-muted/10 p-3">
                      <div className="grid min-w-0 gap-3 md:grid-cols-3">
                        <div className="space-y-2">
                          <Label>Sección DMC extranjera</Label>
                          <Select
                            value={invoiceDraft.dmcForeignSection || "local"}
                            disabled={!canEditSelectedInvoice}
                            onValueChange={value =>
                              updateInvoiceDraft(current => ({
                                ...current,
                                dmcForeignSection:
                                  value === "local"
                                    ? ""
                                    : (value as "fyduca" | "importacion"),
                                dmcFyducaNumber:
                                  value === "fyduca"
                                    ? current.dmcFyducaNumber
                                    : "",
                                dmcDuaNumber:
                                  value === "importacion"
                                    ? current.dmcDuaNumber
                                    : "",
                                dmcImportOutsideCentralAmerica:
                                  value === "importacion"
                                    ? current.dmcImportOutsideCentralAmerica
                                    : false,
                              }))
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="local">
                                Mercado interno (527-52)
                              </SelectItem>
                              <SelectItem value="fyduca">
                                FYDUCA (527-53)
                              </SelectItem>
                              <SelectItem value="importacion">
                                Importación (527-54)
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        {invoiceDraft.dmcForeignSection ? (
                          <div className="space-y-2">
                            <Label>Identificación extranjera</Label>
                            <Input
                              value={invoiceDraft.dmcForeignIdentification}
                              disabled={!canEditSelectedInvoice}
                              onChange={event =>
                                updateInvoiceDraft(current => ({
                                  ...current,
                                  dmcForeignIdentification: event.target.value,
                                }))
                              }
                              maxLength={100}
                            />
                          </div>
                        ) : null}
                        {invoiceDraft.dmcForeignSection === "fyduca" ? (
                          <div className="space-y-2">
                            <Label>Número FYDUCA</Label>
                            <Input
                              value={invoiceDraft.dmcFyducaNumber}
                              disabled={!canEditSelectedInvoice}
                              onChange={event =>
                                updateInvoiceDraft(current => ({
                                  ...current,
                                  dmcFyducaNumber: event.target.value,
                                }))
                              }
                              maxLength={100}
                            />
                          </div>
                        ) : null}
                        {invoiceDraft.dmcForeignSection === "importacion" ? (
                          <>
                            <div className="space-y-2">
                              <Label>Número DUA</Label>
                              <Input
                                value={invoiceDraft.dmcDuaNumber}
                                disabled={!canEditSelectedInvoice}
                                onChange={event =>
                                  updateInvoiceDraft(current => ({
                                    ...current,
                                    dmcDuaNumber: event.target.value,
                                  }))
                                }
                                maxLength={100}
                              />
                            </div>
                            <label className="flex items-center gap-2 self-end pb-2 text-sm font-medium">
                              <Checkbox
                                checked={
                                  invoiceDraft.dmcImportOutsideCentralAmerica
                                }
                                disabled={!canEditSelectedInvoice}
                                onCheckedChange={checked =>
                                  updateInvoiceDraft(current => ({
                                    ...current,
                                    dmcImportOutsideCentralAmerica:
                                      checked === true,
                                  }))
                                }
                              />
                              Fuera de la región centroamericana
                            </label>
                          </>
                        ) : null}
                      </div>
                    </div>
                    <div className="grid min-w-0 gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                      <div className="space-y-2">
                        <Label>Número documento</Label>
                        <Input
                          value={invoiceDraft.invoiceNumber}
                          readOnly={!canEditSelectedInvoice}
                          aria-readonly={!canEditSelectedInvoice}
                          onChange={event =>
                            updateInvoiceDraft(current => ({
                              ...current,
                              invoiceNumber: current.isFiscalDocument
                                ? formatInvoiceNumberInput(event.target.value)
                                : event.target.value,
                            }))
                          }
                          placeholder={
                            invoiceDraft.isFiscalDocument
                              ? INVOICE_NUMBER_FORMAT_EXAMPLE
                              : "Ej. INV-EXT-001"
                          }
                          inputMode={
                            invoiceDraft.isFiscalDocument ? "numeric" : "text"
                          }
                          maxLength={
                            invoiceDraft.isFiscalDocument
                              ? INVOICE_NUMBER_FORMAT_EXAMPLE.length
                              : undefined
                          }
                        />
                      </div>
                      <div className="space-y-2 md:col-span-2">
                        <Label>
                          {invoiceDraft.isFiscalDocument
                            ? "CAI"
                            : "CAI / referencia"}
                        </Label>
                        <Input
                          value={invoiceDraft.cai}
                          disabled={!canEditSelectedInvoice}
                          onChange={event =>
                            updateInvoiceDraft(current => ({
                              ...current,
                              cai: current.isFiscalDocument
                                ? formatCaiInput(event.target.value)
                                : event.target.value,
                            }))
                          }
                          placeholder={
                            invoiceDraft.isFiscalDocument
                              ? CAI_FORMAT_EXAMPLE
                              : "Referencia del documento"
                          }
                          maxLength={
                            invoiceDraft.isFiscalDocument
                              ? CAI_FORMAT_EXAMPLE.length
                              : undefined
                          }
                          autoCapitalize="characters"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Rango autorizado inicial</Label>
                        <Input
                          value={invoiceDraft.documentRangeStart}
                          disabled={!canEditSelectedInvoice}
                          onChange={event =>
                            updateInvoiceDraft(current => ({
                              ...current,
                              documentRangeStart: current.isFiscalDocument
                                ? formatInvoiceNumberInput(event.target.value)
                                : event.target.value,
                            }))
                          }
                          placeholder={
                            invoiceDraft.isFiscalDocument
                              ? INVOICE_NUMBER_FORMAT_EXAMPLE
                              : "Rango autorizado inicial"
                          }
                          inputMode={
                            invoiceDraft.isFiscalDocument ? "numeric" : "text"
                          }
                          maxLength={
                            invoiceDraft.isFiscalDocument
                              ? INVOICE_NUMBER_FORMAT_EXAMPLE.length
                              : undefined
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Rango autorizado final</Label>
                        <Input
                          value={invoiceDraft.documentRangeEnd}
                          disabled={!canEditSelectedInvoice}
                          onChange={event =>
                            updateInvoiceDraft(current => ({
                              ...current,
                              documentRangeEnd: current.isFiscalDocument
                                ? formatInvoiceNumberInput(event.target.value)
                                : event.target.value,
                            }))
                          }
                          placeholder={
                            invoiceDraft.isFiscalDocument
                              ? INVOICE_NUMBER_FORMAT_EXAMPLE
                              : "Rango autorizado final"
                          }
                          inputMode={
                            invoiceDraft.isFiscalDocument ? "numeric" : "text"
                          }
                          maxLength={
                            invoiceDraft.isFiscalDocument
                              ? INVOICE_NUMBER_FORMAT_EXAMPLE.length
                              : undefined
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Fecha documento</Label>
                        <Input
                          type="date"
                          value={invoiceDraft.documentDate}
                          disabled={!canEditSelectedInvoice}
                          onChange={event =>
                            updateInvoiceDraft(current => ({
                              ...current,
                              documentDate: event.target.value,
                            }))
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Fecha vencimiento (crédito)</Label>
                        <Input
                          type="date"
                          value={invoiceDraft.documentDueDate}
                          disabled={!canEditSelectedInvoice}
                          onChange={event =>
                            updateInvoiceDraft(current => ({
                              ...current,
                              documentDueDate: event.target.value,
                            }))
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Fecha contabilización</Label>
                        <Input
                          type="date"
                          value={invoiceDraft.postingDate}
                          disabled={!canEditSelectedInvoice}
                          onChange={event =>
                            updateInvoiceDraft(current => ({
                              ...current,
                              postingDate: event.target.value,
                            }))
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Fecha recepción</Label>
                        <Input
                          type="date"
                          value={invoiceDraft.receiptDate}
                          disabled={!canEditSelectedInvoice}
                          onChange={event =>
                            updateInvoiceDraft(current => ({
                              ...current,
                              receiptDate: event.target.value,
                            }))
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Fecha límite emisión</Label>
                        <Input
                          type="date"
                          value={invoiceDraft.emissionDeadline}
                          disabled={!canEditSelectedInvoice}
                          onChange={event =>
                            updateInvoiceDraft(current => ({
                              ...current,
                              emissionDeadline: event.target.value,
                            }))
                          }
                        />
                      </div>
                    </div>
                    {shouldShowRetentionFiscalData ? (
                      <div className="space-y-3 border-t border-border pt-4">
                        <div>
                          <h3 className="text-sm font-semibold">
                            Datos fiscales del comprobante de retención
                          </h3>
                        </div>
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                          <div className="space-y-2">
                            <Label>
                              Número comprobante
                              {retentionDrafts.length > 0 ? " *" : ""}
                            </Label>
                            <Input
                              value={invoiceDraft.retentionReceiptNumber}
                              disabled={!canEditSelectedInvoice}
                              onChange={event =>
                                updateInvoiceDraft(current => ({
                                  ...current,
                                  retentionReceiptNumber:
                                    formatInvoiceNumberInput(
                                      event.target.value
                                    ),
                                }))
                              }
                              placeholder={
                                RETENTION_DOCUMENT_NUMBER_PLACEHOLDER
                              }
                              inputMode="numeric"
                              maxLength={INVOICE_NUMBER_FORMAT_EXAMPLE.length}
                            />
                          </div>
                          <div className="space-y-2 md:col-span-2">
                            <Label>
                              CAI{retentionDrafts.length > 0 ? " *" : ""}
                            </Label>
                            <Input
                              value={invoiceDraft.retentionCai}
                              disabled={!canEditSelectedInvoice}
                              onChange={event =>
                                updateInvoiceDraft(current => ({
                                  ...current,
                                  retentionCai: formatCaiInput(
                                    event.target.value
                                  ),
                                }))
                              }
                              placeholder={RETENTION_CAI_PLACEHOLDER}
                              maxLength={CAI_FORMAT_EXAMPLE.length}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>
                              Rango autorizado inicial
                              {retentionDrafts.length > 0 ? " *" : ""}
                            </Label>
                            <Input
                              value={invoiceDraft.retentionDocumentRangeStart}
                              disabled={!canEditSelectedInvoice}
                              onChange={event =>
                                updateInvoiceDraft(current => ({
                                  ...current,
                                  retentionDocumentRangeStart:
                                    formatInvoiceNumberInput(
                                      event.target.value
                                    ),
                                }))
                              }
                              placeholder={
                                RETENTION_DOCUMENT_NUMBER_PLACEHOLDER
                              }
                              inputMode="numeric"
                              maxLength={INVOICE_NUMBER_FORMAT_EXAMPLE.length}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>
                              Rango autorizado final
                              {retentionDrafts.length > 0 ? " *" : ""}
                            </Label>
                            <Input
                              value={invoiceDraft.retentionDocumentRangeEnd}
                              disabled={!canEditSelectedInvoice}
                              onChange={event =>
                                updateInvoiceDraft(current => ({
                                  ...current,
                                  retentionDocumentRangeEnd:
                                    formatInvoiceNumberInput(
                                      event.target.value
                                    ),
                                }))
                              }
                              placeholder={
                                RETENTION_DOCUMENT_NUMBER_PLACEHOLDER
                              }
                              inputMode="numeric"
                              maxLength={INVOICE_NUMBER_FORMAT_EXAMPLE.length}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>
                              Fecha límite de emisión
                              {retentionDrafts.length > 0 ? " *" : ""}
                            </Label>
                            <Input
                              type="date"
                              value={invoiceDraft.retentionEmissionDeadline}
                              disabled={!canEditSelectedInvoice}
                              onChange={event =>
                                updateInvoiceDraft(current => ({
                                  ...current,
                                  retentionEmissionDeadline: event.target.value,
                                }))
                              }
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>
                              Fecha del comprobante
                              {retentionDrafts.length > 0 ? " *" : ""}
                            </Label>
                            <Input
                              type="date"
                              value={invoiceDraft.retentionDocumentDate}
                              disabled={!canEditSelectedInvoice}
                              onChange={event =>
                                updateInvoiceDraft(current => ({
                                  ...current,
                                  retentionDocumentDate: event.target.value,
                                }))
                              }
                            />
                          </div>
                        </div>
                      </div>
                    ) : null}
                    <div className="space-y-2">
                      <Label>Notas</Label>
                      <Textarea
                        value={invoiceDraft.notes}
                        disabled={!canEditSelectedInvoice}
                        onChange={event =>
                          updateInvoiceDraft(current => ({
                            ...current,
                            notes: event.target.value,
                          }))
                        }
                        rows={3}
                      />
                    </div>
                    {canEditSelectedInvoice ? (
                      <Button
                        onClick={handleSaveInvoice}
                        variant={invoiceSaveConfirmed ? "outline" : "default"}
                        className={
                          invoiceSaveConfirmed ? SAVED_BUTTON_CLASS : undefined
                        }
                        disabled={
                          updateMutation.isPending || invoiceSaveConfirmed
                        }
                      >
                        {invoiceSaveConfirmed ? (
                          <CheckCircle2 className="mr-2 h-4 w-4" />
                        ) : (
                          <Save className="mr-2 h-4 w-4" />
                        )}
                        {updateMutation.isPending
                          ? "Guardando..."
                          : invoiceSaveConfirmed
                            ? "Factura guardada"
                            : "Guardar factura"}
                      </Button>
                    ) : null}
                  </div>
                </section>

                <Accordion
                  type="single"
                  collapsible
                  className="min-w-0 rounded-lg border border-border/70"
                >
                  <AccordionItem
                    value="document-adjustments"
                    className="border-b-0"
                  >
                    <AccordionTrigger className="px-4 py-3 hover:no-underline">
                      <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-3 pr-2">
                        <div>
                          <h3 className="font-semibold">
                            Retenciones y descuentos por documento
                          </h3>
                          <p className="mt-1 text-xs font-normal text-muted-foreground">
                            Cálculos independientes de las retenciones fiscales
                            y del anticipo aplicado por Tesorería.
                          </p>
                        </div>
                        <div className="text-right text-sm">
                          <p className="font-semibold text-rose-700">
                            Otras retenciones:{" "}
                            {formatSelectedInvoiceCurrency(otherRetentionTotal)}
                          </p>
                          <p className="font-semibold text-amber-700">
                            Descuentos:{" "}
                            {formatSelectedInvoiceCurrency(
                              documentDiscountTotal
                            )}
                          </p>
                        </div>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="space-y-5 border-t border-border/70 p-4">
                      <div className="space-y-3">
                        <div>
                          <h4 className="text-sm font-semibold">
                            Otras retenciones por documento
                          </h4>
                          <p className="text-xs text-muted-foreground">
                            La base corresponde al subtotal de la factura.
                          </p>
                        </div>
                        <DocumentAdjustmentPercentageRow
                          label="Retención de calidad"
                          description="Porcentaje contractual retenido por calidad."
                          baseAmount={toMoneyNumber(detail.invoice.subtotal)}
                          percentage={
                            documentAdjustmentDraft.qualityRetentionInputMode ===
                            "amount"
                              ? documentAdjustmentDraft.qualityRetentionAmount.trim()
                                ? formatDocumentAdjustmentPercent(
                                    qualityRetentionAdjustment?.percentage
                                  )
                                : ""
                              : documentAdjustmentDraft.qualityRetentionPercent
                          }
                          amount={
                            documentAdjustmentDraft.qualityRetentionInputMode ===
                            "amount"
                              ? documentAdjustmentDraft.qualityRetentionAmount
                              : formatDocumentAdjustmentAmount(
                                  qualityRetentionAdjustment?.amount
                                )
                          }
                          currencySymbol={getPurchaseCurrencySymbol(
                            selectedInvoiceCurrency
                          )}
                          disabled={!canEditDocumentAdjustments}
                          onPercentageChange={value =>
                            updateDocumentAdjustmentDraft(current => ({
                              ...current,
                              qualityRetentionPercent: value,
                              qualityRetentionInputMode: "percentage",
                            }))
                          }
                          onAmountChange={value =>
                            updateDocumentAdjustmentDraft(current => ({
                              ...current,
                              qualityRetentionAmount: value,
                              qualityRetentionInputMode: "amount",
                            }))
                          }
                        />
                        {isAccounted && qualityReleaseOverview?.adjustment ? (
                          <div className="rounded-lg border border-blue-200 bg-blue-50/60 p-3">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <p className="text-sm font-semibold text-blue-950">
                                  Liberación y pago posterior
                                </p>
                                <p className="mt-1 text-xs text-blue-800">
                                  La liberación se paga por Tesorería sin
                                  modificar el neto de esta factura.
                                </p>
                              </div>
                              {canRequestQualityRelease ? (
                                <Button
                                  type="button"
                                  size="sm"
                                  onClick={() => {
                                    setQualityReleaseAmount(
                                      Number(
                                        qualityReleaseOverview.summary
                                          .availableAmount
                                      ).toFixed(2)
                                    );
                                    setQualityReleaseDialogOpen(true);
                                  }}
                                >
                                  Solicitar liberación
                                </Button>
                              ) : null}
                            </div>
                            <div className="mt-3 grid grid-cols-2 gap-2 text-sm md:grid-cols-5">
                              {[
                                [
                                  "Original",
                                  qualityReleaseOverview.summary.originalAmount,
                                ],
                                [
                                  "Solicitado",
                                  qualityReleaseOverview.summary
                                    .requestedAmount,
                                ],
                                [
                                  "Aprobado",
                                  qualityReleaseOverview.summary.approvedAmount,
                                ],
                                [
                                  "Pagado",
                                  qualityReleaseOverview.summary.paidAmount,
                                ],
                                [
                                  "Saldo disponible",
                                  qualityReleaseOverview.summary
                                    .availableAmount,
                                ],
                              ].map(([label, value]) => (
                                <div
                                  key={String(label)}
                                  className="rounded-md bg-white/80 p-2"
                                >
                                  <p className="text-xs text-muted-foreground">
                                    {label}
                                  </p>
                                  <p className="font-semibold">
                                    {formatSelectedInvoiceCurrency(
                                      value as number
                                    )}
                                  </p>
                                </div>
                              ))}
                            </div>
                            {(qualityReleaseOverview.releases ?? []).length >
                            0 ? (
                              <div className="mt-3 space-y-2 border-t border-blue-200 pt-3">
                                {qualityReleaseOverview.releases.map(
                                  release => (
                                    <div
                                      key={release.id}
                                      className="rounded-md bg-white/70 p-2"
                                    >
                                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                                        <span>
                                          Solicitud #{release.id} ·{" "}
                                          {
                                            QUALITY_RETENTION_RELEASE_STATUS_LABELS[
                                              release.status
                                            ]
                                          }
                                        </span>
                                        <span className="font-semibold">
                                          {formatSelectedInvoiceCurrency(
                                            release.approvedAmount ??
                                              release.requestedAmount
                                          )}
                                        </span>
                                      </div>
                                      <DocumentAttachmentsPanel
                                        entityType="quality_retention_release"
                                        entityId={release.id}
                                        title="Respaldo opcional"
                                        canManage={
                                          release.status ===
                                            "pending_approval" &&
                                          (user?.role === "admin" ||
                                            userRole ===
                                              "administrador_proyecto")
                                        }
                                        className="mt-2"
                                      />
                                    </div>
                                  )
                                )}
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                        <DocumentAdjustmentPercentageRow
                          label="Amortización de anticipo"
                          description="Deducción documental independiente del anticipo real de Tesorería."
                          baseAmount={toMoneyNumber(detail.invoice.subtotal)}
                          percentage={
                            documentAdjustmentDraft.advanceAmortizationInputMode ===
                            "amount"
                              ? documentAdjustmentDraft.advanceAmortizationAmount.trim()
                                ? formatDocumentAdjustmentPercent(
                                    advanceAmortizationAdjustment?.percentage
                                  )
                                : ""
                              : documentAdjustmentDraft.advanceAmortizationPercent
                          }
                          amount={
                            documentAdjustmentDraft.advanceAmortizationInputMode ===
                            "amount"
                              ? documentAdjustmentDraft.advanceAmortizationAmount
                              : formatDocumentAdjustmentAmount(
                                  advanceAmortizationAdjustment?.amount
                                )
                          }
                          currencySymbol={getPurchaseCurrencySymbol(
                            selectedInvoiceCurrency
                          )}
                          disabled={!canEditDocumentAdjustments}
                          onPercentageChange={value =>
                            updateDocumentAdjustmentDraft(current => ({
                              ...current,
                              advanceAmortizationPercent: value,
                              advanceAmortizationInputMode: "percentage",
                            }))
                          }
                          onAmountChange={value =>
                            updateDocumentAdjustmentDraft(current => ({
                              ...current,
                              advanceAmortizationAmount: value,
                              advanceAmortizationInputMode: "amount",
                            }))
                          }
                        />
                      </div>

                      <div className="space-y-3 border-t border-border/70 pt-5">
                        <div>
                          <h4 className="text-sm font-semibold">
                            Descuentos por documento
                          </h4>
                          <p className="text-xs text-muted-foreground">
                            Pronto pago usa el subtotal; TC usa únicamente el
                            ISV base gravado.
                          </p>
                        </div>
                        <DocumentAdjustmentPercentageRow
                          label="Pronto pago"
                          description="Porcentaje variable calculado sobre el subtotal."
                          baseAmount={toMoneyNumber(detail.invoice.subtotal)}
                          percentage={
                            documentAdjustmentDraft.promptPaymentInputMode ===
                            "amount"
                              ? documentAdjustmentDraft.promptPaymentAmount.trim()
                                ? formatDocumentAdjustmentPercent(
                                    promptPaymentAdjustment?.percentage
                                  )
                                : ""
                              : documentAdjustmentDraft.promptPaymentPercent
                          }
                          amount={
                            documentAdjustmentDraft.promptPaymentInputMode ===
                            "amount"
                              ? documentAdjustmentDraft.promptPaymentAmount
                              : formatDocumentAdjustmentAmount(
                                  promptPaymentAdjustment?.amount
                                )
                          }
                          currencySymbol={getPurchaseCurrencySymbol(
                            selectedInvoiceCurrency
                          )}
                          disabled={!canEditDocumentAdjustments}
                          onPercentageChange={value =>
                            updateDocumentAdjustmentDraft(current => ({
                              ...current,
                              promptPaymentPercent: value,
                              promptPaymentInputMode: "percentage",
                            }))
                          }
                          onAmountChange={value =>
                            updateDocumentAdjustmentDraft(current => ({
                              ...current,
                              promptPaymentAmount: value,
                              promptPaymentInputMode: "amount",
                            }))
                          }
                        />
                        <div className="grid gap-3 rounded-lg border border-border/70 p-3 md:grid-cols-[minmax(220px,1fr)_150px_130px_150px] md:items-end">
                          <div>
                            <div className="flex items-center gap-3">
                              <Switch
                                checked={documentAdjustmentDraft.tcEnabled}
                                disabled={!canEditDocumentAdjustments}
                                onCheckedChange={checked =>
                                  updateDocumentAdjustmentDraft(current => ({
                                    ...current,
                                    tcEnabled: checked,
                                  }))
                                }
                              />
                              <p className="font-medium">TC</p>
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">
                              Activación manual; tasa fija del 8% sobre el ISV
                              base gravado.
                            </p>
                          </div>
                          <div className="space-y-1.5">
                            <Label>Base ISV</Label>
                            <Input
                              value={formatSelectedInvoiceCurrency(
                                documentBaseIsvAmount
                              )}
                              disabled
                              className="text-right disabled:cursor-default disabled:opacity-100"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label>Porcentaje</Label>
                            <Input
                              value="8.00%"
                              disabled
                              className="text-right disabled:cursor-default disabled:opacity-100"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label>Monto</Label>
                            <Input
                              value={formatSelectedInvoiceCurrency(
                                tcDiscountAdjustment?.amount ?? 0
                              )}
                              disabled
                              className="text-right font-semibold disabled:cursor-default disabled:opacity-100"
                            />
                          </div>
                        </div>
                      </div>

                      {documentAdjustmentsDirty ? (
                        <p className="text-sm font-medium text-amber-700">
                          Hay cambios pendientes de guardar.
                        </p>
                      ) : null}
                      {canEditDocumentAdjustments ? (
                        <Button
                          onClick={handleSaveDocumentAdjustments}
                          variant={
                            documentAdjustmentsSaveConfirmed
                              ? "outline"
                              : "default"
                          }
                          className={
                            documentAdjustmentsSaveConfirmed
                              ? SAVED_BUTTON_CLASS
                              : undefined
                          }
                          disabled={
                            replaceDocumentAdjustmentsMutation.isPending ||
                            !documentAdjustmentsDirty
                          }
                        >
                          {documentAdjustmentsSaveConfirmed ? (
                            <CheckCircle2 className="mr-2 h-4 w-4" />
                          ) : (
                            <Save className="mr-2 h-4 w-4" />
                          )}
                          {replaceDocumentAdjustmentsMutation.isPending
                            ? "Guardando..."
                            : documentAdjustmentsSaveConfirmed
                              ? "Retenciones y descuentos guardados"
                              : "Guardar retenciones y descuentos"}
                        </Button>
                      ) : null}
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>

                <section className="min-w-0 rounded-lg border border-border/70">
                  <div className="border-b border-border/70 px-4 py-3">
                    <h3 className="font-semibold">Detalle de la factura</h3>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[1120px] text-sm">
                      <thead>
                        <tr className="border-b border-border bg-muted/30">
                          <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            Ítem
                          </th>
                          <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            SAP
                          </th>
                          <th className="p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            Cantidad
                          </th>
                          <th className="p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            {detail.invoice.pricesIncludeTax === true
                              ? "Precio unitario (incluye ISV)"
                              : "Precio unitario"}
                          </th>
                          <th className="p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            {detail.invoice.pricesIncludeTax === true
                              ? "Base"
                              : "Subtotal"}
                          </th>
                          <th className="p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            ISV
                          </th>
                          <th className="p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            Total
                          </th>
                          <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            Retención
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.items.map((item: any) => {
                          const lineRetentions = getLineRetentionDrafts(
                            item.id
                          );
                          const availableRetentionOptions =
                            getAvailableLineRetentionOptions(item.id);
                          const canAddLineRetention =
                            canEditRetentions &&
                            lineRetentions.length < 2 &&
                            availableRetentionOptions.length > 0;
                          const itemAssetDetails = parseFixedAssetDetails(
                            item.assetDetails
                          );
                          const assetBreakdownRows =
                            getInvoiceAssetBreakdownRows(
                              item,
                              itemAssetDetails
                            );
                          const shouldSplitFixedAssetLine =
                            item.isFixedAsset &&
                            Number(item.quantity ?? 0) > 1 &&
                            assetBreakdownRows.length > 1;
                          const showAssetDetails =
                            canEditSelectedInvoice ||
                            item.isFixedAsset ||
                            Boolean(item.lineObservation?.trim());

                          if (shouldSplitFixedAssetLine) {
                            const assetUnitCount = assetBreakdownRows.length;
                            const unitPrice =
                              toNumber(item.unitPrice) ||
                              getInvoiceUnitAmount(
                                item.subtotal,
                                assetUnitCount
                              );
                            const unitSubtotal = getInvoiceUnitAmount(
                              item.subtotal,
                              assetUnitCount
                            );
                            const unitTaxAmount = getInvoiceUnitAmount(
                              item.taxAmount,
                              assetUnitCount
                            );
                            const unitTotal = getInvoiceUnitAmount(
                              item.total,
                              assetUnitCount
                            );

                            return (
                              <Fragment key={item.id}>
                                {assetBreakdownRows.map((asset, index) => {
                                  const displayCode =
                                    getInvoiceAssetDisplayCode(asset, item);
                                  const temporaryCode = String(
                                    asset.temporaryItemCode ?? ""
                                  ).trim();
                                  const showTemporaryCode =
                                    temporaryCode &&
                                    temporaryCode !== displayCode;

                                  return (
                                    <Fragment
                                      key={`${item.id}-asset-line-${index}`}
                                    >
                                      <tr className="border-b border-border">
                                        <td className="p-3 font-medium">
                                          <div>{item.itemName}</div>
                                          <div className="mt-2 flex flex-wrap gap-1.5">
                                            <Badge
                                              variant="outline"
                                              className="border-blue-300 text-blue-700"
                                            >
                                              Activo fijo
                                            </Badge>
                                            {item.isLeasing ? (
                                              <Badge
                                                variant="outline"
                                                className="border-violet-300 text-violet-700"
                                              >
                                                Leasing
                                              </Badge>
                                            ) : null}
                                            <Badge variant="outline">
                                              Unidad {index + 1} de{" "}
                                              {assetUnitCount}
                                            </Badge>
                                            <Badge
                                              variant="outline"
                                              className={getFixedAssetStatusBadgeClass(
                                                asset.fixedAssetStatus
                                              )}
                                            >
                                              {getFixedAssetStatusLabel(
                                                asset.fixedAssetStatus
                                              )}
                                            </Badge>
                                          </div>
                                          {item.lineObservation ? (
                                            <div className="mt-1 text-xs text-muted-foreground">
                                              {item.lineObservation}
                                            </div>
                                          ) : null}
                                        </td>
                                        <td className="p-3 font-mono text-xs">
                                          <div>{displayCode}</div>
                                          {showTemporaryCode ? (
                                            <div className="mt-1 font-sans text-[11px] text-muted-foreground">
                                              Temp: {temporaryCode}
                                            </div>
                                          ) : null}
                                        </td>
                                        <td className="p-3 text-right">
                                          1.00 {item.unit || ""}
                                        </td>
                                        <td className="p-3 text-right">
                                          {formatSelectedInvoiceCurrency(
                                            unitPrice
                                          )}
                                        </td>
                                        <td className="p-3 text-right">
                                          {formatSelectedInvoiceCurrency(
                                            unitSubtotal
                                          )}
                                        </td>
                                        <td className="p-3 text-right">
                                          {formatSelectedInvoiceCurrency(
                                            unitTaxAmount
                                          )}
                                        </td>
                                        <td className="p-3 text-right font-semibold">
                                          {formatSelectedInvoiceCurrency(
                                            unitTotal
                                          )}
                                        </td>
                                        {index === 0 ? (
                                          <InvoiceLineRetentionCell
                                            item={item}
                                            lineRetentions={lineRetentions}
                                            availableRetentionOptions={
                                              availableRetentionOptions
                                            }
                                            canEditRetentions={
                                              canEditRetentions
                                            }
                                            canAddLineRetention={
                                              canAddLineRetention
                                            }
                                            hasPendingRetentions={
                                              retentionsDirty
                                            }
                                            isSavingRetentions={
                                              replaceRetentionsMutation.isPending
                                            }
                                            saveRetentionsDisabled={
                                              incompatibleAccountPaymentRetentions.length >
                                                0 ||
                                              (retentionDrafts.length > 0 &&
                                                !canRetainSelectedInvoice)
                                            }
                                            onAddLineRetention={
                                              handleAddLineRetention
                                            }
                                            onSaveRetentions={
                                              handleSaveRetentions
                                            }
                                          />
                                        ) : (
                                          <td className="min-w-[300px] p-3">
                                            <span className="text-xs text-muted-foreground">
                                              Retención compartida de la línea
                                            </span>
                                          </td>
                                        )}
                                      </tr>
                                      <tr className="border-b border-border bg-muted/10 last:border-0">
                                        <td colSpan={8} className="p-3 pt-0">
                                          <InvoiceAssetUnitDetailsPanel
                                            asset={asset}
                                            unitNumber={index + 1}
                                          />
                                        </td>
                                      </tr>
                                    </Fragment>
                                  );
                                })}
                              </Fragment>
                            );
                          }

                          return (
                            <Fragment key={item.id}>
                              <tr className="border-b border-border">
                                <td className="p-3 font-medium">
                                  <div>{item.itemName}</div>
                                  {item.isFixedAsset ||
                                  item.isLeasing ||
                                  itemAssetDetails.length > 0 ? (
                                    <div className="mt-2 flex flex-wrap gap-1.5">
                                      {item.isFixedAsset ? (
                                        <Badge
                                          variant="outline"
                                          className="border-blue-300 text-blue-700"
                                        >
                                          Activo fijo
                                        </Badge>
                                      ) : null}
                                      {item.isLeasing ? (
                                        <Badge
                                          variant="outline"
                                          className="border-violet-300 text-violet-700"
                                        >
                                          Leasing
                                        </Badge>
                                      ) : null}
                                      {assetBreakdownRows.length > 0 ? (
                                        <Badge variant="outline">
                                          {assetBreakdownRows.length} unidad(es)
                                        </Badge>
                                      ) : null}
                                    </div>
                                  ) : null}
                                  {item.lineObservation ? (
                                    <div className="mt-1 text-xs text-muted-foreground">
                                      {item.lineObservation}
                                    </div>
                                  ) : null}
                                </td>
                                <td className="p-3 font-mono text-xs">
                                  <div>
                                    {item.currentSapItemCode ||
                                      item.originalSapItemCode ||
                                      "—"}
                                  </div>
                                  {assetBreakdownRows.length > 1 ? (
                                    <div className="mt-1 font-sans text-[11px] text-muted-foreground">
                                      Ver códigos por unidad
                                    </div>
                                  ) : null}
                                </td>
                                <td className="p-3 text-right">
                                  {item.quantity} {item.unit || ""}
                                </td>
                                <td className="p-3 text-right">
                                  {formatSelectedInvoiceCurrency(
                                    item.unitPrice
                                  )}
                                </td>
                                <td className="p-3 text-right">
                                  {formatSelectedInvoiceCurrency(item.subtotal)}
                                </td>
                                <td className="p-3 text-right">
                                  {formatSelectedInvoiceCurrency(
                                    item.taxAmount
                                  )}
                                </td>
                                <td className="p-3 text-right font-semibold">
                                  {formatSelectedInvoiceCurrency(item.total)}
                                </td>
                                <InvoiceLineRetentionCell
                                  item={item}
                                  lineRetentions={lineRetentions}
                                  availableRetentionOptions={
                                    availableRetentionOptions
                                  }
                                  canEditRetentions={canEditRetentions}
                                  canAddLineRetention={canAddLineRetention}
                                  hasPendingRetentions={retentionsDirty}
                                  isSavingRetentions={
                                    replaceRetentionsMutation.isPending
                                  }
                                  saveRetentionsDisabled={
                                    incompatibleAccountPaymentRetentions.length >
                                      0 ||
                                    (retentionDrafts.length > 0 &&
                                      !canRetainSelectedInvoice)
                                  }
                                  onAddLineRetention={handleAddLineRetention}
                                  onSaveRetentions={handleSaveRetentions}
                                />
                              </tr>
                              {showAssetDetails ? (
                                <tr className="border-b border-border bg-muted/10 last:border-0">
                                  <td colSpan={8} className="p-3 pt-0">
                                    <InvoiceAssetDetailsEditor
                                      invoiceId={detail.invoice.id}
                                      item={item}
                                      canEdit={canEditSelectedInvoice}
                                    />
                                  </td>
                                </tr>
                              ) : null}
                            </Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {detail.otherCharges?.length ? (
                    <div className="border-t border-border/70 px-4 py-3">
                      <h4 className="text-sm font-semibold">Otros cargos</h4>
                      <div className="mt-2 divide-y divide-border/70 rounded-lg border border-border/70">
                        {detail.otherCharges.map((charge: any) => (
                          <div
                            key={charge.id}
                            className="grid grid-cols-[1fr_auto] gap-3 px-3 py-2 text-sm"
                          >
                            <span className="font-medium">
                              {charge.concept}
                            </span>
                            <span className="font-semibold tabular-nums">
                              {formatSelectedInvoiceCurrency(charge.amount)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  <div className="flex flex-wrap justify-end gap-5 border-t border-border/70 px-4 py-3 text-sm font-semibold">
                    <span>
                      Subtotal:{" "}
                      {formatSelectedInvoiceCurrency(detail.invoice.subtotal)}
                    </span>
                    <span>
                      ISV:{" "}
                      {formatSelectedInvoiceCurrency(detail.invoice.taxAmount)}
                    </span>
                    {invoiceOtherChargesTotal > 0 ? (
                      <span>
                        Otros cargos:{" "}
                        {formatSelectedInvoiceCurrency(
                          invoiceOtherChargesTotal
                        )}
                      </span>
                    ) : null}
                    <span>
                      Total factura:{" "}
                      {formatSelectedInvoiceCurrency(detail.invoice.total)}
                    </span>
                  </div>
                </section>

                <section className="min-w-0 rounded-lg border border-border/70">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 px-4 py-3">
                    <h3 className="font-semibold">Retenciones aplicadas</h3>
                    <span className="text-sm font-semibold">
                      Total retenciones:{" "}
                      {formatSelectedInvoiceCurrency(retentionTotal)}
                    </span>
                  </div>
                  <div className="space-y-3 p-4">
                    {retentionsDirty ? (
                      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-medium text-amber-800">
                        Hay cambios de retenciones pendientes de guardar.
                      </div>
                    ) : null}
                    {!canRetainSelectedInvoice ? (
                      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                        {retentionDisabledReason}
                      </div>
                    ) : null}

                    {incompatibleAccountPaymentRetentions.length > 0 ? (
                      <div className="rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-800">
                        Esta factura contiene retenciones incompatibles con la
                        constancia vigente. Retírelas antes de guardar; solo se
                        permite RT15 (15%).
                      </div>
                    ) : null}

                    {retentionDrafts.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                        Sin retenciones aplicadas.
                      </div>
                    ) : (
                      <div className="overflow-x-auto rounded-lg border border-border/70">
                        <table className="w-full min-w-[720px] text-sm">
                          <thead>
                            <tr className="border-b bg-muted/30">
                              <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                Línea
                              </th>
                              <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                Retención
                              </th>
                              <th className="p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                Base
                              </th>
                              <th className="p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                %
                              </th>
                              <th className="p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                Monto
                              </th>
                              {canEditRetentions ? (
                                <th className="p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                  Quitar
                                </th>
                              ) : null}
                            </tr>
                          </thead>
                          <tbody>
                            {retentionDrafts.map((retention, index) => (
                              <tr
                                key={index}
                                className="border-b last:border-0"
                              >
                                <td className="max-w-[260px] p-3 font-medium">
                                  <span className="line-clamp-2">
                                    {retention.itemName ||
                                      detail.items?.find(
                                        (item: any) =>
                                          item.id === retention.invoiceItemId
                                      )?.itemName ||
                                      "Retención general"}
                                  </span>
                                </td>
                                <td className="p-3">
                                  <Badge
                                    variant="outline"
                                    className={
                                      hasValidAccountPaymentCertificate &&
                                      !isAccountPaymentAllowedRetention({
                                        taxCode: retention.retentionCode,
                                        ratePercent: retention.percentage,
                                      })
                                        ? "border-rose-300 text-rose-700"
                                        : "border-emerald-300 text-emerald-700"
                                    }
                                  >
                                    {retention.retentionCode} -{" "}
                                    {retention.description}
                                  </Badge>
                                </td>
                                <td className="p-3 text-right">
                                  {formatSelectedInvoiceCurrency(
                                    retention.baseAmount
                                  )}
                                </td>
                                <td className="p-3 text-right">
                                  {Number(retention.percentage).toLocaleString(
                                    "es-HN",
                                    { maximumFractionDigits: 4 }
                                  )}
                                  %
                                </td>
                                <td className="p-3 text-right font-semibold">
                                  {formatSelectedInvoiceCurrency(
                                    getRetentionAmount(retention)
                                  )}
                                </td>
                                {canEditRetentions ? (
                                  <td className="p-3 text-right">
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="icon"
                                      onClick={() =>
                                        updateRetentionDrafts(current =>
                                          current.filter(
                                            (_, entryIndex) =>
                                              entryIndex !== index
                                          )
                                        )
                                      }
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  </td>
                                ) : null}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {canEditSelectedInvoice ? (
                      <Button
                        onClick={handleSaveRetentions}
                        variant={
                          retentionsSaveConfirmed ? "outline" : "default"
                        }
                        className={
                          retentionsSaveConfirmed
                            ? SAVED_BUTTON_CLASS
                            : undefined
                        }
                        disabled={
                          replaceRetentionsMutation.isPending ||
                          retentionsSaveConfirmed ||
                          incompatibleAccountPaymentRetentions.length > 0 ||
                          (retentionDrafts.length > 0 &&
                            !canRetainSelectedInvoice)
                        }
                      >
                        {retentionsSaveConfirmed ? (
                          <CheckCircle2 className="mr-2 h-4 w-4" />
                        ) : (
                          <Save className="mr-2 h-4 w-4" />
                        )}
                        {replaceRetentionsMutation.isPending
                          ? "Guardando..."
                          : retentionsSaveConfirmed
                            ? "Retenciones guardadas"
                            : "Guardar retenciones"}
                      </Button>
                    ) : null}
                  </div>
                </section>

                <DocumentAttachmentsPanel
                  entityType="invoice"
                  entityId={selectedId}
                  category="factura"
                  canManage={canManageInvoiceAttachments}
                  onStateChange={handleInvoiceAttachmentsState}
                />
              </main>

              <aside className="min-w-0 space-y-4 xl:sticky xl:top-4 xl:self-start">
                <section
                  className={`rounded-lg border p-4 text-sm ${
                    supplierSubjectToAccountPayments
                      ? "border-blue-200 bg-blue-50 text-blue-800"
                      : "border-amber-200 bg-amber-50 text-amber-800"
                  }`}
                >
                  <p className="font-semibold">
                    {supplierSubjectToAccountPayments
                      ? "Proveedor sujeto a pagos a cuenta"
                      : "Proveedor no sujeto a pagos a cuenta"}
                  </p>
                  <p className="mt-1">
                    {retentionPolicy === "rt15_only"
                      ? "La constancia vigente permite únicamente la retención RT15 (15%)."
                      : supplierAllowsTaxWithholding
                        ? "Permite aplicar retenciones según normativa vigente."
                        : "No permite retenciones para este proveedor."}
                  </p>
                </section>

                {canAccountSelectedInvoice ? (
                  <section className="rounded-lg border border-border/70 p-4">
                    <h3 className="font-semibold">Comentario contable</h3>
                    <Textarea
                      className="mt-3"
                      value={accountingComment}
                      onChange={event =>
                        setAccountingComment(event.target.value)
                      }
                      rows={3}
                      maxLength={2000}
                    />
                  </section>
                ) : null}

                <section className="rounded-lg border border-border/70 p-4">
                  <h3 className="font-semibold">Resumen de la factura</h3>
                  <div className="mt-4 space-y-2.5">
                    <div className="flex justify-between gap-3 text-sm">
                      <span className="text-muted-foreground">Subtotal</span>
                      <span className="font-medium">
                        {formatSelectedInvoiceCurrency(detail.invoice.subtotal)}
                      </span>
                    </div>
                    <div className="flex justify-between gap-3 text-sm">
                      <span className="text-muted-foreground">ISV</span>
                      <span className="font-medium">
                        {formatSelectedInvoiceCurrency(
                          detail.invoice.taxAmount
                        )}
                      </span>
                    </div>
                    {invoiceOtherChargesTotal > 0 ? (
                      <div className="flex justify-between gap-3 text-sm">
                        <span className="text-muted-foreground">
                          Otros cargos
                        </span>
                        <span className="font-medium">
                          {formatSelectedInvoiceCurrency(
                            invoiceOtherChargesTotal
                          )}
                        </span>
                      </div>
                    ) : null}
                    <div className="flex justify-between gap-3 border-b border-border pb-2 text-sm">
                      <span className="text-muted-foreground">
                        Total factura
                      </span>
                      <span className="font-semibold">
                        {formatSelectedInvoiceCurrency(detail.invoice.total)}
                      </span>
                    </div>
                    <div className="flex justify-between gap-3 text-sm">
                      <span className="font-medium text-rose-700">
                        (-) Retenciones fiscales
                      </span>
                      <span className="font-semibold text-rose-700">
                        {formatSelectedInvoiceCurrency(retentionTotal)}
                      </span>
                    </div>
                    <div className="flex justify-between gap-3 text-sm">
                      <span className="font-medium text-rose-700">
                        (-) Otras retenciones
                      </span>
                      <span className="font-semibold text-rose-700">
                        {formatSelectedInvoiceCurrency(otherRetentionTotal)}
                      </span>
                    </div>
                    <div className="flex justify-between gap-3 text-sm">
                      <span className="font-medium text-amber-700">
                        (-) Descuentos por documento
                      </span>
                      <span className="font-semibold text-amber-700">
                        {formatSelectedInvoiceCurrency(documentDiscountTotal)}
                      </span>
                    </div>
                    <div className="flex justify-between gap-3 border-t border-border pt-3 text-base font-semibold">
                      <span>Neto a pagar</span>
                      <span className="text-emerald-700">
                        {formatSelectedInvoiceCurrency(adjustedNetPayable)}
                      </span>
                    </div>
                    {hasRegisteredSupplierAdvance ? (
                      <div className="rounded-md border border-blue-200 bg-blue-50 p-2.5 text-blue-800">
                        <div className="flex justify-between gap-3 text-sm">
                          <span className="font-medium">
                            Anticipo a proveedor registrado
                          </span>
                          <span className="font-semibold">
                            {formatSelectedInvoiceCurrency(
                              registeredSupplierAdvanceAmount
                            )}
                          </span>
                        </div>
                        <p className="mt-1 text-xs">
                          {isPendingAdvanceApplication
                            ? "El monto contabilizado disponible ya está incluido en el saldo pendiente mostrado y se aplicará definitivamente al contabilizar la factura."
                            : "Dato informativo de la orden de compra. Solo el monto contabilizado y aplicado reduce el saldo pendiente."}
                        </p>
                      </div>
                    ) : null}
                    <div className="flex justify-between gap-3 text-sm">
                      <span className="font-medium text-blue-700">
                        (-) Anticipo aplicado
                        {isPendingAdvanceApplication ? " al contabilizar" : ""}
                      </span>
                      <span className="font-semibold text-blue-700">
                        {formatSelectedInvoiceCurrency(
                          displayedAppliedAdvanceAmount
                        )}
                      </span>
                    </div>
                    {showTreasuryPaymentStatus ? (
                      <>
                        <div className="flex items-center justify-between gap-3 border-t border-border pt-3 text-sm">
                          <span className="font-medium">Estado de pago</span>
                          <Badge
                            variant="outline"
                            className={treasuryPaymentStatusClass}
                          >
                            {treasuryPaymentStatusLabel}
                          </Badge>
                        </div>
                        <div className="flex justify-between gap-3 text-sm">
                          <span className="font-medium text-blue-700">
                            (-) Pagado en Tesorería
                          </span>
                          <span className="font-semibold text-blue-700">
                            {formatSelectedInvoiceCurrency(treasuryPaidAmount)}
                          </span>
                        </div>
                        {treasuryPayments.length > 0 ? (
                          <div className="flex items-start justify-between gap-3 text-sm">
                            <span className="font-medium text-muted-foreground">
                              Lote de Tesorería
                            </span>
                            <div className="flex flex-col items-end gap-1">
                              {treasuryPayments.map(payment =>
                                canOpenTreasuryBatches ? (
                                  <button
                                    key={payment.batchId}
                                    type="button"
                                    className="font-semibold text-primary underline-offset-4 hover:underline"
                                    onClick={() =>
                                      setLocation(
                                        `/tesoreria?lote=${payment.batchId}`
                                      )
                                    }
                                  >
                                    {payment.batchNumber}
                                  </button>
                                ) : (
                                  <span
                                    key={payment.batchId}
                                    className="font-semibold"
                                  >
                                    {payment.batchNumber}
                                  </span>
                                )
                              )}
                            </div>
                          </div>
                        ) : null}
                      </>
                    ) : null}
                    <div className="flex justify-between gap-3 border-t border-border pt-3 text-base font-semibold">
                      <span>Saldo pendiente</span>
                      <span>
                        {formatSelectedInvoiceCurrency(
                          balanceAfterTreasuryPayments
                        )}
                      </span>
                    </div>
                  </div>
                </section>

                <section className="rounded-lg border border-border/70 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-semibold">Detalle de retenciones</h3>
                    {retentionDrafts.length > 0 ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handlePrintRetentionCertificate}
                      >
                        <Printer className="mr-2 h-4 w-4" />
                        Imprimir
                      </Button>
                    ) : null}
                  </div>
                  {retentionDrafts.length === 0 ? (
                    <p className="mt-3 text-sm text-muted-foreground">
                      Sin retenciones aplicadas.
                    </p>
                  ) : (
                    <div className="mt-3 space-y-2">
                      <div className="flex items-start justify-between gap-3 text-sm">
                        <span className="text-muted-foreground">
                          Comprobante
                        </span>
                        <span className="text-right font-medium">
                          {invoiceDraft.retentionReceiptNumber || "Pendiente"}
                        </span>
                      </div>
                      <div className="grid gap-2 border-t border-border pt-3 text-sm sm:grid-cols-2">
                        <div>
                          <span className="block text-xs text-muted-foreground">
                            CAI
                          </span>
                          <span className="font-medium">
                            {invoiceDraft.retentionCai || "Pendiente"}
                          </span>
                        </div>
                        <div>
                          <span className="block text-xs text-muted-foreground">
                            Fecha límite de emisión
                          </span>
                          <span className="font-medium">
                            {formatDateLabel(
                              invoiceDraft.retentionEmissionDeadline
                            )}
                          </span>
                        </div>
                        <div>
                          <span className="block text-xs text-muted-foreground">
                            Rango autorizado inicial
                          </span>
                          <span className="font-medium">
                            {invoiceDraft.retentionDocumentRangeStart ||
                              "Pendiente"}
                          </span>
                        </div>
                        <div>
                          <span className="block text-xs text-muted-foreground">
                            Rango autorizado final
                          </span>
                          <span className="font-medium">
                            {invoiceDraft.retentionDocumentRangeEnd ||
                              "Pendiente"}
                          </span>
                        </div>
                      </div>
                      {retentionDrafts.map((retention, index) => (
                        <div
                          key={`${retention.retentionCatalogId}-${index}`}
                          className="flex items-start justify-between gap-3 text-sm"
                        >
                          <span className="min-w-0">
                            <span className="font-medium">
                              {retention.retentionCode || "Retención"}
                            </span>
                            <span className="block text-muted-foreground">
                              {retention.description}
                            </span>
                          </span>
                          <span className="shrink-0 font-semibold">
                            {formatSelectedInvoiceCurrency(
                              getRetentionAmount(retention)
                            )}
                          </span>
                        </div>
                      ))}
                      <div className="flex justify-between border-t border-border pt-3 text-sm font-semibold">
                        <span>Total retenciones</span>
                        <span>
                          {formatSelectedInvoiceCurrency(retentionTotal)}
                        </span>
                      </div>
                    </div>
                  )}
                </section>

                <section className="rounded-lg border border-border/70 p-4">
                  <h3 className="font-semibold">Información fiscal</h3>
                  <div className="mt-4 space-y-2.5 text-sm">
                    <div className="flex justify-between gap-3">
                      <span className="text-muted-foreground">
                        Proveedor sujeto a pagos a cuenta
                      </span>
                      <Badge
                        variant="outline"
                        className={
                          supplierSubjectToAccountPayments
                            ? "border-emerald-300 text-emerald-700"
                            : "border-slate-300 text-slate-600"
                        }
                      >
                        {supplierSubjectToAccountPayments ? "Sí" : "No"}
                      </Badge>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-muted-foreground">
                        {retentionPolicy === "rt15_only"
                          ? "Retenciones permitidas"
                          : "Permite retención"}
                      </span>
                      <Badge
                        variant="outline"
                        className={
                          retentionPolicy === "rt15_only"
                            ? "border-blue-300 text-blue-700"
                            : supplierAllowsTaxWithholding
                              ? "border-emerald-300 text-emerald-700"
                              : "border-slate-300 text-slate-600"
                        }
                      >
                        {retentionPolicy === "rt15_only"
                          ? "Solo RT15 (15%)"
                          : supplierAllowsTaxWithholding
                            ? "Sí"
                            : "No"}
                      </Badge>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-muted-foreground">
                        Retenciones aplicadas
                      </span>
                      <Badge
                        variant="outline"
                        className={
                          retentionDrafts.length > 0
                            ? "border-emerald-300 text-emerald-700"
                            : "border-slate-300 text-slate-600"
                        }
                      >
                        {retentionDrafts.length > 0 ? "Sí" : "No"}
                      </Badge>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-muted-foreground">
                        Documento fiscal
                      </span>
                      <span className="font-medium">
                        {detail.invoice.isFiscalDocument
                          ? "Fiscal"
                          : "Extranjero"}
                      </span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-muted-foreground">
                        Vencimiento constancia
                      </span>
                      <span className="text-right font-medium">
                        {accountPaymentCertificateLabel}
                      </span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-muted-foreground">
                        Alerta límite emisión factura
                      </span>
                      <span className="font-medium">
                        {getInvoiceHasEmissionDeadlineIssue(detail.invoice)
                          ? "Sí"
                          : "No"}
                      </span>
                    </div>
                  </div>
                </section>

                <section className="rounded-lg border border-border/70 p-4">
                  <h3 className="font-semibold">Historial</h3>
                  <div className="mt-4 space-y-3">
                    {getInvoiceHistoryRows(detail.invoice).map(
                      (entry, index) => (
                        <div
                          key={`${entry.label}-${index}`}
                          className="flex gap-3"
                        >
                          <span
                            className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${
                              entry.state === "danger"
                                ? "bg-rose-500"
                                : entry.state === "done"
                                  ? "bg-emerald-500"
                                  : "bg-muted-foreground/40"
                            }`}
                          />
                          <span className="min-w-0 text-sm">
                            <span className="block font-medium">
                              {entry.label}
                            </span>
                            <span className="text-muted-foreground">
                              {entry.date
                                ? formatDateTimeLabel(entry.date)
                                : "Pendiente"}
                            </span>
                          </span>
                        </div>
                      )
                    )}
                  </div>
                </section>
              </aside>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={qualityReleaseDialogOpen}
        onOpenChange={open => {
          if (!open && !requestQualityReleaseMutation.isPending) {
            setQualityReleaseDialogOpen(false);
          }
        }}
      >
        <DialogContent className="max-w-lg rounded-2xl border-border/70">
          <DialogHeader className="space-y-2">
            <DialogTitle>Solicitar liberación de retención</DialogTitle>
            <DialogDescription>
              Administración Central autorizará el monto. Después quedará
              disponible para un lote de Tesorería.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="quality-release-amount">Monto solicitado *</Label>
            <Input
              id="quality-release-amount"
              type="number"
              min="0.01"
              step="0.01"
              max={Number(qualityReleaseOverview?.summary.availableAmount ?? 0)}
              value={qualityReleaseAmount}
              disabled={requestQualityReleaseMutation.isPending}
              onChange={event => setQualityReleaseAmount(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Disponible:{" "}
              {formatSelectedInvoiceCurrency(
                qualityReleaseOverview?.summary.availableAmount ?? 0
              )}
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="quality-release-justification">
              Justificación *
            </Label>
            <Textarea
              id="quality-release-justification"
              value={qualityReleaseJustification}
              onChange={event =>
                setQualityReleaseJustification(event.target.value)
              }
              rows={4}
              maxLength={4000}
              disabled={requestQualityReleaseMutation.isPending}
              placeholder="Explique el cumplimiento y motivo de la liberación."
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => setQualityReleaseDialogOpen(false)}
              disabled={requestQualityReleaseMutation.isPending}
            >
              Cancelar
            </Button>
            <Button
              onClick={() => {
                if (!selectedId) return;
                requestQualityReleaseMutation.mutate({
                  invoiceId: selectedId,
                  requestedAmount: Number(qualityReleaseAmount),
                  justification: qualityReleaseJustification,
                });
              }}
              disabled={
                requestQualityReleaseMutation.isPending ||
                Number(qualityReleaseAmount) <= 0 ||
                qualityReleaseJustification.trim().length < 5
              }
            >
              {requestQualityReleaseMutation.isPending
                ? "Enviando..."
                : "Enviar solicitud"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={correctionDialogOpen}
        onOpenChange={open => {
          if (!open && !correctReceiptMutation.isPending) {
            setCorrectionDialogOpen(false);
            setCorrectionReason("");
          }
        }}
      >
        <DialogContent className="max-w-lg rounded-2xl border-border/70">
          <DialogHeader className="space-y-2">
            <DialogTitle>Corregir recepción</DialogTitle>
            <DialogDescription>
              La factura y la recepción original quedarán anuladas. El sistema
              devolverá las entradas de inventario, restará cantidades recibidas
              y creará una nueva recepción en borrador.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
            Si algún ítem ya no tiene existencia suficiente en su bodega, la
            corrección se bloqueará y no se hará ningún cambio.
          </div>
          <div className="space-y-2">
            <Label htmlFor="invoice-correction-reason">
              Motivo de corrección *
            </Label>
            <Textarea
              id="invoice-correction-reason"
              value={correctionReason}
              onChange={event => setCorrectionReason(event.target.value)}
              rows={4}
              maxLength={2000}
              disabled={correctReceiptMutation.isPending}
              placeholder="Ej. Cantidad recibida incorrecta, se debe registrar nuevamente."
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setCorrectionDialogOpen(false);
                setCorrectionReason("");
              }}
              disabled={correctReceiptMutation.isPending}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={handleCorrectReceipt}
              disabled={correctReceiptMutation.isPending}
            >
              {correctReceiptMutation.isPending
                ? "Corrigiendo..."
                : "Anular y crear borrador"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={rejectDialogOpen}
        onOpenChange={open => {
          if (!open && !rejectMutation.isPending) {
            setRejectDialogOpen(false);
            setRejectionComment("");
          }
        }}
      >
        <DialogContent className="max-w-lg rounded-2xl border-border/70">
          <DialogHeader className="space-y-2">
            <DialogTitle>Rechazar factura</DialogTitle>
            <DialogDescription>
              Esta factura quedará como rechazada para que administración vea el
              motivo y corrija la información o los adjuntos.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="invoice-rejection-comment">
              Comentario de rechazo *
            </Label>
            <Textarea
              id="invoice-rejection-comment"
              value={rejectionComment}
              onChange={event => setRejectionComment(event.target.value)}
              rows={4}
              maxLength={2000}
              disabled={rejectMutation.isPending}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setRejectDialogOpen(false);
                setRejectionComment("");
              }}
              disabled={rejectMutation.isPending}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={handleRejectInvoice}
              disabled={rejectMutation.isPending}
            >
              {rejectMutation.isPending ? "Rechazando..." : "Confirmar rechazo"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
