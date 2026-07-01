import { trpc } from "@/lib/trpc";
import { buildDatedCsvFileName, downloadCsv } from "@/lib/csv-export";
import { DocumentAttachmentsPanel } from "@/components/DocumentAttachmentsPanel";
import {
  FiscalSummaryCard,
  PurchaseOrderTaxControls,
  type PurchaseOrderItemTaxDraft,
} from "@/components/PurchaseOrderFiscalControls";
import {
  formatAttachmentSize,
  prepareDocumentAttachment,
  type PreparedDocumentAttachment,
} from "@/lib/document-attachments";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Check,
  ChevronDown,
  ChevronsUpDown,
  Download,
  Eye,
  AlertTriangle,
  FileText,
  ImageIcon,
  Loader2,
  Pencil,
  Plus,
  Printer,
  RotateCcw,
  Search,
  ShieldX,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { getPrintLogoMarkup, printWindowWhenReady } from "@/lib/print-logo";
import {
  calculatePurchaseOrderLineAmounts,
  DEFAULT_SALES_TAXES,
  formatPurchaseOrderCurrency,
  getPurchaseOrderFiscalSummaryRows,
  getPurchaseOrderContractSummary,
  normalizePurchaseOrderAdditionalTaxCodes,
  normalizePurchaseOrderTaxCode,
  summarizePurchaseOrderLines,
  toPurchaseOrderNumber,
  type PurchaseOrderTaxCode,
  type SalesTaxCatalogItem,
} from "@shared/purchase-orders";
import {
  CAI_FORMAT_EXAMPLE,
  INVOICE_NUMBER_FORMAT_EXAMPLE,
  formatCaiInput,
  EMISSION_DEADLINE_ISSUE_MESSAGE,
  getDocumentTypeLabelFromNumber,
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

const STATUS_LABELS: Record<string, string> = {
  borrador: "Borrador",
  pendiente: "Pendiente",
  parcial: "Parcial",
  completa: "Completa",
  cierre_incompleto: "Cierre incompleto",
  anulada: "Anulada",
};

const STATUS_COLORS: Record<string, string> = {
  borrador: "border-slate-300 bg-slate-50 text-slate-700",
  pendiente: "border-amber-300 bg-amber-50 text-amber-700",
  parcial: "border-cyan-300 bg-cyan-50 text-cyan-700",
  completa: "border-emerald-300 bg-emerald-50 text-emerald-700",
  cierre_incompleto: "border-yellow-300 bg-yellow-50 text-yellow-700",
  anulada: "border-rose-300 bg-rose-50 text-rose-700",
};
const EMISSION_DEADLINE_ISSUE_COLOR =
  "border-rose-300 bg-rose-50 text-rose-700";

const SOURCE_TYPE_LABELS: Record<"purchase_order" | "transfer", string> = {
  purchase_order: "Orden de Compra",
  transfer: "Traslado",
};

const PURCHASE_ORDER_STATUS_LABELS: Record<string, string> = {
  borrador: "Borrador",
  emitida: "Emitida",
  enviada: "Emitida",
  parcialmente_recibida: "Parcialmente recibida",
  recibida: "Recibida",
  anulada: "Anulada",
};

const PURCHASE_ORDER_STATUS_COLORS: Record<string, string> = {
  borrador: "border-slate-300 bg-slate-50 text-slate-700",
  emitida: "border-blue-300 bg-blue-50 text-blue-700",
  enviada: "border-blue-300 bg-blue-50 text-blue-700",
  parcialmente_recibida: "border-cyan-300 bg-cyan-50 text-cyan-700",
  recibida: "border-emerald-300 bg-emerald-50 text-emerald-700",
  anulada: "border-rose-300 bg-rose-50 text-rose-700",
};

const CORRECTABLE_RECEIPT_INVOICE_STATUSES = new Set([
  "borrador",
  "rechazada",
  "revisada",
]);

const TRANSFER_STATUS_LABELS: Record<string, string> = {
  pendiente: "Pendiente",
  confirmado: "Confirmado",
  en_transito: "En tránsito",
  parcialmente_recibido: "Parcialmente recibido",
  recibido: "Recibido",
  cerrado_incompleto: "Cerrado incompleto",
  anulado: "Anulado",
};

const TRANSFER_STATUS_COLORS: Record<string, string> = {
  pendiente: "border-amber-300 bg-amber-50 text-amber-700",
  confirmado: "border-blue-300 bg-blue-50 text-blue-700",
  en_transito: "border-blue-300 bg-blue-50 text-blue-700",
  parcialmente_recibido: "border-cyan-300 bg-cyan-50 text-cyan-700",
  recibido: "border-emerald-300 bg-emerald-50 text-emerald-700",
  cerrado_incompleto: "border-yellow-300 bg-yellow-50 text-yellow-700",
  anulado: "border-rose-300 bg-rose-50 text-rose-700",
};

const TRANSFER_CLOSE_REASONS = [
  { value: "no_se_va_a_recibir", label: "No se va a recibir" },
  { value: "diferencia_despacho", label: "Diferencia de despacho" },
  { value: "devuelto_origen", label: "Devuelto al origen" },
  { value: "error_traslado", label: "Error en traslado" },
  { value: "otro", label: "Otro" },
];

type ReceiptTargetSelection =
  | {
      targetType: "subproyecto";
      subProjectId: number;
      projectId: number;
      label: string;
    }
  | {
      targetType: "activo_fijo";
      projectId: number;
      fixedAssetSapItemCode: string;
      fixedAssetName: string;
      label: string;
    };

type ReceiptFiscalRangeAutofill = {
  invoiceNumber: string;
  cai: string;
  documentRangeStart: string;
  documentRangeEnd: string;
  emissionDeadline: string;
};

function buildSubprojectReceiptTargetSelection(
  subproject: any
): ReceiptTargetSelection {
  return {
    targetType: "subproyecto",
    subProjectId: subproject.id,
    projectId: subproject.projectId,
    label: `Subproyecto: ${subproject.code} - ${subproject.name}`,
  };
}

function buildFixedAssetReceiptTargetSelection(
  asset: any
): ReceiptTargetSelection {
  return {
    targetType: "activo_fijo",
    projectId: asset.projectId,
    fixedAssetSapItemCode: asset.itemCode,
    fixedAssetName: asset.description,
    label: `Activo fijo: ${asset.itemCode} - ${asset.description}`,
  };
}

function mapReceiptLineTargetToSelection(
  item: any,
  projectId?: number | null
): ReceiptTargetSelection | null {
  const target = item?.target;
  if (target?.type === "subproyecto" && target.subProjectId) {
    return {
      targetType: "subproyecto",
      subProjectId: target.subProjectId,
      projectId: target.projectId ?? projectId ?? item?.projectId ?? 0,
      label: target.label ?? `Subproyecto #${target.subProjectId}`,
    };
  }

  if (target?.type === "activo_fijo" && target.fixedAssetSapItemCode) {
    return {
      targetType: "activo_fijo",
      projectId: target.projectId ?? projectId ?? item?.projectId ?? 0,
      fixedAssetSapItemCode: target.fixedAssetSapItemCode,
      fixedAssetName: target.fixedAssetName ?? "",
      label: target.label ?? `Activo fijo: ${target.fixedAssetSapItemCode}`,
    };
  }

  if (item?.targetType === "subproyecto" && item.subProjectId) {
    return {
      targetType: "subproyecto",
      subProjectId: item.subProjectId,
      projectId: projectId ?? item.projectId ?? 0,
      label: `Subproyecto #${item.subProjectId}`,
    };
  }

  if (item?.targetType === "activo_fijo" && item.fixedAssetSapItemCode) {
    return {
      targetType: "activo_fijo",
      projectId: projectId ?? item.projectId ?? 0,
      fixedAssetSapItemCode: item.fixedAssetSapItemCode,
      fixedAssetName: item.fixedAssetName ?? "",
      label: item.fixedAssetName
        ? `Activo fijo: ${item.fixedAssetSapItemCode} - ${item.fixedAssetName}`
        : `Activo fijo: ${item.fixedAssetSapItemCode}`,
    };
  }

  return null;
}

function formatReceiptTargetSummary(selection: ReceiptTargetSelection | null) {
  const label = selection?.label?.trim();
  if (!label) return "";

  return `Destino: ${label.replace(/^(Activo fijo|Subproyecto):\s*/i, "")}`;
}

function normalizeReceiptPrintLabel(value: unknown) {
  const label = String(value ?? "").trim();
  if (
    !label ||
    /^(null|undefined)$/i.test(label) ||
    /^proyecto\s+(null|undefined)$/i.test(label)
  ) {
    return "";
  }
  return label;
}

function formatReceiptWarehouseLabel(detail: any, fallback = "Almacén de ingreso") {
  const itemWarehouseLabels = Array.from(
    new Set(
      (detail?.items || [])
        .map((item: any) => formatReceiptItemWarehouseLabel(item, ""))
        .filter(Boolean)
    )
  );

  if (itemWarehouseLabels.length === 1) return itemWarehouseLabels[0] as string;
  if (itemWarehouseLabels.length > 1) return "Varios almacenes";

  const directWarehouseLabel = normalizeReceiptPrintLabel(
    formatWarehouseReference(detail?.warehouse, "")
  );
  if (directWarehouseLabel) return directWarehouseLabel;

  return fallback;
}

function formatReceiptItemWarehouseLabel(item: any, fallback = "-") {
  return normalizeReceiptPrintLabel(
    formatWarehouseReference(
      item?.warehouse,
      item?.warehouseId ? `Almacén #${item.warehouseId}` : fallback
    )
  );
}

function formatReceiptProjectLabel(detail: any, fallback = "-") {
  if (detail?.project) {
    return `${detail.project.code} ${detail.project.name}`;
  }

  const projectId = Number(detail?.receipt?.projectId);
  if (Number.isInteger(projectId) && projectId > 0) {
    return `Proyecto ${projectId}`;
  }

  return fallback;
}

function getReceiptTargetPayload(selection: ReceiptTargetSelection | null) {
  if (!selection) {
    return {
      targetType: null,
      subProjectId: null,
      fixedAssetSapItemCode: null,
      fixedAssetName: null,
    };
  }

  if (selection.targetType === "subproyecto") {
    return {
      targetType: "subproyecto" as const,
      subProjectId: selection.subProjectId,
      fixedAssetSapItemCode: null,
      fixedAssetName: null,
    };
  }

  return {
    targetType: "activo_fijo" as const,
    subProjectId: null,
    fixedAssetSapItemCode: selection.fixedAssetSapItemCode,
    fixedAssetName: selection.fixedAssetName,
  };
}

function formatReceiptLineTargetLabel(
  item: any,
  sourceItem?: any,
  projectId?: number | null
) {
  return (
    mapReceiptLineTargetToSelection(item, projectId)?.label ??
    mapReceiptLineTargetToSelection(sourceItem, projectId)?.label ??
    null
  );
}

const RECEIVABLE_PURCHASE_ORDER_STATUSES = new Set([
  "emitida",
  "enviada",
  "parcialmente_recibida",
]);
const RECEIVABLE_TRANSFER_STATUSES = new Set([
  "confirmado",
  "en_transito",
  "parcialmente_recibido",
]);

function canReceivePurchaseOrderRow(row: any) {
  const purchaseOrder = row?.purchaseOrder;
  if (!purchaseOrder) return false;
  if (RECEIVABLE_PURCHASE_ORDER_STATUSES.has(purchaseOrder.status)) {
    return true;
  }

  if (!purchaseOrder.appliesContract) return false;
  if (purchaseOrder.status === "anulada") return false;

  const contractSummary = row.contractSummary;
  return Boolean(
    contractSummary &&
      contractSummary.expectedInvoiceCount > 0 &&
      !contractSummary.isExpired &&
      !contractSummary.isFullyInvoiced
  );
}

function todayDateValue() {
  return toLocalDateInputValue(new Date());
}

function toLocalDateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDateLabel(value: string | Date | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("es-HN");
}

function formatDateTimeLabel(value: string | Date | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleString("es-HN", {
        dateStyle: "short",
        timeStyle: "short",
      });
}

function toDateInputValue(value: string | Date | null | undefined) {
  if (!value) return "";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return toLocalDateInputValue(date);
}

function formatQuantity(value: string | number | null | undefined) {
  const numericValue = Number(value ?? 0);
  return Number.isFinite(numericValue)
    ? numericValue.toLocaleString("es-HN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    : "0.00";
}

function formatPrintDate(value: string | Date | null | undefined) {
  if (!value) return "-";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("es-HN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatPrintNumber(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return "0";
  return parsed.toLocaleString("es-HN", {
    minimumFractionDigits: Number.isInteger(parsed) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

function formatPrintMoney(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return "L 0.00";
  return `L ${parsed.toLocaleString("es-HN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatPrintMoneyAmount(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return "0.00";
  return parsed.toLocaleString("es-HN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatMoneyPayload(value: number | string | null | undefined) {
  const parsed = toPurchaseOrderNumber(value);
  return Number.isFinite(parsed) ? parsed.toFixed(4) : "0.0000";
}

function formatMoneyDisplay(value: number | string | null | undefined) {
  const parsed = toPurchaseOrderNumber(value);
  return Number.isFinite(parsed) ? parsed.toFixed(2) : "0.00";
}

function calculateReceiptSubtotalDraftValue(
  quantity: number | string | null | undefined,
  unitPrice: number | string | null | undefined
) {
  return formatMoneyDisplay(
    toPurchaseOrderNumber(quantity) * toPurchaseOrderNumber(unitPrice)
  );
}

function calculateReceiptUnitPriceDraftValue(
  quantity: number | string | null | undefined,
  subtotal: number | string | null | undefined
) {
  const parsedQuantity = toPurchaseOrderNumber(quantity);
  if (parsedQuantity <= 0) return "0.0000";
  return formatMoneyPayload(toPurchaseOrderNumber(subtotal) / parsedQuantity);
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getPendingQuantity(item: any) {
  if (item.receiptClosed) return 0;
  return Math.max(
    Number(item.quantity ?? item.quantityExpected ?? 0) -
      Number(item.receivedQuantity ?? 0) -
      Number(item.returnedToOriginQuantity ?? 0),
    0
  );
}

function canManuallyCloseReceiptLine(item: any) {
  const receivedQuantity = Number(item.receivedQuantity ?? 0);
  const orderedQuantity = Number(item.quantity ?? item.quantityExpected ?? 0);
  return (
    !item.receiptClosed &&
    receivedQuantity > 0 &&
    receivedQuantity < orderedQuantity
  );
}

function getReceiptHasEmissionDeadlineIssue(receipt: any, invoice?: any) {
  return (
    receipt?.sourceType === "purchase_order" &&
    hasEmissionDeadlineIssue({
      isFiscalDocument: receipt.isFiscalDocument,
      documentDate: receipt.documentDate,
      emissionDeadline: invoice?.emissionDeadline,
    })
  );
}

function getReceiptStatusLabel(receipt: any, invoice?: any) {
  if (getReceiptHasEmissionDeadlineIssue(receipt, invoice)) {
    if (receipt.status === "completa") return "Recibida con alerta";
    if (receipt.status === "parcial") return "Parcial con alerta";
    return "Recepción con alerta";
  }

  return STATUS_LABELS[receipt.status] || receipt.status;
}

function getReceiptStatusColor(receipt: any, invoice?: any) {
  return getReceiptHasEmissionDeadlineIssue(receipt, invoice)
    ? EMISSION_DEADLINE_ISSUE_COLOR
    : STATUS_COLORS[receipt.status] || "";
}

function getSourceItemCode(item: any) {
  return (
    item.currentSapItemCode ??
    item.originalSapItemCode ??
    item.sapItemCode ??
    null
  );
}

function isReceiptFixedAssetProduct(item: any) {
  const tipoArticulo = Number(
    item?.tipoArticulo ??
      item?.catalogItem?.tipoArticulo ??
      item?.catalog?.tipoArticulo ??
      0
  );
  const sourceCode = String(getSourceItemCode(item) ?? "")
    .trim()
    .toUpperCase();

  return (
    item?.isFixedAsset === true ||
    Boolean(item?.fixedAssetArticleId) ||
    tipoArticulo === 3 ||
    sourceCode.startsWith("AFT")
  );
}

function getFixedAssetDetailCount(
  value: FixedAssetDetail[] | string | null | undefined
) {
  return parseFixedAssetDetails(value).length;
}

function getReceiptFixedAssetArticles(item: any) {
  return Array.isArray(item?.fixedAssetArticles)
    ? item.fixedAssetArticles
    : [];
}

function getReceiptFixedAssetProgress(item: any, fallbackCount = 0) {
  const fixedAssetArticles = getReceiptFixedAssetArticles(item);
  const expected = Math.max(
    fixedAssetArticles.length,
    getFixedAssetDetailCount(item?.assetDetails),
    fallbackCount
  );
  const resolved = fixedAssetArticles.filter(
    (article: any) => article?.fixedAssetStatus === "resuelto"
  ).length;
  const pending =
    fixedAssetArticles.length > 0
      ? Math.max(expected - resolved, 0)
      : item?.fixedAssetStatus === "resuelto"
        ? 0
        : expected;

  return { expected, resolved, pending };
}

function getReceiptFixedAssetArticleRows(
  item: any,
  assetDetails: FixedAssetDetail[],
  expectedCount: number
) {
  const fixedAssetArticles = getReceiptFixedAssetArticles(item);
  return Array.from(
    {
      length: Math.max(
        expectedCount,
        fixedAssetArticles.length,
        assetDetails.length
      ),
    },
    (_, index) => ({
      article: fixedAssetArticles[index],
      detail: assetDetails[index],
    })
  );
}

function getReceiptFixedAssetArticleDetail(
  article: any,
  detail?: FixedAssetDetail | null
): FixedAssetDetail {
  const condition = article?.fixedAssetCondition ?? detail?.condition;
  return {
    serialNumber: String(
      article?.fixedAssetSerialNumber ?? detail?.serialNumber ?? ""
    ).trim(),
    condition: ASSET_CONDITION_VALUES.includes(condition)
      ? condition
      : "nuevo",
    color: String(article?.fixedAssetColor ?? detail?.color ?? "").trim(),
    model: String(article?.fixedAssetModel ?? detail?.model ?? "").trim(),
    brand: String(article?.fixedAssetBrand ?? detail?.brand ?? "").trim(),
    chassisSeries: String(
      article?.fixedAssetChassisSeries ?? detail?.chassisSeries ?? ""
    ).trim(),
    motorSeries: String(
      article?.fixedAssetMotorSeries ?? detail?.motorSeries ?? ""
    ).trim(),
    plateOrCode: String(
      article?.fixedAssetPlateOrCode ?? detail?.plateOrCode ?? ""
    ).trim(),
  };
}

function getReceiptFixedAssetArticleDisplayCode(
  article: any,
  fallbackCode?: string | null
) {
  const isResolved = article?.fixedAssetStatus === "resuelto";
  const realCode = String(article?.itemCode ?? "").trim();
  const temporaryCode = String(article?.temporaryItemCode ?? "").trim();
  return (
    (isResolved ? realCode : "") ||
    temporaryCode ||
    realCode ||
    String(fallbackCode ?? "").trim() ||
    "—"
  );
}

function isReceiptServiceItem(item: any) {
  return (
    Number(
      item?.tipoArticulo ??
        item?.catalogItem?.tipoArticulo ??
        item?.catalog?.tipoArticulo ??
        0
    ) === 2
  );
}

function isReceiptNonInventoryItem(item: any) {
  const tipoArticulo = Number(
    item?.tipoArticulo ??
      item?.catalogItem?.tipoArticulo ??
      item?.catalog?.tipoArticulo ??
      0
  );
  const sourceCode = String(getSourceItemCode(item) ?? "")
    .trim()
    .toUpperCase();
  return (
    tipoArticulo === 2 ||
    tipoArticulo === 3 ||
    item?.isFixedAsset === true ||
    Boolean(item?.fixedAssetArticleId) ||
    sourceCode.startsWith("AFT")
  );
}

function receiptItemHasStoredFinancials(item: any) {
  return (
    Number(item?.subtotal ?? 0) > 0 ||
    Number(item?.taxAmount ?? 0) > 0 ||
    Number(item?.total ?? 0) > 0
  );
}

function getReceiptLineTaxSummaryInput(item: any, sourceItem?: any) {
  const useStoredFinancials = receiptItemHasStoredFinancials(item);
  return {
    quantity: item.quantityReceived,
    unitPrice: item.unitPrice ?? sourceItem?.unitPrice ?? "0.00",
    taxCode: useStoredFinancials ? item.taxCode : sourceItem?.taxCode,
    additionalTaxCodes: useStoredFinancials
      ? item.additionalTaxCodes
      : sourceItem?.additionalTaxCodes,
    taxBreakdown: useStoredFinancials
      ? item.taxBreakdown
      : sourceItem?.taxBreakdown,
  };
}

function calculateReceiptLineAmounts(item: any, sourceItem?: any) {
  return calculatePurchaseOrderLineAmounts(
    getReceiptLineTaxSummaryInput(item, sourceItem)
  );
}

function formatProjectReference(project: any, fallback: string) {
  return project ? `${project.code} — ${project.name}` : fallback;
}

function formatWarehouseReference(warehouse: any, fallback = "—") {
  if (!warehouse) return fallback;
  return (
    warehouse.displayName ||
    [warehouse.code || warehouse.localCode, warehouse.name]
      .filter(Boolean)
      .join(" - ") ||
    fallback
  );
}

function getProjectWarehouseIds(project: any) {
  const warehouseIds = [
    ...(project?.warehouses ?? []).map((warehouse: any) => warehouse?.id),
    project?.warehouse?.id,
    project?.warehouseId,
  ]
    .map((warehouseId: any) => Number(warehouseId))
    .filter(
      (warehouseId: number) =>
        Number.isInteger(warehouseId) && warehouseId > 0
    );

  return new Set<number>(warehouseIds);
}

function projectUsesWarehouse(project: any, warehouseId?: string | number | null) {
  const selectedWarehouseId = Number(warehouseId);
  if (!Number.isInteger(selectedWarehouseId) || selectedWarehouseId <= 0) {
    return false;
  }
  return getProjectWarehouseIds(project).has(selectedWarehouseId);
}

function formatUserReference(user: any, fallbackId?: number | null) {
  const name = String(user?.name ?? "").trim();
  if (name) return name;

  const email = String(user?.email ?? "").trim();
  if (email) return email;

  return fallbackId ? `Usuario #${fallbackId}` : "Usuario no identificado";
}

function getSourceStatusColor(
  sourceType: "purchase_order" | "transfer",
  status?: string | null
) {
  if (!status) return "";
  return sourceType === "purchase_order"
    ? PURCHASE_ORDER_STATUS_COLORS[status] || ""
    : TRANSFER_STATUS_COLORS[status] || "";
}

function getTransferDestinationLabel(transferDetail: any, fallback: string) {
  if (!transferDetail?.transferRequest) return fallback;
  if (transferDetail.transferRequest.destinationType === "bodega_central") {
    return "Proyecto/bodega destino en recepción";
  }
  return transferDetail.destinationProject
    ? formatProjectReference(transferDetail.destinationProject, fallback)
    : transferDetail.transferRequest.destinationProjectId
      ? `Proyecto ${transferDetail.transferRequest.destinationProjectId}`
      : fallback;
}

function getTransferOriginLabel(transferDetail: any, fallback: string) {
  if (!transferDetail?.transferRequest) return fallback;
  return transferDetail.project
    ? formatProjectReference(transferDetail.project, fallback)
    : transferDetail.transferRequest.projectId
      ? `Proyecto ${transferDetail.transferRequest.projectId}`
      : fallback;
}

function getTransferSourceWarehouseLabel(transferDetail: any, fallback = "—") {
  const labels = Array.from(
    new Set<string>(
      (transferDetail?.items || [])
        .map((item: any) => formatWarehouseReference(item.sourceWarehouse, ""))
        .filter(Boolean)
    )
  );

  if (labels.length === 1) return labels[0];
  if (labels.length > 1) return "Ver origen por línea";
  return formatWarehouseReference(transferDetail?.originWarehouse, fallback);
}

type PendingReceiptAttachment = PreparedDocumentAttachment & {
  id: string;
};

type ReceiptOtherChargeDraft = {
  id: string;
  concept: string;
  amount: string;
};

type ManualReceiptItem = {
  id: number;
  isManualReceiptItem: true;
  sapItemCode: string;
  itemName: string;
  unit?: string | null;
  tipoArticulo?: number | null;
  unitPrice: string;
  taxCode: PurchaseOrderTaxCode;
  additionalTaxCodes: string[];
  quantityExpected: string;
  receivedQuantity: string;
};

const createReceiptOtherChargeDraft = (
  charge?: Partial<ReceiptOtherChargeDraft>
): ReceiptOtherChargeDraft => ({
  id:
    charge?.id ??
    `other-charge-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  concept: charge?.concept ?? "",
  amount: charge?.amount ?? "",
});

function getOtherChargesTotal(
  charges: Array<{ amount: string | number | null | undefined }>
) {
  return charges.reduce((sum, charge) => {
    const amount = Number(charge.amount ?? 0);
    return sum + (Number.isFinite(amount) ? amount : 0);
  }, 0);
}

type ReceiptAssetDraft = {
  isFixedAsset: boolean;
  isLeasing: boolean;
  notes: string;
  assetDetails: FixedAssetDetail[];
};

const emptyReceiptAssetDraft = (): ReceiptAssetDraft => ({
  isFixedAsset: false,
  isLeasing: false,
  notes: "",
  assetDetails: [],
});

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

function formatSupplierRtnLabel(supplier?: any | null) {
  const rtn = String(supplier?.rtn ?? "").trim();
  return rtn || "RTN no configurado";
}

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

export default function Recepciones() {
  const utils = trpc.useUtils();
  const [location, setLocation] = useLocation();
  const { user } = useAuth();
  const receiptAttachmentInputRef = useRef<HTMLInputElement>(null);
  const fiscalRangeAutofillRef = useRef<ReceiptFiscalRangeAutofill | null>(
    null
  );
  const lastFiscalRangeLookupKeyRef = useRef("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [viewReceiptId, setViewReceiptId] = useState<number | null>(null);
  const [editingDraftReceiptId, setEditingDraftReceiptId] = useState<
    number | null
  >(null);
  const [sourceType, setSourceType] = useState<"purchase_order" | "transfer">(
    "purchase_order"
  );
  const [sourceId, setSourceId] = useState("");
  const [notes, setNotes] = useState("");
  const [isFiscalDocument, setIsFiscalDocument] = useState(true);
  const [cai, setCai] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [documentRangeStart, setDocumentRangeStart] = useState("");
  const [documentRangeEnd, setDocumentRangeEnd] = useState("");
  const [documentDate, setDocumentDate] = useState("");
  const [documentDueDate, setDocumentDueDate] = useState("");
  const [postingDate, setPostingDate] = useState(todayDateValue());
  const [receiptDate, setReceiptDate] = useState(todayDateValue());
  const [emissionDeadline, setEmissionDeadline] = useState("");
  const [receivedMap, setReceivedMap] = useState<Record<number, string>>({});
  const [warehouseByItemId, setWarehouseByItemId] = useState<
    Record<number, string>
  >({});
  const [receiptProjectId, setReceiptProjectId] = useState("");
  const [receiptWarehouseId, setReceiptWarehouseId] = useState("");
  const [priceMap, setPriceMap] = useState<Record<number, string>>({});
  const [subtotalMap, setSubtotalMap] = useState<Record<number, string>>({});
  const [taxCodeByItemId, setTaxCodeByItemId] = useState<
    Record<number, PurchaseOrderTaxCode>
  >({});
  const [additionalTaxCodesByItemId, setAdditionalTaxCodesByItemId] = useState<
    Record<number, string[]>
  >({});
  const [targetByItemId, setTargetByItemId] = useState<
    Record<number, ReceiptTargetSelection | null>
  >({});
  const [targetPopoverOpen, setTargetPopoverOpen] = useState<number | null>(
    null
  );
  const [targetSearch, setTargetSearch] = useState("");
  const [otherChargeDrafts, setOtherChargeDrafts] = useState<
    ReceiptOtherChargeDraft[]
  >([]);
  const [manualReceiptItems, setManualReceiptItems] = useState<
    ManualReceiptItem[]
  >([]);
  const [manualItemSearch, setManualItemSearch] = useState("");
  const [manualItemPopoverOpen, setManualItemPopoverOpen] = useState(false);
  const [assetDrafts, setAssetDrafts] = useState<
    Record<number, ReceiptAssetDraft>
  >({});
  const [expandedReceiptDetailItemIds, setExpandedReceiptDetailItemIds] =
    useState<string[]>([]);
  const [
    selectedReceiptFixedAssetArticle,
    setSelectedReceiptFixedAssetArticle,
  ] = useState<any | null>(null);
  const [receiptFixedAssetRealCode, setReceiptFixedAssetRealCode] =
    useState("");
  const [closeReceiptLineItem, setCloseReceiptLineItem] = useState<any | null>(
    null
  );
  const [closeTransferLineItem, setCloseTransferLineItem] = useState<
    any | null
  >(null);
  const [transferClosureDrafts, setTransferClosureDrafts] = useState<
    Record<number, { reason: string; note: string }>
  >({});
  const [transferCloseReason, setTransferCloseReason] = useState(
    TRANSFER_CLOSE_REASONS[0].value
  );
  const [transferCloseNote, setTransferCloseNote] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sourceTypeFilter, setSourceTypeFilter] = useState("all");
  const [pendingReceiptAttachments, setPendingReceiptAttachments] = useState<
    PendingReceiptAttachment[]
  >([]);
  const [preparingReceiptAttachment, setPreparingReceiptAttachment] =
    useState(false);
  const [receiptCorrectionDialogOpen, setReceiptCorrectionDialogOpen] =
    useState(false);
  const [receiptCorrectionReason, setReceiptCorrectionReason] = useState("");

  const { data: receipts, isLoading } = trpc.receipts.list.useQuery();
  const {
    data: receiptDetail,
    isLoading: receiptDetailLoading,
    isError: receiptDetailIsError,
    error: receiptDetailError,
    refetch: refetchReceiptDetail,
  } = trpc.receipts.getById.useQuery(
    { id: viewReceiptId ?? 0 },
    { enabled: viewReceiptId !== null }
  );
  const { data: editingDraftReceiptDetail } = trpc.receipts.getById.useQuery(
    { id: editingDraftReceiptId ?? 0 },
    { enabled: editingDraftReceiptId !== null }
  );
  const { data: purchaseOrders } = trpc.purchaseOrders.list.useQuery();
  const { data: transfers } = trpc.transfers.list.useQuery({
    receivableOnly: true,
  });
  const { data: receiptProjects } = trpc.projects.list.useQuery(
    { status: "activo" },
    {
      enabled: dialogOpen && Boolean(sourceId),
    }
  );
  const { data: salesTaxes } = trpc.taxes.activeOptions.useQuery(undefined, {
    enabled: Boolean(user),
  });
  const activeSalesTaxes = useMemo(
    () =>
      (salesTaxes?.length
        ? salesTaxes
        : DEFAULT_SALES_TAXES) as SalesTaxCatalogItem[],
    [salesTaxes]
  );
  const {
    data: purchaseOrderDetail,
    isLoading: purchaseOrderDetailLoading,
    isFetching: purchaseOrderDetailFetching,
    refetch: refetchPurchaseOrderDetail,
  } = trpc.purchaseOrders.getById.useQuery(
    { id: Number(sourceId) },
    {
      enabled:
        dialogOpen && sourceType === "purchase_order" && Boolean(sourceId),
    }
  );
  const { data: transferDetail, isLoading: transferDetailLoading } =
    trpc.transfers.getById.useQuery(
      { id: Number(sourceId) },
      {
        enabled: dialogOpen && sourceType === "transfer" && Boolean(sourceId),
      }
    );

  const activeSourceDetail =
    sourceType === "purchase_order" ? purchaseOrderDetail : transferDetail;
  const activeSourceLoading =
    sourceType === "purchase_order"
      ? purchaseOrderDetailLoading
      : transferDetailLoading;
  const purchaseOrderContractSummary =
    purchaseOrderDetail?.contractSummary ??
    getPurchaseOrderContractSummary({
      appliesContract: purchaseOrderDetail?.purchaseOrder.appliesContract,
      contractPaymentFrequency:
        purchaseOrderDetail?.purchaseOrder.contractPaymentFrequency,
      contractFirstPaymentDate:
        purchaseOrderDetail?.purchaseOrder.contractFirstPaymentDate,
      contractEndDate: purchaseOrderDetail?.purchaseOrder.contractEndDate,
    });
  const isContractPurchaseOrder =
    sourceType === "purchase_order" &&
    purchaseOrderDetail?.purchaseOrder.appliesContract === true;
  const contractReceiptBlockReason = isContractPurchaseOrder
    ? purchaseOrderContractSummary.isExpired
      ? "El contrato está vencido y ya no permite agregar facturas."
      : purchaseOrderContractSummary.isFullyInvoiced
        ? "La OC de contrato ya alcanzó el total de facturas programadas."
        : purchaseOrderContractSummary.expectedInvoiceCount <= 0
          ? "La OC de contrato no tiene una programación de pagos válida."
          : ""
    : "";

  const {
    data: receiptPurchaseOrderDetail,
    isLoading: receiptPurchaseOrderDetailLoading,
  } = trpc.purchaseOrders.getById.useQuery(
    { id: receiptDetail?.receipt.sourceId ?? 0 },
    {
      enabled:
        viewReceiptId !== null &&
        receiptDetail?.receipt.sourceType === "purchase_order" &&
        Boolean(receiptDetail?.receipt.sourceId),
    }
  );
  const {
    data: receiptTransferDetail,
    isLoading: receiptTransferDetailLoading,
  } = trpc.transfers.getById.useQuery(
    { id: receiptDetail?.receipt.sourceId ?? 0 },
    {
      enabled:
        viewReceiptId !== null &&
        receiptDetail?.receipt.sourceType === "transfer" &&
        Boolean(receiptDetail?.receipt.sourceId),
    }
  );

  const resetForm = () => {
    fiscalRangeAutofillRef.current = null;
    lastFiscalRangeLookupKeyRef.current = "";
    setEditingDraftReceiptId(null);
    setSourceType("purchase_order");
    setSourceId("");
    setNotes("");
    setIsFiscalDocument(true);
    setCai("");
    setInvoiceNumber("");
    setDocumentRangeStart("");
    setDocumentRangeEnd("");
    setDocumentDate("");
    setDocumentDueDate("");
    setPostingDate(todayDateValue());
    setReceiptDate(todayDateValue());
    setEmissionDeadline("");
    setReceivedMap({});
    setWarehouseByItemId({});
    setReceiptProjectId("");
    setReceiptWarehouseId("");
    setPriceMap({});
    setSubtotalMap({});
    setTaxCodeByItemId({});
    setAdditionalTaxCodesByItemId({});
    setTargetByItemId({});
    setTargetPopoverOpen(null);
    setTargetSearch("");
    setOtherChargeDrafts([]);
    setManualReceiptItems([]);
    setManualItemSearch("");
    setManualItemPopoverOpen(false);
    setAssetDrafts({});
    setExpandedReceiptDetailItemIds([]);
    setTransferClosureDrafts({});
    setCloseTransferLineItem(null);
    setTransferCloseReason(TRANSFER_CLOSE_REASONS[0].value);
    setTransferCloseNote("");
    setPendingReceiptAttachments([]);
    setPreparingReceiptAttachment(false);
  };

  useEffect(() => {
    const query = location.includes("?") ? location.split("?")[1] : "";
    const editReceiptId = Number(new URLSearchParams(query).get("editar"));
    if (!Number.isFinite(editReceiptId) || editReceiptId <= 0) return;

    resetForm();
    setViewReceiptId(null);
    setEditingDraftReceiptId(editReceiptId);
    setDialogOpen(true);
    setLocation("/recepciones");
  }, [location, setLocation]);

  useEffect(() => {
    if (viewReceiptId !== null) return;
    setReceiptCorrectionDialogOpen(false);
    setReceiptCorrectionReason("");
  }, [viewReceiptId]);

  const sourceItems = useMemo(
    () =>
      (activeSourceDetail?.items ?? []).filter((item: any) =>
        isContractPurchaseOrder
          ? !item.receiptClosed
          : getPendingQuantity(item) > 0
      ),
    [activeSourceDetail, isContractPurchaseOrder]
  );
  const getReceivableQuantity = (item: any) =>
    isContractPurchaseOrder
      ? Math.max(Number(item.quantity ?? item.quantityExpected ?? 0), 0)
      : getPendingQuantity(item);
  const sourceProjectId =
    sourceType === "purchase_order"
      ? purchaseOrderDetail?.purchaseOrder.projectId
      : transferDetail?.transferRequest?.destinationType === "proyecto"
        ? transferDetail.transferRequest.destinationProjectId
        : transferDetail?.transferRequest?.destinationType === "bodega_central"
          ? transferDetail.transferRequest.projectId
          : undefined;
  const selectedReceiptProjectId = Number(receiptProjectId || 0) || undefined;
  const selectedReceiptProject = (receiptProjects ?? []).find(
    (project: any) => project.id === selectedReceiptProjectId
  );
  const selectedReceiptProjectLabel = selectedReceiptProject
    ? formatProjectReference(selectedReceiptProject, "Proyecto/bodega")
    : selectedReceiptProjectId
      ? `Proyecto ${selectedReceiptProjectId}`
      : "Seleccione proyecto";
  const lockedReceiptProjectId = sourceProjectId;
  const { data: receiptWarehouses } = trpc.warehouses.list.useQuery(
    {
      isActive: true,
    },
    {
      enabled:
        dialogOpen &&
        Boolean(sourceId),
    }
  );
  const receiptWarehouseOptions = useMemo(() => {
    return receiptWarehouses ?? [];
  }, [receiptWarehouses]);
  const getWarehousesForReceiptProject = (project: any | null | undefined) => {
    const warehouses = receiptWarehouseOptions ?? [];
    if (!project) return [];

    const projectWarehouseIds = getProjectWarehouseIds(project);
    if (projectWarehouseIds.size === 0) return [];

    return warehouses.filter((warehouse: any) =>
      projectWarehouseIds.has(Number(warehouse.id))
    );
  };
  const receiptProjectWarehouseOptions = useMemo(
    () => getWarehousesForReceiptProject(selectedReceiptProject),
    [receiptWarehouseOptions, selectedReceiptProject]
  );
  useEffect(() => {
    if (sourceProjectId) {
      setReceiptProjectId(String(sourceProjectId));
      return;
    }

    setReceiptProjectId("");
  }, [sourceId, sourceProjectId]);

  useEffect(() => {
    setExpandedReceiptDetailItemIds([]);
  }, [sourceId, sourceType]);

  const isSameTransferOriginScope = (
    item: any,
    warehouseId?: string | number | null
  ) => {
    if (sourceType !== "transfer") return false;
    const selectedWarehouseId = Number(warehouseId);
    const sourceWarehouseId = Number(item?.sourceWarehouseId);
    if (
      !Number.isInteger(selectedWarehouseId) ||
      selectedWarehouseId <= 0 ||
      !Number.isInteger(sourceWarehouseId) ||
      sourceWarehouseId <= 0 ||
      selectedWarehouseId !== sourceWarehouseId
    ) {
      return false;
    }

    const originProjectId = Number(
      transferDetail?.transferRequest?.projectId ?? 0
    );
    const destinationProjectId = Number(selectedReceiptProjectId ?? 0);
    if (
      !Number.isInteger(originProjectId) ||
      originProjectId <= 0 ||
      !Number.isInteger(destinationProjectId) ||
      destinationProjectId <= 0
    ) {
      return true;
    }

    return originProjectId === destinationProjectId;
  };
  const getDefaultReceiptWarehouseIdForItem = (item: any) => {
    if (
      receiptWarehouseId &&
      receiptProjectWarehouseOptions.some(
        (warehouse: any) => String(warehouse.id) === receiptWarehouseId
      ) &&
      !isSameTransferOriginScope(item, receiptWarehouseId)
    ) {
      return receiptWarehouseId;
    }

    const destinationWarehouseId =
      sourceType === "transfer" && transferDetail?.destinationWarehouse?.id
        ? String(transferDetail.destinationWarehouse.id)
        : "";

    if (
      destinationWarehouseId &&
      lockedReturnDestinationWarehouseId &&
      receiptProjectWarehouseOptions.some(
        (warehouse: any) => String(warehouse.id) === destinationWarehouseId
      ) &&
      !isSameTransferOriginScope(item, destinationWarehouseId)
    ) {
      return destinationWarehouseId;
    }

    return "";
  };
  const lockedReturnDestinationWarehouseId =
    sourceType === "transfer" &&
    transferDetail?.transferRequest?.reverseLogisticId &&
    transferDetail.transferRequest.destinationType === "proyecto" &&
    transferDetail.destinationWarehouse?.id
      ? String(transferDetail.destinationWarehouse.id)
      : "";
  useEffect(() => {
    if (!dialogOpen || !sourceId || !receiptProjectWarehouseOptions.length) {
      setReceiptWarehouseId("");
      return;
    }

    setReceiptWarehouseId(current => {
      const currentIsAvailable =
        current &&
        receiptProjectWarehouseOptions.some(
          (warehouse: any) => String(warehouse.id) === current
        ) &&
        (!lockedReturnDestinationWarehouseId ||
          current === lockedReturnDestinationWarehouseId);

      if (currentIsAvailable) return current;
      if (lockedReturnDestinationWarehouseId) return lockedReturnDestinationWarehouseId;
      return "";
    });
  }, [
    dialogOpen,
    lockedReturnDestinationWarehouseId,
    receiptProjectWarehouseOptions,
    sourceId,
  ]);
  const { data: targetOptions, isLoading: targetOptionsLoading } =
    trpc.materialRequests.targetOptions.useQuery(
      {
        projectId: Number(selectedReceiptProjectId || 0),
        search: targetSearch.trim() || undefined,
      },
      {
        enabled:
          dialogOpen &&
          sourceType === "purchase_order" &&
          Boolean(selectedReceiptProjectId),
      }
    );
  const { data: manualSapResults } =
    trpc.requestItems.searchSapCatalog.useQuery(
      { search: manualItemSearch.trim() },
      {
        enabled:
          dialogOpen &&
          sourceType === "purchase_order" &&
          Boolean(sourceId) &&
          manualItemSearch.trim().length >= 2,
      }
    );
  useEffect(() => {
    if (
      !editingDraftReceiptDetail ||
      editingDraftReceiptDetail.receipt.status !== "borrador"
    ) {
      return;
    }

    const receipt = editingDraftReceiptDetail.receipt;
    setSourceType(receipt.sourceType as "purchase_order" | "transfer");
    setSourceId(String(receipt.sourceId));
    setReceiptProjectId(receipt.projectId ? String(receipt.projectId) : "");
    setNotes(receipt.notes ?? "");
    setIsFiscalDocument(receipt.isFiscalDocument === true);
    setCai(receipt.cai ?? "");
    setInvoiceNumber(receipt.invoiceNumber ?? "");
    setDocumentRangeStart(receipt.documentRangeStart ?? "");
    setDocumentRangeEnd(receipt.documentRangeEnd ?? "");
    setDocumentDate(toDateInputValue(receipt.documentDate));
    setDocumentDueDate(toDateInputValue(receipt.documentDueDate));
    setPostingDate(toDateInputValue(receipt.postingDate) || todayDateValue());
    setReceiptDate(toDateInputValue(receipt.receiptDate) || todayDateValue());
    setEmissionDeadline("");
    setOtherChargeDrafts(
      (editingDraftReceiptDetail.otherCharges ?? []).map((charge: any) =>
        createReceiptOtherChargeDraft({
          id: `draft-charge-${charge.id}`,
          concept: String(charge.concept ?? ""),
          amount: String(charge.amount ?? ""),
        })
      )
    );
    const manualDraftItems =
      receipt.sourceType === "purchase_order"
        ? (editingDraftReceiptDetail.items ?? []).filter(
            (item: any) => !item.sourceItemId && item.sapItemCode
          )
        : [];
    const nextManualItems: ManualReceiptItem[] = manualDraftItems.map(
      (item: any) => ({
        id: -Number(item.id),
        isManualReceiptItem: true,
        sapItemCode: String(item.sapItemCode),
        itemName: String(item.itemName ?? item.sapItemCode),
        unit: item.unit ?? null,
        tipoArticulo:
          typeof item.tipoArticulo === "number"
            ? item.tipoArticulo
            : (item.catalogItem?.tipoArticulo ?? null),
        unitPrice: String(item.unitPrice ?? "0.0000"),
        taxCode: normalizePurchaseOrderTaxCode(item.taxCode, activeSalesTaxes),
        additionalTaxCodes: normalizePurchaseOrderAdditionalTaxCodes(
          item.additionalTaxCodes,
          normalizePurchaseOrderTaxCode(item.taxCode, activeSalesTaxes),
          activeSalesTaxes
        ),
        quantityExpected: String(
          item.quantityExpected ?? item.quantityReceived ?? "0"
        ),
        receivedQuantity: String(item.quantityReceived ?? "0"),
      })
    );
    setManualReceiptItems(nextManualItems);
    if (nextManualItems.length > 0) {
      setReceivedMap(current => ({
        ...current,
        ...Object.fromEntries(
          nextManualItems.map(item => [item.id, item.receivedQuantity])
        ),
      }));
      setPriceMap(current => ({
        ...current,
        ...Object.fromEntries(
          nextManualItems.map(item => [item.id, item.unitPrice])
        ),
      }));
      setSubtotalMap(current => ({
        ...current,
        ...Object.fromEntries(
          nextManualItems.map((item, index) => [
            item.id,
            formatMoneyDisplay(
              manualDraftItems[index]?.subtotal ??
                calculateReceiptSubtotalDraftValue(
                  item.receivedQuantity,
                  item.unitPrice
                )
            ),
          ])
        ),
      }));
      setWarehouseByItemId(current => ({
        ...current,
        ...Object.fromEntries(
          manualDraftItems.map((item: any) => [
            -Number(item.id),
            isReceiptNonInventoryItem(item)
              ? ""
              : item.warehouseId
                ? String(item.warehouseId)
                : receiptWarehouseId,
          ])
        ),
      }));
      setTaxCodeByItemId(current => ({
        ...current,
        ...Object.fromEntries(
          nextManualItems.map(item => [item.id, item.taxCode])
        ),
      }));
      setAdditionalTaxCodesByItemId(current => ({
        ...current,
        ...Object.fromEntries(
          nextManualItems.map(item => [item.id, item.additionalTaxCodes])
        ),
      }));
    }
  }, [activeSalesTaxes, editingDraftReceiptDetail, receiptWarehouseId]);

  useEffect(() => {
    if (!sourceItems.length) {
      setReceivedMap({});
      setWarehouseByItemId({});
      setReceiptProjectId("");
      setReceiptWarehouseId("");
      setPriceMap({});
      setSubtotalMap({});
      setTaxCodeByItemId({});
      setAdditionalTaxCodesByItemId({});
      setTargetByItemId({});
      setAssetDrafts({});
      return;
    }

    const nextMap: Record<number, string> = {};
    const nextPriceMap: Record<number, string> = {};
    const nextSubtotalMap: Record<number, string> = {};
    const nextWarehouseMap: Record<number, string> = {};
    const nextTaxCodeMap: Record<number, PurchaseOrderTaxCode> = {};
    const nextAdditionalTaxCodesMap: Record<number, string[]> = {};
    const nextTargetMap: Record<number, ReceiptTargetSelection | null> = {};
    const draftItemsBySourceId = new Map(
      editingDraftReceiptDetail?.receipt.status === "borrador" &&
      String(editingDraftReceiptDetail.receipt.sourceId) === sourceId
        ? (editingDraftReceiptDetail.items ?? []).map((item: any) => [
            item.sourceItemId,
            item,
          ])
        : []
    );
    for (const item of sourceItems as any[]) {
      const draftItem = draftItemsBySourceId.get(item.id) as any | undefined;
      const isSavedFixedAsset =
        sourceType === "purchase_order" && item.isFixedAsset === true;
      const savedAssetDetailCount = getFixedAssetDetailCount(
        item.assetDetails
      );
      const savedFixedAssetQuantity =
        savedAssetDetailCount ||
        getPositiveIntegerQuantity(getReceivableQuantity(item));
      if (draftItem) {
        const draftAssetDetailCount = getFixedAssetDetailCount(
          draftItem.assetDetails
        );
        const draftFixedAssetQuantity =
          getPositiveIntegerQuantity(draftItem.quantityReceived) ||
          draftAssetDetailCount ||
          (isSavedFixedAsset ? savedFixedAssetQuantity : 0);
        nextMap[item.id] =
          draftItem.isFixedAsset === true
            ? String(draftFixedAssetQuantity)
            : String(draftItem.quantityReceived ?? "0");
      } else {
        nextMap[item.id] = isSavedFixedAsset
          ? String(savedFixedAssetQuantity)
          : String(getReceivableQuantity(item));
      }
      nextPriceMap[item.id] = String(
        draftItem?.unitPrice ?? (item as any).unitPrice ?? "0.00"
      );
      nextSubtotalMap[item.id] = formatMoneyDisplay(
        draftItem?.subtotal ??
          calculateReceiptSubtotalDraftValue(
            nextMap[item.id],
            nextPriceMap[item.id]
          )
      );
      const draftWarehouseId = draftItem?.warehouseId
        ? String(draftItem.warehouseId)
        : "";
      if (
        sourceType === "purchase_order" &&
        isReceiptNonInventoryItem(item)
      ) {
        nextWarehouseMap[item.id] = "";
      } else {
        const draftWarehouseIsAvailable = draftWarehouseId
          ? receiptProjectWarehouseOptions.some(
              (warehouse: any) => String(warehouse.id) === draftWarehouseId
            )
          : false;
        nextWarehouseMap[item.id] =
          draftWarehouseId &&
          draftWarehouseIsAvailable &&
          !isSameTransferOriginScope(item, draftWarehouseId)
            ? draftWarehouseId
            : getDefaultReceiptWarehouseIdForItem(item);
      }
      const taxCode = normalizePurchaseOrderTaxCode(
        draftItem?.taxCode ?? item.taxCode,
        activeSalesTaxes
      );
      nextTaxCodeMap[item.id] = taxCode;
      nextAdditionalTaxCodesMap[item.id] =
        normalizePurchaseOrderAdditionalTaxCodes(
          draftItem?.additionalTaxCodes ?? item.additionalTaxCodes,
          taxCode,
          activeSalesTaxes
        );
      nextTargetMap[item.id] = mapReceiptLineTargetToSelection(
        draftItem ?? item,
        sourceProjectId
      );
    }
    setReceivedMap(nextMap);
    setWarehouseByItemId(nextWarehouseMap);
    const draftWarehouseIds = new Set(
      Object.values(nextWarehouseMap).filter(Boolean)
    );
    if (!receiptWarehouseId && draftWarehouseIds.size === 1) {
      setReceiptWarehouseId(Array.from(draftWarehouseIds)[0]);
    }
    setPriceMap(nextPriceMap);
    setSubtotalMap(nextSubtotalMap);
    setTaxCodeByItemId(nextTaxCodeMap);
    setAdditionalTaxCodesByItemId(nextAdditionalTaxCodesMap);
    setTargetByItemId(nextTargetMap);
    setAssetDrafts(current => {
      const nextDrafts: Record<number, ReceiptAssetDraft> = {};
      for (const item of sourceItems as any[]) {
        const draftItem = draftItemsBySourceId.get(item.id) as any | undefined;
        if (draftItem) {
          const draftAssetCount =
            draftItem.isFixedAsset === true
              ? getPositiveIntegerQuantity(nextMap[item.id]) ||
                getFixedAssetDetailCount(draftItem.assetDetails)
              : 0;
          nextDrafts[item.id] = {
            isFixedAsset: draftItem.isFixedAsset === true,
            isLeasing: draftItem.isLeasing === true,
            notes: String(draftItem.notes ?? ""),
            assetDetails: normalizeFixedAssetDetails(
              draftItem.assetDetails,
              draftAssetCount
            ),
          };
        } else if (
          sourceType === "purchase_order" &&
          item.isFixedAsset === true
        ) {
          const itemAssetCount =
            getPositiveIntegerQuantity(nextMap[item.id]) ||
            getFixedAssetDetailCount(item.assetDetails);
          nextDrafts[item.id] = {
            isFixedAsset: true,
            isLeasing: item.isLeasing === true,
            notes: String(item.lineObservation ?? ""),
            assetDetails: normalizeFixedAssetDetails(
              item.assetDetails,
              itemAssetCount
            ),
          };
        } else {
          nextDrafts[item.id] = current[item.id] ?? emptyReceiptAssetDraft();
        }
      }
      return nextDrafts;
    });
  }, [
    activeSalesTaxes,
    receiptWarehouseId,
    editingDraftReceiptDetail,
    receiptProjectWarehouseOptions,
    selectedReceiptProjectId,
    sourceProjectId,
    sourceId,
    sourceItems,
    sourceType,
    transferDetail?.destinationWarehouse?.id,
  ]);

  const uploadPendingReceiptAttachmentMutation =
    trpc.attachments.upload.useMutation();
  const lookupManualSapItemMutation =
    trpc.requestItems.lookupSapItem.useMutation();
  const fiscalRangeLookupMutation =
    trpc.receipts.lookupFiscalDocumentRange.useMutation({
      onSuccess: (range, variables) => {
        const purchaseOrderId = Number(sourceId || 0);
        const lookupInvoiceNumber = formatInvoiceNumberInput(
          variables.invoiceNumber
        );
        const previousAutofill = fiscalRangeAutofillRef.current;

        if (
          sourceType !== "purchase_order" ||
          !isFiscalDocument ||
          variables.purchaseOrderId !== purchaseOrderId ||
          formatInvoiceNumberInput(invoiceNumber) !== lookupInvoiceNumber
        ) {
          return;
        }

        if (!range) {
          if (!previousAutofill) return;
          setCai(current => (current === previousAutofill.cai ? "" : current));
          setDocumentRangeStart(current =>
            current === previousAutofill.documentRangeStart ? "" : current
          );
          setDocumentRangeEnd(current =>
            current === previousAutofill.documentRangeEnd ? "" : current
          );
          setEmissionDeadline(current =>
            current === previousAutofill.emissionDeadline ? "" : current
          );
          fiscalRangeAutofillRef.current = null;
          return;
        }

        const nextAutofill: ReceiptFiscalRangeAutofill = {
          invoiceNumber: lookupInvoiceNumber,
          cai: range.cai ?? "",
          documentRangeStart: range.documentRangeStart ?? "",
          documentRangeEnd: range.documentRangeEnd ?? "",
          emissionDeadline: toDateInputValue(range.emissionDeadline),
        };

        const canApplyField = (
          current: string,
          field: keyof Omit<ReceiptFiscalRangeAutofill, "invoiceNumber">
        ) =>
          !current.trim() ||
          Boolean(previousAutofill && current === previousAutofill[field]);

        setCai(current =>
          canApplyField(current, "cai") ? nextAutofill.cai : current
        );
        setDocumentRangeStart(current =>
          canApplyField(current, "documentRangeStart")
            ? nextAutofill.documentRangeStart
            : current
        );
        setDocumentRangeEnd(current =>
          canApplyField(current, "documentRangeEnd")
            ? nextAutofill.documentRangeEnd
            : current
        );
        setEmissionDeadline(current =>
          canApplyField(current, "emissionDeadline")
            ? nextAutofill.emissionDeadline
            : current
        );
        fiscalRangeAutofillRef.current = nextAutofill;
      },
      onError: () => {
        fiscalRangeAutofillRef.current = null;
      },
    });

  useEffect(() => {
    if (
      !dialogOpen ||
      sourceType !== "purchase_order" ||
      !sourceId ||
      !isFiscalDocument ||
      !isValidInvoiceNumber(invoiceNumber)
    ) {
      const previousAutofill = fiscalRangeAutofillRef.current;
      if (previousAutofill) {
        setCai(current => (current === previousAutofill.cai ? "" : current));
        setDocumentRangeStart(current =>
          current === previousAutofill.documentRangeStart ? "" : current
        );
        setDocumentRangeEnd(current =>
          current === previousAutofill.documentRangeEnd ? "" : current
        );
        setEmissionDeadline(current =>
          current === previousAutofill.emissionDeadline ? "" : current
        );
        fiscalRangeAutofillRef.current = null;
      }
      lastFiscalRangeLookupKeyRef.current = "";
      return;
    }

    const lookupInvoiceNumber = formatInvoiceNumberInput(invoiceNumber);
    const lookupKey = `${sourceId}:${lookupInvoiceNumber}`;
    if (lastFiscalRangeLookupKeyRef.current === lookupKey) return;

    lastFiscalRangeLookupKeyRef.current = lookupKey;
    fiscalRangeLookupMutation.mutate({
      purchaseOrderId: Number(sourceId),
      invoiceNumber: lookupInvoiceNumber,
    });
  }, [
    dialogOpen,
    fiscalRangeLookupMutation,
    invoiceNumber,
    isFiscalDocument,
    sourceId,
    sourceType,
  ]);

  const registerMutation = trpc.receipts.register.useMutation({
    onSuccess: async result => {
      const attachmentsToUpload = [...pendingReceiptAttachments];

      toast.success(
        result.invoiceDocumentNumber
          ? `Recepción registrada y documento ${result.invoiceDocumentNumber} creado`
          : "Recepción registrada"
      );
      setDialogOpen(false);
      resetForm();
      void Promise.all([
        utils.receipts.list.invalidate(),
        utils.purchaseOrders.list.invalidate(),
        utils.transfers.list.invalidate(),
        utils.materialRequests.list.invalidate(),
        utils.supplyFlows.pendingQueue.invalidate(),
        utils.supplyFlows.list.invalidate(),
        sourceType === "transfer" && sourceId
          ? utils.transfers.getById.invalidate({ id: Number(sourceId) })
          : Promise.resolve(),
        sourceType === "purchase_order" && sourceId
          ? utils.purchaseOrders.getById.invalidate({ id: Number(sourceId) })
          : Promise.resolve(),
      ]);

      if (attachmentsToUpload.length > 0) {
        try {
          await Promise.all(
            attachmentsToUpload.map(attachment =>
              uploadPendingReceiptAttachmentMutation.mutateAsync({
                entityType: "receipt",
                entityId: result.id,
                fileName: attachment.fileName,
                fileData: attachment.fileData,
                mimeType: attachment.mimeType,
                fileSize: attachment.fileSize,
                category: "comprobante_entrega",
              })
            )
          );
          const uploadDestination = result.invoiceId
            ? "a la recepción y a la factura"
            : "a la recepción";
          toast.success(
            attachmentsToUpload.length === 1
              ? `Adjunto subido ${uploadDestination}`
              : `${attachmentsToUpload.length} adjuntos subidos ${uploadDestination}`
          );
          void utils.attachments.getByEntity.invalidate({
            entityType: "receipt",
            entityId: result.id,
          });
          if (result.invoiceId) {
            void utils.attachments.getByEntity.invalidate({
              entityType: "invoice",
              entityId: result.invoiceId,
            });
          }
        } catch (error) {
          toast.error(
            error instanceof Error
              ? `La recepción fue registrada, pero falló un adjunto: ${error.message}`
              : "La recepción fue registrada, pero no se pudieron subir todos los adjuntos"
          );
        }
      }
    },
    onError: error => toast.error(error.message),
  });

  const correctReceiptMutation = trpc.invoices.correctReceipt.useMutation({
    onSuccess: result => {
      const replacementReceipt = (result as any).replacementReceipt;
      const originalReceiptId = viewReceiptId;
      const invoiceId = receiptDetail?.invoice?.id;

      toast.success(
        replacementReceipt?.receiptNumber
          ? `Recepción anulada. Borrador ${replacementReceipt.receiptNumber} listo para corregir.`
          : "Recepción anulada y borrador creado para corregir."
      );
      setReceiptCorrectionDialogOpen(false);
      setReceiptCorrectionReason("");
      void Promise.all([
        utils.receipts.list.invalidate(),
        utils.invoices.list.invalidate(),
        utils.purchaseOrders.list.invalidate(),
        utils.materialRequests.list.invalidate(),
        utils.inventory.list.invalidate(),
        originalReceiptId
          ? utils.receipts.getById.invalidate({ id: originalReceiptId })
          : Promise.resolve(),
        invoiceId
          ? utils.invoices.getById.invalidate({ id: invoiceId })
          : Promise.resolve(),
        replacementReceipt?.id
          ? utils.receipts.getById.invalidate({ id: replacementReceipt.id })
          : Promise.resolve(),
      ]);
      setViewReceiptId(null);
      if (replacementReceipt?.id) {
        setLocation(`/recepciones?editar=${replacementReceipt.id}`);
      }
    },
    onError: error => toast.error(error.message),
  });

  const saveFixedAssetDraftMutation =
    trpc.purchaseOrders.saveFixedAssetDraftLine.useMutation({
      onSuccess: result => {
        const articleCode =
          (result as any)?.article?.temporaryItemCode ||
          (result as any)?.article?.itemCode ||
          "código temporal";
        toast.success(`Activo fijo guardado como borrador: ${articleCode}`);
        if (sourceType === "purchase_order" && sourceId) {
          void utils.purchaseOrders.getById.invalidate({
            id: Number(sourceId),
          });
        }
        void utils.purchaseOrders.list.invalidate();
        void utils.articles.list.invalidate();
      },
      onError: error => toast.error(error.message),
    });

  const saveReceiptDraftMutation = trpc.receipts.saveDraft.useMutation({
    onSuccess: result => {
      toast.success(
        result.updated
          ? `Recepción borrador actualizada: ${result.receiptNumber}`
          : `Recepción borrador creada: ${result.receiptNumber}`
      );
      void utils.receipts.getById.invalidate({ id: result.id });
      void utils.receipts.list.invalidate();
      void utils.purchaseOrders.list.invalidate();
      if (sourceType === "purchase_order" && sourceId) {
        void utils.purchaseOrders.getById.invalidate({ id: Number(sourceId) });
      }
    },
    onError: error => toast.error(error.message),
  });

  const resolveReceiptFixedAssetMutation =
    trpc.articles.resolveFixedAssetCode.useMutation({
      onSuccess: article => {
        toast.success(`Código real actualizado: ${article.itemCode}`);
        setSelectedReceiptFixedAssetArticle(null);
        setReceiptFixedAssetRealCode("");
        void utils.articles.list.invalidate();
        void utils.purchaseOrders.list.invalidate();
        if (sourceType === "purchase_order" && sourceId) {
          void utils.purchaseOrders.getById.invalidate({ id: Number(sourceId) });
          void refetchPurchaseOrderDetail();
        }
      },
      onError: error => toast.error(error.message),
    });

  const closeReceiptLineMutation =
    trpc.purchaseOrders.closeReceiptLine.useMutation({
      onSuccess: result => {
        toast.success(
          result.orderStatus === "recibida"
            ? "Línea cerrada. La orden ya no tiene recepciones pendientes."
            : "Línea cerrada para recepción"
        );
        setCloseReceiptLineItem(null);
        if (sourceType === "purchase_order" && sourceId) {
          void utils.purchaseOrders.getById.invalidate({
            id: Number(sourceId),
          });
        }
        void utils.purchaseOrders.list.invalidate();
      },
      onError: error => toast.error(error.message),
    });

  const availablePurchaseOrders = useMemo(
    () =>
      (purchaseOrders ?? []).filter((row: any) =>
        canReceivePurchaseOrderRow(row)
      ),
    [purchaseOrders]
  );

  const availableTransfers = useMemo(
    () =>
      (transfers ?? []).filter((row: any) =>
        RECEIVABLE_TRANSFER_STATUSES.has(row.transfer.status)
      ),
    [transfers]
  );

  const canCloseTransferLines =
    sourceType === "transfer" &&
    ((user as any)?.buildreqRole === "administracion_central" ||
      (() => {
        if ((user as any)?.buildreqRole !== "administrador_proyecto")
          return false;
        if (sourceProjectId === undefined) return false;
        const rawAssignedProjectIds = (user as any)?.assignedProjectIds;
        const assignedProjectIds =
          Array.isArray(rawAssignedProjectIds) &&
          rawAssignedProjectIds.length > 0
            ? rawAssignedProjectIds.map(Number)
            : (user as any)?.assignedProjectId
              ? [(user as any).assignedProjectId]
              : [];
        return (
          assignedProjectIds.length === 0 ||
          assignedProjectIds.includes(sourceProjectId)
        );
      })());
  const userRole = (user as any)?.buildreqRole;
  const canManageReceiptAttachments =
    user?.role === "admin" ||
    userRole === "jefe_bodega_central" ||
    userRole === "administracion_central" ||
    userRole === "administrador_proyecto" ||
    userRole === "bodeguero_proyecto";

  const sourceProjectLabel =
    sourceType === "purchase_order"
      ? purchaseOrderDetail?.project
        ? `${purchaseOrderDetail.project.code} — ${purchaseOrderDetail.project.name}`
        : purchaseOrderDetail?.purchaseOrder.projectId
          ? `Proyecto ${purchaseOrderDetail.purchaseOrder.projectId}`
          : "Seleccione documento"
      : getTransferDestinationLabel(transferDetail, "Seleccione documento");

  const sourceHeaderTitle =
    sourceType === "purchase_order"
      ? purchaseOrderDetail?.purchaseOrder.orderNumber || "Registrar recepción"
      : transferDetail?.transfer?.transferNumber || "Registrar recepción";

  const sourceStatusKey =
    sourceType === "purchase_order"
      ? purchaseOrderDetail?.purchaseOrder.status
      : transferDetail?.transfer?.status;
  const sourceStatusLabel = sourceStatusKey
    ? sourceType === "purchase_order"
      ? isContractPurchaseOrder
        ? purchaseOrderContractSummary.statusLabel
        : PURCHASE_ORDER_STATUS_LABELS[sourceStatusKey] || sourceStatusKey
      : TRANSFER_STATUS_LABELS[sourceStatusKey] || sourceStatusKey
    : null;

  const sourceSecondaryLabel =
    sourceType === "purchase_order"
      ? purchaseOrderDetail?.supplier
        ? `${purchaseOrderDetail.supplier.supplierCode} — ${purchaseOrderDetail.supplier.name}`
        : "Proveedor pendiente"
      : transferDetail?.transferRequest
        ? `Origen: ${getTransferOriginLabel(transferDetail, "Proyecto origen")}`
        : "Seleccione documento";
  const transferSourceWarehouseLabel =
    sourceType === "transfer" && transferDetail?.transferRequest
      ? getTransferSourceWarehouseLabel(transferDetail, "Bodega pendiente")
      : null;
  const sourceSupplierRtnLabel =
    sourceType === "purchase_order" && purchaseOrderDetail?.supplier
      ? formatSupplierRtnLabel(purchaseOrderDetail.supplier)
      : null;

  const sourceNeededByLabel =
    sourceType === "purchase_order"
      ? formatDateLabel(purchaseOrderDetail?.purchaseOrder.neededBy)
      : transferDetail?.transferRequest?.neededBy
        ? formatDateLabel(transferDetail.transferRequest.neededBy)
        : "—";

  const getReceiptLineSubtotalDraft = (item: any) =>
    subtotalMap[item.id] ??
    calculateReceiptSubtotalDraftValue(
      receivedMap[item.id] ?? "0",
      priceMap[item.id] ?? String(item.unitPrice ?? "0.00")
    );

  const getReceiptLineTaxDraft = (item: any): PurchaseOrderItemTaxDraft => {
    const taxCode =
      taxCodeByItemId[item.id] ??
      normalizePurchaseOrderTaxCode(item.taxCode, activeSalesTaxes);
    return {
      quantity: receivedMap[item.id] ?? "0",
      unitPrice: formatMoneyPayload(
        priceMap[item.id] ?? String(item.unitPrice ?? "0.00")
      ),
      taxCode,
      additionalTaxCodes:
        additionalTaxCodesByItemId[item.id] ??
        normalizePurchaseOrderAdditionalTaxCodes(
          item.additionalTaxCodes,
          taxCode,
          activeSalesTaxes
        ),
    };
  };

  const receiptEditableItems = useMemo(
    () =>
      sourceType === "purchase_order"
        ? [...(sourceItems as any[]), ...manualReceiptItems]
        : (sourceItems as any[]),
    [manualReceiptItems, sourceItems, sourceType]
  );

  const getEditableReceiptExpectedQuantity = (item: any) =>
    item.isManualReceiptItem
      ? Number(receivedMap[item.id] ?? item.quantityExpected ?? 0) || 0
      : getReceivableQuantity(item);

  const addManualReceiptItem = async (catalogItem: any) => {
    if (sourceType !== "purchase_order") return;
    const sapItemCode = String(catalogItem.itemCode ?? "").trim();
    if (!sapItemCode) return;

    try {
      const lookup = await lookupManualSapItemMutation.mutateAsync({
        sapItemCode,
      });
      const nextId = -Date.now() - Math.floor(Math.random() * 1000);
      const itemName =
        lookup?.itemName || catalogItem.description || `SKU ${sapItemCode}`;
      const manualItem: ManualReceiptItem = {
        id: nextId,
        isManualReceiptItem: true,
        sapItemCode: lookup?.sapItemCode || sapItemCode,
        itemName,
        unit: lookup?.unit ?? null,
        tipoArticulo: lookup?.tipoArticulo ?? catalogItem.tipoArticulo ?? null,
        unitPrice: "0.0000",
        taxCode: "exe",
        additionalTaxCodes: [],
        quantityExpected: "1",
        receivedQuantity: "1",
      };

      setManualReceiptItems(current => [...current, manualItem]);
      setReceivedMap(current => ({ ...current, [nextId]: "1" }));
      setPriceMap(current => ({ ...current, [nextId]: manualItem.unitPrice }));
      setSubtotalMap(current => ({ ...current, [nextId]: "0.00" }));
      setTaxCodeByItemId(current => ({
        ...current,
        [nextId]: manualItem.taxCode,
      }));
      setAdditionalTaxCodesByItemId(current => ({
        ...current,
        [nextId]: manualItem.additionalTaxCodes,
      }));
      setWarehouseByItemId(current => ({
        ...current,
        [nextId]: isReceiptNonInventoryItem(manualItem)
          ? ""
          : receiptWarehouseId,
      }));
      setTargetByItemId(current => ({ ...current, [nextId]: null }));
      setAssetDrafts(current => ({
        ...current,
        [nextId]: emptyReceiptAssetDraft(),
      }));
      setManualItemSearch("");
      setManualItemPopoverOpen(false);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "No se pudo agregar el producto"
      );
    }
  };

  const removeManualReceiptItem = (itemId: number) => {
    setManualReceiptItems(current =>
      current.filter(item => item.id !== itemId)
    );
    setReceivedMap(current => {
      const { [itemId]: _removed, ...next } = current;
      return next;
    });
    setWarehouseByItemId(current => {
      const { [itemId]: _removed, ...next } = current;
      return next;
    });
    setPriceMap(current => {
      const { [itemId]: _removed, ...next } = current;
      return next;
    });
    setSubtotalMap(current => {
      const { [itemId]: _removed, ...next } = current;
      return next;
    });
    setTaxCodeByItemId(current => {
      const { [itemId]: _removed, ...next } = current;
      return next;
    });
    setAdditionalTaxCodesByItemId(current => {
      const { [itemId]: _removed, ...next } = current;
      return next;
    });
    setTargetByItemId(current => {
      const { [itemId]: _removed, ...next } = current;
      return next;
    });
    setAssetDrafts(current => {
      const { [itemId]: _removed, ...next } = current;
      return next;
    });
  };

  const buildManualReceiptItemPayload = () =>
    manualReceiptItems.map(item => {
      const taxDraft = getReceiptLineTaxDraft(item);
      const quantityReceived =
        receivedMap[item.id] || item.receivedQuantity || "0";
      const isNonInventoryLine = isReceiptNonInventoryItem(item);
      return {
        requiresWarehouse: !isNonInventoryLine,
        sourceItemId: null,
        sapItemCode: item.sapItemCode,
        warehouseId: isNonInventoryLine
          ? undefined
          : warehouseByItemId[item.id]
            ? Number(warehouseByItemId[item.id])
            : undefined,
        itemName: item.itemName,
        quantityExpected: quantityReceived,
        quantityReceived,
        unit: item.unit || undefined,
        unitPrice: formatMoneyPayload(priceMap[item.id] || item.unitPrice),
        taxCode: taxDraft.taxCode,
        additionalTaxCodes: taxDraft.additionalTaxCodes,
        ...getReceiptTargetPayload(targetByItemId[item.id] ?? null),
        notes: getReceiptAssetDraft(item.id).notes.trim() || undefined,
        isFixedAsset: false,
        isLeasing: false,
        assetDetails: [],
      };
    });

  const getReceiptProjectOptionsForWarehouse = (
    warehouseId?: string | number | null
  ) => {
    const selectedWarehouseId = Number(warehouseId);
    const lockedProjectId = Number(lockedReceiptProjectId ?? 0);
    if (
      !Number.isInteger(selectedWarehouseId) ||
      selectedWarehouseId <= 0
    ) {
      return lockedProjectId
        ? (receiptProjects ?? []).filter(
            (project: any) => project.id === lockedProjectId
          )
        : [];
    }

    return (receiptProjects ?? []).filter((project: any) => {
      if (lockedProjectId && project.id !== lockedProjectId) return false;
      if (!projectUsesWarehouse(project, selectedWarehouseId)) {
        return false;
      }
      return true;
    });
  };

  const isReceiptWarehouseSelectableForItem = (
    item: any,
    warehouseId?: string | number | null,
    warehouseOptions = receiptProjectWarehouseOptions
  ) => {
    const warehouseKey = String(warehouseId ?? "");
    if (!warehouseKey) return false;
    if (sourceType === "purchase_order" && isReceiptNonInventoryItem(item)) {
      return false;
    }
    if (
      lockedReturnDestinationWarehouseId &&
      warehouseKey !== lockedReturnDestinationWarehouseId
    ) {
      return false;
    }
    if (isSameTransferOriginScope(item, warehouseKey)) return false;

    return (warehouseOptions ?? []).some(
      (warehouse: any) => String(warehouse.id) === warehouseKey
    );
  };

  const getReceiptWarehouseForItem = (
    item: any,
    preferredWarehouseId?: string | number | null,
    warehouseOptions = receiptProjectWarehouseOptions
  ) => {
    if (sourceType === "purchase_order" && isReceiptNonInventoryItem(item)) {
      return "";
    }

    if (
      isReceiptWarehouseSelectableForItem(
        item,
        preferredWarehouseId,
        warehouseOptions
      )
    ) {
      return String(preferredWarehouseId);
    }

    const fallbackWarehouse = (warehouseOptions ?? []).find((warehouse: any) =>
      isReceiptWarehouseSelectableForItem(item, warehouse.id, warehouseOptions)
    );
    return fallbackWarehouse?.id ? String(fallbackWarehouse.id) : "";
  };

  const applyReceiptWarehouseToAllItems = (
    warehouseId?: string | number | null,
    warehouseOptions = receiptProjectWarehouseOptions
  ) => {
    setWarehouseByItemId(current => {
      const next = { ...current };
      receiptEditableItems.forEach((item: any) => {
        next[item.id] = getReceiptWarehouseForItem(
          item,
          warehouseId,
          warehouseOptions
        );
      });
      return next;
    });
  };

  const receiptWarehouseSelectionValue = receiptWarehouseId;
  const receiptHeaderProjectOptions = (() => {
    const options = getReceiptProjectOptionsForWarehouse(
      receiptWarehouseSelectionValue
    );
    if (options.length > 0 || !selectedReceiptProject) return options;
    return [selectedReceiptProject];
  })();
  const receiptHeaderWarehouseOptions = receiptProjectWarehouseOptions.filter(
    (warehouse: any) =>
      receiptEditableItems.length === 0 ||
      receiptEditableItems.some((item: any) =>
        isReceiptWarehouseSelectableForItem(
          item,
          warehouse.id,
          receiptProjectWarehouseOptions
        )
      )
  );
  const receiptItemsRequireWarehouse = receiptEditableItems.some(
    (item: any) =>
      !(sourceType === "purchase_order" && isReceiptNonInventoryItem(item))
  );
  const shouldShowReceiptEntryScopeControls =
    Boolean(sourceId) && receiptItemsRequireWarehouse;
  const getReceiptWarehouseSelectionError = () => {
    if (!shouldShowReceiptEntryScopeControls) return "";
    if (!selectedReceiptProjectId) {
      return "Seleccione el proyecto de la recepción.";
    }
    if (!receiptWarehouseSelectionValue) {
      return "Seleccione un almacén de ingreso antes de guardar o registrar.";
    }
    const selectedWarehouseIsAvailable = receiptHeaderWarehouseOptions.some(
      (warehouse: any) => String(warehouse.id) === receiptWarehouseSelectionValue
    );
    if (!selectedWarehouseIsAvailable) {
      return "Seleccione un almacén de ingreso válido.";
    }
    return "";
  };
  const receiptWarehouseSelectionError = getReceiptWarehouseSelectionError();

  const handleReceiptHeaderWarehouseChange = (value: string) => {
    setReceiptWarehouseId(value);
    applyReceiptWarehouseToAllItems(value);

    const nextProjectOptions = getReceiptProjectOptionsForWarehouse(value);
    if (
      !lockedReceiptProjectId &&
      selectedReceiptProjectId &&
      !nextProjectOptions.some(
        (project: any) => Number(project.id) === Number(selectedReceiptProjectId)
      )
    ) {
      setReceiptProjectId("");
      setTargetByItemId({});
    }
  };

  const handleReceiptHeaderProjectChange = (value: string) => {
    if (!receiptWarehouseSelectionValue) {
      toast.error("Seleccione un almacén de ingreso primero");
      return;
    }

    setReceiptProjectId(value);
    setTargetByItemId({});
    applyReceiptWarehouseToAllItems(receiptWarehouseSelectionValue);
  };

  const renderReceiptWarehouseSelector = (
    item: any,
    compact = false,
    warehouseValue?: string,
    onWarehouseChange?: (value: string) => void
  ) => {
    if (sourceType === "purchase_order" && isReceiptNonInventoryItem(item)) {
      const noInventoryLabel = isReceiptServiceItem(item)
        ? "No aplica - Servicio"
        : "No aplica - Activo fijo";
      const noInventoryHint = isReceiptServiceItem(item)
        ? "No ingresa a inventario."
        : "Se registra como activo fijo, sin entrada a bodega.";
      return (
        <div className="min-w-0 space-y-1.5">
          {!compact ? <Label>Almacén ingreso</Label> : null}
          <div className="flex min-h-10 min-w-52 items-center rounded-md border border-dashed border-border bg-muted/20 px-3 text-sm font-medium text-muted-foreground">
            {noInventoryLabel}
          </div>
          <p className="text-[10px] text-muted-foreground">
            {noInventoryHint}
          </p>
        </div>
      );
    }

    const lockedDestinationWarehouseId = lockedReturnDestinationWarehouseId;
    const itemWarehouseOptions = receiptProjectWarehouseOptions;
    const hasSelectableWarehouses = itemWarehouseOptions.some(
      (warehouse: any) => {
        const warehouseId = String(warehouse.id);
        if (isSameTransferOriginScope(item, warehouseId)) return false;
        return (
          !lockedDestinationWarehouseId ||
          warehouseId === lockedDestinationWarehouseId
        );
      }
    );
    const selectedWarehouseValue = warehouseValue ?? warehouseByItemId[item.id];
    const selectedWarehouse = itemWarehouseOptions.find(
      (warehouse: any) => String(warehouse.id) === selectedWarehouseValue
    );
    const projectOptions =
      getReceiptProjectOptionsForWarehouse(selectedWarehouseValue);
    const selectedProjectValue = selectedReceiptProjectId
      ? String(selectedReceiptProjectId)
      : undefined;
    const selectedProjectInWarehouse = projectOptions.find(
      (project: any) => String(project.id) === selectedProjectValue
    );
    const selectedIsSourceWarehouse =
      isSameTransferOriginScope(item, selectedWarehouseValue);
    const selectedIsWrongReturnDestination =
      Boolean(lockedDestinationWarehouseId) &&
      Boolean(selectedWarehouseValue) &&
      selectedWarehouseValue !== lockedDestinationWarehouseId;

    return (
      <div className="min-w-0 space-y-1.5">
        {!compact ? <Label>Almacén ingreso</Label> : null}
        <Select
          value={selectedWarehouseValue || undefined}
          onValueChange={value => {
            if (onWarehouseChange) {
              onWarehouseChange(value);
              return;
            }
            setWarehouseByItemId(current => ({
              ...current,
              [item.id]: value,
            }));
          }}
          disabled={
            !itemWarehouseOptions.length ||
            !hasSelectableWarehouses ||
            registerMutation.isPending
          }
        >
          <SelectTrigger className={compact ? "min-w-64" : "w-full min-w-0"}>
            <SelectValue placeholder="Seleccione almacén" />
          </SelectTrigger>
          <SelectContent className="max-w-[min(680px,calc(100vw-2rem))]">
            {itemWarehouseOptions.map((warehouse: any) => {
              const warehouseId = String(warehouse.id);
              const isSourceWarehouse =
                isSameTransferOriginScope(item, warehouseId);
              const isWrongReturnDestination =
                Boolean(lockedDestinationWarehouseId) &&
                warehouseId !== lockedDestinationWarehouseId;
              return (
                <SelectItem
                  key={warehouse.id}
                  value={warehouseId}
                  disabled={isSourceWarehouse || isWrongReturnDestination}
                >
                  {warehouse.displayName}
                  {isSourceWarehouse ? " - origen" : ""}
                  {!isSourceWarehouse && isWrongReturnDestination
                    ? " - no destino"
                    : ""}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
        <Select
          value={selectedProjectValue}
          onValueChange={value => {
            setReceiptProjectId(value);
            setTargetByItemId({});
            const nextProject = (receiptProjects ?? []).find(
              (project: any) => String(project.id) === value
            );
            if (
              selectedWarehouseValue &&
              nextProject &&
              !projectUsesWarehouse(nextProject, selectedWarehouseValue)
            ) {
              const nextWarehouse = (nextProject.warehouses ?? [])[0];
              if (nextWarehouse?.id) {
                setWarehouseByItemId(current => ({
                  ...current,
                  [item.id]: String(nextWarehouse.id),
                }));
              }
            }
          }}
          disabled={
            Boolean(lockedReceiptProjectId) ||
            registerMutation.isPending
          }
        >
          <SelectTrigger className={compact ? "min-w-64" : "w-full min-w-0"}>
            <SelectValue placeholder="Seleccione proyecto" />
          </SelectTrigger>
          <SelectContent className="max-w-[min(720px,calc(100vw-2rem))]">
            {projectOptions.map((project: any) => (
              <SelectItem key={project.id} value={String(project.id)}>
                {formatProjectReference(project, `Proyecto ${project.id}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {selectedIsSourceWarehouse ? (
          <p className="text-[10px] font-medium text-destructive">
            No se puede ingresar a la misma bodega/proyecto de origen.
          </p>
        ) : selectedIsWrongReturnDestination ? (
          <p className="text-[10px] font-medium text-destructive">
            Este traslado debe ingresar a la bodega destino de la devolución.
          </p>
        ) : selectedWarehouse ? (
          <p className="truncate text-[10px] text-muted-foreground">
            Ingreso a{" "}
            {selectedProjectInWarehouse
              ? formatProjectReference(
                  selectedProjectInWarehouse,
                  selectedReceiptProjectLabel
                )
              : selectedReceiptProjectLabel}{" "}
            / {selectedWarehouse.displayName}
          </p>
        ) : !hasSelectableWarehouses && sourceType === "transfer" ? (
          <p className="text-[10px] font-medium text-destructive">
            No hay una bodega/proyecto destino distinta a la de origen.
          </p>
        ) : (
          <p className="text-[10px] text-muted-foreground">
            Seleccione el almacén físico donde entrará el producto.
          </p>
        )}
      </div>
    );
  };

  const renderReceiptTargetSelector = (item: any) => {
    const selectedTarget = targetByItemId[item.id] ?? null;
    const open = targetPopoverOpen === item.id;

    return (
      <div className="min-w-0 space-y-1.5">
        <Label>Destino</Label>
        <div className="flex min-w-0 gap-2">
          <Popover
            open={open}
            onOpenChange={nextOpen => {
              setTargetPopoverOpen(nextOpen ? item.id : null);
              if (!nextOpen) {
                setTargetSearch("");
              }
            }}
          >
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                disabled={
                  !selectedReceiptProjectId ||
                  registerMutation.isPending
                }
                className="min-w-0 flex-1 justify-between font-normal"
              >
                <span
                  className={
                    selectedTarget
                      ? "truncate"
                      : "truncate text-muted-foreground"
                  }
                >
                  {selectedTarget?.label ?? "Subproyecto o activo fijo"}
                </span>
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              className="w-[min(540px,calc(100vw-2rem))] p-0"
              align="start"
            >
              <Command shouldFilter={false}>
                <CommandInput
                  placeholder="Buscar subproyecto o activo fijo..."
                  value={targetSearch}
                  onValueChange={setTargetSearch}
                />
                <CommandList>
                  {targetOptionsLoading ? (
                    <div className="p-3 text-sm text-muted-foreground">
                      Buscando opciones...
                    </div>
                  ) : (
                    <>
                      <CommandEmpty>No se encontraron opciones.</CommandEmpty>
                      {(targetOptions?.subprojects ?? []).length > 0 ? (
                        <CommandGroup heading="Subproyectos">
                          {(targetOptions?.subprojects ?? []).map(
                            (subproject: any) => {
                              const selected =
                                selectedTarget?.targetType === "subproyecto" &&
                                selectedTarget.subProjectId === subproject.id;

                              return (
                                <CommandItem
                                  key={`subproject-${subproject.id}`}
                                  value={`subproject-${subproject.id}-${subproject.code}-${subproject.name}`}
                                  onSelect={() => {
                                    setTargetByItemId(current => ({
                                      ...current,
                                      [item.id]:
                                        buildSubprojectReceiptTargetSelection(
                                          subproject
                                        ),
                                    }));
                                    setTargetPopoverOpen(null);
                                    setTargetSearch("");
                                  }}
                                >
                                  <Check
                                    className={`mr-2 h-4 w-4 ${
                                      selected ? "opacity-100" : "opacity-0"
                                    }`}
                                  />
                                  <div className="min-w-0">
                                    <p className="truncate text-sm font-medium">
                                      {subproject.code} - {subproject.name}
                                    </p>
                                    {subproject.description ? (
                                      <p className="truncate text-xs text-muted-foreground">
                                        {subproject.description}
                                      </p>
                                    ) : null}
                                  </div>
                                </CommandItem>
                              );
                            }
                          )}
                        </CommandGroup>
                      ) : null}

                      {(targetOptions?.fixedAssets ?? []).length > 0 ? (
                        <CommandGroup heading="Activos fijos">
                          {(targetOptions?.fixedAssets ?? []).map(
                            (asset: any) => {
                              const selected =
                                selectedTarget?.targetType === "activo_fijo" &&
                                selectedTarget.fixedAssetSapItemCode ===
                                  asset.itemCode;

                              return (
                                <CommandItem
                                  key={`asset-${asset.itemCode}`}
                                  value={`asset-${asset.itemCode}-${asset.description}`}
                                  onSelect={() => {
                                    setTargetByItemId(current => ({
                                      ...current,
                                      [item.id]:
                                        buildFixedAssetReceiptTargetSelection(
                                          asset
                                        ),
                                    }));
                                    setTargetPopoverOpen(null);
                                    setTargetSearch("");
                                  }}
                                >
                                  <Check
                                    className={`mr-2 h-4 w-4 ${
                                      selected ? "opacity-100" : "opacity-0"
                                    }`}
                                  />
                                  <div className="min-w-0">
                                    <p className="truncate text-sm font-medium">
                                      {asset.itemCode} - {asset.description}
                                    </p>
                                    {asset.itemGroup ? (
                                      <p className="truncate text-xs text-muted-foreground">
                                        {asset.itemGroup}
                                      </p>
                                    ) : null}
                                  </div>
                                </CommandItem>
                              );
                            }
                          )}
                        </CommandGroup>
                      ) : null}
                    </>
                  )}
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>

          {selectedTarget ? (
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Limpiar destino de la línea"
              disabled={registerMutation.isPending}
              onClick={() =>
                setTargetByItemId(current => ({
                  ...current,
                  [item.id]: null,
                }))
              }
            >
              <X className="h-4 w-4" />
            </Button>
          ) : null}
        </div>
      </div>
    );
  };

  const receiptPricingSummary = useMemo(
    () =>
      sourceType === "purchase_order"
        ? summarizePurchaseOrderLines(
            receiptEditableItems.map(item => getReceiptLineTaxDraft(item)),
            activeSalesTaxes
          )
        : summarizePurchaseOrderLines([], activeSalesTaxes),
    [
      activeSalesTaxes,
      additionalTaxCodesByItemId,
      priceMap,
      receiptEditableItems,
      receivedMap,
      sourceType,
      taxCodeByItemId,
    ]
  );
  const getReceiptOtherChargesPayload = () =>
    otherChargeDrafts
      .map(charge => ({
        concept: charge.concept.trim(),
        amount: charge.amount.trim(),
      }))
      .filter(charge => charge.concept || charge.amount);
  const getCompleteReceiptOtherChargesPayload = () =>
    getReceiptOtherChargesPayload().filter(charge => {
      const amount = Number(charge.amount);
      return charge.concept && Number.isFinite(amount) && amount > 0;
    });
  const receiptOtherChargesTotal = useMemo(
    () => getOtherChargesTotal(otherChargeDrafts),
    [otherChargeDrafts]
  );
  const receiptTableColumnCount = sourceType === "purchase_order" ? 11 : 8;
  const isReceiptLineDetailsExpanded = (itemId: string | number) =>
    expandedReceiptDetailItemIds.includes(String(itemId));
  const toggleReceiptLineDetails = (itemId: string | number) => {
    const key = String(itemId);
    setExpandedReceiptDetailItemIds(current =>
      current.includes(key)
        ? current.filter(entry => entry !== key)
        : [...current, key]
    );
  };
  const renderReceiptLineDetailsButton = (
    itemId: string | number,
    expanded: boolean,
    className = ""
  ) => (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={`h-7 gap-1.5 px-2 text-xs ${className}`}
      onClick={() => toggleReceiptLineDetails(itemId)}
      aria-expanded={expanded}
    >
      <ChevronDown
        className={`h-3.5 w-3.5 transition-transform ${
          expanded ? "rotate-180" : ""
        }`}
      />
      {expanded ? "Ocultar detalles" : "Detalles"}
    </Button>
  );

  const totals = useMemo(
    () =>
      receiptEditableItems.reduce(
        (acc, item: any) => {
          acc.pending += getEditableReceiptExpectedQuantity(item);
          acc.receiving += Number(receivedMap[item.id] ?? 0) || 0;
          return acc;
        },
        { pending: 0, receiving: 0 }
      ),
    [receiptEditableItems, receivedMap]
  );
  const currentDocumentHasEmissionDeadlineIssue = hasEmissionDeadlineIssue({
    isFiscalDocument: sourceType === "purchase_order" && isFiscalDocument,
    documentDate,
    emissionDeadline,
  });

  const getTransferCloseQuantity = (item: any) => {
    const requestedQuantity = Math.max(
      Number(receivedMap[item.id] ?? 0) || 0,
      0
    );
    return Math.max(getPendingQuantity(item) - requestedQuantity, 0);
  };

  const getReceiptAssetDraft = (itemId: number) =>
    assetDrafts[itemId] ?? emptyReceiptAssetDraft();

  const openReceiptFixedAssetArticleDialog = (article: any) => {
    if (!article?.id) {
      toast.error("Este activo fijo aún no tiene artículo temporal");
      return;
    }
    setSelectedReceiptFixedAssetArticle(article);
    setReceiptFixedAssetRealCode(
      article.fixedAssetStatus === "pendiente" ? "" : article.itemCode || ""
    );
  };

  const submitReceiptFixedAssetCode = () => {
    if (!selectedReceiptFixedAssetArticle) return;
    if (selectedReceiptFixedAssetArticle.fixedAssetStatus !== "pendiente") {
      setSelectedReceiptFixedAssetArticle(null);
      return;
    }
    const nextCode = receiptFixedAssetRealCode.trim();
    if (!nextCode) {
      toast.error("Ingrese el código real del activo fijo");
      return;
    }

    resolveReceiptFixedAssetMutation.mutate({
      id: selectedReceiptFixedAssetArticle.id,
      itemCode: nextCode,
    });
  };

  const updateReceiptAssetDraft = (
    itemId: number,
    updater: (draft: ReceiptAssetDraft) => ReceiptAssetDraft
  ) => {
    setAssetDrafts(current => {
      const currentDraft = current[itemId] ?? emptyReceiptAssetDraft();
      return {
        ...current,
        [itemId]: updater(currentDraft),
      };
    });
  };

  const handleReceivedQuantityChange = (item: any, value: string) => {
    const itemId = item.id;
    const nextValue = value;
    setReceivedMap(current => ({
      ...current,
      [itemId]: nextValue,
    }));
    if (sourceType === "purchase_order") {
      setSubtotalMap(current => ({
        ...current,
        [itemId]: calculateReceiptSubtotalDraftValue(
          nextValue,
          priceMap[itemId] ?? String(item.unitPrice ?? "0.00")
        ),
      }));
    }
    setAssetDrafts(current => {
      const draft = current[itemId];
      if (!draft?.isFixedAsset) return current;

      return {
        ...current,
        [itemId]: {
          ...draft,
          assetDetails: normalizeFixedAssetDetails(
            draft.assetDetails,
            getPositiveIntegerQuantity(nextValue)
          ),
        },
      };
    });
  };

  const handleFixedAssetToggle = (item: any, checked: boolean) => {
    if (sourceType !== "purchase_order") {
      toast.error(
        "Los activos fijos temporales se guardan desde órdenes de compra"
      );
      return;
    }
    if (!checked && item.fixedAssetArticleId) {
      toast.error("Este activo fijo ya fue guardado como borrador");
      return;
    }
    if (checked) {
      if (!isReceiptFixedAssetProduct(item)) {
        toast.error(
          "Solo se puede activar Activo fijo para productos clasificados como Activo Fijo"
        );
        return;
      }
      const receivedQuantity =
        getPositiveIntegerQuantity(receivedMap[item.id]) ||
        getPositiveIntegerQuantity(getReceivableQuantity(item));
      setReceivedMap(current => ({
        ...current,
        [item.id]: String(receivedQuantity),
      }));
      setSubtotalMap(current => ({
        ...current,
        [item.id]: calculateReceiptSubtotalDraftValue(
          receivedQuantity,
          priceMap[item.id] ?? String(item.unitPrice ?? "0.00")
        ),
      }));
    }

    const itemId = item.id;
    const assetCount =
      getPositiveIntegerQuantity(receivedMap[itemId]) ||
      getPositiveIntegerQuantity(getReceivableQuantity(item));
    updateReceiptAssetDraft(itemId, draft => ({
      ...draft,
      isFixedAsset: checked,
      isLeasing: checked ? draft.isLeasing : false,
      assetDetails: checked
        ? normalizeFixedAssetDetails(draft.assetDetails, assetCount)
        : [],
    }));
  };

  const updateAssetDetail = (
    itemId: number,
    index: number,
    field: keyof FixedAssetDetail,
    value: string
  ) => {
    updateReceiptAssetDraft(itemId, draft => {
      const count = getPositiveIntegerQuantity(receivedMap[itemId]);
      const assetDetails = normalizeFixedAssetDetails(
        draft.assetDetails,
        count
      );
      assetDetails[index] = {
        ...assetDetails[index],
        [field]: value,
      };
      return {
        ...draft,
        assetDetails,
      };
    });
  };

  const getFixedAssetReceiptBlockReason = () => {
    if (sourceType !== "purchase_order") return "";

    for (const item of sourceItems as any[]) {
      const draft = getReceiptAssetDraft(item.id);
      if (draft.isFixedAsset && !item.fixedAssetArticleId) {
        return `Guarde como borrador el activo fijo de ${item.itemName}`;
      }
      const progress = getReceiptFixedAssetProgress(
        item,
        getPositiveIntegerQuantity(receivedMap[item.id])
      );
      if (item.isFixedAsset === true && progress.pending > 0) {
        return `Contabilidad debe resolver ${progress.pending} activo(s) fijo(s) de ${item.itemName}`;
      }
    }

    return "";
  };

  const handleSaveFixedAssetDraft = (item: any) => {
    if (sourceType !== "purchase_order") {
      toast.error("Seleccione una orden de compra para guardar el activo fijo");
      return;
    }
    if (item.fixedAssetStatus === "resuelto") {
      toast.error("Este activo fijo ya tiene código real asignado");
      return;
    }
    if (!isReceiptFixedAssetProduct(item)) {
      toast.error(
        "Solo se puede activar Activo fijo para productos clasificados como Activo Fijo"
      );
      return;
    }
    if (receiptWarehouseSelectionError) {
      toast.error(receiptWarehouseSelectionError);
      return;
    }
    const draft = getReceiptAssetDraft(item.id);
    if (!draft.isFixedAsset) {
      toast.error("Marque la línea como activo fijo");
      return;
    }
    const assetCount = getPositiveIntegerQuantity(receivedMap[item.id]);
    if (assetCount <= 0) {
      toast.error("Ingrese una cantidad entera mayor que cero");
      return;
    }
    const assetDetails = normalizeFixedAssetDetails(
      draft.assetDetails,
      assetCount
    );
    const missingIndex = assetDetails.findIndex(
      detail => !detail.serialNumber.trim() || !detail.condition
    );
    if (missingIndex >= 0) {
      toast.error(
        `Completa serie y condición de ${item.itemName}, unidad ${
          missingIndex + 1
        }`
      );
      return;
    }

    void (async () => {
      const result = await saveFixedAssetDraftMutation.mutateAsync({
        purchaseOrderItemId: item.id,
        isLeasing: draft.isLeasing,
        lineObservation: draft.notes.trim() || undefined,
        assetDetails,
      });

      const projectId =
        selectedReceiptProjectId ??
        sourceProjectId ??
        purchaseOrderDetail?.purchaseOrder.projectId;
      if (!sourceId || !projectId) {
        toast.error("No se pudo guardar el borrador de recepción");
        return;
      }

      await saveReceiptDraftMutation.mutateAsync({
        sourceType: "purchase_order",
        sourceId: Number(sourceId),
        projectId,
        isFiscalDocument,
        cai: cai.trim() || undefined,
        invoiceNumber: invoiceNumber.trim() || undefined,
        documentRangeStart: documentRangeStart.trim() || undefined,
        documentRangeEnd: documentRangeEnd.trim() || undefined,
        documentDate: documentDate || undefined,
        documentDueDate: documentDueDate || undefined,
        postingDate: postingDate || todayDateValue(),
        receiptDate,
        notes: notes.trim() || undefined,
        otherCharges: getCompleteReceiptOtherChargesPayload(),
        items: [
          ...(sourceItems as any[]).map(sourceItem => {
            const sourceItemDraft = getReceiptAssetDraft(sourceItem.id);
            const isCurrentSavedItem = sourceItem.id === item.id;
            const isFixedAsset =
              sourceItemDraft.isFixedAsset === true ||
              sourceItem.isFixedAsset === true ||
              isCurrentSavedItem;
            const details = isCurrentSavedItem
              ? assetDetails
              : normalizeFixedAssetDetails(
                  sourceItemDraft.assetDetails,
                  getPositiveIntegerQuantity(receivedMap[sourceItem.id])
                );
            const updatedPoItem = isCurrentSavedItem
              ? (result as any).item
              : sourceItem;
            const taxDraft = getReceiptLineTaxDraft(sourceItem);
            const isNonInventoryLine =
              isFixedAsset || isReceiptNonInventoryItem(sourceItem);

            return {
              sourceItemId: sourceItem.id,
              sapItemCode: getSourceItemCode(sourceItem),
              warehouseId: isNonInventoryLine
                ? undefined
                : warehouseByItemId[sourceItem.id]
                  ? Number(warehouseByItemId[sourceItem.id])
                  : undefined,
              itemName: sourceItem.itemName,
              quantityExpected: String(getReceivableQuantity(sourceItem)),
              quantityReceived: isFixedAsset
                ? String(getPositiveIntegerQuantity(receivedMap[sourceItem.id]))
                : receivedMap[sourceItem.id] || "0",
              unit: sourceItem.unit || undefined,
              unitPrice: formatMoneyPayload(
                priceMap[sourceItem.id] ||
                  String(sourceItem.unitPrice ?? "0.00")
              ),
              taxCode: taxDraft.taxCode,
              additionalTaxCodes: taxDraft.additionalTaxCodes,
              ...getReceiptTargetPayload(targetByItemId[sourceItem.id] ?? null),
              notes: isCurrentSavedItem
                ? draft.notes.trim() || undefined
                : sourceItemDraft.notes.trim() || undefined,
              isFixedAsset,
              isLeasing: isFixedAsset
                ? isCurrentSavedItem
                  ? draft.isLeasing
                  : sourceItemDraft.isLeasing ||
                    updatedPoItem?.isLeasing === true
                : false,
              assetDetails: isFixedAsset ? details : [],
            };
          }),
          ...buildManualReceiptItemPayload(),
        ],
      });
    })().catch(error => {
      toast.error(
        error instanceof Error
          ? error.message
          : "No se pudo guardar el borrador"
      );
    });
  };

  const handleRegisterReceipt = () => {
    const receiptProjectForSubmit = selectedReceiptProjectId;
    if (!sourceId) {
      toast.error("Selecciona un documento origen válido");
      return;
    }
    if (!receiptProjectForSubmit) {
      toast.error("Seleccione el proyecto de la recepción");
      return;
    }
    if (receiptWarehouseSelectionError) {
      toast.error(receiptWarehouseSelectionError);
      return;
    }
    if (contractReceiptBlockReason) {
      toast.error(contractReceiptBlockReason);
      return;
    }
    const fixedAssetBlockReason = getFixedAssetReceiptBlockReason();
    if (fixedAssetBlockReason) {
      toast.error(fixedAssetBlockReason);
      return;
    }
    if (pendingReceiptAttachments.length === 0) {
      toast.error("Adjunta al menos un comprobante para procesar la recepción");
      return;
    }

    const isPurchaseOrderFiscalDocument =
      sourceType === "purchase_order" && isFiscalDocument;

    if (isPurchaseOrderFiscalDocument) {
      if (!cai.trim()) {
        toast.error("Ingresa el CAI del documento");
        return;
      }
      if (!isValidCai(cai)) {
        toast.error(`El CAI debe tener el formato ${CAI_FORMAT_EXAMPLE}`);
        return;
      }
      if (!invoiceNumber.trim()) {
        toast.error("Ingresa el número documento");
        return;
      }
      if (!isValidInvoiceNumber(invoiceNumber)) {
        toast.error(
          `El número documento debe tener el formato ${INVOICE_NUMBER_FORMAT_EXAMPLE}`
        );
        return;
      }
      if (!documentRangeStart.trim()) {
        toast.error("Ingresa el rango autorizado inicial");
        return;
      }
      if (!isValidInvoiceNumber(documentRangeStart)) {
        toast.error(
          `El rango autorizado inicial debe tener el formato ${INVOICE_NUMBER_FORMAT_EXAMPLE}`
        );
        return;
      }
      if (!documentRangeEnd.trim()) {
        toast.error("Ingresa el rango autorizado final");
        return;
      }
      if (!isValidInvoiceNumber(documentRangeEnd)) {
        toast.error(
          `El rango autorizado final debe tener el formato ${INVOICE_NUMBER_FORMAT_EXAMPLE}`
        );
        return;
      }
      if (
        !isFiscalInvoiceRangeOrdered({
          documentRangeStart,
          documentRangeEnd,
        })
      ) {
        toast.error(
          "El rango autorizado final debe ser mayor o igual al inicial"
        );
        return;
      }
      if (
        !isInvoiceNumberWithinFiscalRange({
          invoiceNumber,
          documentRangeStart,
          documentRangeEnd,
        })
      ) {
        toast.error(
          "El número documento debe estar dentro del rango autorizado"
        );
        return;
      }
      if (!documentDate) {
        toast.error("Selecciona la fecha del documento");
        return;
      }
      if (!documentDueDate) {
        toast.error("Selecciona la fecha de vencimiento (crédito)");
        return;
      }
      if (!emissionDeadline) {
        toast.error("Selecciona la fecha límite de emisión");
        return;
      }
    }

    for (const item of sourceItems as any[]) {
      const draft = getReceiptAssetDraft(item.id);
      if (!draft.isFixedAsset) continue;

      const receivedQuantity = Number(receivedMap[item.id] ?? 0);
      if (sourceType === "purchase_order") {
        if (!item.fixedAssetArticleId) {
          toast.error(
            `Guarde como borrador el activo fijo de ${item.itemName}`
          );
          return;
        }
        const progress = getReceiptFixedAssetProgress(item, receivedQuantity);
        if (progress.pending > 0) {
          toast.error(
            `Contabilidad debe resolver ${progress.pending} activo(s) fijo(s) de ${item.itemName}`
          );
          return;
        }
      }
      if (
        !Number.isFinite(receivedQuantity) ||
        receivedQuantity <= 0 ||
        !Number.isInteger(receivedQuantity)
      ) {
        toast.error(
          `Activo fijo en ${item.itemName} requiere cantidad entera mayor que cero`
        );
        return;
      }

      const assetDetails = normalizeFixedAssetDetails(
        draft.assetDetails,
        receivedQuantity
      );
      const missingIndex = assetDetails.findIndex(
        detail => !detail.serialNumber.trim() || !detail.condition
      );
      if (missingIndex >= 0) {
        toast.error(
          `Completa serie y condición de ${item.itemName}, unidad ${
            missingIndex + 1
          }`
        );
        return;
      }
    }

    const receiptItems: any[] = [
      ...(sourceItems as any[]).flatMap((item: any): any[] => {
        const closureDraft = transferClosureDrafts[item.id];
        const closeQuantity =
          sourceType === "transfer" && closureDraft
            ? getTransferCloseQuantity(item)
            : 0;
        const assetDraft = getReceiptAssetDraft(item.id);
        const isFixedAsset = assetDraft.isFixedAsset === true;
        const isNonInventoryLine =
          sourceType === "purchase_order" && isReceiptNonInventoryItem(item);
        const receivedQuantity = getPositiveIntegerQuantity(
          receivedMap[item.id]
        );
        const taxDraft =
          sourceType === "purchase_order" ? getReceiptLineTaxDraft(item) : null;
        const basePayload = {
          requiresWarehouse: !isNonInventoryLine,
          sourceItemId: item.id,
          warehouseId: isNonInventoryLine
            ? undefined
            : warehouseByItemId[item.id]
              ? Number(warehouseByItemId[item.id])
              : undefined,
          itemName: item.itemName,
          quantityExpected: String(getReceivableQuantity(item)),
          quantityReceived: receivedMap[item.id] || "0",
          unit: item.unit || undefined,
          unitPrice:
            sourceType === "purchase_order"
              ? formatMoneyPayload(
                  priceMap[item.id] || String(item.unitPrice ?? "0.00")
                )
              : "0.00",
          ...(taxDraft
            ? {
                taxCode: taxDraft.taxCode,
                additionalTaxCodes: taxDraft.additionalTaxCodes,
                ...getReceiptTargetPayload(targetByItemId[item.id] ?? null),
              }
            : {}),
          notes: assetDraft.notes.trim() || undefined,
          isFixedAsset,
          isLeasing: isFixedAsset ? assetDraft.isLeasing : false,
          closeRemaining: closeQuantity > 0,
          closeReason:
            closeQuantity > 0
              ? TRANSFER_CLOSE_REASONS.find(
                  reason => reason.value === closureDraft?.reason
                )?.label || closureDraft?.reason
              : undefined,
          closeNote: closeQuantity > 0 ? closureDraft?.note : undefined,
        };

        if (
          sourceType === "purchase_order" &&
          isFixedAsset &&
          receivedQuantity > 1
        ) {
          const fullAssetDetails = normalizeFixedAssetDetails(
            assetDraft.assetDetails,
            receivedQuantity
          );
          const receivedOffset = Math.max(
            Math.trunc(Number(item.receivedQuantity ?? 0)),
            0
          );
          const articleRows = getReceiptFixedAssetArticleRows(
            item,
            fullAssetDetails,
            Math.max(receivedQuantity, fullAssetDetails.length)
          ).slice(receivedOffset, receivedOffset + receivedQuantity);

          if (articleRows.length > 1) {
            return articleRows.map(({ article, detail }: any, index) => {
              const absoluteIndex = receivedOffset + index;
              const articleCode =
                getReceiptFixedAssetArticleDisplayCode(
                  article,
                  getSourceItemCode(item)
                );
              const unitDetail = getReceiptFixedAssetArticleDetail(
                article,
                detail
              );

              return {
                ...basePayload,
                sapItemCode:
                  articleCode === "—" ? getSourceItemCode(item) : articleCode,
                warehouseId: undefined,
                requiresWarehouse: false,
                itemName: article?.description || item.itemName,
                quantityExpected: "1.00",
                quantityReceived: "1",
                fixedAssetSapItemCode:
                  articleCode === "—" ? getSourceItemCode(item) : articleCode,
                fixedAssetName: article?.description || item.itemName,
                assetDetails: [unitDetail],
                notes:
                  assetDraft.notes.trim() ||
                  `Activo fijo unidad ${absoluteIndex + 1}`,
              };
            });
          }
        }

        return [{
          ...basePayload,
          sapItemCode: getSourceItemCode(item),
          assetDetails: isFixedAsset
            ? normalizeFixedAssetDetails(
                assetDraft.assetDetails,
                receivedQuantity
              )
            : [],
        }];
      }),
      ...(sourceType === "purchase_order"
        ? buildManualReceiptItemPayload()
        : []),
    ];

    const hasPositiveReceipt = receiptItems.some(
      item => Number(item.quantityReceived || 0) > 0
    );
    const missingWarehouse = receiptItems.find(
      item =>
        item.requiresWarehouse !== false &&
        Number(item.quantityReceived || 0) > 0 &&
        !item.warehouseId
    );
    if (missingWarehouse) {
      toast.error(`Seleccione almacén para ${missingWarehouse.itemName}`);
      return;
    }
    if (sourceType === "transfer") {
      const sourceItemById = new Map(
        (sourceItems as any[]).map(item => [Number(item.id), item])
      );
      const sameOriginWarehouse = receiptItems.find(item => {
        if (Number(item.quantityReceived || 0) <= 0 || !item.warehouseId) {
          return false;
        }
        const sourceItem = sourceItemById.get(Number(item.sourceItemId));
        return isSameTransferOriginScope(sourceItem, item.warehouseId);
      });
      if (sameOriginWarehouse) {
        toast.error(
          `${sameOriginWarehouse.itemName}: no se puede ingresar a la misma bodega/proyecto de origen`
        );
        return;
      }
      const wrongReturnDestinationWarehouse = receiptItems.find(item => {
        if (
          Number(item.quantityReceived || 0) <= 0 ||
          !item.warehouseId ||
          !lockedReturnDestinationWarehouseId
        ) {
          return false;
        }
        return (
          Number(item.warehouseId) !==
          Number(lockedReturnDestinationWarehouseId)
        );
      });
      if (wrongReturnDestinationWarehouse) {
        toast.error(
          `${wrongReturnDestinationWarehouse.itemName}: debe ingresar a la bodega destino de la devolución`
        );
        return;
      }
    }
    const hasTransferClosure = receiptItems.some(item => item.closeRemaining);

    if (!hasPositiveReceipt && !hasTransferClosure) {
      toast.error(
        "Ingresa al menos una cantidad mayor que cero o cierra un saldo pendiente"
      );
      return;
    }

    const invalidClosure = receiptItems.find(
      item => item.closeRemaining && (!item.closeReason || !item.closeNote)
    );
    if (invalidClosure) {
      toast.error("Completa el motivo y la nota del cierre incompleto");
      return;
    }

    const otherChargesPayload =
      sourceType === "purchase_order" ? getReceiptOtherChargesPayload() : [];
    for (const charge of otherChargesPayload) {
      if (!charge.concept) {
        toast.error("Ingrese el concepto de cada otro cargo");
        return;
      }
      const amount = Number(charge.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        toast.error("Ingrese un monto mayor que cero para cada otro cargo");
        return;
      }
    }

    const currentPostingDate = todayDateValue();
    setPostingDate(currentPostingDate);
    const registrationItems = receiptItems.map(
      ({ requiresWarehouse: _requiresWarehouse, ...item }) => item
    );

    registerMutation.mutate({
      sourceType,
      sourceId: Number(sourceId),
      projectId: receiptProjectForSubmit,
      isFiscalDocument:
        sourceType === "purchase_order" ? isFiscalDocument : false,
      cai: cai.trim()
        ? isPurchaseOrderFiscalDocument
          ? formatCaiInput(cai)
          : cai.trim()
        : undefined,
      invoiceNumber: invoiceNumber.trim()
        ? isPurchaseOrderFiscalDocument
          ? formatInvoiceNumberInput(invoiceNumber)
          : invoiceNumber.trim()
        : undefined,
      documentRangeStart:
        sourceType === "purchase_order" && documentRangeStart.trim()
          ? isPurchaseOrderFiscalDocument
            ? formatInvoiceNumberInput(documentRangeStart)
            : documentRangeStart.trim()
          : undefined,
      documentRangeEnd:
        sourceType === "purchase_order" && documentRangeEnd.trim()
          ? isPurchaseOrderFiscalDocument
            ? formatInvoiceNumberInput(documentRangeEnd)
            : documentRangeEnd.trim()
          : undefined,
      documentDate: documentDate || undefined,
      documentDueDate: documentDueDate || undefined,
      postingDate: currentPostingDate,
      receiptDate,
      emissionDeadline: emissionDeadline || undefined,
      notes: notes || undefined,
      items: registrationItems,
      otherCharges: otherChargesPayload,
    });
  };

  const handlePendingReceiptAttachmentChange = async (
    event: ChangeEvent<HTMLInputElement>
  ) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) return;

    setPreparingReceiptAttachment(true);
    try {
      const preparedAttachments: PendingReceiptAttachment[] = [];
      for (const file of files) {
        const prepared = await prepareDocumentAttachment(file);
        preparedAttachments.push({
          ...prepared,
          id: `${file.name}-${file.size}-${file.lastModified}-${Math.random()
            .toString(36)
            .slice(2)}`,
        });
      }

      setPendingReceiptAttachments(current => [
        ...current,
        ...preparedAttachments,
      ]);
      toast.success(
        preparedAttachments.length === 1
          ? "Adjunto listo para subir"
          : `${preparedAttachments.length} adjuntos listos para subir`
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "No se pudo preparar el adjunto"
      );
    } finally {
      setPreparingReceiptAttachment(false);
    }
  };

  const removePendingReceiptAttachment = (id: string) => {
    setPendingReceiptAttachments(current =>
      current.filter(attachment => attachment.id !== id)
    );
  };

  const receiptSourceHeaderTitle =
    receiptDetail?.receipt.sourceType === "purchase_order"
      ? receiptPurchaseOrderDetail?.purchaseOrder.orderNumber ||
        "Orden de Compra"
      : receiptTransferDetail?.transfer?.transferNumber || "Traslado";

  const receiptSourceSecondaryLabel =
    receiptDetail?.receipt.sourceType === "purchase_order"
      ? receiptPurchaseOrderDetail?.supplier
        ? `${receiptPurchaseOrderDetail.supplier.supplierCode} — ${receiptPurchaseOrderDetail.supplier.name}`
        : "Proveedor pendiente"
      : receiptTransferDetail?.transferRequest
        ? `Origen: ${getTransferOriginLabel(receiptTransferDetail, "Proyecto origen")}`
        : "—";
  const receiptSourceSupplierRtnLabel =
    receiptDetail?.receipt.sourceType === "purchase_order"
      ? formatSupplierRtnLabel(
          receiptPurchaseOrderDetail?.supplier ?? receiptDetail?.supplier
        )
      : null;

  const receiptSourceStatusLabel = receiptDetail
    ? receiptDetail.receipt.sourceType === "purchase_order"
      ? PURCHASE_ORDER_STATUS_LABELS[
          receiptPurchaseOrderDetail?.purchaseOrder.status || ""
        ] || "—"
      : TRANSFER_STATUS_LABELS[receiptTransferDetail?.transfer?.status || ""] ||
        "—"
    : "—";

  const receiptSourceDetailLoading =
    receiptDetail?.receipt.sourceType === "purchase_order"
      ? receiptPurchaseOrderDetailLoading
      : receiptDetail?.receipt.sourceType === "transfer"
        ? receiptTransferDetailLoading
        : false;

  const receiptSourceItemCodes = useMemo(() => {
    const sourceItems =
      receiptDetail?.receipt.sourceType === "purchase_order"
        ? receiptPurchaseOrderDetail?.items
        : receiptTransferDetail?.items;

    return new Map(
      (sourceItems ?? []).map((item: any) => [item.id, getSourceItemCode(item)])
    );
  }, [
    receiptDetail?.receipt.sourceType,
    receiptPurchaseOrderDetail?.items,
    receiptTransferDetail?.items,
  ]);

  const receiptSourceItemsById = useMemo(() => {
    const sourceItems =
      receiptDetail?.receipt.sourceType === "purchase_order"
        ? receiptPurchaseOrderDetail?.items
        : receiptTransferDetail?.items;

    return new Map((sourceItems ?? []).map((item: any) => [item.id, item]));
  }, [
    receiptDetail?.receipt.sourceType,
    receiptPurchaseOrderDetail?.items,
    receiptTransferDetail?.items,
  ]);

  const receiptDetailPricingSummary = useMemo(() => {
    if (
      !receiptDetail ||
      receiptDetail.receipt.sourceType !== "purchase_order"
    ) {
      return null;
    }

    return summarizePurchaseOrderLines(
      receiptDetail.items.map((item: any) =>
        getReceiptLineTaxSummaryInput(
          item,
          receiptSourceItemsById.get(item.sourceItemId)
        )
      )
    );
  }, [receiptDetail, receiptSourceItemsById]);
  const receiptDetailOtherChargesTotal = useMemo(
    () => getOtherChargesTotal((receiptDetail as any)?.otherCharges ?? []),
    [receiptDetail]
  );
  const canEditReceiptCorrections =
    user?.role === "admin" ||
    userRole === "administracion_central" ||
    userRole === "administrador_proyecto";
  const receiptCorrectionInvoiceStatus = String(
    receiptDetail?.invoice?.status ?? ""
  );
  const receiptCorrectionDisabledReason =
    !receiptDetail ||
    receiptDetail.receipt.sourceType !== "purchase_order" ||
    receiptDetail.receipt.status === "anulada"
      ? null
      : !receiptDetail.invoice?.id
        ? "Esta recepción no tiene factura vinculada para corregir."
        : receiptDetail.invoice.status === "registrada"
          ? "La factura ya está contabilizada; no se puede corregir la recepción."
          : receiptDetail.invoice.status === "anulada"
            ? "La factura ya está anulada."
            : !CORRECTABLE_RECEIPT_INVOICE_STATUSES.has(
                  receiptCorrectionInvoiceStatus
                )
              ? "Esta factura no permite corrección de recepción."
              : !canEditReceiptCorrections
                ? "No tienes permisos para corregir recepciones."
                : null;
  const canOpenReceiptCorrection =
    Boolean(receiptDetail?.invoice?.id) &&
    !receiptCorrectionDisabledReason &&
    receiptDetail?.receipt.sourceType === "purchase_order" &&
    receiptDetail?.receipt.status !== "anulada";

  const handlePrintReceipt = () => {
    if (!receiptDetail) return;

    const receipt = receiptDetail.receipt;
    const isPurchaseOrderReceipt = receipt.sourceType === "purchase_order";
    const sourceItems = isPurchaseOrderReceipt
      ? (receiptPurchaseOrderDetail?.items ?? [])
      : (receiptTransferDetail?.items ?? []);
    const sourceItemsById = new Map(
      sourceItems.map((item: any) => [item.id, item])
    );
    const warehouseLabel = formatReceiptWarehouseLabel(receiptDetail);
    const projectLabel = formatReceiptProjectLabel(receiptDetail, warehouseLabel);
    const receivedByLabel = formatUserReference(
      (receiptDetail as any).receivedBy,
      receipt.receivedById
    );
    const receiptOriginalRequester = (receiptPurchaseOrderDetail as any)
      ?.originalRequester;
    const requestedByLabel = isPurchaseOrderReceipt
      ? receiptOriginalRequester?.name ||
        receiptOriginalRequester?.email ||
        receiptPurchaseOrderDetail?.createdBy?.name ||
        receivedByLabel
      : receivedByLabel;
    const sourceWarehouseLabel = isPurchaseOrderReceipt
      ? warehouseLabel
      : getTransferOriginLabel(receiptTransferDetail, "-");
    const supplierLabel = isPurchaseOrderReceipt
      ? receiptPurchaseOrderDetail?.supplier?.name ||
        receiptDetail.supplier?.name ||
        "-"
      : "-";
    const supplierRtnLabel = isPurchaseOrderReceipt
      ? receiptPurchaseOrderDetail?.supplier?.rtn ||
        receiptDetail.supplier?.rtn ||
        "-"
      : "-";
    const documentTypeLabel = isPurchaseOrderReceipt
      ? receipt.isFiscalDocument
        ? getDocumentTypeLabelFromNumber(receipt.invoiceNumber) ||
          "Documento fiscal"
        : "Documento extranjero"
      : "Traslado";
    const referenceLabel = isPurchaseOrderReceipt ? "Compra" : "Traslado";
    const observations = receipt.notes?.trim() || "-";
    const receiptOtherCharges = isPurchaseOrderReceipt
      ? ((receiptDetail as any).otherCharges ?? [])
          .map((charge: any) => ({
            concept: String(charge.concept ?? "").trim(),
            amount: Number(charge.amount ?? 0),
          }))
          .filter(
            (charge: { concept: string; amount: number }) =>
              charge.concept &&
              Number.isFinite(charge.amount) &&
              charge.amount > 0
          )
      : [];

    const summaryLines: Array<{
      quantity: string | number | null | undefined;
      unitPrice?: string | number | null;
      taxCode?: string | null;
      additionalTaxCodes?: string[] | string | null;
      taxBreakdown?: any;
    }> = [];
    const itemRows = receiptDetail.items
      .map((item: any, index: number) => {
        const sourceItem: any = sourceItemsById.get(item.sourceItemId);
        const sourceCode =
          getSourceItemCode(sourceItem ?? item) ||
          receiptSourceItemCodes.get(item.sourceItemId) ||
          "-";
        const companyCode =
          sourceItem?.originalSapItemCode ||
          sourceItem?.sapItemCode ||
          sourceItem?.currentSapItemCode ||
          sourceCode;
        const partNumber =
          sourceItem?.partNumber ||
          sourceItem?.catalogItem?.partNumber ||
          sourceItem?.currentSapItemCode ||
          sourceItem?.sapItemCode ||
          sourceItem?.originalSapItemCode ||
          sourceCode;
        const brandHtml =
          sourceItem?.brand || sourceItem?.catalogItem?.brand
            ? `<div class="line-note"><strong>Marca:</strong> ${escapeHtml(
                sourceItem?.brand || sourceItem?.catalogItem?.brand
              )}</div>`
            : "";
        const unitPrice = isPurchaseOrderReceipt
          ? (item.unitPrice ?? sourceItem?.unitPrice ?? "0.00")
          : "0.00";
        const summaryInput = getReceiptLineTaxSummaryInput(item, sourceItem);
        const amounts = calculatePurchaseOrderLineAmounts(summaryInput);
        summaryLines.push(summaryInput);
        const assetDetails = parseFixedAssetDetails(item.assetDetails);
        const targetLabel = isPurchaseOrderReceipt
          ? formatReceiptLineTargetLabel(item, sourceItem, receipt.projectId)
          : null;
        const targetCellLabel = targetLabel || "-";
        const itemWarehouseLabel = formatReceiptItemWarehouseLabel(
          item,
          warehouseLabel
        );
        const notesHtml = item.notes?.trim()
          ? `<div class="line-note">${escapeHtml(item.notes)}</div>`
          : "";
        const assetHtml = item.isFixedAsset
          ? `
            <div class="asset-meta">
              <strong>Activo fijo${item.isLeasing ? " · Leasing" : ""}</strong>
              ${assetDetails
                .map(
                  (detail, detailIndex) =>
                    `<div>Unidad ${detailIndex + 1}: ${escapeHtml(
                      getAssetDetailSummary(detail)
                    )}</div>`
                )
                .join("")}
            </div>
          `
          : "";

        return `
          <tr>
            <td>${escapeHtml(companyCode || "-")}</td>
            <td>${escapeHtml(item.itemName)}${brandHtml}${notesHtml}${assetHtml}</td>
            <td>${escapeHtml(itemWarehouseLabel)}</td>
            <td>${escapeHtml(targetCellLabel)}</td>
            <td class="center">${escapeHtml(partNumber || "-")}</td>
            <td class="numeric">${escapeHtml(formatPrintNumber(item.quantityReceived))}</td>
            <td class="center">${escapeHtml(item.unit || "-")}</td>
            <td class="numeric">${escapeHtml(formatPrintMoney(unitPrice))}</td>
            <td class="numeric">${escapeHtml(formatPrintMoney(amounts.subtotal))}</td>
          </tr>
        `;
      })
      .join("");
    const otherChargeRows = receiptOtherCharges
      .map(
        (charge: { concept: string; amount: number }) => `
          <tr class="charge-row">
            <td>-</td>
            <td><strong>Otros cargos:</strong> ${escapeHtml(charge.concept)}</td>
            <td class="center">-</td>
            <td class="center">-</td>
            <td class="center">-</td>
            <td class="numeric">-</td>
            <td class="center">-</td>
            <td class="numeric">-</td>
            <td class="numeric">${escapeHtml(formatPrintMoney(charge.amount))}</td>
          </tr>
        `
      )
      .join("");
    const fiscalSummary = summarizePurchaseOrderLines(summaryLines);
    const otherChargesTotal = getOtherChargesTotal(receiptOtherCharges);
    const fiscalSummaryBaseRows =
      getPurchaseOrderFiscalSummaryRows(fiscalSummary);
    const fiscalSummaryRowsWithCharges =
      otherChargesTotal > 0
        ? [
            ...fiscalSummaryBaseRows.filter(row => row.key !== "total"),
            {
              key: "other-charges",
              label: "Otros cargos L.",
              value: otherChargesTotal,
              emphasized: false,
            },
            {
              ...fiscalSummaryBaseRows.find(row => row.key === "total")!,
              value: fiscalSummary.total + otherChargesTotal,
            },
          ]
        : fiscalSummaryBaseRows;
    const fiscalSummaryRows = fiscalSummaryRowsWithCharges
      .map(
        row => `
        <tr>
          <td>${escapeHtml(
            row.label
              .replace(/\blempiras\b/gi, "")
              .replace(/\s+/g, " ")
              .trim()
          )}</td>
          <td class="numeric">${escapeHtml(formatPrintMoneyAmount(row.value))}</td>
        </tr>
      `
      )
      .join("");

    const printWindow = window.open("", "_blank", "width=840,height=1000");
    if (!printWindow) {
      toast.error("No se pudo abrir la ventana de impresión");
      return;
    }

    printWindow.document.write(`
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>${escapeHtml(receipt.receiptNumber)}</title>
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
              grid-template-columns: 104px 1fr;
              min-height: 12px;
            }
            .meta-column.right .field {
              grid-template-columns: 96px 1fr;
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
            @media print {
              .sheet { max-width: none; padding: 0; }
            }
          </style>
        </head>
        <body>
          <main class="sheet">
            <section class="header">
              ${getPrintLogoMarkup()}
              <div class="title">
                <div class="company">HIDALGO E HIDALGO HONDURAS S.A. DE C.V.</div>
                <div>${escapeHtml(warehouseLabel)}</div>
                <div>INGRESO BODEGA</div>
              </div>
              <div class="document-number">${escapeHtml(receipt.receiptNumber)}</div>
            </section>

            <section class="meta">
              <div class="meta-column">
                <div class="field">
                  <div class="label">Fecha Documento:</div>
                  <div class="value">${escapeHtml(formatPrintDate(receipt.documentDate))}</div>
                </div>
                <div class="field">
                  <div class="label">Fecha Vencimiento (crédito):</div>
                  <div class="value">${escapeHtml(formatPrintDate(receipt.documentDueDate))}</div>
                </div>
                <div class="field">
                  <div class="label">No Pedido:</div>
                  <div class="value">${escapeHtml(receiptSourceHeaderTitle)}</div>
                </div>
                <div class="field">
                  <div class="label">Job:</div>
                  <div class="value">${escapeHtml(projectLabel)}</div>
                </div>
                <div class="field">
                  <div class="label">Solicitado por:</div>
                  <div class="value">${escapeHtml(requestedByLabel)}</div>
                </div>
                <div class="field">
                  <div class="label">De Bodega:</div>
                  <div class="value">${escapeHtml(sourceWarehouseLabel)}</div>
                </div>
                <div class="field">
                  <div class="label">Fecha Ingreso:</div>
                  <div class="value">${escapeHtml(formatPrintDate(receipt.receiptDate))}</div>
                </div>
              </div>
              <div class="meta-column right">
                <div class="field">
                  <div class="label">Proveedor:</div>
                  <div class="value">${escapeHtml(supplierLabel)}</div>
                </div>
                <div class="field">
                  <div class="label">RTN Proveedor:</div>
                  <div class="value">${escapeHtml(supplierRtnLabel)}</div>
                </div>
                <div class="field">
                  <div class="label">Tipo Documento:</div>
                  <div class="value">${escapeHtml(documentTypeLabel)}</div>
                </div>
                <div class="field">
                  <div class="label">No Documento:</div>
                  <div class="value">${escapeHtml(receipt.invoiceNumber || "-")}</div>
                </div>
                <div class="field">
                  <div class="label">Rango Autorizado Inicial:</div>
                  <div class="value">${escapeHtml(receipt.documentRangeStart || "-")}</div>
                </div>
                <div class="field">
                  <div class="label">Rango Autorizado Final:</div>
                  <div class="value">${escapeHtml(receipt.documentRangeEnd || "-")}</div>
                </div>
                <div class="field">
                  <div class="label">Referencia:</div>
                  <div class="value">${escapeHtml(referenceLabel)}</div>
                </div>
                <div class="field">
                  <div class="label">Observacion:</div>
                  <div class="value">${escapeHtml(observations)}</div>
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
                  <th style="width: 7%;" class="numeric">Valor U</th>
                  <th style="width: 6%;" class="numeric">Valor T</th>
                </tr>
              </thead>
              <tbody>
                ${itemRows || `<tr><td colspan="9">Sin ítems</td></tr>`}
                ${otherChargeRows}
              </tbody>
            </table>

            <section class="summary">
              <table class="summary-table">
                <tbody>
                  ${fiscalSummaryRows}
                </tbody>
              </table>
            </section>

            <section class="signatures">
              <div class="signature-line">Elaborado</div>
            </section>
          </main>
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindowWhenReady(printWindow);
  };

  const filteredReceipts = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();

    return (receipts ?? []).filter((row: any) => {
      const receipt = row.receipt;
      const sourceTypeLabel =
        receipt.sourceType === "purchase_order"
          ? SOURCE_TYPE_LABELS.purchase_order
          : SOURCE_TYPE_LABELS.transfer;
      const projectLabel = row.project
        ? `${row.project.code} ${row.project.name}`
        : "";
      const matchesSearch =
        !normalizedSearch ||
        [
          receipt.receiptNumber,
          receipt.invoiceNumber,
          receipt.documentRangeStart,
          receipt.documentRangeEnd,
          row.purchaseOrder?.orderNumber,
          row.supplier?.name,
          row.supplier?.supplierCode,
          row.supplier?.rtn,
          sourceTypeLabel,
          projectLabel,
        ]
          .filter(Boolean)
          .some(value =>
            String(value).toLowerCase().includes(normalizedSearch)
          );
      const matchesStatus =
        statusFilter === "all" || receipt.status === statusFilter;
      const matchesSourceType =
        sourceTypeFilter === "all" || receipt.sourceType === sourceTypeFilter;

      return matchesSearch && matchesStatus && matchesSourceType;
    });
  }, [receipts, searchTerm, sourceTypeFilter, statusFilter]);

  const exportReceiptsCsv = () => {
    downloadCsv(
      buildDatedCsvFileName("recepciones"),
      [
        {
          header: "No. Recepción",
          value: (row: any) => row.receipt.receiptNumber,
        },
        {
          header: "Proyecto",
          value: (row: any) =>
            row.project ? `${row.project.code} — ${row.project.name}` : "—",
        },
        {
          header: "Proveedor",
          value: (row: any) =>
            row.supplier
              ? `${row.supplier.supplierCode} — ${row.supplier.name}`
              : "—",
        },
        {
          header: "RTN proveedor",
          value: (row: any) => row.supplier?.rtn || "—",
        },
        {
          header: "Tipo",
          value: (row: any) =>
            row.receipt.sourceType === "purchase_order"
              ? SOURCE_TYPE_LABELS.purchase_order
              : SOURCE_TYPE_LABELS.transfer,
        },
        {
          header: "Estatus",
          value: (row: any) => getReceiptStatusLabel(row.receipt, row.invoice),
        },
        {
          header: "Fecha",
          value: (row: any) =>
            formatDateLabel(row.receipt.receiptDate || row.receipt.createdAt),
        },
      ],
      filteredReceipts
    );
  };
  const openDraftReceiptForEdit = (row: any) => {
    resetForm();
    setViewReceiptId(null);
    setEditingDraftReceiptId(row.receipt.id);
    setSourceType(row.receipt.sourceType);
    setSourceId(String(row.receipt.sourceId));
    setNotes(row.receipt.notes ?? "");
    setIsFiscalDocument(row.receipt.isFiscalDocument === true);
    setCai(row.receipt.cai ?? "");
    setInvoiceNumber(row.receipt.invoiceNumber ?? "");
    setDocumentRangeStart(row.receipt.documentRangeStart ?? "");
    setDocumentRangeEnd(row.receipt.documentRangeEnd ?? "");
    setDocumentDate(toDateInputValue(row.receipt.documentDate));
    setDocumentDueDate(toDateInputValue(row.receipt.documentDueDate));
    setPostingDate(
      toDateInputValue(row.receipt.postingDate) || todayDateValue()
    );
    setReceiptDate(
      toDateInputValue(row.receipt.receiptDate) || todayDateValue()
    );
    setDialogOpen(true);
  };
  const handleCorrectReceiptFromReceipt = () => {
    const invoiceId = Number(receiptDetail?.invoice?.id);
    if (!Number.isInteger(invoiceId) || invoiceId <= 0) {
      toast.error("No se encontró una factura vinculada a esta recepción.");
      return;
    }
    if (!canOpenReceiptCorrection) {
      toast.error(
        receiptCorrectionDisabledReason ||
          "Esta recepción no permite corrección."
      );
      return;
    }
    if (receiptCorrectionReason.trim().length < 5) {
      toast.error("Escribe un motivo de corrección de al menos 5 caracteres");
      return;
    }
    correctReceiptMutation.mutate({
      id: invoiceId,
      reason: receiptCorrectionReason.trim(),
    });
  };
  const fixedAssetReceiptBlockReason = getFixedAssetReceiptBlockReason();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1>Recepciones</h1>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={exportReceiptsCsv}
            disabled={!filteredReceipts.length}
          >
            <Download className="mr-2 h-4 w-4" />
            Exportar CSV
          </Button>

          <Dialog
            open={dialogOpen}
            onOpenChange={open => {
              setDialogOpen(open);
              if (open) {
                setPostingDate(todayDateValue());
                setReceiptDate(todayDateValue());
              } else {
                resetForm();
              }
            }}
          >
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                Nueva recepción
              </Button>
            </DialogTrigger>
            <DialogContent className="scrollbar-visible max-h-[calc(100vh-0.5rem)] w-[calc(100vw-0.25rem)] max-w-[calc(100vw-0.25rem)] overflow-x-hidden overflow-y-auto rounded-2xl p-4 sm:max-h-[calc(100vh-1rem)] sm:w-[calc(100vw-0.75rem)] sm:max-w-[1920px] sm:p-6 lg:p-7">
              <DialogHeader className="border-b border-border/70 pb-4 pr-10">
                <div className="flex flex-wrap items-center gap-3">
                  <DialogTitle className="text-[2rem] font-bold tracking-tight sm:text-[2.4rem]">
                    {sourceHeaderTitle}
                  </DialogTitle>
                  {sourceStatusLabel ? (
                    <Badge
                      variant="outline"
                      className={`text-sm ${
                        isContractPurchaseOrder
                          ? purchaseOrderContractSummary.isExpired
                            ? "border-rose-300 bg-rose-50 text-rose-700"
                            : purchaseOrderContractSummary.expiresSoon
                              ? "border-amber-300 bg-amber-50 text-amber-800"
                              : "border-cyan-300 bg-cyan-50 text-cyan-700"
                          : getSourceStatusColor(sourceType, sourceStatusKey)
                      }`}
                    >
                      {sourceStatusLabel}
                    </Badge>
                  ) : null}
                </div>
              </DialogHeader>

              <div className="min-w-0 space-y-5">
                <div className="grid gap-3 md:grid-cols-12">
                  <div className="space-y-2.5 rounded-2xl border border-border/70 bg-muted/20 p-3.5 sm:p-4 md:col-span-3">
                    <Label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground sm:text-xs">
                      Tipo de origen
                    </Label>
                    <Select
                      value={sourceType}
                      onValueChange={value => {
                        fiscalRangeAutofillRef.current = null;
                        lastFiscalRangeLookupKeyRef.current = "";
                        setSourceType(value as "purchase_order" | "transfer");
                        setSourceId("");
                        setReceivedMap({});
                        setWarehouseByItemId({});
                        setReceiptProjectId("");
                        setReceiptWarehouseId("");
                        setPriceMap({});
                        setSubtotalMap({});
                        setTaxCodeByItemId({});
                        setAdditionalTaxCodesByItemId({});
                        setTargetByItemId({});
                        setTargetPopoverOpen(null);
                        setTargetSearch("");
                        setManualReceiptItems([]);
                        setManualItemSearch("");
                        setManualItemPopoverOpen(false);
                        setIsFiscalDocument(true);
                        setCai("");
                        setInvoiceNumber("");
                        setDocumentRangeStart("");
                        setDocumentRangeEnd("");
                        setDocumentDate("");
                        setDocumentDueDate("");
                        setEmissionDeadline("");
                        setPostingDate(todayDateValue());
                        setReceiptDate(todayDateValue());
                        setTransferClosureDrafts({});
                      }}
                    >
                      <SelectTrigger className="h-11 w-full text-sm sm:h-12 sm:text-base">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="purchase_order">
                          Orden de Compra
                        </SelectItem>
                        <SelectItem value="transfer">Traslado</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2.5 rounded-2xl border border-border/70 bg-muted/20 p-3.5 sm:p-4 md:col-span-5">
                    <Label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground sm:text-xs">
                      Documento origen
                    </Label>
                    <Select
                      value={sourceId}
                      onValueChange={value => {
                        fiscalRangeAutofillRef.current = null;
                        lastFiscalRangeLookupKeyRef.current = "";
                        setSourceId(value);
                        setReceivedMap({});
                        setWarehouseByItemId({});
                        setReceiptProjectId("");
                        setPriceMap({});
                        setSubtotalMap({});
                        setTaxCodeByItemId({});
                        setAdditionalTaxCodesByItemId({});
                        setTargetByItemId({});
                        setTargetPopoverOpen(null);
                        setTargetSearch("");
                        setManualReceiptItems([]);
                        setManualItemSearch("");
                        setManualItemPopoverOpen(false);
                        setIsFiscalDocument(true);
                        setCai("");
                        setInvoiceNumber("");
                        setDocumentRangeStart("");
                        setDocumentRangeEnd("");
                        setDocumentDate("");
                        setDocumentDueDate("");
                        setEmissionDeadline("");
                        setPostingDate(todayDateValue());
                        setReceiptDate(todayDateValue());
                        setTransferClosureDrafts({});
                      }}
                    >
                      <SelectTrigger className="h-11 w-full text-sm sm:h-12 sm:text-base">
                        <SelectValue placeholder="Seleccione documento" />
                      </SelectTrigger>
                      <SelectContent className="max-h-[320px]">
                        {sourceType === "purchase_order"
                          ? availablePurchaseOrders.map((row: any) => (
                              <SelectItem
                                key={row.purchaseOrder.id}
                                value={String(row.purchaseOrder.id)}
                                className="py-2.5"
                              >
                                {row.purchaseOrder.orderNumber} —{" "}
                                {row.supplier?.name || "Proveedor pendiente"}
                                {row.purchaseOrder.appliesContract &&
                                row.contractSummary?.statusLabel
                                  ? ` — ${row.contractSummary.statusLabel}`
                                  : ""}
                              </SelectItem>
                            ))
                          : availableTransfers.map((row: any) => (
                              <SelectItem
                                key={row.transfer.id}
                                value={String(row.transfer.id)}
                                className="py-2.5"
                              >
                                {row.transfer.transferNumber} —{" "}
                                {row.transferRequest?.requestNumber ||
                                  "Solicitud"}
                                {" — "}
                                {getTransferDestinationLabel(
                                  row,
                                  "Destino pendiente"
                                )}
                              </SelectItem>
                            ))}
                      </SelectContent>
                    </Select>
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      {sourceType === "purchase_order"
                        ? "Solo aparecen órdenes emitidas con saldo pendiente o contratos vigentes por facturar."
                        : "Solo aparecen traslados confirmados con saldo pendiente por recibir."}
                    </p>
                  </div>

                  <div className="space-y-1.5 rounded-2xl border border-border/70 bg-muted/20 p-3.5 sm:p-4 md:col-span-2">
                    <Label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground sm:text-xs">
                      Proyecto
                    </Label>
                    <p className="text-sm font-semibold leading-snug sm:text-base">
                      {sourceProjectLabel}
                    </p>
                  </div>

                  <div className="space-y-1.5 rounded-2xl border border-border/70 bg-muted/20 p-3.5 sm:p-4 md:col-span-2">
                    <Label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground sm:text-xs">
                      Fecha base
                    </Label>
                    <p className="text-sm font-semibold leading-snug sm:text-base">
                      {sourceNeededByLabel}
                    </p>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-12">
                  <div
                    className={`space-y-1.5 rounded-2xl border border-border/70 bg-muted/20 p-3.5 sm:p-4 ${
                      sourceType === "transfer"
                        ? "md:col-span-3"
                        : "md:col-span-4"
                    }`}
                  >
                    <Label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground sm:text-xs">
                      {sourceType === "purchase_order"
                        ? "Proveedor"
                        : "Referencia del origen"}
                    </Label>
                    <p className="text-sm font-semibold leading-snug sm:text-base">
                      {sourceSecondaryLabel}
                    </p>
                    {sourceSupplierRtnLabel ? (
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        RTN: {sourceSupplierRtnLabel}
                      </p>
                    ) : null}
                  </div>
                  {sourceType === "transfer" ? (
                    <div className="space-y-1.5 rounded-2xl border border-border/70 bg-muted/20 p-3.5 sm:p-4 md:col-span-3">
                      <Label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground sm:text-xs">
                        Bodega origen
                      </Label>
                      <p className="text-sm font-semibold leading-snug sm:text-base">
                        {transferSourceWarehouseLabel || "Bodega pendiente"}
                      </p>
                    </div>
                  ) : null}
                  <div
                    className={`space-y-1.5 rounded-2xl border border-border/70 bg-muted/20 p-3.5 sm:p-4 ${
                      sourceType === "transfer"
                        ? "md:col-span-2"
                        : "md:col-span-3"
                    }`}
                  >
                    <Label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground sm:text-xs">
                      Estado del origen
                    </Label>
                    <p className="text-sm font-semibold leading-snug sm:text-base">
                      {sourceStatusLabel || "Pendiente de selección"}
                    </p>
                  </div>
                  <div className="space-y-1.5 rounded-2xl border border-border/70 bg-muted/20 p-3.5 sm:p-4 md:col-span-2">
                    <Label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground sm:text-xs">
                      Pendiente total
                    </Label>
                    <p className="text-sm font-semibold leading-snug sm:text-base">
                      {formatQuantity(totals.pending)}
                    </p>
                  </div>
                  <div className="space-y-1.5 rounded-2xl border border-border/70 bg-muted/20 p-3.5 sm:p-4 md:col-span-2">
                    <Label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground sm:text-xs">
                      Recibir ahora
                    </Label>
                    <p className="text-sm font-semibold leading-snug sm:text-base">
                      {formatQuantity(totals.receiving)}
                    </p>
                  </div>
                </div>

                {shouldShowReceiptEntryScopeControls ? (
                  <div className="rounded-2xl border border-border/70 bg-background p-3.5 sm:p-4">
                    <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <Label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground sm:text-xs">
                          Ingreso
                        </Label>
                        <p className="text-xs text-muted-foreground">
                          El cambio se aplica a todas las líneas de la recepción.
                        </p>
                      </div>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">
                          Almacén ingreso *
                        </Label>
                        <Select
                          value={receiptWarehouseSelectionValue || undefined}
                          onValueChange={handleReceiptHeaderWarehouseChange}
                          disabled={
                            !receiptHeaderWarehouseOptions.length ||
                            Boolean(lockedReturnDestinationWarehouseId) ||
                            registerMutation.isPending
                          }
                        >
                          <SelectTrigger
                            className={`h-11 ${
                              receiptWarehouseSelectionError
                                ? "border-destructive"
                                : ""
                            }`}
                          >
                            <SelectValue placeholder="Seleccione almacén" />
                          </SelectTrigger>
                          <SelectContent className="max-w-[min(720px,calc(100vw-2rem))]">
                            {receiptHeaderWarehouseOptions.map(
                              (warehouse: any) => (
                                <SelectItem
                                  key={warehouse.id}
                                  value={String(warehouse.id)}
                                >
                                  {formatWarehouseReference(
                                    warehouse,
                                    `Almacén ${warehouse.id}`
                                  )}
                                </SelectItem>
                              )
                            )}
                          </SelectContent>
                        </Select>
                        {receiptWarehouseSelectionError ? (
                          <p className="text-xs text-destructive">
                            {receiptWarehouseSelectionError}
                          </p>
                        ) : null}
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">
                          Proyecto *
                        </Label>
                        <Select
                          value={
                            selectedReceiptProjectId
                              ? String(selectedReceiptProjectId)
                              : undefined
                          }
                          onValueChange={handleReceiptHeaderProjectChange}
                          disabled={
                            Boolean(lockedReceiptProjectId) ||
                            !receiptWarehouseSelectionValue ||
                            registerMutation.isPending
                          }
                        >
                          <SelectTrigger className="h-11">
                            <SelectValue placeholder="Seleccione proyecto" />
                          </SelectTrigger>
                          <SelectContent className="max-w-[min(720px,calc(100vw-2rem))]">
                            {receiptHeaderProjectOptions.map((project: any) => (
                              <SelectItem
                                key={project.id}
                                value={String(project.id)}
                              >
                                {formatProjectReference(
                                  project,
                                  `Proyecto ${project.id}`
                                )}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>
                ) : null}

                {isContractPurchaseOrder ? (
                  <div
                    className={`flex items-start gap-2 rounded-xl border p-3 text-sm ${
                      contractReceiptBlockReason
                        ? "border-rose-300 bg-rose-50 text-rose-700"
                        : purchaseOrderContractSummary.expiresSoon
                          ? "border-amber-300 bg-amber-50 text-amber-800"
                          : "border-cyan-300 bg-cyan-50 text-cyan-700"
                    }`}
                  >
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      {contractReceiptBlockReason ||
                        `OC con contrato: ${purchaseOrderContractSummary.statusLabel}.`}
                    </span>
                  </div>
                ) : null}

                <div className="space-y-4 rounded-2xl border border-border/70 bg-muted/10 p-4 sm:p-5">
                  {sourceType === "purchase_order" ? (
                    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border/70 bg-background px-3 py-2.5">
                      <Checkbox
                        id="receipt-fiscal-document"
                        checked={isFiscalDocument}
                        onCheckedChange={checked => {
                          const nextIsFiscal = checked === true;
                          setIsFiscalDocument(nextIsFiscal);
                          if (nextIsFiscal) {
                            setCai(current => formatCaiInput(current));
                            setInvoiceNumber(current =>
                              formatInvoiceNumberInput(current)
                            );
                            setDocumentRangeStart(current =>
                              formatInvoiceNumberInput(current)
                            );
                            setDocumentRangeEnd(current =>
                              formatInvoiceNumberInput(current)
                            );
                          }
                        }}
                      />
                      <Label htmlFor="receipt-fiscal-document">
                        Documento fiscal
                      </Label>
                      <Badge variant="outline" className="text-xs">
                        {isFiscalDocument ? "Fiscal" : "Extranjero"}
                      </Badge>
                    </div>
                  ) : null}

                  <div
                    className={`grid min-w-0 gap-3 md:grid-cols-2 ${
                      sourceType === "purchase_order"
                        ? "lg:grid-cols-3 xl:grid-cols-4"
                        : "lg:grid-cols-2"
                    }`}
                  >
                    {sourceType === "purchase_order" ? (
                      <>
                        <div className="space-y-2">
                          <Label htmlFor="receipt-invoice-number">
                            Número documento
                          </Label>
                          <Input
                            id="receipt-invoice-number"
                            value={invoiceNumber}
                            onChange={event =>
                              setInvoiceNumber(
                                isFiscalDocument
                                  ? formatInvoiceNumberInput(event.target.value)
                                  : event.target.value
                              )
                            }
                            placeholder={
                              isFiscalDocument
                                ? INVOICE_NUMBER_FORMAT_EXAMPLE
                                : "Ej. INV-EXT-001"
                            }
                            inputMode={isFiscalDocument ? "numeric" : "text"}
                            maxLength={
                              isFiscalDocument
                                ? INVOICE_NUMBER_FORMAT_EXAMPLE.length
                                : undefined
                            }
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="receipt-cai">
                            {isFiscalDocument ? "CAI" : "CAI / referencia"}
                          </Label>
                          <Input
                            id="receipt-cai"
                            value={cai}
                            onChange={event =>
                              setCai(
                                isFiscalDocument
                                  ? formatCaiInput(event.target.value)
                                  : event.target.value
                              )
                            }
                            placeholder={
                              isFiscalDocument
                                ? CAI_FORMAT_EXAMPLE
                                : "Referencia del documento"
                            }
                            maxLength={
                              isFiscalDocument
                                ? CAI_FORMAT_EXAMPLE.length
                                : undefined
                            }
                            autoCapitalize="characters"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="receipt-document-range-start">
                            Rango autorizado inicial
                          </Label>
                          <Input
                            id="receipt-document-range-start"
                            value={documentRangeStart}
                            onChange={event =>
                              setDocumentRangeStart(
                                isFiscalDocument
                                  ? formatInvoiceNumberInput(event.target.value)
                                  : event.target.value
                              )
                            }
                            placeholder={
                              isFiscalDocument
                                ? INVOICE_NUMBER_FORMAT_EXAMPLE
                                : "Rango autorizado inicial"
                            }
                            inputMode={isFiscalDocument ? "numeric" : "text"}
                            maxLength={
                              isFiscalDocument
                                ? INVOICE_NUMBER_FORMAT_EXAMPLE.length
                                : undefined
                            }
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="receipt-document-range-end">
                            Rango autorizado final
                          </Label>
                          <Input
                            id="receipt-document-range-end"
                            value={documentRangeEnd}
                            onChange={event =>
                              setDocumentRangeEnd(
                                isFiscalDocument
                                  ? formatInvoiceNumberInput(event.target.value)
                                  : event.target.value
                              )
                            }
                            placeholder={
                              isFiscalDocument
                                ? INVOICE_NUMBER_FORMAT_EXAMPLE
                                : "Rango autorizado final"
                            }
                            inputMode={isFiscalDocument ? "numeric" : "text"}
                            maxLength={
                              isFiscalDocument
                                ? INVOICE_NUMBER_FORMAT_EXAMPLE.length
                                : undefined
                            }
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="receipt-document-date">
                            Fecha documento
                          </Label>
                          <Input
                            id="receipt-document-date"
                            type="date"
                            value={documentDate}
                            onChange={event =>
                              setDocumentDate(event.target.value)
                            }
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="receipt-emission-deadline">
                            Fecha límite de emisión
                          </Label>
                          <Input
                            id="receipt-emission-deadline"
                            type="date"
                            value={emissionDeadline}
                            onChange={event =>
                              setEmissionDeadline(event.target.value)
                            }
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="receipt-document-due-date">
                            Fecha vencimiento (crédito)
                          </Label>
                          <Input
                            id="receipt-document-due-date"
                            type="date"
                            value={documentDueDate}
                            onChange={event =>
                              setDocumentDueDate(event.target.value)
                            }
                          />
                        </div>
                      </>
                    ) : null}
                    <div className="space-y-2">
                      <Label htmlFor="receipt-posting-date">
                        Fecha contabilización
                      </Label>
                      <Input
                        id="receipt-posting-date"
                        type="date"
                        value={postingDate}
                        readOnly
                        className="bg-muted/40"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="receipt-receipt-date">
                        Fecha recepción
                      </Label>
                      <Input
                        id="receipt-receipt-date"
                        type="date"
                        value={receiptDate}
                        onChange={event => setReceiptDate(event.target.value)}
                      />
                    </div>
                  </div>

                  {currentDocumentHasEmissionDeadlineIssue ? (
                    <div className="flex items-start gap-2 rounded-xl border border-rose-300 bg-rose-50 px-3 py-2.5 text-sm text-rose-700">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>
                        {EMISSION_DEADLINE_ISSUE_MESSAGE}. Se permitirá
                        registrar la recepción, pero quedará marcada con alerta.
                      </span>
                    </div>
                  ) : null}

                  <div className="space-y-2">
                    <Label htmlFor="receipt-notes">Notas</Label>
                    <Textarea
                      id="receipt-notes"
                      value={notes}
                      onChange={event => setNotes(event.target.value)}
                      rows={3}
                      placeholder={
                        sourceType === "purchase_order"
                          ? "Observaciones, referencia de documento o comentarios de recepción"
                          : "Observaciones o comentarios de recepción"
                      }
                    />
                  </div>
                </div>

                <section className="min-w-0 space-y-3 rounded-2xl border border-border/70 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <h3 className="text-lg font-semibold">Adjuntos</h3>
                      <Badge variant="outline" className="text-xs">
                        Obligatorio
                      </Badge>
                    </div>
                    <div>
                      <input
                        ref={receiptAttachmentInputRef}
                        type="file"
                        multiple
                        accept="application/pdf,image/jpeg,image/png,image/webp"
                        className="hidden"
                        onChange={handlePendingReceiptAttachmentChange}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() =>
                          receiptAttachmentInputRef.current?.click()
                        }
                        disabled={
                          preparingReceiptAttachment ||
                          registerMutation.isPending ||
                          uploadPendingReceiptAttachmentMutation.isPending
                        }
                      >
                        <Upload className="mr-2 h-4 w-4" />
                        {preparingReceiptAttachment
                          ? "Preparando..."
                          : "Adjuntar"}
                      </Button>
                    </div>
                  </div>

                  {pendingReceiptAttachments.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                      Adjunta el comprobante para procesar la recepción.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {pendingReceiptAttachments.map(attachment => {
                        const AttachmentIcon = attachment.mimeType.startsWith(
                          "image/"
                        )
                          ? ImageIcon
                          : FileText;
                        return (
                          <div
                            key={attachment.id}
                            className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 p-3"
                          >
                            <div className="flex min-w-0 items-center gap-2">
                              <AttachmentIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium">
                                  {attachment.fileName}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {formatAttachmentSize(attachment.fileSize)}
                                </p>
                              </div>
                            </div>
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              onClick={() =>
                                removePendingReceiptAttachment(attachment.id)
                              }
                              disabled={
                                registerMutation.isPending ||
                                uploadPendingReceiptAttachmentMutation.isPending
                              }
                              aria-label={`Quitar ${attachment.fileName}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>

                {sourceType === "purchase_order" && sourceId ? (
                  <div className="flex justify-end">
                    <Popover
                      open={manualItemPopoverOpen}
                      onOpenChange={open => {
                        setManualItemPopoverOpen(open);
                        if (!open) setManualItemSearch("");
                      }}
                    >
                      <PopoverTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          className="gap-2"
                          disabled={registerMutation.isPending}
                        >
                          <Plus className="h-4 w-4" />
                          Agregar producto
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent
                        className="w-[min(720px,calc(100vw-2rem))] p-0"
                        align="end"
                      >
                        <Command shouldFilter={false}>
                          <CommandInput
                            placeholder="Buscar SKU o descripción..."
                            value={manualItemSearch}
                            onValueChange={setManualItemSearch}
                          />
                          <CommandList>
                            {manualItemSearch.trim().length < 2 ? (
                              <div className="p-3 text-sm text-muted-foreground">
                                Escriba al menos 2 caracteres.
                              </div>
                            ) : (
                              <>
                                <CommandEmpty>Sin resultados.</CommandEmpty>
                                <CommandGroup heading="Catálogo SAP">
                                  {(manualSapResults ?? []).map((item: any) => (
                                    <CommandItem
                                      key={item.id}
                                      value={`${item.itemCode}-${item.description}`}
                                      onSelect={() =>
                                        void addManualReceiptItem(item)
                                      }
                                    >
                                      <div className="min-w-0">
                                        <p className="font-mono text-xs font-semibold">
                                          {item.itemCode}
                                        </p>
                                        <p className="whitespace-normal break-words text-sm leading-snug">
                                          {item.description}
                                        </p>
                                        {item.brand || item.partNumber ? (
                                          <p className="mt-1 whitespace-normal break-words text-xs text-muted-foreground">
                                            {[
                                              item.brand &&
                                                `Marca: ${item.brand}`,
                                              item.partNumber &&
                                                `No. parte: ${item.partNumber}`,
                                            ]
                                              .filter(Boolean)
                                              .join(" · ")}
                                          </p>
                                        ) : null}
                                      </div>
                                    </CommandItem>
                                  ))}
                                </CommandGroup>
                              </>
                            )}
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                  </div>
                ) : null}

                <div className="overflow-x-auto rounded-2xl border border-border/70">
                  <table
                    className={`w-full text-sm ${
                      sourceType === "purchase_order"
                        ? "min-w-[1540px]"
                        : "min-w-[1240px]"
                    }`}
                  >
                    <thead>
                      <tr className="border-b border-border/70 bg-muted/20">
                        <th className="p-3 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground sm:text-xs">
                          Ítem
                        </th>
                        <th className="p-3 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground sm:text-xs">
                          SAP actual
                        </th>
                        <th className="p-3 text-right text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground sm:text-xs">
                          Pendiente
                        </th>
                        <th className="p-3 text-right text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground sm:text-xs">
                          Recibido
                        </th>
                        <th className="p-3 text-right text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground sm:text-xs">
                          Precio confirmado
                        </th>
                        {sourceType === "purchase_order" ? (
                          <>
                            <th className="p-3 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground sm:text-xs">
                              Impuesto
                            </th>
                            <th className="p-3 text-right text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground sm:text-xs">
                              Subtotal
                            </th>
                            <th className="p-3 text-right text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground sm:text-xs">
                              ISV
                            </th>
                            <th className="p-3 text-right text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground sm:text-xs">
                              Total
                            </th>
                          </>
                        ) : null}
                        <th className="p-3 text-right text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground sm:text-xs">
                          Recibir ahora
                        </th>
                        <th className="p-3 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground sm:text-xs">
                          Almacén ingreso
                        </th>
                        {sourceType === "transfer" ? (
                          <th className="p-3 text-right text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground sm:text-xs">
                            Acción
                          </th>
                        ) : null}
                      </tr>
                    </thead>
                    <tbody>
                      {!sourceId ? (
                        <tr>
                          <td
                            className="p-4 text-sm text-muted-foreground"
                            colSpan={receiptTableColumnCount}
                          >
                            Selecciona una orden de compra o traslado para
                            cargar sus ítems.
                          </td>
                        </tr>
                      ) : activeSourceLoading ? (
                        <tr>
                          <td
                            className="p-4 text-sm text-muted-foreground"
                            colSpan={receiptTableColumnCount}
                          >
                            Cargando detalle del documento...
                          </td>
                        </tr>
                      ) : receiptEditableItems.length === 0 ? (
                        <tr>
                          <td
                            className="p-4 text-sm text-muted-foreground"
                            colSpan={receiptTableColumnCount}
                          >
                            Este documento no tiene ítems pendientes por
                            recibir. Puede agregar un producto manualmente con
                            el botón superior.
                          </td>
                        </tr>
                      ) : (
                        receiptEditableItems.map((item: any) => {
                          const isManualItem =
                            item.isManualReceiptItem === true;
                          const pendingQuantity =
                            getEditableReceiptExpectedQuantity(item);
                          const receivingQuantity =
                            Number(receivedMap[item.id] ?? 0) || 0;
                          const excessQuantity = Math.max(
                            receivingQuantity - pendingQuantity,
                            0
                          );
                          const sourceCode = getSourceItemCode(item);
                          const transferCloseQuantity =
                            getTransferCloseQuantity(item);
                          const transferClosureDraft =
                            transferClosureDrafts[item.id];
                          const assetDraft = getReceiptAssetDraft(item.id);
                          const isSavedFixedAsset =
                            sourceType === "purchase_order" &&
                            !isManualItem &&
                            item.isFixedAsset === true;
                          const isLineFixedAsset =
                            assetDraft.isFixedAsset || isSavedFixedAsset;
                          const isFixedAssetProduct =
                            isReceiptFixedAssetProduct(item);
                          const fixedAssetUnavailableReason =
                            !isFixedAssetProduct
                              ? "Solo disponible para productos de tipo Activo Fijo"
                              : "";
                          const assetUnitCount = getPositiveIntegerQuantity(
                            receivedMap[item.id]
                          );
                          const assetDetails = isLineFixedAsset
                            ? normalizeFixedAssetDetails(
                                assetDraft.assetDetails,
                                assetUnitCount
                              )
                            : [];
                          const fixedAssetArticles =
                            getReceiptFixedAssetArticles(item);
                          const fixedAssetProgress =
                            getReceiptFixedAssetProgress(
                              item,
                              Math.max(assetUnitCount, assetDetails.length)
                            );
                          const fixedAssetArticleRows =
                            getReceiptFixedAssetArticleRows(
                              item,
                              assetDetails,
                              fixedAssetProgress.expected
                            );
                          const hasResolvedFixedAssetArticle =
                            fixedAssetArticles.some(
                              (article: any) =>
                                article?.fixedAssetStatus === "resuelto"
                            );
                          const assetInputsDisabled =
                            item.fixedAssetStatus === "resuelto" ||
                            hasResolvedFixedAssetArticle;
                          const fixedAssetDraftSaved =
                            Boolean(item.fixedAssetArticleId) &&
                            fixedAssetProgress.pending > 0;
                          const fixedAssetResolved =
                            fixedAssetProgress.expected > 0 &&
                            fixedAssetProgress.pending === 0;
                          const taxDraft =
                            sourceType === "purchase_order"
                              ? getReceiptLineTaxDraft(item)
                              : null;
                          const receiptUnitPriceDraft =
                            sourceType === "purchase_order"
                              ? (priceMap[item.id] ??
                                String(item.unitPrice ?? "0.00"))
                              : "0.00";
                          const lineAmounts = taxDraft
                            ? calculatePurchaseOrderLineAmounts({
                                quantity: taxDraft.quantity,
                                unitPrice: taxDraft.unitPrice,
                                taxCode: taxDraft.taxCode,
                                additionalTaxCodes: taxDraft.additionalTaxCodes,
                                taxes: activeSalesTaxes,
                              })
                            : null;
                          const fixedAssetReceivedOffset = Math.max(
                            Math.trunc(Number(item.receivedQuantity ?? 0)),
                            0
                          );
                          const fixedAssetReceiptRows =
                            sourceType === "purchase_order" &&
                            isLineFixedAsset &&
                            fixedAssetArticleRows.length > 1 &&
                            assetUnitCount > 0
                              ? fixedAssetArticleRows.slice(
                                  fixedAssetReceivedOffset,
                                  fixedAssetReceivedOffset + assetUnitCount
                                )
                              : [];
                          const shouldRenderFixedAssetReceiptRows =
                            sourceType === "purchase_order" &&
                            hasResolvedFixedAssetArticle &&
                            fixedAssetReceiptRows.length > 1;
                          const fixedAssetUnitLineAmounts = taxDraft
                            ? calculatePurchaseOrderLineAmounts({
                                quantity: "1",
                                unitPrice: taxDraft.unitPrice,
                                taxCode: taxDraft.taxCode,
                                additionalTaxCodes: taxDraft.additionalTaxCodes,
                                taxes: activeSalesTaxes,
                              })
                            : null;
                          const receiptLineDetailsExpanded =
                            isReceiptLineDetailsExpanded(item.id);
                          const selectedReceiptTarget =
                            targetByItemId[item.id] ?? null;
                          const hasReceiptLineNotes =
                            assetDraft.notes.trim().length > 0;
                          return (
                            <Fragment key={item.id}>
                              {shouldRenderFixedAssetReceiptRows
                                ? fixedAssetReceiptRows.map(
                                    ({ article, detail }: any, index) => {
                                      const articleDetail =
                                        getReceiptFixedAssetArticleDetail(
                                          article,
                                          detail
                                        );
                                      const isResolved =
                                        article?.fixedAssetStatus ===
                                        "resuelto";
                                      const displayCode =
                                        getReceiptFixedAssetArticleDisplayCode(
                                          article,
                                          sourceCode
                                        );
                                      const temporaryCode = String(
                                        article?.temporaryItemCode ?? ""
                                      ).trim();

                                      return (
                                        <tr
                                          key={`${item.id}-receipt-unit-${fixedAssetReceivedOffset + index}`}
                                          className="border-b border-border/70 bg-background"
                                        >
                                          <td className="p-4">
                                            <div className="font-semibold">
                                              {article?.description ||
                                                item.itemName}
                                            </div>
                                            <div className="mt-2 flex flex-wrap gap-1.5">
                                              <Badge
                                                variant="outline"
                                                className="border-blue-300 text-blue-700"
                                              >
                                                Activo fijo
                                              </Badge>
                                              <Badge variant="outline">
                                                Unidad{" "}
                                                {fixedAssetReceivedOffset +
                                                  index +
                                                  1}
                                              </Badge>
                                              <Badge
                                                variant="outline"
                                                className={
                                                  isResolved
                                                    ? "border-emerald-300 text-emerald-700"
                                                    : "border-amber-300 text-amber-700"
                                                }
                                              >
                                                {isResolved
                                                  ? "Resuelto"
                                                  : "Pendiente"}
                                              </Badge>
                                            </div>
                                            {articleDetail.serialNumber ? (
                                              <div className="mt-1 text-xs text-muted-foreground">
                                                Serie:{" "}
                                                {articleDetail.serialNumber}
                                              </div>
                                            ) : null}
                                            {index === 0 ? (
                                              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                                {renderReceiptLineDetailsButton(
                                                  item.id,
                                                  receiptLineDetailsExpanded
                                                )}
                                                {selectedReceiptTarget?.label ? (
                                                  <span className="max-w-64 truncate text-xs text-muted-foreground">
                                                    {formatReceiptTargetSummary(
                                                      selectedReceiptTarget
                                                    )}
                                                  </span>
                                                ) : null}
                                                {hasReceiptLineNotes ? (
                                                  <Badge variant="outline">
                                                    Con observación
                                                  </Badge>
                                                ) : null}
                                              </div>
                                            ) : null}
                                          </td>
                                          <td className="p-4 font-mono text-sm">
                                            <div>{displayCode}</div>
                                            {temporaryCode &&
                                            temporaryCode !== displayCode ? (
                                              <div className="mt-1 font-sans text-xs text-muted-foreground">
                                                Temp: {temporaryCode}
                                              </div>
                                            ) : null}
                                          </td>
                                          <td className="p-4 text-right font-semibold">
                                            1.00 {item.unit || ""}
                                          </td>
                                          <td className="p-4 text-right text-muted-foreground">
                                            0.00 {item.unit || ""}
                                          </td>
                                          <td className="p-4 text-right font-semibold">
                                            {formatPurchaseOrderCurrency(
                                              receiptUnitPriceDraft
                                            )}
                                          </td>
                                          {taxDraft &&
                                          fixedAssetUnitLineAmounts ? (
                                            <>
                                              <td className="p-4">
                                                <Badge variant="outline">
                                                  {taxDraft.taxCode.toUpperCase()}
                                                </Badge>
                                              </td>
                                              <td className="p-4 text-right font-semibold">
                                                {formatPurchaseOrderCurrency(
                                                  fixedAssetUnitLineAmounts.subtotal
                                                )}
                                              </td>
                                              <td className="p-4 text-right font-semibold">
                                                {formatPurchaseOrderCurrency(
                                                  fixedAssetUnitLineAmounts.taxAmount
                                                )}
                                              </td>
                                              <td className="p-4 text-right font-semibold">
                                                {formatPurchaseOrderCurrency(
                                                  fixedAssetUnitLineAmounts.total
                                                )}
                                              </td>
                                            </>
                                          ) : null}
                                          <td className="p-4 text-right font-semibold">
                                            1.00 {item.unit || ""}
                                          </td>
                                          <td className="p-4">
                                            {renderReceiptWarehouseSelector(
                                              item,
                                              true
                                            )}
                                          </td>
                                        </tr>
                                      );
                                    }
                                  )
                                : null}
                              {!shouldRenderFixedAssetReceiptRows ? (
                                <tr className="border-b border-border/70">
                                <td className="p-4">
                                  <div className="font-semibold">
                                    {item.itemName}
                                    {isManualItem ? (
                                      <Badge
                                        variant="outline"
                                        className="ml-2 align-middle"
                                      >
                                        Agregado
                                      </Badge>
                                    ) : null}
                                  </div>
                                  {sourceCode ? (
                                    <div className="mt-1 text-xs text-muted-foreground">
                                      {isManualItem ? "SKU" : "Original"}:{" "}
                                      {sourceCode}
                                    </div>
                                  ) : null}
                                  <div className="mt-2 flex max-w-[360px] flex-wrap items-center gap-1.5">
                                    {renderReceiptLineDetailsButton(
                                      item.id,
                                      receiptLineDetailsExpanded
                                    )}
                                    {sourceType === "purchase_order" ? (
                                      selectedReceiptTarget?.label ? (
                                        <span className="truncate text-xs text-muted-foreground">
                                          {formatReceiptTargetSummary(
                                            selectedReceiptTarget
                                          )}
                                        </span>
                                      ) : (
                                        <Badge
                                          variant="outline"
                                          className="border-amber-300 text-amber-700"
                                        >
                                          Destino pendiente
                                        </Badge>
                                      )
                                    ) : null}
                                    {isLineFixedAsset ? (
                                      <Badge
                                        variant="outline"
                                        className="border-blue-300 text-blue-700"
                                      >
                                        Activo fijo
                                      </Badge>
                                    ) : null}
                                    {hasReceiptLineNotes ? (
                                      <Badge variant="outline">
                                        Con observación
                                      </Badge>
                                    ) : null}
                                  </div>
                                </td>
                                <td className="p-4 font-mono text-sm">
                                  {sourceCode || "—"}
                                </td>
                                <td className="p-4 text-right font-semibold">
                                  {formatQuantity(pendingQuantity)}{" "}
                                  {item.unit || ""}
                                </td>
                                <td className="p-4 text-right text-muted-foreground">
                                  {formatQuantity(
                                    isManualItem
                                      ? "0.00"
                                      : item.receivedQuantity
                                  )}{" "}
                                  {item.unit || ""}
                                </td>
                                <td className="p-4 text-right">
                                  {sourceType === "purchase_order" ? (
                                    <Input
                                      type="number"
                                      min="0"
                                      step="0.01"
                                      className="ml-auto w-36 text-right"
                                      value={receiptUnitPriceDraft}
                                      onChange={event => {
                                        const nextUnitPrice =
                                          event.target.value;
                                        setPriceMap(current => ({
                                          ...current,
                                          [item.id]: nextUnitPrice,
                                        }));
                                        setSubtotalMap(current => ({
                                          ...current,
                                          [item.id]:
                                            calculateReceiptSubtotalDraftValue(
                                              receivedMap[item.id] ?? "0",
                                              nextUnitPrice
                                            ),
                                        }));
                                      }}
                                      onBlur={event => {
                                        const nextUnitPrice =
                                          formatMoneyDisplay(
                                            event.target.value
                                          );
                                        setPriceMap(current => ({
                                          ...current,
                                          [item.id]: nextUnitPrice,
                                        }));
                                        setSubtotalMap(current => ({
                                          ...current,
                                          [item.id]:
                                            calculateReceiptSubtotalDraftValue(
                                              receivedMap[item.id] ?? "0",
                                              nextUnitPrice
                                            ),
                                        }));
                                      }}
                                      disabled={registerMutation.isPending}
                                    />
                                  ) : (
                                    <span className="text-muted-foreground">
                                      —
                                    </span>
                                  )}
                                </td>
                                {sourceType === "purchase_order" &&
                                taxDraft &&
                                lineAmounts ? (
                                  <>
                                    <td className="p-4">
                                      <PurchaseOrderTaxControls
                                        draft={taxDraft}
                                        taxes={activeSalesTaxes}
                                        disabled={registerMutation.isPending}
                                        onChange={nextDraft => {
                                          setTaxCodeByItemId(current => ({
                                            ...current,
                                            [item.id]: nextDraft.taxCode,
                                          }));
                                          setAdditionalTaxCodesByItemId(
                                            current => ({
                                              ...current,
                                              [item.id]:
                                                nextDraft.additionalTaxCodes,
                                            })
                                          );
                                        }}
                                      />
                                    </td>
                                    <td className="p-4 text-right">
                                      <Input
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        className="ml-auto w-36 text-right font-semibold"
                                        value={getReceiptLineSubtotalDraft(
                                          item
                                        )}
                                        onChange={event => {
                                          const nextSubtotal =
                                            event.target.value;
                                          setSubtotalMap(current => ({
                                            ...current,
                                            [item.id]: nextSubtotal,
                                          }));
                                          setPriceMap(current => ({
                                            ...current,
                                            [item.id]:
                                              calculateReceiptUnitPriceDraftValue(
                                                receivedMap[item.id] ?? "0",
                                                nextSubtotal
                                              ),
                                          }));
                                        }}
                                        onBlur={event => {
                                          const nextSubtotal =
                                            formatMoneyDisplay(
                                              event.target.value
                                            );
                                          setSubtotalMap(current => ({
                                            ...current,
                                            [item.id]: nextSubtotal,
                                          }));
                                          setPriceMap(current => ({
                                            ...current,
                                            [item.id]:
                                              calculateReceiptUnitPriceDraftValue(
                                                receivedMap[item.id] ?? "0",
                                                nextSubtotal
                                              ),
                                          }));
                                        }}
                                        disabled={registerMutation.isPending}
                                      />
                                    </td>
                                    <td className="p-4 text-right font-semibold">
                                      {formatPurchaseOrderCurrency(
                                        lineAmounts.taxAmount
                                      )}
                                    </td>
                                    <td className="p-4 text-right font-semibold">
                                      {formatPurchaseOrderCurrency(
                                        lineAmounts.total
                                      )}
                                    </td>
                                  </>
                                ) : null}
                                <td className="p-4 text-right">
                                  <Input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    className="ml-auto w-36 text-right"
                                    value={receivedMap[item.id] ?? ""}
                                    onChange={event =>
                                      handleReceivedQuantityChange(
                                        item,
                                        event.target.value
                                      )
                                    }
                                    disabled={
                                      !isManualItem && pendingQuantity <= 0
                                    }
                                  />
                                  {!isManualItem && excessQuantity > 0 ? (
                                    <p className="mt-1 text-xs font-medium text-emerald-700">
                                      Exceso permitido:{" "}
                                      {formatQuantity(excessQuantity)}{" "}
                                      {item.unit || ""}
                                    </p>
                                  ) : null}
                                </td>
                                <td className="p-4">
                                  {renderReceiptWarehouseSelector(item, true)}
                                </td>
                                {sourceType === "transfer" ? (
                                  <td className="p-4 text-right">
                                    <div className="flex flex-col items-end gap-1.5">
                                      <Button
                                        variant={
                                          transferClosureDraft &&
                                          transferCloseQuantity > 0
                                            ? "default"
                                            : "outline"
                                        }
                                        size="sm"
                                        className="ml-auto gap-2"
                                        onClick={() => {
                                          if (!canCloseTransferLines) return;
                                          setCloseTransferLineItem(item);
                                          setTransferCloseReason(
                                            transferClosureDraft?.reason ||
                                              TRANSFER_CLOSE_REASONS[0].value
                                          );
                                          setTransferCloseNote(
                                            transferClosureDraft?.note || ""
                                          );
                                        }}
                                        disabled={
                                          !canCloseTransferLines ||
                                          transferCloseQuantity <= 0
                                        }
                                        title={
                                          !canCloseTransferLines
                                            ? "Solo Administración Central o el administrador del proyecto destino pueden cerrar saldos de traslado"
                                            : transferCloseQuantity <= 0
                                              ? "No hay saldo restante para cerrar; baja Recibir ahora si no recibiste todo"
                                              : "Cerrar saldo pendiente, devolverlo al origen y regresarlo a requisición"
                                        }
                                      >
                                        <RotateCcw className="h-4 w-4" />
                                        {!canCloseTransferLines
                                          ? "Sin autorización"
                                          : transferCloseQuantity <= 0
                                            ? "Sin saldo"
                                            : transferClosureDraft
                                              ? "Cierre marcado"
                                              : "Cerrar saldo"}
                                      </Button>
                                      {transferClosureDraft &&
                                      transferCloseQuantity > 0 ? (
                                        <span className="text-xs text-muted-foreground">
                                          Devuelve{" "}
                                          {formatQuantity(
                                            transferCloseQuantity
                                          )}{" "}
                                          {item.unit || ""} al origen y a
                                          requisición
                                        </span>
                                      ) : canCloseTransferLines &&
                                        transferCloseQuantity <= 0 ? (
                                        <span className="max-w-48 text-right text-xs text-muted-foreground">
                                          Baja Recibir ahora para cerrar saldo.
                                        </span>
                                      ) : null}
                                    </div>
                                  </td>
                                ) : null}
                                </tr>
                              ) : null}
                              {receiptLineDetailsExpanded ? (
                                <tr
                                  key={`${item.id}-asset`}
                                  className="border-b border-border/70 bg-muted/10 last:border-0"
                                >
                                  <td
                                    colSpan={receiptTableColumnCount}
                                    className="p-4 pt-0"
                                  >
                                  <div className="space-y-4 rounded-xl border border-border/70 bg-background p-3">
                                    {sourceType === "purchase_order" ? (
                                      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-end">
                                        {renderReceiptTargetSelector(item)}

                                        <div className="flex justify-start lg:justify-end">
                                          {isManualItem ? (
                                            <Button
                                              type="button"
                                              variant="outline"
                                              size="sm"
                                              className="gap-2"
                                              onClick={() =>
                                                removeManualReceiptItem(item.id)
                                              }
                                              disabled={
                                                registerMutation.isPending
                                              }
                                            >
                                              <Trash2 className="h-4 w-4" />
                                              Quitar
                                            </Button>
                                          ) : !isContractPurchaseOrder &&
                                            canManuallyCloseReceiptLine(
                                              item
                                            ) ? (
                                            <Button
                                              variant="outline"
                                              size="sm"
                                              className="gap-2"
                                              onClick={() =>
                                                setCloseReceiptLineItem(item)
                                              }
                                              disabled={
                                                closeReceiptLineMutation.isPending
                                              }
                                            >
                                              {closeReceiptLineMutation.isPending &&
                                              closeReceiptLineItem?.id ===
                                                item.id ? (
                                                <Loader2 className="h-4 w-4 animate-spin" />
                                              ) : (
                                                <ShieldX className="h-4 w-4" />
                                              )}
                                              Cerrar línea
                                            </Button>
                                          ) : (
                                            <span className="text-xs text-muted-foreground">
                                              Sin acción pendiente
                                            </span>
                                          )}
                                        </div>
                                      </div>
                                    ) : null}

                                    <div className="flex flex-wrap items-center gap-4">
                                      <label className="flex items-center gap-2 text-sm font-medium">
                                        <Checkbox
                                          checked={isLineFixedAsset}
                                          disabled={
                                            sourceType !== "purchase_order" ||
                                            isManualItem ||
                                            Boolean(item.fixedAssetArticleId) ||
                                            (!isLineFixedAsset &&
                                              Boolean(fixedAssetUnavailableReason))
                                          }
                                          onCheckedChange={checked =>
                                            handleFixedAssetToggle(
                                              item,
                                              checked === true
                                            )
                                          }
                                        />
                                        Activo fijo
                                      </label>
                                      {!isLineFixedAsset &&
                                      fixedAssetUnavailableReason ? (
                                        <span className="text-xs text-muted-foreground bg-muted/50 px-2 py-0.5 rounded border border-border/50">
                                          {fixedAssetUnavailableReason}
                                        </span>
                                      ) : null}
                                      {isLineFixedAsset ? (
                                        <label className="flex items-center gap-2 text-sm font-medium">
                                          <Checkbox
                                            checked={assetDraft.isLeasing}
                                            disabled={assetInputsDisabled}
                                            onCheckedChange={checked =>
                                              updateReceiptAssetDraft(
                                                item.id,
                                                draft => ({
                                                  ...draft,
                                                  isLeasing: checked === true,
                                                })
                                              )
                                            }
                                          />
                                          Leasing
                                        </label>
                                      ) : null}
                                      {isLineFixedAsset ? (
                                        <Badge
                                          variant="outline"
                                          className="border-blue-300 text-blue-700"
                                        >
                                          {assetUnitCount} unidad(es) con serie
                                        </Badge>
                                      ) : null}
                                      {isLineFixedAsset &&
                                      fixedAssetArticles.length > 0 ? (
                                        <Badge
                                          variant="outline"
                                          className={
                                            fixedAssetResolved
                                              ? "border-emerald-300 text-emerald-700"
                                              : "border-amber-300 text-amber-700"
                                          }
                                        >
                                          {fixedAssetProgress.resolved}/
                                          {fixedAssetProgress.expected}{" "}
                                          resueltos
                                        </Badge>
                                      ) : null}
                                      {fixedAssetDraftSaved ? (
                                        <Badge
                                          variant="outline"
                                          className="border-amber-300 text-amber-700"
                                        >
                                          Pendiente Contabilidad
                                        </Badge>
                                      ) : null}
                                      {fixedAssetResolved ? (
                                        <Badge
                                          variant="outline"
                                          className="border-emerald-300 text-emerald-700"
                                        >
                                          Código real listo
                                        </Badge>
                                      ) : null}
                                    </div>

                                    <div className="space-y-2">
                                      <Label>Observación de línea</Label>
                                      <Textarea
                                        rows={2}
                                        value={assetDraft.notes}
                                        disabled={assetInputsDisabled}
                                        onChange={event =>
                                          updateReceiptAssetDraft(
                                            item.id,
                                            draft => ({
                                              ...draft,
                                              notes: event.target.value,
                                            })
                                          )
                                        }
                                        placeholder="Observaciones de este producto recibido"
                                      />
                                    </div>

                                    {isLineFixedAsset ? (
                                      assetUnitCount === 0 ? (
                                        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                                          Ingrese una cantidad entera mayor que
                                          cero en “Recibir ahora” para capturar
                                          las unidades del activo.
                                        </div>
                                      ) : (
                                        <div className="space-y-3">
                                          {assetDetails.map((detail, index) => (
                                            <div
                                              key={`${item.id}-asset-${index}`}
                                              className="rounded-lg border border-border/70 p-3"
                                            >
                                              <div className="mb-3 text-sm font-semibold">
                                                Unidad {index + 1}
                                              </div>
                                              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                                                <div className="space-y-1.5">
                                                  <Label>Número de serie</Label>
                                                  <Input
                                                    value={detail.serialNumber}
                                                    disabled={
                                                      assetInputsDisabled
                                                    }
                                                    onChange={event =>
                                                      updateAssetDetail(
                                                        item.id,
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
                                                    disabled={
                                                      assetInputsDisabled
                                                    }
                                                    onValueChange={value =>
                                                      updateAssetDetail(
                                                        item.id,
                                                        index,
                                                        "condition",
                                                        value
                                                      )
                                                    }
                                                  >
                                                    <SelectTrigger>
                                                      <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                      {ASSET_CONDITION_VALUES.map(
                                                        condition => (
                                                          <SelectItem
                                                            key={condition}
                                                            value={condition}
                                                          >
                                                            {
                                                              ASSET_CONDITION_LABELS[
                                                                condition
                                                              ]
                                                            }
                                                          </SelectItem>
                                                        )
                                                      )}
                                                    </SelectContent>
                                                  </Select>
                                                </div>
                                                {ASSET_DETAIL_OPTIONAL_FIELDS.map(
                                                  field => (
                                                    <div
                                                      key={field.key}
                                                      className="space-y-1.5"
                                                    >
                                                      <Label>
                                                        {field.label}
                                                      </Label>
                                                      <Input
                                                        value={String(
                                                          detail[field.key] ??
                                                            ""
                                                        )}
                                                        disabled={
                                                          assetInputsDisabled
                                                        }
                                                        onChange={event =>
                                                          updateAssetDetail(
                                                            item.id,
                                                            index,
                                                            field.key,
                                                            event.target.value
                                                          )
                                                        }
                                                        placeholder={
                                                          field.placeholder
                                                        }
                                                      />
                                                    </div>
                                                  )
                                                )}
                                              </div>
                                            </div>
                                          ))}
                                          {fixedAssetArticles.length > 0 ? (
                                            <div className="rounded-lg border border-border/70">
                                              <div className="flex flex-col gap-2 border-b border-border/70 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                                                <div>
                                                  <div className="text-sm font-semibold">
                                                    Estado de Contabilidad
                                                  </div>
                                                  <div className="text-xs text-muted-foreground">
                                                    {
                                                      fixedAssetProgress.resolved
                                                    }
                                                    /
                                                    {
                                                      fixedAssetProgress.expected
                                                    }{" "}
                                                    activo(s) con código real
                                                  </div>
                                                </div>
                                                <Button
                                                  type="button"
                                                  variant="outline"
                                                  size="sm"
                                                  className="gap-2 self-start sm:self-auto"
                                                  disabled={
                                                    purchaseOrderDetailFetching
                                                  }
                                                  onClick={() => {
                                                    void refetchPurchaseOrderDetail();
                                                  }}
                                                >
                                                  <RotateCcw className="h-4 w-4" />
                                                  Actualizar estado
                                                </Button>
                                              </div>
                                              <div className="overflow-x-auto">
                                                <table className="w-full min-w-[720px] text-sm">
                                                  <thead className="bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
                                                    <tr>
                                                      <th className="p-2 text-left">
                                                        Unidad
                                                      </th>
                                                      <th className="p-2 text-left">
                                                        Serie
                                                      </th>
                                                      <th className="p-2 text-left">
                                                        Código temporal
                                                      </th>
                                                      <th className="p-2 text-left">
                                                        Código real
                                                      </th>
                                                      <th className="p-2 text-left">
                                                        Estado
                                                      </th>
                                                      <th className="p-2 text-right">
                                                        Acciones
                                                      </th>
                                                    </tr>
                                                  </thead>
                                                  <tbody>
                                                    {fixedAssetArticleRows.map(
                                                      (
                                                        {
                                                          article,
                                                          detail,
                                                        }: any,
                                                        index
                                                      ) => {
                                                        const isResolved =
                                                          article?.fixedAssetStatus ===
                                                          "resuelto";
                                                        const temporaryCode =
                                                          article?.temporaryItemCode ||
                                                          (!isResolved
                                                            ? article?.itemCode
                                                            : "");
                                                        const realCode =
                                                          isResolved
                                                            ? article?.itemCode
                                                            : "";
                                                        const serialNumber =
                                                          article?.fixedAssetSerialNumber ||
                                                          detail?.serialNumber ||
                                                          "";

                                                        return (
                                                          <tr
                                                            key={`${item.id}-article-${index}`}
                                                            className="border-t border-border/60"
                                                          >
                                                            <td className="p-2 font-medium">
                                                              {index + 1}
                                                            </td>
                                                            <td className="p-2">
                                                              {serialNumber ||
                                                                "—"}
                                                            </td>
                                                            <td className="p-2 font-mono text-xs">
                                                              {temporaryCode ||
                                                                "—"}
                                                            </td>
                                                            <td className="p-2 font-mono text-xs">
                                                              {realCode || "—"}
                                                            </td>
                                                            <td className="p-2">
                                                              <Badge
                                                                variant="outline"
                                                                className={
                                                                  isResolved
                                                                    ? "border-emerald-300 text-emerald-700"
                                                                    : article
                                                                      ? "border-amber-300 text-amber-700"
                                                                      : "border-muted-foreground/30 text-muted-foreground"
                                                                }
                                                              >
                                                                {isResolved
                                                                  ? "Resuelto"
                                                                  : article
                                                                    ? "Pendiente"
                                                                  : "Sin crear"}
                                                              </Badge>
                                                            </td>
                                                            <td className="p-2 text-right">
                                                              {article ? (
                                                                <Button
                                                                  type="button"
                                                                  variant="outline"
                                                                  size="sm"
                                                                  className="gap-2"
                                                                  onClick={() =>
                                                                    openReceiptFixedAssetArticleDialog(
                                                                      article
                                                                    )
                                                                  }
                                                                >
                                                                  <Pencil className="h-3.5 w-3.5" />
                                                                  {isResolved
                                                                    ? "Ver"
                                                                    : "Resolver"}
                                                                </Button>
                                                              ) : (
                                                                <span className="text-xs text-muted-foreground">
                                                                  —
                                                                </span>
                                                              )}
                                                            </td>
                                                          </tr>
                                                        );
                                                      }
                                                    )}
                                                  </tbody>
                                                </table>
                                              </div>
                                            </div>
                                          ) : null}
                                          <div className="flex flex-col items-start gap-2 border-t border-border/70 pt-3 sm:flex-row sm:items-center sm:justify-between">
                                            <p className="text-xs text-muted-foreground">
                                              {fixedAssetResolved
                                                ? `Código final: ${
                                                    getSourceItemCode(item) ||
                                                    "—"
                                                  }`
                                                : fixedAssetDraftSaved
                                                  ? `Borrador temporal: ${
                                                      getSourceItemCode(item) ||
                                                      "pendiente"
                                                    }`
                                                  : "Guarde el activo como borrador para crear el artículo temporal."}
                                            </p>
                                            <Button
                                              type="button"
                                              variant={
                                                fixedAssetResolved
                                                  ? "outline"
                                                  : "default"
                                              }
                                              size="sm"
                                              onClick={() =>
                                                handleSaveFixedAssetDraft(item)
                                              }
                                              disabled={
                                                fixedAssetResolved ||
                                                saveFixedAssetDraftMutation.isPending ||
                                                saveReceiptDraftMutation.isPending
                                              }
                                            >
                                              {saveFixedAssetDraftMutation.isPending ||
                                              saveReceiptDraftMutation.isPending
                                                ? "Guardando..."
                                                : fixedAssetResolved
                                                  ? "Código real listo"
                                                  : fixedAssetDraftSaved
                                                    ? "Actualizar borrador"
                                                    : "Guardar como borrador"}
                                            </Button>
                                          </div>
                                        </div>
                                      )
                                    ) : null}
                                  </div>
                                  </td>
                                </tr>
                              ) : null}
                            </Fragment>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>

                {sourceType === "purchase_order" ? (
                  <section className="space-y-3 border-t border-border/70 px-1 py-4 sm:px-2">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <h3 className="text-sm font-semibold">Otros cargos</h3>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="gap-2"
                        onClick={() =>
                          setOtherChargeDrafts(current => [
                            ...current,
                            createReceiptOtherChargeDraft(),
                          ])
                        }
                        disabled={registerMutation.isPending}
                      >
                        <Plus className="h-4 w-4" />
                        Agregar
                      </Button>
                    </div>
                    {otherChargeDrafts.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground">
                        Sin otros cargos.
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {otherChargeDrafts.map(charge => (
                          <div
                            key={charge.id}
                            className="grid gap-2 md:grid-cols-[1fr_180px_auto]"
                          >
                            <Input
                              value={charge.concept}
                              onChange={event =>
                                setOtherChargeDrafts(current =>
                                  current.map(entry =>
                                    entry.id === charge.id
                                      ? {
                                          ...entry,
                                          concept: event.target.value,
                                        }
                                      : entry
                                  )
                                )
                              }
                              placeholder="Concepto"
                              maxLength={255}
                              disabled={registerMutation.isPending}
                            />
                            <Input
                              type="number"
                              min="0"
                              step="0.0001"
                              value={charge.amount}
                              onChange={event =>
                                setOtherChargeDrafts(current =>
                                  current.map(entry =>
                                    entry.id === charge.id
                                      ? {
                                          ...entry,
                                          amount: event.target.value,
                                        }
                                      : entry
                                  )
                                )
                              }
                              placeholder="0.00"
                              className="text-right"
                              disabled={registerMutation.isPending}
                            />
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              onClick={() =>
                                setOtherChargeDrafts(current =>
                                  current.filter(
                                    entry => entry.id !== charge.id
                                  )
                                )
                              }
                              disabled={registerMutation.isPending}
                              aria-label="Quitar otro cargo"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                ) : null}

                {sourceType === "purchase_order" ? (
                  <div className="flex justify-end border-t border-border bg-muted/10 px-3 py-4 sm:px-4">
                    <FiscalSummaryCard
                      summary={receiptPricingSummary}
                      otherChargesTotal={receiptOtherChargesTotal}
                    />
                  </div>
                ) : null}

                <div className="flex flex-col items-end border-t border-border/70 pt-4">
                  <Button
                    size="lg"
                    className="min-w-[240px] text-sm font-semibold sm:h-11 sm:text-base"
                    onClick={handleRegisterReceipt}
                    disabled={
                      registerMutation.isPending ||
                      !sourceId ||
                      activeSourceLoading ||
                      pendingReceiptAttachments.length === 0 ||
                      Boolean(contractReceiptBlockReason) ||
                      Boolean(fixedAssetReceiptBlockReason) ||
                      Boolean(receiptWarehouseSelectionError)
                    }
                  >
                    {registerMutation.isPending
                      ? "Registrando..."
                      : "Registrar recepción"}
                  </Button>
                  {fixedAssetReceiptBlockReason ? (
                    <p className="mt-2 max-w-md text-right text-xs text-amber-700">
                      {fixedAssetReceiptBlockReason}
                    </p>
                  ) : null}
                  {pendingReceiptAttachments.length === 0 ? (
                    <p className="mt-2 max-w-md text-right text-xs text-amber-700">
                      Adjunta el comprobante antes de registrar la recepción.
                    </p>
                  ) : null}
                  {receiptWarehouseSelectionError ? (
                    <p className="mt-2 max-w-md text-right text-xs text-amber-700">
                      {receiptWarehouseSelectionError}
                    </p>
                  ) : null}
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        <Dialog
          open={Boolean(selectedReceiptFixedAssetArticle)}
          onOpenChange={open => {
            if (!open) {
              setSelectedReceiptFixedAssetArticle(null);
              setReceiptFixedAssetRealCode("");
            }
          }}
        >
          <DialogContent className="sm:max-w-[560px]">
            <DialogHeader>
              <DialogTitle>Resolver código de activo fijo</DialogTitle>
              <DialogDescription>
                Actualiza el código real del artículo temporal sin salir de la
                recepción.
              </DialogDescription>
            </DialogHeader>

            {selectedReceiptFixedAssetArticle ? (
              <div className="space-y-4">
                <div className="grid gap-3 rounded-md border border-border p-3 text-sm sm:grid-cols-2">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Código temporal
                    </p>
                    <p className="font-mono">
                      {selectedReceiptFixedAssetArticle.temporaryItemCode ||
                        selectedReceiptFixedAssetArticle.itemCode ||
                        "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Serie
                    </p>
                    <p>
                      {selectedReceiptFixedAssetArticle.fixedAssetSerialNumber ||
                        "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Estado
                    </p>
                    <Badge
                      variant="outline"
                      className={
                        selectedReceiptFixedAssetArticle.fixedAssetStatus ===
                        "resuelto"
                          ? "border-emerald-300 text-emerald-700"
                          : "border-amber-300 text-amber-700"
                      }
                    >
                      {selectedReceiptFixedAssetArticle.fixedAssetStatus ===
                      "resuelto"
                        ? "Resuelto"
                        : "Pendiente"}
                    </Badge>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Código actual
                    </p>
                    <p className="font-mono">
                      {selectedReceiptFixedAssetArticle.itemCode || "—"}
                    </p>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label>Código real</Label>
                  <Input
                    value={receiptFixedAssetRealCode}
                    onChange={event =>
                      setReceiptFixedAssetRealCode(event.target.value)
                    }
                    readOnly={
                      selectedReceiptFixedAssetArticle.fixedAssetStatus ===
                      "resuelto"
                    }
                    placeholder="Ingrese el código real"
                    onKeyDown={event => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        submitReceiptFixedAssetCode();
                      }
                    }}
                  />
                </div>
              </div>
            ) : null}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setSelectedReceiptFixedAssetArticle(null);
                  setReceiptFixedAssetRealCode("");
                }}
                disabled={resolveReceiptFixedAssetMutation.isPending}
              >
                Cerrar
              </Button>
              {selectedReceiptFixedAssetArticle?.fixedAssetStatus ===
              "pendiente" ? (
                <Button
                  type="button"
                  onClick={submitReceiptFixedAssetCode}
                  disabled={resolveReceiptFixedAssetMutation.isPending}
                >
                  {resolveReceiptFixedAssetMutation.isPending
                    ? "Guardando..."
                    : "Guardar código"}
                </Button>
              ) : null}
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog
          open={viewReceiptId !== null}
          onOpenChange={open => {
            if (!open) setViewReceiptId(null);
          }}
        >
          <DialogContent className="scrollbar-visible max-h-[calc(100vh-0.5rem)] w-[calc(100vw-0.25rem)] max-w-[calc(100vw-0.25rem)] overflow-x-hidden overflow-y-auto rounded-2xl p-4 sm:max-h-[calc(100vh-1rem)] sm:w-[calc(100vw-0.75rem)] sm:max-w-[1920px] sm:p-6 lg:p-7">
            <DialogHeader className="border-b border-border/70 pb-4 pr-10">
              <div className="flex flex-wrap items-center gap-3">
                <DialogTitle className="text-[2rem] font-bold tracking-tight sm:text-[2.4rem]">
                  {receiptDetail?.receipt.receiptNumber ||
                    "Detalle de recepción"}
                </DialogTitle>
                {receiptDetail ? (
                  <Badge
                    variant="outline"
                    className={`text-sm ${getReceiptStatusColor(
                      receiptDetail.receipt,
                      receiptDetail.invoice
                    )}`}
                  >
                    {getReceiptStatusLabel(
                      receiptDetail.receipt,
                      receiptDetail.invoice
                    )}
                  </Badge>
                ) : null}
              </div>
            </DialogHeader>

            {receiptDetailLoading ? (
              <div className="py-8 text-center text-muted-foreground">
                Cargando recepción...
              </div>
            ) : receiptDetailIsError ? (
              <div className="flex flex-col items-center justify-center gap-4 py-10 text-center">
                <AlertTriangle className="h-8 w-8 text-destructive" />
                <div className="space-y-1">
                  <p className="font-semibold text-foreground">
                    No se pudo cargar la recepción.
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {receiptDetailError?.message ||
                      "Intenta de nuevo o revisa el servidor."}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={() => void refetchReceiptDetail()}
                >
                  <RotateCcw className="h-4 w-4" />
                  Reintentar
                </Button>
              </div>
            ) : !receiptDetail ? (
              <div className="py-8 text-center text-muted-foreground">
                No se encontró la recepción.
              </div>
            ) : receiptDetail ? (
              <div className="space-y-5">
                {getReceiptHasEmissionDeadlineIssue(
                  receiptDetail.receipt,
                  receiptDetail.invoice
                ) ? (
                  <div className="flex items-start gap-2 rounded-2xl border border-rose-300 bg-rose-50 p-4 text-sm text-rose-700">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <div>
                      <p className="font-semibold">
                        {EMISSION_DEADLINE_ISSUE_MESSAGE}
                      </p>
                      <p>
                        La fecha del documento es posterior a la fecha límite de
                        emisión autorizada.
                      </p>
                    </div>
                  </div>
                ) : null}

                <div className="grid gap-3 md:grid-cols-12">
                  <div className="space-y-1.5 rounded-2xl border border-border/70 bg-muted/20 p-3.5 sm:p-4 md:col-span-3">
                    <Label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground sm:text-xs">
                      Tipo de origen
                    </Label>
                    <p className="text-sm font-semibold leading-snug sm:text-base">
                      {receiptDetail.receipt.sourceType === "purchase_order"
                        ? SOURCE_TYPE_LABELS.purchase_order
                        : SOURCE_TYPE_LABELS.transfer}
                    </p>
                  </div>
                  <div className="space-y-1.5 rounded-2xl border border-border/70 bg-muted/20 p-3.5 sm:p-4 md:col-span-5">
                    <Label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground sm:text-xs">
                      Documento origen
                    </Label>
                    <p className="text-sm font-semibold leading-snug sm:text-base">
                      {receiptSourceHeaderTitle}
                    </p>
                  </div>
                  <div className="space-y-1.5 rounded-2xl border border-border/70 bg-muted/20 p-3.5 sm:p-4 md:col-span-2">
                    <Label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground sm:text-xs">
                      Proyecto
                    </Label>
                    <p className="text-sm font-semibold leading-snug sm:text-base">
                      {receiptDetail.project
                        ? `${receiptDetail.project.code} — ${receiptDetail.project.name}`
                        : "—"}
                    </p>
                  </div>
                  <div className="space-y-1.5 rounded-2xl border border-border/70 bg-muted/20 p-3.5 sm:p-4 md:col-span-2">
                    <Label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground sm:text-xs">
                      Estado del origen
                    </Label>
                    <p className="text-sm font-semibold leading-snug sm:text-base">
                      {receiptSourceStatusLabel}
                    </p>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-12">
                  <div className="space-y-1.5 rounded-2xl border border-border/70 bg-muted/20 p-3.5 sm:p-4 md:col-span-4">
                    <Label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground sm:text-xs">
                      {receiptDetail.receipt.sourceType === "purchase_order"
                        ? "Proveedor"
                        : "Referencia del origen"}
                    </Label>
                    <p className="text-sm font-semibold leading-snug sm:text-base">
                      {receiptSourceSecondaryLabel}
                    </p>
                    {receiptSourceSupplierRtnLabel ? (
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        RTN: {receiptSourceSupplierRtnLabel}
                      </p>
                    ) : null}
                  </div>
                  <div className="space-y-1.5 rounded-2xl border border-border/70 bg-muted/20 p-3.5 sm:p-4 md:col-span-2">
                    <Label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground sm:text-xs">
                      Tipo documento
                    </Label>
                    <p className="text-sm font-semibold leading-snug sm:text-base">
                      {receiptDetail.receipt.sourceType === "purchase_order"
                        ? receiptDetail.receipt.isFiscalDocument
                          ? getDocumentTypeLabelFromNumber(
                              receiptDetail.receipt.invoiceNumber
                            ) || "Documento fiscal"
                          : "Documento extranjero"
                        : "—"}
                    </p>
                  </div>
                  <div className="space-y-1.5 rounded-2xl border border-border/70 bg-muted/20 p-3.5 sm:p-4 md:col-span-2">
                    <Label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground sm:text-xs">
                      Número documento
                    </Label>
                    <p className="text-sm font-semibold leading-snug sm:text-base">
                      {receiptDetail.receipt.invoiceNumber || "—"}
                    </p>
                  </div>
                  <div className="space-y-1.5 rounded-2xl border border-border/70 bg-muted/20 p-3.5 sm:p-4 md:col-span-2">
                    <Label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground sm:text-xs">
                      {receiptDetail.receipt.isFiscalDocument
                        ? "CAI"
                        : "CAI / referencia"}
                    </Label>
                    <p className="text-sm font-semibold leading-snug sm:text-base">
                      {receiptDetail.receipt.cai || "—"}
                    </p>
                  </div>
                  <div className="space-y-1.5 rounded-2xl border border-border/70 bg-muted/20 p-3.5 sm:p-4 md:col-span-2">
                    <Label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground sm:text-xs">
                      Rango autorizado inicial
                    </Label>
                    <p className="text-sm font-semibold leading-snug sm:text-base">
                      {receiptDetail.receipt.documentRangeStart || "—"}
                    </p>
                  </div>
                  <div className="space-y-1.5 rounded-2xl border border-border/70 bg-muted/20 p-3.5 sm:p-4 md:col-span-2">
                    <Label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground sm:text-xs">
                      Rango autorizado final
                    </Label>
                    <p className="text-sm font-semibold leading-snug sm:text-base">
                      {receiptDetail.receipt.documentRangeEnd || "—"}
                    </p>
                  </div>
                  <div className="space-y-1.5 rounded-2xl border border-border/70 bg-muted/20 p-3.5 sm:p-4 md:col-span-2">
                    <Label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground sm:text-xs">
                      Registrada por
                    </Label>
                    <p className="text-sm font-semibold leading-snug sm:text-base">
                      {formatUserReference(
                        (receiptDetail as any).receivedBy,
                        receiptDetail.receipt.receivedById
                      )}
                    </p>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-4">
                  <div className="space-y-1.5 rounded-2xl border border-border/70 bg-muted/20 p-3.5 sm:p-4">
                    <Label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground sm:text-xs">
                      Fecha documento
                    </Label>
                    <p className="text-sm font-semibold leading-snug sm:text-base">
                      {formatDateLabel(receiptDetail.receipt.documentDate)}
                    </p>
                  </div>
                  <div className="space-y-1.5 rounded-2xl border border-border/70 bg-muted/20 p-3.5 sm:p-4">
                    <Label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground sm:text-xs">
                      Fecha vencimiento (crédito)
                    </Label>
                    <p className="text-sm font-semibold leading-snug sm:text-base">
                      {formatDateLabel(receiptDetail.receipt.documentDueDate)}
                    </p>
                  </div>
                  <div className="space-y-1.5 rounded-2xl border border-border/70 bg-muted/20 p-3.5 sm:p-4">
                    <Label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground sm:text-xs">
                      Fecha contabilización
                    </Label>
                    <p className="text-sm font-semibold leading-snug sm:text-base">
                      {formatDateLabel(receiptDetail.receipt.postingDate)}
                    </p>
                  </div>
                  <div className="space-y-1.5 rounded-2xl border border-border/70 bg-muted/20 p-3.5 sm:p-4">
                    <Label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground sm:text-xs">
                      Fecha recepción
                    </Label>
                    <p className="text-sm font-semibold leading-snug sm:text-base">
                      {formatDateLabel(receiptDetail.receipt.receiptDate)}
                    </p>
                  </div>
                </div>

                <div className="space-y-2 rounded-2xl border border-border/70 bg-muted/10 p-4 sm:p-5">
                  <Label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground sm:text-xs">
                    Notas
                  </Label>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                    {receiptDetail.receipt.notes?.trim() ||
                      "Sin notas registradas"}
                  </p>
                </div>

                {receiptDetail.receipt.status === "anulada" ? (
                  <div className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-rose-300 bg-rose-50 p-4 text-sm text-rose-800 sm:p-5">
                    <div className="min-w-0">
                      <p className="font-semibold">
                        Recepción anulada por corrección
                      </p>
                      <p className="whitespace-pre-wrap">
                        {receiptDetail.receipt.voidReason ||
                          "Sin motivo registrado"}
                      </p>
                      {receiptDetail.receipt.voidedAt ? (
                        <p className="mt-1 text-xs text-rose-700">
                          {formatUserReference(
                            (receiptDetail as any).voidedBy,
                            receiptDetail.receipt.voidedById
                          )}{" "}
                          ·{" "}
                          {formatDateTimeLabel(receiptDetail.receipt.voidedAt)}
                        </p>
                      ) : null}
                    </div>
                    {receiptDetail.receipt.replacementReceiptId ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="border-rose-300 bg-white text-rose-800 hover:bg-rose-100"
                        onClick={() => {
                          setViewReceiptId(null);
                          setEditingDraftReceiptId(
                            receiptDetail.receipt.replacementReceiptId
                          );
                          setDialogOpen(true);
                        }}
                      >
                        Abrir recepción corregida
                      </Button>
                    ) : null}
                  </div>
                ) : null}

                <div className="overflow-x-auto rounded-2xl border border-border/70">
                  <table
                    className={`w-full text-sm ${
                      receiptDetail?.receipt.sourceType === "purchase_order"
                        ? "min-w-[1120px]"
                        : ""
                    }`}
                  >
                    <thead>
                      <tr className="border-b border-border/70 bg-muted/20">
                        <th className="p-3 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground sm:text-xs">
                          Ítem
                        </th>
                        <th className="p-3 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground sm:text-xs">
                          Código
                        </th>
                        <th className="p-3 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground sm:text-xs">
                          Almacén
                        </th>
                        <th className="p-3 text-right text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground sm:text-xs">
                          Esperado
                        </th>
                        <th className="p-3 text-right text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground sm:text-xs">
                          Recibido
                        </th>
                        <th className="p-3 text-right text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground sm:text-xs">
                          Precio confirmado
                        </th>
                        {receiptDetail.receipt.sourceType ===
                        "purchase_order" ? (
                          <>
                            <th className="p-3 text-right text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground sm:text-xs">
                              Subtotal
                            </th>
                            <th className="p-3 text-right text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground sm:text-xs">
                              ISV
                            </th>
                            <th className="p-3 text-right text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground sm:text-xs">
                              Total
                            </th>
                          </>
                        ) : null}
                      </tr>
                    </thead>
                    <tbody>
                      {receiptDetail.items.length === 0 ? (
                        <tr>
                          <td
                            className="p-4 text-sm text-muted-foreground"
                            colSpan={
                              receiptDetail?.receipt.sourceType ===
                              "purchase_order"
                                ? 9
                                : 6
                            }
                          >
                            Esta recepción no tiene ítems registrados.
                          </td>
                        </tr>
                      ) : (
                        receiptDetail.items.map((item: any) => {
                          const itemCode =
                            receiptSourceItemCodes.get(item.sourceItemId) ??
                            getSourceItemCode(item);
                          const sourceItem = receiptSourceItemsById.get(
                            item.sourceItemId
                          );
                          const lineAmounts = calculateReceiptLineAmounts(
                            item,
                            sourceItem
                          );
                          const targetLabel =
                            receiptDetail.receipt.sourceType ===
                            "purchase_order"
                              ? formatReceiptLineTargetLabel(
                                  item,
                                  sourceItem,
                                  receiptDetail.receipt.projectId
                                )
                              : null;
                          const assetDetails = parseFixedAssetDetails(
                            item.assetDetails
                          );

                          return (
                            <tr
                              key={item.id}
                              className="border-b border-border/70 last:border-0"
                            >
                              <td className="p-4">
                                <div className="font-semibold">
                                  {item.itemName}
                                </div>
                                {item.notes ? (
                                  <div className="mt-1 text-xs text-muted-foreground">
                                    {item.notes}
                                  </div>
                                ) : null}
                                {targetLabel ? (
                                  <div className="mt-1 text-xs text-muted-foreground">
                                    Destino: {targetLabel}
                                  </div>
                                ) : null}
                                {item.isFixedAsset ? (
                                  <div className="mt-2 space-y-1.5">
                                    <div className="flex flex-wrap gap-1.5">
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
                                        {assetDetails.length} unidad(es)
                                      </Badge>
                                    </div>
                                    {assetDetails.length > 0 ? (
                                      <div className="space-y-1 text-xs text-muted-foreground">
                                        {assetDetails.map((detail, index) => (
                                          <div
                                            key={`${item.id}-asset-${index}`}
                                          >
                                            Unidad {index + 1}:{" "}
                                            {getAssetDetailSummary(detail)}
                                          </div>
                                        ))}
                                      </div>
                                    ) : null}
                                  </div>
                                ) : null}
                              </td>
                              <td className="p-4 font-mono text-sm">
                                {itemCode || "—"}
                              </td>
                              <td className="p-4 text-sm">
                                <div className="font-medium">
                                  {formatWarehouseReference(
                                    item.warehouse,
                                    item.warehouseId
                                      ? `Almacén #${item.warehouseId}`
                                      : "—"
                                  )}
                                </div>
                              </td>
                              <td className="p-4 text-right font-semibold">
                                {formatQuantity(item.quantityExpected)}{" "}
                                {item.unit || ""}
                              </td>
                              <td className="p-4 text-right text-muted-foreground">
                                {formatQuantity(item.quantityReceived)}{" "}
                                {item.unit || ""}
                              </td>
                              <td className="p-4 text-right font-medium">
                                {formatPrintMoney(item.unitPrice)}
                              </td>
                              {receiptDetail.receipt.sourceType ===
                              "purchase_order" ? (
                                <>
                                  <td className="p-4 text-right font-semibold">
                                    {formatPurchaseOrderCurrency(
                                      lineAmounts.subtotal
                                    )}
                                  </td>
                                  <td className="p-4 text-right font-semibold">
                                    {formatPurchaseOrderCurrency(
                                      lineAmounts.taxAmount
                                    )}
                                  </td>
                                  <td className="p-4 text-right font-semibold">
                                    {formatPurchaseOrderCurrency(
                                      lineAmounts.total
                                    )}
                                  </td>
                                </>
                              ) : null}
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>

                {receiptDetail.receipt.sourceType === "purchase_order" &&
                (receiptDetail as any).otherCharges?.length ? (
                  <section className="rounded-2xl border border-border/70">
                    <div className="border-b border-border/70 px-4 py-3">
                      <h3 className="font-semibold">Otros cargos</h3>
                    </div>
                    <div className="divide-y divide-border/70">
                      {(receiptDetail as any).otherCharges.map(
                        (charge: any) => (
                          <div
                            key={charge.id}
                            className="grid grid-cols-[1fr_auto] gap-3 px-4 py-3 text-sm"
                          >
                            <span className="font-medium">
                              {charge.concept}
                            </span>
                            <span className="font-semibold tabular-nums">
                              {formatPurchaseOrderCurrency(charge.amount)}
                            </span>
                          </div>
                        )
                      )}
                    </div>
                  </section>
                ) : null}

                {receiptDetailPricingSummary ? (
                  <div className="flex justify-end border-t border-border bg-muted/10 px-3 py-4 sm:px-4">
                    <FiscalSummaryCard
                      summary={receiptDetailPricingSummary}
                      otherChargesTotal={receiptDetailOtherChargesTotal}
                    />
                  </div>
                ) : null}

                <DocumentAttachmentsPanel
                  entityType="receipt"
                  entityId={receiptDetail.receipt.id}
                  category="comprobante_entrega"
                  title="Adjuntos"
                  canManage={canManageReceiptAttachments}
                />

                <div className="flex flex-wrap justify-end gap-3 border-t border-border/70 pt-1">
                  {receiptDetail.receipt.sourceType === "purchase_order" &&
                  receiptDetail.invoice?.id &&
                  receiptDetail.receipt.status !== "anulada" ? (
                    <div className="flex flex-col items-end gap-1">
                      <Button
                        variant="destructive"
                        size="lg"
                        className="h-10 min-w-[210px] px-5 text-sm font-semibold sm:h-11 sm:text-base"
                        onClick={() => setReceiptCorrectionDialogOpen(true)}
                        disabled={
                          !canOpenReceiptCorrection ||
                          correctReceiptMutation.isPending
                        }
                      >
                        <RotateCcw className="mr-2 h-4 w-4" />
                        Corregir recepción
                      </Button>
                      {receiptCorrectionDisabledReason ? (
                        <p className="max-w-[320px] text-right text-xs text-muted-foreground">
                          {receiptCorrectionDisabledReason}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                  <Button
                    variant="outline"
                    size="lg"
                    className="h-10 min-w-[210px] px-5 text-sm font-semibold sm:h-11 sm:text-base"
                    onClick={handlePrintReceipt}
                    disabled={
                      receiptDetail.items.length === 0 ||
                      receiptSourceDetailLoading
                    }
                  >
                    <Printer className="mr-2 h-4 w-4" />
                    Imprimir documento
                  </Button>
                </div>
              </div>
            ) : null}
          </DialogContent>
        </Dialog>

        <Dialog
          open={receiptCorrectionDialogOpen}
          onOpenChange={open => {
            if (!open && !correctReceiptMutation.isPending) {
              setReceiptCorrectionDialogOpen(false);
              setReceiptCorrectionReason("");
            }
          }}
        >
          <DialogContent className="max-w-lg rounded-2xl border-border/70">
            <DialogHeader className="space-y-2">
              <DialogTitle>Corregir recepción</DialogTitle>
              <DialogDescription>
                La factura y la recepción original quedarán anuladas. El
                sistema devolverá las entradas de inventario, restará cantidades
                recibidas y creará una nueva recepción en borrador.
              </DialogDescription>
            </DialogHeader>
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
              Si la factura ya está contabilizada o algún ítem ya no tiene
              existencia suficiente en su bodega, la corrección se bloqueará sin
              hacer cambios.
            </div>
            <div className="space-y-2">
              <Label htmlFor="receipt-correction-reason">
                Motivo de corrección *
              </Label>
              <Textarea
                id="receipt-correction-reason"
                value={receiptCorrectionReason}
                onChange={event =>
                  setReceiptCorrectionReason(event.target.value)
                }
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
                  setReceiptCorrectionDialogOpen(false);
                  setReceiptCorrectionReason("");
                }}
                disabled={correctReceiptMutation.isPending}
              >
                Cancelar
              </Button>
              <Button
                variant="destructive"
                onClick={handleCorrectReceiptFromReceipt}
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
          open={closeTransferLineItem !== null}
          onOpenChange={open => {
            if (!open) {
              setCloseTransferLineItem(null);
              setTransferCloseReason(TRANSFER_CLOSE_REASONS[0].value);
              setTransferCloseNote("");
            }
          }}
        >
          <DialogContent className="sm:max-w-[560px]">
            <DialogHeader>
              <DialogTitle>Cerrar saldo de traslado</DialogTitle>
              <DialogDescription>
                El saldo que ya no se recibirá se devolverá al proyecto origen y
                volverá a la requisición al registrar la recepción.
              </DialogDescription>
            </DialogHeader>

            {closeTransferLineItem ? (
              <div className="space-y-4">
                <div className="rounded-lg border border-border/70 bg-muted/20 p-3 text-sm">
                  <div className="font-semibold">
                    {closeTransferLineItem.itemName}
                  </div>
                  <div className="mt-1 text-muted-foreground">
                    Se recibirá{" "}
                    <strong>
                      {formatQuantity(
                        Number(receivedMap[closeTransferLineItem.id] ?? 0) || 0
                      )}{" "}
                      {closeTransferLineItem.unit || ""}
                    </strong>{" "}
                    y se devolverá al origen y volverá a requisición el saldo de{" "}
                    <strong>
                      {formatQuantity(
                        getTransferCloseQuantity(closeTransferLineItem)
                      )}{" "}
                      {closeTransferLineItem.unit || ""}
                    </strong>
                    .
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Motivo</Label>
                  <Select
                    value={transferCloseReason}
                    onValueChange={setTransferCloseReason}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TRANSFER_CLOSE_REASONS.map(reason => (
                        <SelectItem key={reason.value} value={reason.value}>
                          {reason.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="transfer-close-note">Nota obligatoria</Label>
                  <Textarea
                    id="transfer-close-note"
                    rows={4}
                    value={transferCloseNote}
                    onChange={event => setTransferCloseNote(event.target.value)}
                    placeholder="Explique por qué el saldo no se recibirá, regresa al origen y vuelve a requisición"
                  />
                </div>
              </div>
            ) : null}

            <DialogFooter>
              {closeTransferLineItem &&
              transferClosureDrafts[closeTransferLineItem.id] ? (
                <Button
                  variant="outline"
                  onClick={() => {
                    setTransferClosureDrafts(current => {
                      const next = { ...current };
                      delete next[closeTransferLineItem.id];
                      return next;
                    });
                    setCloseTransferLineItem(null);
                  }}
                >
                  Quitar cierre
                </Button>
              ) : null}
              <Button
                variant="outline"
                onClick={() => setCloseTransferLineItem(null)}
              >
                Cancelar
              </Button>
              <Button
                onClick={() => {
                  if (!closeTransferLineItem) return;
                  if (getTransferCloseQuantity(closeTransferLineItem) <= 0) {
                    toast.error("No hay saldo pendiente para cerrar");
                    return;
                  }
                  if (!transferCloseNote.trim()) {
                    toast.error("Ingrese una nota para cerrar el saldo");
                    return;
                  }

                  setTransferClosureDrafts(current => ({
                    ...current,
                    [closeTransferLineItem.id]: {
                      reason: transferCloseReason,
                      note: transferCloseNote.trim(),
                    },
                  }));
                  setCloseTransferLineItem(null);
                  toast.success("Cierre marcado para esta recepción");
                }}
              >
                Marcar cierre
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <AlertDialog
        open={closeReceiptLineItem !== null}
        onOpenChange={open => {
          if (!open) setCloseReceiptLineItem(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cerrar línea de recepción</AlertDialogTitle>
            <AlertDialogDescription>
              {closeReceiptLineItem ? (
                <>
                  Esta acción cerrará la línea{" "}
                  <strong>{closeReceiptLineItem.itemName}</strong> con saldo
                  pendiente de{" "}
                  <strong>
                    {formatQuantity(getPendingQuantity(closeReceiptLineItem))}{" "}
                    {closeReceiptLineItem.unit || ""}
                  </strong>
                  . Después de cerrarla ya no aparecerá como opción en este
                  panel de recepciones.
                </>
              ) : (
                "Esta acción cerrará la línea seleccionada para que deje de aparecer en recepciones."
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={closeReceiptLineMutation.isPending}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={
                closeReceiptLineMutation.isPending || !closeReceiptLineItem
              }
              onClick={event => {
                event.preventDefault();
                if (!closeReceiptLineItem) return;
                closeReceiptLineMutation.mutate({
                  purchaseOrderItemId: closeReceiptLineItem.id,
                });
              }}
            >
              {closeReceiptLineMutation.isPending
                ? "Cerrando..."
                : "Cerrar línea"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchTerm}
            onChange={event => setSearchTerm(event.target.value)}
            placeholder="Buscar por recepción, origen, proveedor o proyecto..."
            className="h-10 pl-9"
          />
        </div>
        <Select value={sourceTypeFilter} onValueChange={setSourceTypeFilter}>
          <SelectTrigger className="h-10 w-full lg:w-56">
            <SelectValue placeholder="Tipo de origen" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los tipos</SelectItem>
            <SelectItem value="purchase_order">Orden de Compra</SelectItem>
            <SelectItem value="transfer">Traslado</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-10 w-full lg:w-56">
            <SelectValue placeholder="Estado" />
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
              Cargando recepciones...
            </div>
          ) : !(receipts || []).length ? (
            <div className="p-8 text-center text-muted-foreground">
              No hay recepciones registradas
            </div>
          ) : !filteredReceipts.length ? (
            <div className="p-8 text-center text-muted-foreground">
              No hay recepciones que coincidan con los filtros
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      No. Recepción
                    </th>
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Proyecto
                    </th>
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Proveedor
                    </th>
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Tipo
                    </th>
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Estatus
                    </th>
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Fecha
                    </th>
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Acciones
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredReceipts.map((row: any) => (
                    <tr
                      key={row.receipt.id}
                      className="border-b border-border last:border-0"
                    >
                      <td className="p-3 font-medium">
                        {row.receipt.receiptNumber}
                      </td>
                      <td className="p-3 text-xs">
                        {row.project
                          ? `${row.project.code} — ${row.project.name}`
                          : "—"}
                      </td>
                      <td className="p-3 text-xs">
                        {row.supplier ? (
                          <div className="space-y-1">
                            <div className="font-medium text-foreground">
                              {row.supplier.supplierCode} — {row.supplier.name}
                            </div>
                            <div className="text-muted-foreground">
                              RTN: {formatSupplierRtnLabel(row.supplier)}
                            </div>
                          </div>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="p-3 text-xs">
                        {row.receipt.sourceType === "purchase_order"
                          ? SOURCE_TYPE_LABELS.purchase_order
                          : SOURCE_TYPE_LABELS.transfer}
                      </td>
                      <td className="p-3">
                        <Badge
                          variant="outline"
                          className={`text-xs ${getReceiptStatusColor(
                            row.receipt,
                            row.invoice
                          )}`}
                        >
                          {getReceiptStatusLabel(row.receipt, row.invoice)}
                        </Badge>
                      </td>
                      <td className="p-3 text-xs">
                        {formatDateLabel(
                          row.receipt.receiptDate || row.receipt.createdAt
                        )}
                      </td>
                      <td className="p-3">
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-2"
                          onClick={() =>
                            row.receipt.status === "borrador"
                              ? openDraftReceiptForEdit(row)
                              : setViewReceiptId(row.receipt.id)
                          }
                        >
                          {row.receipt.status === "borrador" ? (
                            <Pencil className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                          {row.receipt.status === "borrador" ? "Editar" : "Ver"}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
