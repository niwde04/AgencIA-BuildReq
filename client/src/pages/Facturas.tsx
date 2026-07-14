import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { buildDatedExcelFileName, downloadExcel } from "@/lib/excel-export";
import { getPrintLogoMarkup, printWindowWhenReady } from "@/lib/print-logo";
import { getReadablePrintStyles } from "@/lib/readable-print-styles";
import { DocumentAttachmentsPanel } from "@/components/DocumentAttachmentsPanel";
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
import { isAccountPaymentAllowedRetention } from "@shared/supplier-documents";

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
const RETENTION_CAI_PLACEHOLDER =
  "000000-000000-000000-000000-000000-00";

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
  hasOceExemption: boolean;
  oceResolutionNumber: string;
  oceResolutionDate: string;
  oceExemptAmount: string;
  notes: string;
};

type FiscalRangeAutofill = Pick<
  InvoiceDraft,
  "cai" | "documentRangeStart" | "documentRangeEnd" | "emissionDeadline"
> & {
  invoiceNumber: string;
};

type InvoiceActionFeedback = {
  invoiceSavedId: number | null;
  retentionsSavedId: number | null;
  reviewSentId: number | null;
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
  assetDetails: FixedAssetDetail[];
};

const ASSET_DETAIL_OPTIONAL_FIELDS: Array<{
  key: keyof FixedAssetDetail;
  label: string;
  placeholder: string;
}> = [
  { key: "color", label: "Color", placeholder: "Color" },
  { key: "model", label: "Modelo", placeholder: "Modelo" },
  { key: "brand", label: "Marca", placeholder: "Marca" },
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
  return Array.isArray(item?.fixedAssetArticles)
    ? item.fixedAssetArticles
    : [];
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
          color:
            matchingArticle.fixedAssetColor ?? fallbackDetail?.color ?? "",
          model:
            matchingArticle.fixedAssetModel ?? fallbackDetail?.model ?? "",
          brand:
            matchingArticle.fixedAssetBrand ?? fallbackDetail?.brand ?? "",
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
  const normalized = String(status ?? "").trim().toLowerCase();
  if (normalized === "resuelto") return "Resuelto";
  if (normalized === "pendiente") return "Pendiente";
  return normalized || "Pendiente";
}

function getFixedAssetStatusBadgeClass(status: string | null | undefined) {
  return String(status ?? "").trim().toLowerCase() === "resuelto"
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
  onAddLineRetention,
}: {
  item: any;
  lineRetentions: RetentionDraft[];
  availableRetentionOptions: RetentionOption[];
  canEditRetentions: boolean;
  canAddLineRetention: boolean;
  onAddLineRetention: (item: any, retentionCatalogId: string) => void;
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
            <Badge variant="outline" className="border-amber-300 text-amber-700">
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
        </div>
      ) : (
        <Badge variant="outline" className="border-slate-300 text-slate-600">
          No aplica
        </Badge>
      )}
    </td>
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
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("es-HN");
}

function formatExchangeRateLabel(
  value: string | number | null | undefined
) {
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
    const baseRows = breakdown.filter((entry: any) => entry?.taxType === "base");

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
    new Set(
      users
        .map((user: any) => getUserLabel(user, ""))
        .filter(Boolean)
    )
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
  return (
    Math.round(
      ((toNumber(draft.baseAmount) * toNumber(draft.percentage)) / 100 +
        Number.EPSILON) *
        10000
    ) / 10000
  );
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

function parsePrintDate(value: string | Date | null | undefined) {
  if (!value) return null;
  if (value instanceof Date) return value;

  const normalized = String(value).trim();
  const dateOnlyMatch = normalized.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/);
  if (dateOnlyMatch) {
    const [, year, month, day] = dateOnlyMatch;
    return new Date(Number(year), Number(month) - 1, Number(day));
  }

  return new Date(normalized);
}

