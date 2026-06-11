import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { buildDatedCsvFileName, downloadCsv } from "@/lib/csv-export";
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
import { formatPurchaseOrderCurrency } from "@shared/purchase-orders";
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

function formatCsvAmount(value: string | number | null | undefined) {
  return toNumber(value).toFixed(2);
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
  if (!value) return "";
  const date = new Date(value);
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

function amountToSpanishLempiras(value: number) {
  const centsTotal = Math.max(0, Math.round(value * 100));
  const lempiras = Math.floor(centsTotal / 100);
  const cents = centsTotal % 100;
  const unitLabel = lempiras === 1 ? "LEMPIRA" : "LEMPIRAS";
  return `${integerToSpanishWords(lempiras).toUpperCase()} ${unitLabel} CON ${String(cents).padStart(2, "0")}/100`;
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
                (assetUnitCount !== 1 || item.targetType !== "activo_fijo"))
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
        (assetUnitCount !== 1 || item.targetType !== "activo_fijo") ? (
          <span className="text-xs text-muted-foreground bg-muted/50 px-2 py-0.5 rounded border border-border/50">
            {item.targetType !== "activo_fijo"
              ? "Solo disponible para productos de tipo Activo Fijo"
              : "Solo disponible cuando la cantidad es exactamente 1"}
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
    notes: "",
  });
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
          formatInvoiceRequestNumbers(row),
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

  const exportInvoicesCsv = () => {
    downloadCsv(
      buildDatedCsvFileName("facturas"),
      [
        {
          header: "Documento",
          value: (row: any) => row.invoice.invoiceDocumentNumber,
        },
        {
          header: "Número fiscal",
          value: (row: any) =>
            row.invoice.invoiceNumber || "Documento sin número",
        },
        {
          header: "Proveedor",
          value: (row: any) =>
            row.supplier
              ? `${row.supplier.supplierCode} — ${row.supplier.name}`
              : "Proveedor pendiente",
        },
        {
          header: "RTN proveedor",
          value: (row: any) => row.supplier?.rtn || "—",
        },
        {
          header: "Origen OC",
          value: (row: any) => row.purchaseOrder?.orderNumber || "OC",
        },
        {
          header: "Recepción",
          value: (row: any) => row.receipt?.receiptNumber || "Recepción",
        },
        {
          header: "Requisición",
          value: (row: any) => formatInvoiceRequestNumbers(row),
        },
        {
          header: "Fecha vencimiento (crédito)",
          value: (row: any) => formatDateLabel(row.invoice.documentDueDate),
        },
        {
          header: "Fecha límite emisión",
          value: (row: any) => formatDateLabel(row.invoice.emissionDeadline),
        },
        {
          header: "Total",
          value: (row: any) => formatCsvAmount(row.invoice.total),
        },
        {
          header: "Retenciones",
          value: (row: any) => formatCsvAmount(row.invoice.retentionTotal),
        },
        {
          header: "Neto",
          value: (row: any) => formatCsvAmount(row.invoice.netPayable),
        },
        {
          header: "Estado",
          value: (row: any) => getInvoiceStatusLabel(row.invoice),
        },
      ],
      filteredInvoices
    );
  };

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
  const supplierAllowsTaxWithholding =
    detail?.supplier?.allowsTaxWithholding !== false;
  const supplierSubjectToAccountPayments =
    detail?.supplier?.subjectToAccountPayments !== false;
  const canRetainSelectedInvoice =
    supplierAllowsTaxWithholding && withholdingBase > 0;
  const retentionDisabledReason = !supplierAllowsTaxWithholding
    ? "El proveedor no permite retención de impuestos."
    : withholdingBase <= 0
      ? "La factura no tiene líneas habilitadas para retención."
      : "";
  const netPayable = Math.max(invoiceTotal - retentionTotal, 0);
  const isRejected = detail?.invoice.status === "rechazada";
  const isDraft = detail?.invoice.status === "borrador" || isRejected;
  const isReviewed = detail?.invoice.status === "revisada";
  const isVoided = detail?.invoice.status === "anulada";
  const canEditSelectedInvoice = canEditInvoices && isDraft;
  const canEditRetentions = canEditSelectedInvoice && canRetainSelectedInvoice;
  const canManageInvoiceAttachments = canReviewInvoices && isDraft;
  const canReviewSelectedInvoice = canReviewInvoices && isDraft;
  const canAccountSelectedInvoice = canAccountInvoices && isReviewed;
  const canCorrectSelectedReceipt =
    canEditInvoices && Boolean(detail?.receipt) && (isDraft || isReviewed);
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
    if (
      retentionDrafts.length > 0 &&
      !invoiceDraft.retentionReceiptNumber.trim()
    ) {
      toast.error("Ingrese el número de comprobante de retención");
      return false;
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
      invoiceDraft.retentionReceiptNumber.trim() || undefined,
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
    return retentionOptions.filter(
      option => !selectedRetentionIds.has(String(option.id))
    );
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
    if (retentionDrafts.length > 0 && !canRetainSelectedInvoice) {
      toast.error(
        retentionDisabledReason || "La factura no permite retenciones"
      );
      return;
    }
    if (
      retentionDrafts.length > 0 &&
      !invoiceDraft.retentionReceiptNumber.trim()
    ) {
      toast.error("Ingrese el número de comprobante de retención");
      return;
    }
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
        invoiceDraft.retentionReceiptNumber.trim() || undefined,
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
    const amountWords = amountToSpanishLempiras(totalRetained);
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
      <div class="field invoice-cai">${escapePrintHtml(invoice.cai ?? "")}</div>
      <div class="field supplier-address multiline">${escapePrintHtml(supplierAddress)}</div>
      ${rowsHtml}
      <div class="field total-retained right">${formatRetentionPrintNumber(totalRetained)}</div>
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
          onClick={exportInvoicesCsv}
          disabled={!filteredInvoices.length}
        >
          <Download className="mr-2 h-4 w-4" />
          Exportar CSV
        </Button>
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchTerm}
            onChange={event => setSearchTerm(event.target.value)}
            placeholder="Buscar por factura, OC, recepción, REQ, proveedor o proyecto..."
            className="h-10 pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-10 w-full lg:w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">
              {isAccountant ? "Revisión y contabilizadas" : "Todos los estados"}
            </SelectItem>
            {Object.entries(STATUS_LABELS)
              .filter(
                ([value]) =>
                  !isAccountant ||
                  value === "revisada" ||
                  value === "registrada"
              )
              .map(([value, label]) => (
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
              <table className="w-full text-sm">
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
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Estado
                    </th>
                    <th className="p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Acciones
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredInvoices.map((row: any) => (
                    <tr
                      key={row.invoice.id}
                      className="border-b border-border last:border-0"
                    >
                      <td className="p-3">
                        <div className="font-semibold">
                          {row.invoice.invoiceDocumentNumber}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {row.invoice.invoiceNumber || "Documento sin número"}
                        </div>
                      </td>
                      <td className="p-3">
                        {row.supplier ? (
                          <div className="space-y-1">
                            <div className="font-medium">
                              {row.supplier.supplierCode} — {row.supplier.name}
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
                        {formatPurchaseOrderCurrency(row.invoice.total)}
                      </td>
                      <td className="p-3 text-right font-medium">
                        {formatPurchaseOrderCurrency(
                          row.invoice.retentionTotal
                        )}
                      </td>
                      <td className="p-3 text-right font-semibold">
                        {formatPurchaseOrderCurrency(row.invoice.netPayable)}
                      </td>
                      <td className="p-3">
                        <Badge
                          variant="outline"
                          className={`text-xs ${getInvoiceStatusColor(row.invoice)}`}
                        >
                          {getInvoiceStatusLabel(row.invoice)}
                        </Badge>
                      </td>
                      <td className="p-3 text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setSelectedId(row.invoice.id)}
                        >
                          Ver
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
                          supplierAllowsTaxWithholding
                            ? "border-emerald-300 text-emerald-700"
                            : "border-amber-300 text-amber-700"
                        }`}
                      >
                        {supplierAllowsTaxWithholding
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
                          }))
                        }
                      />
                      <Label htmlFor="invoice-fiscal-document">
                        Documento fiscal
                      </Label>
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
                      <div className="space-y-2">
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
                      <div className="space-y-2">
                        <Label>
                          Número comprobante de retención
                          {retentionDrafts.length > 0 ? " *" : ""}
                        </Label>
                        <Input
                          value={invoiceDraft.retentionReceiptNumber}
                          disabled={!canEditSelectedInvoice}
                          onChange={event =>
                            updateInvoiceDraft(current => ({
                              ...current,
                              retentionReceiptNumber: event.target.value,
                            }))
                          }
                          placeholder="Comprobante de retención"
                          maxLength={100}
                        />
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
                            Precio unitario
                          </th>
                          <th className="p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            Subtotal
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
                          const showAssetDetails =
                            canEditSelectedInvoice ||
                            item.isFixedAsset ||
                            Boolean(item.lineObservation?.trim());

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
                                      {itemAssetDetails.length > 0 ? (
                                        <Badge variant="outline">
                                          {itemAssetDetails.length} unidad(es)
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
                                  {item.currentSapItemCode ||
                                    item.originalSapItemCode ||
                                    "—"}
                                </td>
                                <td className="p-3 text-right">
                                  {item.quantity} {item.unit || ""}
                                </td>
                                <td className="p-3 text-right">
                                  {formatPurchaseOrderCurrency(item.unitPrice)}
                                </td>
                                <td className="p-3 text-right">
                                  {formatPurchaseOrderCurrency(item.subtotal)}
                                </td>
                                <td className="p-3 text-right">
                                  {formatPurchaseOrderCurrency(item.taxAmount)}
                                </td>
                                <td className="p-3 text-right font-semibold">
                                  {formatPurchaseOrderCurrency(item.total)}
                                </td>
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
                                              {retention.retentionCode} -{" "}
                                              {retention.description}
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
                                              .map(
                                                retention =>
                                                  retention.retentionCatalogId
                                              )
                                              .join("-")}`}
                                            onValueChange={value =>
                                              handleAddLineRetention(
                                                item,
                                                value
                                              )
                                            }
                                          >
                                            <SelectTrigger className="h-9">
                                              <SelectValue placeholder="Agregar retención" />
                                            </SelectTrigger>
                                            <SelectContent>
                                              {availableRetentionOptions.map(
                                                option => (
                                                  <SelectItem
                                                    key={option.id}
                                                    value={String(option.id)}
                                                  >
                                                    {option.taxCode} —{" "}
                                                    {option.description} (
                                                    {Number(
                                                      option.ratePercent
                                                    ).toLocaleString("es-HN", {
                                                      maximumFractionDigits: 4,
                                                    })}
                                                    %)
                                                  </SelectItem>
                                                )
                                              )}
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
                                    <Badge
                                      variant="outline"
                                      className="border-slate-300 text-slate-600"
                                    >
                                      No aplica
                                    </Badge>
                                  )}
                                </td>
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
                              {formatPurchaseOrderCurrency(charge.amount)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  <div className="flex flex-wrap justify-end gap-5 border-t border-border/70 px-4 py-3 text-sm font-semibold">
                    <span>
                      Subtotal:{" "}
                      {formatPurchaseOrderCurrency(detail.invoice.subtotal)}
                    </span>
                    <span>
                      ISV:{" "}
                      {formatPurchaseOrderCurrency(detail.invoice.taxAmount)}
                    </span>
                    {invoiceOtherChargesTotal > 0 ? (
                      <span>
                        Otros cargos:{" "}
                        {formatPurchaseOrderCurrency(invoiceOtherChargesTotal)}
                      </span>
                    ) : null}
                    <span>
                      Total factura:{" "}
                      {formatPurchaseOrderCurrency(detail.invoice.total)}
                    </span>
                  </div>
                </section>

                <section className="min-w-0 rounded-lg border border-border/70">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 px-4 py-3">
                    <h3 className="font-semibold">Retenciones aplicadas</h3>
                    <span className="text-sm font-semibold">
                      Total retenciones:{" "}
                      {formatPurchaseOrderCurrency(retentionTotal)}
                    </span>
                  </div>
                  <div className="space-y-3 p-4">
                    {!canRetainSelectedInvoice ? (
                      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                        {retentionDisabledReason}
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
                                    className="border-emerald-300 text-emerald-700"
                                  >
                                    {retention.retentionCode} -{" "}
                                    {retention.description}
                                  </Badge>
                                </td>
                                <td className="p-3 text-right">
                                  {formatPurchaseOrderCurrency(
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
                                  {formatPurchaseOrderCurrency(
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
                    {supplierAllowsTaxWithholding
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
                        {formatPurchaseOrderCurrency(detail.invoice.subtotal)}
                      </span>
                    </div>
                    <div className="flex justify-between gap-3 text-sm">
                      <span className="text-muted-foreground">ISV</span>
                      <span className="font-medium">
                        {formatPurchaseOrderCurrency(detail.invoice.taxAmount)}
                      </span>
                    </div>
                    {invoiceOtherChargesTotal > 0 ? (
                      <div className="flex justify-between gap-3 text-sm">
                        <span className="text-muted-foreground">
                          Otros cargos
                        </span>
                        <span className="font-medium">
                          {formatPurchaseOrderCurrency(
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
                        {formatPurchaseOrderCurrency(detail.invoice.total)}
                      </span>
                    </div>
                    <div className="flex justify-between gap-3 text-sm">
                      <span className="font-medium text-rose-700">
                        (-) Total retenciones
                      </span>
                      <span className="font-semibold text-rose-700">
                        {formatPurchaseOrderCurrency(retentionTotal)}
                      </span>
                    </div>
                    <div className="flex justify-between gap-3 border-t border-border pt-3 text-base font-semibold">
                      <span>Neto a pagar</span>
                      <span className="text-emerald-700">
                        {formatPurchaseOrderCurrency(netPayable)}
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
                            {formatPurchaseOrderCurrency(
                              getRetentionAmount(retention)
                            )}
                          </span>
                        </div>
                      ))}
                      <div className="flex justify-between border-t border-border pt-3 text-sm font-semibold">
                        <span>Total retenciones</span>
                        <span>
                          {formatPurchaseOrderCurrency(retentionTotal)}
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
                        Permite retención
                      </span>
                      <Badge
                        variant="outline"
                        className={
                          supplierAllowsTaxWithholding
                            ? "border-emerald-300 text-emerald-700"
                            : "border-slate-300 text-slate-600"
                        }
                      >
                        {supplierAllowsTaxWithholding ? "Sí" : "No"}
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
                        Alerta fecha límite
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