function formatRetentionPrintDate(value: string | Date | null | undefined) {
  if (!value) return "";
  const date = parsePrintDate(value);
  if (!date) return "";
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("es-HN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
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
  const unitLabel =
    currency === "USD"
      ? units === 1
        ? "DÓLAR"
        : "DÓLARES"
      : units === 1
        ? "LEMPIRA"
        : "LEMPIRAS";
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
    assetDetails: parseFixedAssetDetails(item.assetDetails),
  });
  const updateAssetDetailsMutation =
    trpc.invoices.updateItemAssetDetails.useMutation({
      onSuccess: () => {
        toast.success("Datos de activo actualizados");
        void utils.invoices.list.invalidate();
        void utils.invoices.getById.invalidate({ id: invoiceId });
      },
      onError: error => toast.error(getFriendlyMutationError(error.message)),
    });

  useEffect(() => {
    setDraft({
      isFixedAsset: item.isFixedAsset === true,
      isLeasing: item.isLeasing === true,
      lineObservation: item.lineObservation ?? "",
      assetDetails: parseFixedAssetDetails(item.assetDetails),
    });
  }, [
    item.id,
    item.isFixedAsset,
    item.isLeasing,
    item.lineObservation,
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
            {assetDetails.map((detail, index) => (
              <div
                key={`${item.id}-asset-${index}`}
                className="rounded-lg border border-border/70 p-3"
              >
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-semibold">
                    Unidad {index + 1}
                  </span>
                  {!canEdit ? (
                    <span className="text-xs text-muted-foreground">
                      {getAssetDetailSummary(detail)}
                    </span>
                  ) : null}
                </div>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <div className="space-y-1.5">
                    <Label>Número de serie</Label>
                    <Input
                      value={detail.serialNumber}
                      disabled={!canEdit}
                      onChange={event =>
                        updateAssetDetail(
                          index,
                          "serialNumber",
                          event.target.value
                        )
                      }
                      placeholder="Serie"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Condición</Label>
                    <Select
                      value={detail.condition}
                      disabled={!canEdit}
                      onValueChange={value =>
                        updateAssetDetail(index, "condition", value)
                      }
                    >
                      <SelectTrigger>
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
                    </div>
                  ))}
                </div>
              </div>
            ))}
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
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const userRole = (user as any)?.buildreqRole;
  const isAccountant = userRole === "contable";
  const canAccountInvoices = isAccountant || user?.role === "admin";
  const canEditInvoices =
    user?.role === "admin" ||
    userRole === "administracion_central" ||
    userRole === "administrador_proyecto";
  const canReviewInvoices = canEditInvoices;
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [isExportingExcel, setIsExportingExcel] = useState(false);
  const [accountingComment, setAccountingComment] = useState("");
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectionComment, setRejectionComment] = useState("");
  const [correctionDialogOpen, setCorrectionDialogOpen] = useState(false);
  const [correctionReason, setCorrectionReason] = useState("");
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
    hasOceExemption: false,
    oceResolutionNumber: "",
    oceResolutionDate: "",
    oceExemptAmount: "",
    notes: "",
  });
  const oceExemptAmountTouchedRef = useRef(false);
  const fiscalRangeAutofillRef = useRef<FiscalRangeAutofill | null>(null);
  const lastFiscalRangeLookupKeyRef = useRef("");
  const [retentionDrafts, setRetentionDrafts] = useState<RetentionDraft[]>([]);
  const [actionFeedback, setActionFeedback] = useState<InvoiceActionFeedback>({
    invoiceSavedId: null,
    retentionsSavedId: null,
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
      setRetentionDrafts(updater);
    },
    [clearRetentionsSavedFeedback]
  );
  const listFilters = useMemo(
    () => ({
      status:
        statusFilter === "all"
          ? undefined
          : (statusFilter as
              | "borrador"
              | "revisada"
              | "rechazada"
              | "registrada"
              | "anulada"),
      search: searchTerm.trim() || undefined,
    }),
    [searchTerm, statusFilter]
  );

  const { data: invoices, isLoading } =
    trpc.invoices.list.useQuery(listFilters);
  const { data: detail, isLoading: detailLoading } =
    trpc.invoices.getById.useQuery(
      { id: selectedId ?? 0 },
      { enabled: selectedId !== null }
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
      void utils.invoices.list.invalidate();
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
  const replaceRetentionsMutation = trpc.invoices.replaceRetentions.useMutation(
    {
      onSuccess: (_data, variables) => {
        toast.success("Retenciones actualizadas");
        setActionFeedback(current => ({
          ...current,
          retentionsSavedId: variables.id,
        }));
        void utils.invoices.list.invalidate();
        void utils.invoices.getById.invalidate({ id: variables.id });
      },
      onError: error => toast.error(getFriendlyMutationError(error.message)),
    }
  );
  const reviewMutation = trpc.invoices.review.useMutation({
    onSuccess: (_data, variables) => {
      toast.success("Factura enviada a revisión");
      setActionFeedback(current => ({
        ...current,
        reviewSentId: variables.id,
      }));
      void utils.invoices.list.invalidate();
      void utils.invoices.getById.invalidate({ id: variables.id });
    },
    onError: error => toast.error(getFriendlyMutationError(error.message)),
  });
  const accountMutation = trpc.invoices.account.useMutation({
    onSuccess: () => {
      toast.success("Factura contabilizada");
      setAccountingComment("");
      void utils.invoices.list.invalidate();
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
      void utils.invoices.list.invalidate();
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
        utils.invoices.list.invalidate(),
        utils.receipts.list.invalidate(),
        utils.purchaseOrders.list.invalidate(),
        utils.materialRequests.list.invalidate(),
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
    setCorrectionDialogOpen(false);
    setCorrectionReason("");
    setActionFeedback({
      invoiceSavedId: null,
      retentionsSavedId: null,
      reviewSentId: null,
    });
  }, [selectedId]);
  useEffect(() => {
    if (!detail?.invoice) return;
    oceExemptAmountTouchedRef.current = false;
    fiscalRangeAutofillRef.current = null;
    lastFiscalRangeLookupKeyRef.current = "";
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
      retentionDocumentRangeEnd:
        detail.invoice.retentionDocumentRangeEnd ?? "",
      retentionEmissionDeadline: dateInputValue(
        detail.invoice.retentionEmissionDeadline
      ),
      hasOceExemption: detail.invoice.hasOceExemption === true,
      oceResolutionNumber: detail.invoice.oceResolutionNumber ?? "",
      oceResolutionDate: dateInputValue(detail.invoice.oceResolutionDate),
      oceExemptAmount: formatMoneyInput(detail.invoice.oceExemptAmount),
      notes: detail.invoice.notes ?? "",
    });
    setRetentionDrafts(
      (detail.retentions ?? []).map((retention: any) => ({
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
      }))
    );
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

  const filteredInvoices = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    return (invoices ?? []).filter((row: any) => {
      const invoice = row.invoice;
      const matchesStatus =
        statusFilter === "all" || invoice.status === statusFilter;
      const requestNumbers = formatInvoiceRequestNumbers(row);
      const requestedByLabel = formatInvoiceRequestedBy(row);
      const createdByLabel = formatInvoiceCreatedBy(row);
      const matchesSearch =
        !normalizedSearch ||
        [
          invoice.invoiceDocumentNumber,
          invoice.invoiceNumber,
          invoice.documentRangeStart,
          invoice.documentRangeEnd,
          invoice.cai,
          row.purchaseOrder?.orderNumber,
          row.receipt?.receiptNumber,
          requestNumbers,
          requestedByLabel,
          createdByLabel,
          row.supplier?.name,
          row.supplier?.supplierCode,
          row.supplier?.rtn,
          row.project ? `${row.project.code} ${row.project.name}` : "",
        ]
          .filter(Boolean)
          .some(value =>
            String(value).toLowerCase().includes(normalizedSearch)
          );

      return matchesStatus && matchesSearch;
    });
  }, [invoices, searchTerm, statusFilter]);

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
  const withholdingBase = (detail?.items ?? [])
    .filter((item: any) => item.allowsTaxWithholding !== false)
    .reduce((sum: number, item: any) => sum + toNumber(item.subtotal), 0);
  const accountPaymentCertificate = detail?.accountPaymentCertificate ?? null;
  const hasValidAccountPaymentCertificate =
    accountPaymentCertificate?.status === "vigente";
  const retentionPolicy =
    detail?.retentionPolicy ??
    (detail?.supplier?.allowsTaxWithholding !== false ? "manual" : "none");
  const supplierAllowsTaxWithholding =
    retentionPolicy === "rt15_only"
      ? false
      : detail?.supplier?.allowsTaxWithholding !== false;
  const supplierSubjectToAccountPayments =
    hasValidAccountPaymentCertificate ||
    detail?.supplier?.subjectToAccountPayments !== false;
  const hasAvailableRt15Retention = retentionOptions.some(option =>
    isAccountPaymentAllowedRetention(option)
  );
  const canRetainSelectedInvoice =
    (retentionPolicy === "rt15_only"
      ? hasAvailableRt15Retention
      : supplierAllowsTaxWithholding) && withholdingBase > 0;
  const retentionDisabledReason =
    retentionPolicy === "rt15_only" && !hasAvailableRt15Retention
      ? "La retención RT15 (15%) no está disponible en el catálogo."
      : retentionPolicy !== "rt15_only" && !supplierAllowsTaxWithholding
        ? "El proveedor no permite retención de impuestos."
        : withholdingBase <= 0
          ? "La factura no tiene líneas habilitadas para retención."
          : "";
  const incompatibleAccountPaymentRetentions =
    hasValidAccountPaymentCertificate
      ? retentionDrafts.filter(
          retention =>
            !isAccountPaymentAllowedRetention({
              taxCode: retention.retentionCode,
              ratePercent: retention.percentage,
            })
        )
      : [];
  const accountPaymentCertificateLabel = !accountPaymentCertificate
    ? "Sin constancia"
    : accountPaymentCertificate.status === "vigente"
      ? `Vigente hasta ${formatDateLabel(accountPaymentCertificate.expirationDate)}`
      : accountPaymentCertificate.status === "futuro"
        ? `Vigente desde ${formatDateLabel(accountPaymentCertificate.documentDate)}`
        : accountPaymentCertificate.status === "vencido"
          ? `Vencida el ${formatDateLabel(accountPaymentCertificate.expirationDate)}`
          : "Sin vencimiento válido";
  const netPayable = Math.max(invoiceTotal - retentionTotal, 0);
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
      invoiceDraft.isFiscalDocument !== false ? "Factura" : "Documento extranjero";
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
        return [
          "Activo fijo:",
          item.fixedAssetSapItemCode,
          item.fixedAssetName,
        ]
          .filter(Boolean)
          .join(" ");
      }
      if (item.targetType === "subproyecto") {
        return item.subProjectId ? `Subproyecto #${item.subProjectId}` : "Subproyecto";
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
      { label: `Total factura ${invoiceSummaryCurrency}`, value: invoice.total },
      {
        label: `Total retenciones ${invoiceSummaryCurrency}`,
        value: retentionTotal,
      },
      {
        label: `Total a pagar ${invoiceSummaryCurrency}`,
        value: netPayable,
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
  const canManageInvoiceAttachments = canReviewInvoices && isDraft;
  const canReviewSelectedInvoice = canReviewInvoices && isDraft;
  const canAccountSelectedInvoice = canAccountInvoices && isReviewed;
  const canCorrectSelectedReceipt =
    canEditInvoices &&
    Boolean(detail?.receipt) &&
    !isAccounted &&
    (isDraft || isReviewed);
  const replacementReceiptId = detail?.receipt?.replacementReceiptId ?? null;
  const invoiceSaveConfirmed =
    selectedId !== null && actionFeedback.invoiceSavedId === selectedId;
  const retentionsSaveConfirmed =
    selectedId !== null && actionFeedback.retentionsSavedId === selectedId;
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
      const exemptAmount = toMoneyNumber(invoiceDraft.oceExemptAmount);
      const invoiceSubtotal = toMoneyNumber(detail?.invoice?.subtotal);
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
    retentionReceiptNumber:
      invoiceDraft.retentionReceiptNumber.trim()
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
    retentionEmissionDeadline: invoiceDraft.retentionEmissionDeadline,
    hasOceExemption: invoiceDraft.hasOceExemption,
    oceResolutionNumber: invoiceDraft.hasOceExemption
      ? invoiceDraft.oceResolutionNumber.trim()
      : undefined,
    oceResolutionDate: invoiceDraft.hasOceExemption
      ? invoiceDraft.oceResolutionDate
      : undefined,
    oceExemptAmount: invoiceDraft.hasOceExemption
      ? String(toMoneyNumber(invoiceDraft.oceExemptAmount))
      : "0",
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
      retentionReceiptNumber:
        invoiceDraft.retentionReceiptNumber.trim()
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
      retentions: retentionDrafts.map(retention => ({
        invoiceItemId: retention.invoiceItemId ?? undefined,
        retentionCatalogId: Number(retention.retentionCatalogId),
        baseAmount: String(toNumber(retention.baseAmount)),
      })),
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
    const retentionCai =
      invoiceDraft.retentionCai.trim() || detail.invoice.retentionCai || "";
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
    const printableRetentions = retentionDrafts.slice(0, 8);

    if (retentionDrafts.length > printableRetentions.length) {
      toast.warning(
        "El formato preimpreso solo tiene espacio para las primeras 8 retenciones"
      );
    }

    const rowsHtml = printableRetentions
      .map((retention, index) => {
        const top = 75.5 + index * 7.7;
        const rate = toNumber(retention.percentage).toLocaleString("es-HN", {
          minimumFractionDigits: 0,
          maximumFractionDigits: 4,
        });
        return `
          <div class="cell row-date" style="top:${top}mm">${escapePrintHtml(documentDate)}</div>
          <div class="cell row-desc" style="top:${top}mm">${escapePrintHtml(retention.description || retention.retentionCode || "Retencion")}</div>
          <div class="cell row-type" style="top:${top}mm">Factura</div>
          <div class="cell row-doc" style="top:${top}mm">${escapePrintHtml(documentNumber)}</div>
          <div class="cell row-base" style="top:${top}mm">${formatRetentionPrintNumber(retention.baseAmount)}</div>
          <div class="cell row-rate" style="top:${top}mm">${escapePrintHtml(rate)}%</div>
          <div class="cell row-amount" style="top:${top}mm">${formatRetentionPrintNumber(getRetentionAmount(retention))}</div>
        `;
      })
      .join("");

    const totalRetained = printableRetentions.reduce(
      (sum, retention) => sum + getRetentionAmount(retention),
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
    <title>Comprobante de retención ${escapePrintHtml(retentionReceiptNumber || invoice.invoiceDocumentNumber)}</title>
    <style>
      @page {
        size: letter;
        margin: 0;
      }
      * {
        box-sizing: border-box;
      }
      body {
        margin: 0;
        font-family: Arial, Helvetica, sans-serif;
        color: #000;
        background: #f3f4f6;
      }
      .screen-toolbar {
        padding: 10px 14px;
        font-size: 12px;
        color: #000;
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
        top: 41.7mm;
        width: 126mm;
        font-weight: 600;
      }
      .supplier-rtn {
        left: 158mm;
        top: 41.7mm;
        width: 47mm;
      }
      .print-date {
        left: 148mm;
        top: 29.7mm;
        width: 48mm;
      }
      .invoice-cai {
        left: 56mm;
        top: 49.8mm;
        width: 143mm;
      }
      .supplier-address {
        left: 25mm;
        top: 57.5mm;
        width: 174mm;
      }
      .row-date {
        left: 9mm;
        width: 19mm;
        text-align: center;
        font-size: 8.4pt;
      }
      .row-desc {
        left: 31mm;
        width: 32mm;
        white-space: normal;
        font-size: 8.2pt;
      }
      .row-type {
        left: 65mm;
        width: 24mm;
        text-align: center;
        font-size: 8.3pt;
      }
      .row-doc {
        left: 91mm;
        width: 39mm;
        text-align: center;
        font-size: 8.2pt;
      }
      .row-base {
        left: 132mm;
        width: 24mm;
        text-align: right;
        font-size: 8.4pt;
      }
      .row-rate {
        left: 159mm;
        width: 17mm;
        text-align: center;
        font-size: 8.4pt;
      }
      .row-amount {
        left: 178mm;
        width: 28mm;
        text-align: right;
        font-size: 8.4pt;
        font-weight: 600;
      }
      .total-retained {
        left: 178mm;
        top: 125.8mm;
        width: 28mm;
        font-size: 9.4pt;
        font-weight: 700;
      }
      .amount-words {
        left: 36mm;
        top: 138.8mm;
        width: 92mm;
        font-size: 8.8pt;
        line-height: 1.18;
        font-weight: 600;
      }
      @media screen {
        .page {
          box-shadow: 0 12px 32px rgba(15, 23, 42, 0.18);
        }
      }
      @media print {
        body {
          background: white;
        }
        .screen-toolbar {
          display: none;
        }
        .page {
          margin: 0;
          box-shadow: none;
        }
      }
    </style>
  </head>
  <body>
    <div class="screen-toolbar">Vista de impresión para formato preimpreso carta. Si el navegador pregunta, usa tamaño Carta y escala 100%.</div>
    <div class="page">
      <div class="field print-date">${escapePrintHtml(documentDate)}</div>
      <div class="field supplier-name">${escapePrintHtml(supplierName)}</div>
      <div class="field supplier-rtn">${escapePrintHtml(supplierRtn)}</div>
      <div class="field invoice-cai">${escapePrintHtml(retentionCai)}</div>
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

  const exportInvoicesExcel = async () => {
    if (isLoading || isExportingExcel) return;

    if (filteredInvoices.length === 0) {
      toast.error("No hay facturas para exportar");
      return;
    }

    setIsExportingExcel(true);
    try {
      await downloadExcel(
        buildDatedExcelFileName("facturas"),
        "Facturas",
        [
          {
            header: "Documento interno",
            value: (row: any) => row.invoice.invoiceDocumentNumber,
            width: 18,
          },
          {
            header: "Número factura",
            value: (row: any) => row.invoice.invoiceNumber || "",
            width: 24,
          },
          {
            header: "Proveedor",
            value: (row: any) =>
              row.supplier
                ? `${row.supplier.supplierCode} - ${row.supplier.name}`
                : "Proveedor pendiente",
            width: 42,
          },
          {
            header: "RTN proveedor",
            value: (row: any) =>
              row.supplier ? formatSupplierRtnLabel(row.supplier) : "",
            width: 18,
          },
          {
            header: "Orden de compra",
            value: (row: any) => row.purchaseOrder?.orderNumber || "",
            width: 18,
          },
          {
            header: "Recepción",
            value: (row: any) => row.receipt?.receiptNumber || "",
            width: 18,
          },
          {
            header: "Requisición",
            value: (row: any) => formatInvoiceRequestNumbers(row),
            width: 22,
          },
          {
            header: "Requiriente",
            value: (row: any) => formatInvoiceRequestedBy(row),
            width: 32,
          },
          {
            header: "Creada por",
            value: (row: any) => formatInvoiceCreatedBy(row),
            width: 32,
          },
          {
            header: "Proyecto",
            value: (row: any) =>
              row.project ? `${row.project.code} - ${row.project.name}` : "",
            width: 36,
          },
          {
            header: "Fecha documento",
            value: (row: any) => formatDateLabel(row.invoice.documentDate),
            width: 16,
          },
          {
            header: "Fecha vencimiento",
            value: (row: any) => formatDateLabel(row.invoice.documentDueDate),
            width: 16,
          },
          {
            header: "Fecha recepción",
            value: (row: any) => formatDateLabel(row.invoice.receiptDate),
            width: 16,
          },
          {
            header: "Límite emisión",
            value: (row: any) => formatDateLabel(row.invoice.emissionDeadline),
            width: 16,
          },
          {
            header: "Moneda",
            value: (row: any) => row.invoice.currency ?? "HNL",
            width: 12,
          },
          {
            header: "Total",
            value: (row: any) => toMoneyNumber(row.invoice.total),
            width: 14,
            numFmt: "#,##0.00",
          },
          {
            header: "Retenciones",
            value: (row: any) => toMoneyNumber(row.invoice.retentionTotal),
            width: 14,
            numFmt: "#,##0.00",
          },
          {
            header: "Neto",
            value: (row: any) => toMoneyNumber(row.invoice.netPayable),
            width: 14,
            numFmt: "#,##0.00",
          },
          {
            header: "Estado",
            value: (row: any) => getInvoiceStatusLabel(row.invoice),
            width: 20,
          },
          {
            header: "Comentario estado",
            value: (row: any) => getInvoiceStatusNote(row.invoice)?.text || "",
            width: 42,
          },
        ],
        filteredInvoices
      );

      toast.success(
        `Se exportaron ${filteredInvoices.length.toLocaleString("es-HN")} factura(s)`
      );
    } catch {
      toast.error("No se pudo exportar el archivo Excel");
    } finally {
      setIsExportingExcel(false);
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
        <Button
          type="button"
          variant="outline"
          onClick={() => void exportInvoicesExcel()}
          disabled={
            isLoading || filteredInvoices.length === 0 || isExportingExcel
          }
          className="gap-2"
        >
          <Download className="h-4 w-4" />
          {isExportingExcel ? "Exportando..." : "Exportar Excel"}
        </Button>
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchTerm}
            onChange={event => setSearchTerm(event.target.value)}
            placeholder="Buscar por factura, OC, recepción, REQ, requiriente, creador, proveedor o proyecto..."
            className="h-10 pl-9"
          />
        </div>
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
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1750px] text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Documento
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
                      Retenciones
                    </th>
                    <th className="p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Neto
                    </th>
                    <th className="min-w-[280px] p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Estado
                    </th>
                    <th className="sticky right-0 z-20 min-w-[104px] border-l border-border/60 bg-muted/30 p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground shadow-[-8px_0_12px_-12px_rgba(0,0,0,0.45)]">
                      Acciones
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredInvoices.map((row: any) => {
                    const statusNote = getInvoiceStatusNote(row.invoice);

                    return (
                      <tr
                        key={row.invoice.id}
                        className="border-b border-border last:border-0"
                      >
                        <td className="p-3">
                          <div className="font-semibold">
                            {row.invoice.invoiceDocumentNumber}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {row.invoice.invoiceNumber ||
                              "Documento sin número"}
                          </div>
                        </td>
                        <td className="p-3">
                          {row.supplier ? (
                            <div className="space-y-1">
                              <div className="font-medium">
                                {row.supplier.supplierCode} —{" "}
                                {row.supplier.name}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                RTN: {formatSupplierRtnLabel(row.supplier)}
                              </div>
                            </div>
                          ) : (
                            "Proveedor pendiente"
                          )}
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
                        <td className="sticky right-0 z-10 min-w-[104px] border-l border-border/60 bg-background p-3 text-right align-top shadow-[-8px_0_12px_-12px_rgba(0,0,0,0.45)]">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setSelectedId(row.invoice.id)}
                          >
                            Ver
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
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
                            : "Enviar a revisión"}
                    </Button>
                  ) : null}
                  {canAccountSelectedInvoice ? (
                    <>
                      <Button
                        onClick={handleAccountInvoice}
                        disabled={accountMutation.isPending}
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
                          retentionPolicy === "rt15_only"
                            ? "border-blue-300 text-blue-700"
                            : supplierAllowsTaxWithholding
                            ? "border-emerald-300 text-emerald-700"
                            : "border-amber-300 text-amber-700"
                        }`}
                      >
                        {retentionPolicy === "rt15_only"
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
                        1 USD = {formatExchangeRateLabel(
                          detail.invoice.exchangeRate
                        )} HNL · {formatDateLabel(
                          detail.invoice.exchangeRateDate
                        )}
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
                            }));
                          }}
                        />
                      </div>
                      {invoiceDraft.hasOceExemption ? (
                        <div className="mt-4 grid min-w-0 gap-3 md:grid-cols-3">
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
                            <Label>Importe exento</Label>
                            <Input
                              type="number"
                              min="0"
                              step="0.01"
                              value={invoiceDraft.oceExemptAmount}
                              disabled={!canEditSelectedInvoice}
                              onChange={event => {
                                oceExemptAmountTouchedRef.current = true;
                                updateInvoiceDraft(current => ({
                                  ...current,
                                  oceExemptAmount: event.target.value,
                                }));
                              }}
                              placeholder="0.00"
                            />
                          </div>
                        </div>
                      ) : null}
                    </div>
                    <div className="grid min-w-0 gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                      <div className="space-y-2">
                        <Label>Número documento</Label>
                        <Input
                          value={invoiceDraft.invoiceNumber}
                          disabled={!canEditSelectedInvoice}
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
                                  formatInvoiceNumberInput(event.target.value),
                              }))
                            }
                            placeholder={RETENTION_DOCUMENT_NUMBER_PLACEHOLDER}
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
                                retentionCai: formatCaiInput(event.target.value),
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
                                  formatInvoiceNumberInput(event.target.value),
                              }))
                            }
                            placeholder={RETENTION_DOCUMENT_NUMBER_PLACEHOLDER}
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
                                  formatInvoiceNumberInput(event.target.value),
                              }))
                            }
                            placeholder={RETENTION_DOCUMENT_NUMBER_PLACEHOLDER}
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
                      </div>
                    </div>
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
                              getInvoiceUnitAmount(item.subtotal, assetUnitCount);
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
                                          {formatSelectedInvoiceCurrency(unitPrice)}
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
                                          {formatSelectedInvoiceCurrency(unitTotal)}
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
                                            onAddLineRetention={
                                              handleAddLineRetention
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
                                  {formatSelectedInvoiceCurrency(item.unitPrice)}
                                </td>
                                <td className="p-3 text-right">
                                  {formatSelectedInvoiceCurrency(item.subtotal)}
                                </td>
                                <td className="p-3 text-right">
                                  {formatSelectedInvoiceCurrency(item.taxAmount)}
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
                                  onAddLineRetention={handleAddLineRetention}
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
                        {formatSelectedInvoiceCurrency(invoiceOtherChargesTotal)}
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
                        {formatSelectedInvoiceCurrency(detail.invoice.taxAmount)}
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
                        (-) Total retenciones
                      </span>
                      <span className="font-semibold text-rose-700">
                        {formatSelectedInvoiceCurrency(retentionTotal)}
                      </span>
                    </div>
                    <div className="flex justify-between gap-3 border-t border-border pt-3 text-base font-semibold">
                      <span>Neto a pagar</span>
                      <span className="text-emerald-700">
                        {formatSelectedInvoiceCurrency(netPayable)}
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
