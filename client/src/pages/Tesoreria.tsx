import { useEffect, useMemo, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { DataPagination } from "@/components/DataPagination";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { downloadTreasuryInvoiceSummaryWorkbook } from "@/lib/dmc-export";
import {
  buildDatedExcelFileName,
  downloadExcel,
  downloadWorkbook,
  type ExcelColumn,
} from "@/lib/excel-export";
import { printWindowWhenReady } from "@/lib/print-logo";
import { trpc } from "@/lib/trpc";
import { buildTreasuryPaymentsWorksheets } from "@/lib/treasury-payments-export";
import {
  buildTreasuryPaymentReportHtml,
  type TreasuryPaymentReportPayload,
} from "@/lib/treasury-payment-report";
import { formatPurchaseOrderCurrency } from "@shared/purchase-orders";
import {
  TREASURY_BATCH_STATUS_CODES,
  TREASURY_BATCH_STATUS_LABELS,
  TREASURY_ITEM_STATUS_LABELS,
  TREASURY_PAYMENT_KIND_LABELS,
  getTreasuryBatchStatusLabel,
  roundTreasuryMoney,
  type TreasuryBatchStatus,
} from "@shared/treasury";
import {
  AlertTriangle,
  Banknote,
  CheckCircle2,
  Download,
  Eye,
  FileSpreadsheet,
  FileText,
  Loader2,
  Plus,
  Printer,
  RefreshCcw,
  RotateCcw,
  Save,
  Search,
  Send,
  Trash2,
  WalletCards,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { PurchaseOrderAdvanceDialog } from "@/components/PurchaseOrderAdvanceDialog";

type PreparedBankAttachment = {
  fileName: string;
  mimeType: string;
  base64: string;
  fileSize: number;
};

type PendingReasonAction =
  | { type: "return" }
  | { type: "cancel" }
  | { type: "reopen" }
  | { type: "reject" }
  | { type: "reopenRejected" }
  | { type: "resolve"; itemId: number; resolution: "accept" | "reject" };

type InvoicePaymentReportStatus = "all" | "paid" | "pending" | "partial";

const INVOICE_PAYMENT_REPORT_STATUS_LABELS: Record<
  InvoicePaymentReportStatus,
  string
> = {
  all: "Todos los estados",
  paid: "Pagado",
  pending: "Pendiente",
  partial: "Parcial",
};

const TREASURY_BATCH_PAGE_SIZE = 25;
const INVOICE_REPORT_PAGE_SIZE = 10;

function getRequestedTreasuryBatchId(search: string) {
  const batchId = Number(new URLSearchParams(search).get("lote"));
  return Number.isInteger(batchId) && batchId > 0 ? batchId : null;
}

function formatMoney(value: unknown, currency: "HNL" | "USD" = "HNL") {
  const amount = Number(value ?? 0);
  return formatPurchaseOrderCurrency(
    Number.isFinite(amount) ? roundTreasuryMoney(amount) : 0,
    currency
  );
}

function formatMoneyInputValue(value: unknown) {
  const amount = Number(value ?? 0);
  return roundTreasuryMoney(Number.isFinite(amount) ? amount : 0).toFixed(2);
}

const OTHER_RETENTION_LABELS: Record<string, string> = {
  quality_retention: "Retención de calidad",
  advance_amortization: "Amortización de anticipo",
};

const DOCUMENT_DISCOUNT_LABELS: Record<string, string> = {
  prompt_payment_discount: "Pronto pago",
  tc_discount: "TC",
};

function TreasuryDocumentAdjustmentsAccordion({
  total,
  adjustments,
  currency,
  labels,
  fallbackLabel,
}: {
  total: unknown;
  adjustments?: Array<{
    adjustmentType?: string | null;
    percentage?: string | number | null;
    baseAmount?: string | number | null;
    amount?: string | number | null;
  }>;
  currency: "HNL" | "USD";
  labels: Record<string, string>;
  fallbackLabel: string;
}) {
  const detailRows = (adjustments ?? []).filter(adjustment =>
    Object.prototype.hasOwnProperty.call(
      labels,
      adjustment.adjustmentType ?? ""
    )
  );

  if (detailRows.length === 0) {
    return <span>{formatMoney(total, currency)}</span>;
  }

  return (
    <Accordion type="single" collapsible className="ml-auto w-64">
      <AccordionItem value="other-retentions" className="border-b-0">
        <AccordionTrigger className="justify-end gap-2 py-1 text-right hover:no-underline">
          <span className="font-medium tabular-nums">
            {formatMoney(total, currency)}
          </span>
        </AccordionTrigger>
        <AccordionContent className="pb-1 pt-2">
          <div className="space-y-2 rounded-md border border-border/70 bg-background p-2 text-left shadow-sm">
            {detailRows.map(adjustment => (
              <div
                key={adjustment.adjustmentType}
                className="border-b border-border/60 pb-2 last:border-b-0 last:pb-0"
              >
                <div className="flex items-start justify-between gap-3 text-xs">
                  <span className="font-medium">
                    {labels[adjustment.adjustmentType ?? ""] ?? fallbackLabel}
                  </span>
                  <span className="shrink-0 font-semibold tabular-nums">
                    {formatMoney(adjustment.amount, currency)}
                  </span>
                </div>
                <div className="mt-1 flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
                  <span>
                    Base {formatMoney(adjustment.baseAmount, currency)}
                  </span>
                  <span>{Number(adjustment.percentage ?? 0).toFixed(2)}%</span>
                </div>
              </div>
            ))}
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

function formatDate(value: unknown) {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("es-HN");
}

function toDateInput(value: unknown) {
  if (!value) return new Date().toISOString().slice(0, 10);
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime())
    ? new Date().toISOString().slice(0, 10)
    : date.toISOString().slice(0, 10);
}

function toDateKey(value: unknown) {
  if (!value) return "";
  if (typeof value === "string") {
    const datePrefix = value.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
    if (datePrefix) return datePrefix;
  }
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function formatDateOnly(value: unknown) {
  const dateKey = toDateKey(value);
  if (!dateKey) return "—";
  const [year, month, day] = dateKey.split("-");
  return `${day}/${month}/${year}`;
}

function formatReportText(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

function treasuryProjectSummary(source: any) {
  const projectMap = new Map<
    number | string,
    { id?: number; code: string; name: string }
  >();
  const sourceProjects =
    Array.isArray(source?.projects) && source.projects.length > 0
      ? source.projects
      : source?.project
        ? [source.project]
        : [];
  for (const project of sourceProjects) {
    const code = String(project?.code ?? "").trim();
    const name = String(project?.name ?? "").trim();
    const key = Number(project?.id) || `${code}:${name}`;
    projectMap.set(key, { id: project?.id, code, name });
  }
  const projects = Array.from(projectMap.values());
  if (projects.length === 1) {
    return {
      projects,
      code: projects[0]!.code,
      name: projects[0]!.name,
      label: [projects[0]!.code, projects[0]!.name].filter(Boolean).join(" - "),
    };
  }
  const labels = projects.map(project =>
    [project.code, project.name].filter(Boolean).join(" - ")
  );
  return {
    projects,
    code: projects.length ? "Varios proyectos" : "Sin proyecto",
    name: labels.join(" · "),
    label: projects.length
      ? `Varios proyectos (${labels.join(" · ")})`
      : "Sin proyecto",
  };
}

function currentLocalDateInput() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toExcelDate(value: unknown) {
  const dateKey = toDateKey(value);
  if (!dateKey) return undefined;
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year!, month! - 1, day!, 12);
}

const TREASURY_BATCH_EXPORT_COLUMNS: ExcelColumn<any>[] = [
  {
    header: "Lote",
    value: row => row.batch.batchNumber,
    width: 22,
  },
  {
    header: "Código de proyecto",
    value: row =>
      treasuryProjectSummary(row)
        .projects.map(project => project.code)
        .join(", "),
    width: 20,
  },
  {
    header: "Proyecto",
    value: row =>
      treasuryProjectSummary(row)
        .projects.map(project => project.name)
        .join(", "),
    width: 36,
  },
  {
    header: "Estado",
    value: row =>
      getTreasuryBatchStatusLabel(
        row.batch.status as TreasuryBatchStatus,
        row.batch.approvalBypassed === true
      ),
    width: 28,
  },
  {
    header: "Fecha de registro de pago",
    value: row => toExcelDate(row.paymentRegistrationDate),
    width: 24,
    numFmt: "dd/mm/yyyy",
  },
  {
    header: "Moneda",
    value: row => row.batch.currency,
    width: 12,
  },
  {
    header: "Proveedores",
    value: row => Number(row.supplierCount ?? 0),
    width: 14,
  },
  {
    header: "Facturas",
    value: row => Number(row.itemCount ?? 0),
    width: 12,
  },
  {
    header: "Solicitado",
    value: row => Number(row.requestedTotal ?? 0),
    width: 18,
    numFmt: "#,##0.0000",
  },
  {
    header: "Monto aprobado/listo para banco",
    value: row => Number(row.approvedTotal ?? 0),
    width: 18,
    numFmt: "#,##0.0000",
  },
  {
    header: "Pagado",
    value: row => Number(row.paidTotal ?? 0),
    width: 18,
    numFmt: "#,##0.0000",
  },
  {
    header: "Versión",
    value: row => Number(row.batch.version ?? 1),
    width: 10,
  },
  {
    header: "Notas",
    value: row => row.batch.notes ?? "",
    width: 42,
  },
];

function downloadBase64File(
  fileName: string,
  mimeType: string,
  base64: string
) {
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) {
    bytes[index] = raw.charCodeAt(index);
  }
  const url = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

const BANK_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
const BANK_ATTACHMENT_MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

function readFileAsBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = String(reader.result ?? "");
      resolve(value.includes(",") ? (value.split(",")[1] ?? "") : value);
    };
    reader.onerror = () => reject(new Error("No se pudo leer el adjunto"));
    reader.readAsDataURL(file);
  });
}

async function prepareBankAttachment(
  file: File
): Promise<PreparedBankAttachment> {
  const extension = file.name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
  const mimeType = BANK_ATTACHMENT_MIME_BY_EXTENSION[extension];
  if (!mimeType) {
    throw new Error(
      "El adjunto debe ser PDF, imagen JPG/PNG/WebP o archivo Excel."
    );
  }
  if (!file.size) throw new Error("El adjunto bancario está vacío.");
  if (file.size > BANK_ATTACHMENT_MAX_BYTES) {
    throw new Error("El adjunto bancario no puede superar 10 MB.");
  }
  return {
    fileName: file.name,
    mimeType,
    base64: await readFileAsBase64(file),
    fileSize: file.size,
  };
}

function statusVariant(status: string) {
  if (status === "cerrado" || status === "contabilizada")
    return "default" as const;
  if (
    status === "anulado" ||
    status === "rechazado" ||
    status === "rechazada_banco"
  )
    return "destructive" as const;
  if (status === "conciliacion" || status === "con_diferencia")
    return "outline" as const;
  return "secondary" as const;
}

function auditActionLabel(action: string) {
  const reviewLabels: Record<string, string> = {
    enviar_depuracion: "enviar a revisión",
    enviar_sin_aprobacion: "enviar directamente a banco",
    finalizar_depuracion: "finalizar revisión",
    ajustar_depuracion: "ajustar en revisión",
    excluir_depuracion: "excluir en revisión",
    guardar_revision: "guardar revisión",
    consolidar_enviar_aprobacion: "consolidar y enviar a aprobación",
    consolidar_en_lote: "integrar en lote consolidado",
    crear_lote_consolidado: "crear lote consolidado y enviar a aprobación",
    crear_lote_consolidado_sin_aprobacion:
      "crear lote consolidado listo para banco",
    enviar_aprobacion: "enviar a aprobación",
    rechazar_lote: "rechazar lote",
    reabrir_lote_rechazado: "reabrir lote rechazado",
    reabrir_sin_aprobacion: "reabrir directamente para banco",
    omitir_aprobacion_configuracion: "omitir aprobación por configuración",
    registrar_pago_banco: "registrar pago bancario",
    reabrir_respuesta_bancaria: "restaurar respuesta bancaria",
    reabrir_lote: "reabrir lote para corregir respuesta bancaria",
  };
  return reviewLabels[action] ?? action.replaceAll("_", " ");
}

function BatchFormDialog({
  open,
  onOpenChange,
  existing,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existing?: any;
  onSaved: (batchId: number) => void;
}) {
  const utils = trpc.useUtils();
  const [projectId, setProjectId] = useState("");
  const [currency, setCurrency] = useState<"HNL" | "USD">("HNL");
  const [paymentDate, setPaymentDate] = useState(
    new Date().toISOString().slice(0, 10)
  );
  const [notes, setNotes] = useState("");
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [amounts, setAmounts] = useState<Record<number, string>>({});

  const projectsQuery = trpc.projects.list.useQuery(
    { status: "activo" },
    { enabled: open }
  );
  const eligibleQuery = trpc.treasury.eligibleInvoices.useQuery(
    {
      projectId: projectId ? Number(projectId) : undefined,
      currency,
      batchId: existing?.batch?.id,
    },
    { enabled: open && Boolean(projectId) }
  );
  const sortedProjects = useMemo(
    () =>
      [...(projectsQuery.data ?? [])].sort(
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
    [projectsQuery.data]
  );

  useEffect(() => {
    if (!open) return;
    if (existing?.batch) {
      setProjectId(String(existing.batch.projectId));
      setCurrency(existing.batch.currency);
      setPaymentDate(toDateInput(existing.batch.requestedPaymentDate));
      setNotes(existing.batch.notes ?? "");
      const included = (existing.items ?? []).filter(
        (item: any) => item.status !== "excluida"
      );
      setSelectedIds(new Set(included.map((item: any) => item.invoiceId)));
      setAmounts(
        Object.fromEntries(
          included.map((item: any) => [
            item.invoiceId,
            formatMoneyInputValue(item.requestedAmount),
          ])
        )
      );
      return;
    }
    setProjectId("");
    setCurrency("HNL");
    setPaymentDate(new Date().toISOString().slice(0, 10));
    setNotes("");
    setSearch("");
    setSelectedIds(new Set());
    setAmounts({});
  }, [existing, open]);

  const saveSuccess = async (data: any) => {
    toast.success(existing ? "Borrador actualizado" : "Lote creado");
    await Promise.all([
      utils.treasury.list.invalidate(),
      utils.treasury.eligibleInvoices.invalidate(),
      utils.treasury.eligibleAdvances.invalidate(),
      utils.purchaseOrderAdvances.list.invalidate(),
    ]);
    onOpenChange(false);
    onSaved(Number(data.id));
  };
  const createMutation = trpc.treasury.create.useMutation({
    onSuccess: saveSuccess,
    onError: error => toast.error(error.message),
  });
  const updateMutation = trpc.treasury.updateDraft.useMutation({
    onSuccess: saveSuccess,
    onError: error => toast.error(error.message),
  });

  const visibleInvoices = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("es-HN");
    if (!term) return eligibleQuery.data ?? [];
    return (eligibleQuery.data ?? []).filter((row: any) =>
      [
        row.supplier?.name,
        row.supplier?.supplierCode,
        row.invoice?.invoiceDocumentNumber,
        row.invoice?.invoiceNumber,
        row.project?.code,
      ]
        .join(" ")
        .toLocaleLowerCase("es-HN")
        .includes(term)
    );
  }, [eligibleQuery.data, search]);
  const allVisibleInvoicesSelected =
    visibleInvoices.length > 0 &&
    visibleInvoices.every((row: any) => selectedIds.has(row.invoice.id));
  const someVisibleInvoicesSelected = visibleInvoices.some((row: any) =>
    selectedIds.has(row.invoice.id)
  );

  function toggleAllVisibleInvoices() {
    const shouldSelect = !allVisibleInvoicesSelected;
    setSelectedIds(current => {
      const next = new Set(current);
      visibleInvoices.forEach((row: any) => {
        if (shouldSelect) next.add(row.invoice.id);
        else next.delete(row.invoice.id);
      });
      return next;
    });
    if (shouldSelect) {
      setAmounts(current => {
        const next = { ...current };
        visibleInvoices.forEach((row: any) => {
          if (
            next[row.invoice.id] === undefined ||
            next[row.invoice.id] === ""
          ) {
            next[row.invoice.id] = formatMoneyInputValue(
              row.money.availableAmount
            );
          }
        });
        return next;
      });
    }
  }

  function toggleInvoice(row: any, checked: boolean) {
    setSelectedIds(current => {
      const next = new Set(current);
      if (checked) next.add(row.invoice.id);
      else next.delete(row.invoice.id);
      return next;
    });
    if (checked && !amounts[row.invoice.id]) {
      setAmounts(current => ({
        ...current,
        [row.invoice.id]: formatMoneyInputValue(row.money.availableAmount),
      }));
    }
  }

  function save() {
    const items = Array.from(selectedIds).map(invoiceId => ({
      invoiceId,
      requestedAmount: Number(amounts[invoiceId]),
    }));
    if (!projectId || !paymentDate || items.length === 0) {
      toast.error("Seleccione proyecto, fecha y al menos una factura.");
      return;
    }
    if (
      items.some(
        item =>
          !Number.isFinite(item.requestedAmount) || item.requestedAmount <= 0
      )
    ) {
      toast.error("Todos los abonos deben ser mayores que cero.");
      return;
    }
    const payload = { requestedPaymentDate: paymentDate, notes, items };
    if (existing?.batch?.id) {
      updateMutation.mutate({ id: existing.batch.id, ...payload });
    } else {
      createMutation.mutate({
        projectId: Number(projectId),
        currency,
        ...payload,
      });
    }
  }

  const pending = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="grid max-h-[96vh] w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:max-w-[calc(100vw-1.5rem)]">
        <DialogHeader className="border-b px-6 py-5 pr-14">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <WalletCards className="h-5 w-5" />
            </div>
            <div className="space-y-1.5">
              <DialogTitle>
                {existing ? "Editar lote" : "Nuevo lote de abonos"}
              </DialogTitle>
              <DialogDescription className="max-w-3xl leading-relaxed">
                Seleccione facturas contabilizadas y defina el abono solicitado.
                El valor inicial corresponde al saldo completo disponible y
                puede reducirse para registrar un pago parcial.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="min-h-0 space-y-5 overflow-y-auto px-6 py-5">
          <div className="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(8rem,0.65fr)_minmax(11rem,0.9fr)]">
            <div className="min-w-0 space-y-2">
              <Label>Proyecto</Label>
              <Select
                value={projectId}
                onValueChange={setProjectId}
                disabled={Boolean(existing)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Seleccione proyecto" />
                </SelectTrigger>
                <SelectContent>
                  {sortedProjects.map((project: any) => (
                    <SelectItem key={project.id} value={String(project.id)}>
                      {project.code} - {project.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Moneda</Label>
              <Select
                value={currency}
                onValueChange={value => setCurrency(value as "HNL" | "USD")}
                disabled={Boolean(existing)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="HNL">HNL</SelectItem>
                  <SelectItem value="USD">USD</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Fecha prevista de pago</Label>
              <Input
                type="date"
                value={paymentDate}
                onChange={event => setPaymentDate(event.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Notas</Label>
            <Textarea
              className="min-h-20 resize-y"
              value={notes}
              onChange={event => setNotes(event.target.value)}
              maxLength={2000}
              placeholder="Agregue una observación para el lote (opcional)"
            />
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative min-w-0 flex-1">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Buscar por proveedor, código o número de factura"
                value={search}
                onChange={event => setSearch(event.target.value)}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary" className="w-fit shrink-0 px-3 py-1.5">
                {visibleInvoices.length}{" "}
                {visibleInvoices.length === 1
                  ? "factura disponible"
                  : "facturas disponibles"}
              </Badge>
            </div>
          </div>

          <div className="overflow-hidden rounded-lg border bg-card [&_[data-slot=table-container]]:max-h-[38vh] [&_[data-slot=table-container]]:overflow-auto">
            <Table className="min-w-[1760px]">
              <TableHeader className="[&_th]:sticky [&_th]:top-0 [&_th]:z-20 [&_th]:bg-muted">
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={
                        allVisibleInvoicesSelected
                          ? true
                          : someVisibleInvoicesSelected
                            ? "indeterminate"
                            : false
                      }
                      disabled={
                        eligibleQuery.isLoading || !visibleInvoices.length
                      }
                      onCheckedChange={toggleAllVisibleInvoices}
                      aria-label={
                        allVisibleInvoicesSelected
                          ? "Deseleccionar todas las facturas visibles"
                          : "Seleccionar todas las facturas visibles"
                      }
                      title={
                        allVisibleInvoicesSelected
                          ? "Deseleccionar todas"
                          : "Seleccionar todas"
                      }
                    />
                  </TableHead>
                  <TableHead className="min-w-48">Proveedor</TableHead>
                  <TableHead className="min-w-40">Factura</TableHead>
                  <TableHead className="min-w-40">Factura fiscal</TableHead>
                  <TableHead className="min-w-32">Fecha documento</TableHead>
                  <TableHead className="min-w-36">
                    Fecha de vencimiento
                  </TableHead>
                  <TableHead className="text-right">Subtotal</TableHead>
                  <TableHead className="text-right">ISV</TableHead>
                  <TableHead className="text-right">Total factura</TableHead>
                  <TableHead className="text-right">
                    Retenciones fiscales
                  </TableHead>
                  <TableHead className="text-right">
                    Otras retenciones
                  </TableHead>
                  <TableHead className="text-right">Descuentos</TableHead>
                  <TableHead className="text-right">Neto a pagar</TableHead>
                  <TableHead className="text-right">
                    Anticipo aplicado
                  </TableHead>
                  <TableHead className="text-right">
                    Abonos anteriores
                  </TableHead>
                  <TableHead className="text-right">Saldo</TableHead>
                  <TableHead className="w-40 text-right">
                    Abono solicitado
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {eligibleQuery.isLoading ? (
                  <TableRow>
                    <TableCell colSpan={17} className="py-12 text-center">
                      <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">
                        Cargando facturas...
                      </span>
                    </TableCell>
                  </TableRow>
                ) : visibleInvoices.length ? (
                  visibleInvoices.map((row: any) => {
                    const checked = selectedIds.has(row.invoice.id);
                    return (
                      <TableRow
                        key={row.invoice.id}
                        data-state={checked ? "selected" : undefined}
                      >
                        <TableCell>
                          <Checkbox
                            checked={checked}
                            onCheckedChange={value =>
                              toggleInvoice(row, value === true)
                            }
                          />
                        </TableCell>
                        <TableCell className="whitespace-normal">
                          <div className="font-medium">{row.supplier.name}</div>
                          <div className="mt-0.5 text-xs text-muted-foreground">
                            {row.supplier.supplierCode || "Sin código"}
                          </div>
                        </TableCell>
                        <TableCell className="whitespace-normal">
                          <div className="font-medium">
                            {row.invoice.invoiceDocumentNumber}
                          </div>
                        </TableCell>
                        <TableCell className="whitespace-normal">
                          {row.invoice.invoiceNumber || "Sin número fiscal"}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {formatDateOnly(row.invoice.documentDate)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {formatDateOnly(row.invoice.documentDueDate)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatMoney(row.invoice.subtotal, currency)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatMoney(row.invoice.taxAmount, currency)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatMoney(row.invoice.total, currency)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatMoney(row.invoice.retentionTotal, currency)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatMoney(
                            row.invoice.otherRetentionTotal,
                            currency
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatMoney(
                            row.invoice.documentDiscountTotal,
                            currency
                          )}
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums">
                          {formatMoney(row.money.invoiceNetPayable, currency)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatMoney(
                            row.money.appliedAdvanceAmount,
                            currency
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatMoney(row.money.paidAmount, currency)}
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums">
                          {formatMoney(row.money.availableAmount, currency)}
                        </TableCell>
                        <TableCell>
                          <Input
                            className="ml-auto w-32 text-right tabular-nums"
                            type="number"
                            min="0.01"
                            step="0.01"
                            max={row.money.availableAmount}
                            disabled={!checked}
                            value={amounts[row.invoice.id] ?? ""}
                            onChange={event =>
                              setAmounts(current => ({
                                ...current,
                                [row.invoice.id]: event.target.value,
                              }))
                            }
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })
                ) : (
                  <TableRow>
                    <TableCell
                      colSpan={17}
                      className="py-12 text-center text-muted-foreground"
                    >
                      {projectId
                        ? "No hay facturas elegibles con saldo disponible."
                        : "Seleccione un proyecto para consultar sus facturas."}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </div>

        <DialogFooter className="border-t bg-muted/20 px-6 py-4 sm:items-center sm:justify-between">
          <div className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">
              {selectedIds.size}
            </span>{" "}
            {selectedIds.size === 1
              ? "factura seleccionada"
              : "facturas seleccionadas"}
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button onClick={save} disabled={pending || selectedIds.size === 0}>
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {existing ? "Guardar cambios" : "Crear borrador"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function QualityReleaseBatchFormDialog({
  open,
  onOpenChange,
  existing,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existing?: any;
  onSaved: (batchId: number) => void;
}) {
  const utils = trpc.useUtils();
  const [projectId, setProjectId] = useState("");
  const [currency, setCurrency] = useState<"HNL" | "USD">("HNL");
  const [paymentDate, setPaymentDate] = useState(currentLocalDateInput());
  const [notes, setNotes] = useState("");
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [amounts, setAmounts] = useState<Record<number, string>>({});
  const projectsQuery = trpc.projects.list.useQuery(
    { status: "activo" },
    { enabled: open }
  );
  const eligibleQuery = trpc.treasury.eligibleQualityRetentionReleases.useQuery(
    {
      projectId: projectId ? Number(projectId) : undefined,
      currency,
      batchId: existing?.batch?.id,
    },
    { enabled: open && Boolean(projectId) }
  );

  useEffect(() => {
    if (!open) return;
    if (existing?.batch) {
      setProjectId(String(existing.batch.projectId));
      setCurrency(existing.batch.currency);
      setPaymentDate(toDateInput(existing.batch.requestedPaymentDate));
      setNotes(existing.batch.notes ?? "");
      const included = (existing.items ?? []).filter(
        (item: any) => item.status !== "excluida"
      );
      setSelectedIds(
        new Set(included.map((item: any) => item.qualityRetentionReleaseId))
      );
      setAmounts(
        Object.fromEntries(
          included.map((item: any) => [
            item.qualityRetentionReleaseId,
            formatMoneyInputValue(item.requestedAmount),
          ])
        )
      );
    } else {
      setProjectId("");
      setCurrency("HNL");
      setPaymentDate(currentLocalDateInput());
      setNotes("");
      setSearch("");
      setSelectedIds(new Set());
      setAmounts({});
    }
  }, [existing, open]);

  const saveSuccess = async (data: any) => {
    toast.success(
      existing ? "Borrador actualizado" : "Lote de liberaciones creado"
    );
    await Promise.all([
      utils.treasury.list.invalidate(),
      utils.treasury.eligibleQualityRetentionReleases.invalidate(),
      utils.qualityRetentionReleases.invalidate(),
    ]);
    onOpenChange(false);
    onSaved(Number(data.id));
  };
  const createMutation = trpc.treasury.create.useMutation({
    onSuccess: saveSuccess,
    onError: error => toast.error(error.message),
  });
  const updateMutation = trpc.treasury.updateDraft.useMutation({
    onSuccess: saveSuccess,
    onError: error => toast.error(error.message),
  });
  const visibleRows = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("es-HN");
    if (!term) return eligibleQuery.data ?? [];
    return (eligibleQuery.data ?? []).filter((row: any) =>
      [
        row.supplier?.name,
        row.supplier?.supplierCode,
        row.invoice?.invoiceDocumentNumber,
        row.invoice?.invoiceNumber,
        row.project?.code,
      ]
        .join(" ")
        .toLocaleLowerCase("es-HN")
        .includes(term)
    );
  }, [eligibleQuery.data, search]);

  function toggle(row: any, checked: boolean) {
    const id = row.release.id;
    setSelectedIds(current => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
    if (checked && !amounts[id]) {
      setAmounts(current => ({
        ...current,
        [id]: formatMoneyInputValue(row.availableToPayAmount),
      }));
    }
  }

  function save() {
    const items = Array.from(selectedIds).map(qualityRetentionReleaseId => ({
      sourceType: "quality_retention_release" as const,
      qualityRetentionReleaseId,
      requestedAmount: Number(amounts[qualityRetentionReleaseId]),
    }));
    if (!projectId || !paymentDate || !items.length) {
      toast.error("Seleccione proyecto, fecha y al menos una liberación.");
      return;
    }
    if (
      items.some(
        item =>
          !Number.isFinite(item.requestedAmount) || item.requestedAmount <= 0
      )
    ) {
      toast.error("Todos los pagos deben ser mayores que cero.");
      return;
    }
    const payload = { requestedPaymentDate: paymentDate, notes, items };
    if (existing?.batch?.id) {
      updateMutation.mutate({ id: existing.batch.id, ...payload });
    } else {
      createMutation.mutate({
        projectId: Number(projectId),
        currency,
        paymentKind: "quality_retention_release",
        ...payload,
      });
    }
  }

  const pending = createMutation.isPending || updateMutation.isPending;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="grid max-h-[96vh] w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:max-w-[calc(100vw-2rem)] xl:max-w-[1400px]">
        <DialogHeader className="border-b px-6 py-5 pr-14">
          <DialogTitle>
            {existing
              ? "Editar lote"
              : "Nueva liberación de retención de calidad"}
          </DialogTitle>
          <DialogDescription>
            Seleccione solicitudes autorizadas. Un pago parcial conservará el
            remanente para otro lote.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 space-y-4 overflow-y-auto px-6 py-5">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label>Proyecto</Label>
              <Select
                value={projectId}
                onValueChange={setProjectId}
                disabled={Boolean(existing)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Seleccione proyecto" />
                </SelectTrigger>
                <SelectContent>
                  {(projectsQuery.data ?? []).map((project: any) => (
                    <SelectItem key={project.id} value={String(project.id)}>
                      {project.code} - {project.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Moneda</Label>
              <Select
                value={currency}
                onValueChange={value => setCurrency(value as "HNL" | "USD")}
                disabled={Boolean(existing)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="HNL">HNL</SelectItem>
                  <SelectItem value="USD">USD</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Fecha prevista</Label>
              <Input
                type="date"
                value={paymentDate}
                onChange={event => setPaymentDate(event.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Notas</Label>
            <Textarea
              value={notes}
              onChange={event => setNotes(event.target.value)}
              maxLength={2000}
            />
          </div>
          <Input
            placeholder="Buscar factura o proveedor"
            value={search}
            onChange={event => setSearch(event.target.value)}
          />
          <div className="overflow-auto rounded-lg border">
            <Table className="min-w-[1050px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10" />
                  <TableHead>Factura</TableHead>
                  <TableHead>Proveedor</TableHead>
                  <TableHead className="text-right">
                    Retenido original
                  </TableHead>
                  <TableHead className="text-right">Autorizado</TableHead>
                  <TableHead className="text-right">Pagado</TableHead>
                  <TableHead className="text-right">Saldo</TableHead>
                  <TableHead className="w-40 text-right">
                    Pago solicitado
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {eligibleQuery.isLoading ? (
                  <TableRow>
                    <TableCell colSpan={8} className="py-10 text-center">
                      <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                    </TableCell>
                  </TableRow>
                ) : visibleRows.length ? (
                  visibleRows.map((row: any) => {
                    const checked = selectedIds.has(row.release.id);
                    return (
                      <TableRow
                        key={row.release.id}
                        data-state={checked ? "selected" : undefined}
                      >
                        <TableCell>
                          <Checkbox
                            checked={checked}
                            onCheckedChange={value =>
                              toggle(row, value === true)
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <div className="font-medium">
                            {row.invoice.invoiceDocumentNumber}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {row.invoice.invoiceNumber || "Sin número fiscal"}
                          </div>
                        </TableCell>
                        <TableCell>
                          {row.supplier?.name || "Proveedor"}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatMoney(row.adjustment.amount, currency)}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatMoney(row.release.approvedAmount, currency)}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatMoney(row.paidAmount, currency)}
                        </TableCell>
                        <TableCell className="text-right font-semibold">
                          {formatMoney(row.availableToPayAmount, currency)}
                        </TableCell>
                        <TableCell>
                          <Input
                            className="text-right"
                            type="number"
                            min="0.01"
                            step="0.01"
                            max={row.availableToPayAmount}
                            disabled={!checked}
                            value={amounts[row.release.id] ?? ""}
                            onChange={event =>
                              setAmounts(current => ({
                                ...current,
                                [row.release.id]: event.target.value,
                              }))
                            }
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })
                ) : (
                  <TableRow>
                    <TableCell
                      colSpan={8}
                      className="py-10 text-center text-muted-foreground"
                    >
                      {projectId
                        ? "No hay liberaciones autorizadas disponibles."
                        : "Seleccione un proyecto."}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </div>
        <DialogFooter className="border-t px-6 py-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={pending || !selectedIds.size}>
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {existing ? "Guardar cambios" : "Crear borrador"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AdvanceBatchFormDialog({
  open,
  onOpenChange,
  existing,
  initialAdvance,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existing?: any;
  initialAdvance?: any;
  onSaved: (batchId: number) => void;
}) {
  const utils = trpc.useUtils();
  const [projectId, setProjectId] = useState("");
  const [currency, setCurrency] = useState<"HNL" | "USD">("HNL");
  const [paymentDate, setPaymentDate] = useState(currentLocalDateInput());
  const [notes, setNotes] = useState("");
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [amounts, setAmounts] = useState<Record<number, string>>({});
  const projectsQuery = trpc.projects.list.useQuery(
    { status: "activo" },
    { enabled: open }
  );
  const eligibleQuery = trpc.treasury.eligibleAdvances.useQuery(
    {
      projectId: projectId ? Number(projectId) : undefined,
      currency,
      batchId: existing?.batch?.id,
    },
    { enabled: open && Boolean(projectId) }
  );
  const projects = useMemo(
    () =>
      [...(projectsQuery.data ?? [])].sort((left: any, right: any) =>
        String(left.code ?? "").localeCompare(
          String(right.code ?? ""),
          "es-HN",
          { numeric: true, sensitivity: "base" }
        )
      ),
    [projectsQuery.data]
  );

  useEffect(() => {
    if (!open) return;
    if (existing?.batch) {
      setProjectId(String(existing.batch.projectId));
      setCurrency(existing.batch.currency);
      setPaymentDate(toDateInput(existing.batch.requestedPaymentDate));
      setNotes(existing.batch.notes ?? "");
      const included = (existing.items ?? []).filter(
        (item: any) => item.status !== "excluida"
      );
      setSelectedIds(
        new Set(included.map((item: any) => item.purchaseOrderAdvanceId))
      );
      setAmounts(
        Object.fromEntries(
          included.map((item: any) => [
            item.purchaseOrderAdvanceId,
            formatMoneyInputValue(item.requestedAmount),
          ])
        )
      );
    } else {
      setProjectId(initialAdvance ? String(initialAdvance.projectId) : "");
      setCurrency(initialAdvance?.currency ?? "HNL");
      setPaymentDate(currentLocalDateInput());
      setNotes("");
      setSearch("");
      setSelectedIds(initialAdvance ? new Set([initialAdvance.id]) : new Set());
      setAmounts(
        initialAdvance
          ? {
              [initialAdvance.id]: formatMoneyInputValue(
                initialAdvance.requestedAmount
              ),
            }
          : {}
      );
    }
  }, [existing, initialAdvance, open]);

  const createMutation = trpc.treasury.create.useMutation({
    onSuccess: async data => {
      toast.success("Lote de anticipos a proveedores creado");
      await Promise.all([
        utils.treasury.list.invalidate(),
        utils.treasury.eligibleAdvances.invalidate(),
        utils.purchaseOrderAdvances.list.invalidate(),
      ]);
      onOpenChange(false);
      onSaved(Number(data.id));
    },
    onError: error => toast.error(error.message),
  });
  const updateMutation = trpc.treasury.updateDraft.useMutation({
    onSuccess: async data => {
      toast.success("Borrador de anticipos a proveedores actualizado");
      await Promise.all([
        utils.treasury.list.invalidate(),
        utils.treasury.eligibleAdvances.invalidate(),
        utils.purchaseOrderAdvances.list.invalidate(),
      ]);
      onOpenChange(false);
      onSaved(Number(data.id));
    },
    onError: error => toast.error(error.message),
  });
  const visibleRows = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("es-HN");
    if (!term) return eligibleQuery.data ?? [];
    return (eligibleQuery.data ?? []).filter((row: any) =>
      [
        row.advance.advanceNumber,
        row.purchaseOrder.orderNumber,
        row.supplier.name,
        row.supplier.supplierCode,
      ]
        .join(" ")
        .toLocaleLowerCase("es-HN")
        .includes(term)
    );
  }, [eligibleQuery.data, search]);

  function toggle(row: any, checked: boolean) {
    const id = row.advance.id;
    setSelectedIds(current => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
    if (checked && !amounts[id]) {
      setAmounts(current => ({
        ...current,
        [id]: formatMoneyInputValue(row.money.availableToPayAmount),
      }));
    }
  }

  function save() {
    const items = Array.from(selectedIds).map(purchaseOrderAdvanceId => ({
      sourceType: "purchase_order_advance" as const,
      purchaseOrderAdvanceId,
      requestedAmount: Number(amounts[purchaseOrderAdvanceId]),
    }));
    if (!projectId || !paymentDate || !items.length) {
      toast.error("Seleccione proyecto, fecha y al menos un anticipo.");
      return;
    }
    if (
      items.some(
        item =>
          !Number.isFinite(item.requestedAmount) || item.requestedAmount <= 0
      )
    ) {
      toast.error("Todos los pagos deben ser mayores que cero.");
      return;
    }
    const payload = { requestedPaymentDate: paymentDate, notes, items };
    if (existing?.batch?.id) {
      updateMutation.mutate({ id: existing.batch.id, ...payload });
    } else {
      createMutation.mutate({
        projectId: Number(projectId),
        currency,
        paymentKind: "purchase_order_advance",
        ...payload,
      });
    }
  }

  const pending = createMutation.isPending || updateMutation.isPending;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="grid max-h-[94vh] w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:max-w-[calc(100vw-2rem)] xl:max-w-[1200px]">
        <DialogHeader className="border-b px-6 py-5">
          <DialogTitle>
            {existing
              ? "Editar lote de anticipos a proveedores"
              : "Nuevo lote de anticipos a proveedores"}
          </DialogTitle>
          <DialogDescription>
            Seleccione solicitudes ANT disponibles. Cada lote contiene
            únicamente anticipos a proveedores y admite pagos parciales.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 space-y-5 overflow-y-auto px-6 py-5">
          <div className="grid gap-4 md:grid-cols-[minmax(20rem,2fr)_minmax(8rem,0.65fr)_minmax(12rem,0.9fr)]">
            <div className="min-w-0 space-y-2">
              <Label>Proyecto</Label>
              <Select
                value={projectId}
                onValueChange={setProjectId}
                disabled={Boolean(existing)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Seleccione" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((project: any) => (
                    <SelectItem key={project.id} value={String(project.id)}>
                      {project.code} - {project.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Moneda</Label>
              <Select
                value={currency}
                onValueChange={value => setCurrency(value as "HNL" | "USD")}
                disabled={Boolean(existing)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="HNL">HNL</SelectItem>
                  <SelectItem value="USD">USD</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Fecha prevista de pago</Label>
              <Input
                type="date"
                value={paymentDate}
                onChange={event => setPaymentDate(event.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Notas</Label>
            <Textarea
              value={notes}
              onChange={event => setNotes(event.target.value)}
              maxLength={2000}
            />
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Buscar ANT, OC o proveedor"
              value={search}
              onChange={event => setSearch(event.target.value)}
            />
          </div>
          <div className="overflow-hidden rounded-lg border [&_[data-slot=table-container]]:max-h-[42vh] [&_[data-slot=table-container]]:overflow-auto">
            <Table className="min-w-[1080px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10" />
                  <TableHead>Anticipo</TableHead>
                  <TableHead>OC</TableHead>
                  <TableHead>Proveedor</TableHead>
                  <TableHead className="text-right">Solicitado</TableHead>
                  <TableHead className="text-right">Contabilizado</TableHead>
                  <TableHead className="text-right">Saldo</TableHead>
                  <TableHead className="w-40 text-right">
                    Pago objetivo
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {eligibleQuery.isLoading ? (
                  <TableRow>
                    <TableCell colSpan={8} className="py-10 text-center">
                      <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                    </TableCell>
                  </TableRow>
                ) : visibleRows.length ? (
                  visibleRows.map((row: any) => {
                    const checked = selectedIds.has(row.advance.id);
                    return (
                      <TableRow key={row.advance.id}>
                        <TableCell>
                          <Checkbox
                            checked={checked}
                            onCheckedChange={value =>
                              toggle(row, value === true)
                            }
                          />
                        </TableCell>
                        <TableCell className="font-medium">
                          {row.advance.advanceNumber}
                        </TableCell>
                        <TableCell>{row.purchaseOrder.orderNumber}</TableCell>
                        <TableCell>{row.supplier.name}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatMoney(row.money.requestedAmount, currency)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatMoney(row.money.accountedAmount, currency)}
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums">
                          {formatMoney(
                            row.money.availableToPayAmount,
                            currency
                          )}
                        </TableCell>
                        <TableCell>
                          <Input
                            className="ml-auto w-32 text-right"
                            type="number"
                            min="0.01"
                            max={row.money.availableToPayAmount}
                            step="0.01"
                            disabled={!checked}
                            value={amounts[row.advance.id] ?? ""}
                            onChange={event =>
                              setAmounts(current => ({
                                ...current,
                                [row.advance.id]: event.target.value,
                              }))
                            }
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })
                ) : (
                  <TableRow>
                    <TableCell
                      colSpan={8}
                      className="py-10 text-center text-muted-foreground"
                    >
                      {projectId
                        ? "No hay anticipos disponibles para este proyecto."
                        : "Seleccione un proyecto para consultar anticipos."}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </div>
        <DialogFooter className="border-t px-6 py-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={pending || !selectedIds.size}>
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {existing ? "Guardar cambios" : "Crear borrador"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BatchDetailDialog({
  batchId,
  onClose,
  onEdit,
}: {
  batchId: number | null;
  onClose: () => void;
  onEdit: (detail: any) => void;
}) {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const settingsQuery = trpc.treasury.settings.useQuery();
  const detailQuery = trpc.treasury.getById.useQuery(
    { id: batchId ?? 0 },
    { enabled: Boolean(batchId), retry: false }
  );
  const [amounts, setAmounts] = useState<Record<number, string>>({});
  const [excludedIds, setExcludedIds] = useState<Set<number>>(new Set());
  const [exclusionReasons, setExclusionReasons] = useState<
    Record<number, string>
  >({});
  const [accountItemIds, setAccountItemIds] = useState<Set<number>>(new Set());
  const [batchBankReference, setBatchBankReference] = useState("");
  const [bankPaymentDate, setBankPaymentDate] = useState(currentLocalDateInput);
  const [bankAttachment, setBankAttachment] =
    useState<PreparedBankAttachment>();
  const [preparingBankAttachment, setPreparingBankAttachment] = useState(false);
  const [generatingPaymentReport, setGeneratingPaymentReport] = useState(false);
  const [removingItem, setRemovingItem] = useState<any>();
  const [pendingReasonAction, setPendingReasonAction] =
    useState<PendingReasonAction>();
  const [actionReason, setActionReason] = useState("");

  useEffect(() => {
    setBatchBankReference("");
    setBankPaymentDate(currentLocalDateInput());
    setBankAttachment(undefined);
    setPreparingBankAttachment(false);
  }, [batchId]);

  useEffect(() => {
    const items = detailQuery.data?.items ?? [];
    setRemovingItem(undefined);
    setAmounts(
      Object.fromEntries(
        items.map((item: any) => [
          item.id,
          formatMoneyInputValue(item.approvedAmount ?? item.requestedAmount),
        ])
      )
    );
    setExcludedIds(new Set());
    setExclusionReasons({});
    setPendingReasonAction(undefined);
    setActionReason("");
    setAccountItemIds(
      new Set(
        items
          .filter((item: any) => item.status === "pagada")
          .map((item: any) => item.id)
      )
    );
  }, [detailQuery.data]);

  const refresh = async () => {
    await Promise.all([
      utils.treasury.getById.invalidate(),
      utils.treasury.list.invalidate(),
      utils.treasury.eligibleInvoices.invalidate(),
      utils.notifications.unreadCount.invalidate(),
    ]);
  };
  const mutationOptions = (message: string) => ({
    onSuccess: async () => {
      toast.success(message);
      await refresh();
    },
    onError: (error: { message: string }) => toast.error(error.message),
  });
  const submitMutation = trpc.treasury.submit.useMutation({
    onSuccess: async data => {
      toast.success(
        data.approvalBypassed
          ? "Lote listo para banco"
          : "Lote enviado a revisión"
      );
      await refresh();
    },
    onError: error => toast.error(error.message),
  });
  const saveReviewMutation = trpc.treasury.saveReview.useMutation(
    mutationOptions("Revisión guardada")
  );
  const approveMutation = trpc.treasury.approve.useMutation(
    mutationOptions("Lote aprobado")
  );
  const rejectMutation = trpc.treasury.reject.useMutation(
    mutationOptions("Lote rechazado")
  );
  const returnMutation = trpc.treasury.returnBatch.useMutation(
    mutationOptions("Lote devuelto")
  );
  const cancelMutation = trpc.treasury.cancel.useMutation(
    mutationOptions(
      "Lote anulado; sus documentos ya están disponibles para otro lote"
    )
  );
  const exportMutation = trpc.treasury.exportBankWorkbook.useMutation({
    onSuccess: async data => {
      downloadBase64File(data.fileName, data.mimeType, data.base64);
      toast.success("Excel bancario generado");
      await refresh();
    },
    onError: error => toast.error(error.message),
  });
  const recordBankResponseMutation =
    trpc.treasury.recordBankResponse.useMutation(
      mutationOptions("Pago bancario registrado")
    );
  const removeDraftItemMutation = trpc.treasury.updateDraft.useMutation({
    onSuccess: async () => {
      setRemovingItem(undefined);
      toast.success("Factura quitada del borrador");
      await refresh();
    },
    onError: error => toast.error(error.message),
  });
  const resolveMutation = trpc.treasury.resolveDifference.useMutation(
    mutationOptions("Diferencia resuelta")
  );
  const accountMutation = trpc.treasury.accountItems.useMutation(
    mutationOptions("Abonos contabilizados")
  );
  const reopenMutation = trpc.treasury.reopenClosed.useMutation(
    mutationOptions("Lote reabierto en Enviado al banco")
  );
  const reopenRejectedMutation = trpc.treasury.reopenRejected.useMutation({
    onSuccess: async data => {
      toast.success(
        data.approvalBypassed
          ? "Lote reabierto y listo para banco"
          : "Lote reabierto para aprobación"
      );
      await refresh();
    },
    onError: error => toast.error(error.message),
  });

  const detail = detailQuery.data;
  const batch = detail?.batch;
  const isAdvanceBatch = batch?.paymentKind === "purchase_order_advance";
  const isQualityReleaseBatch =
    batch?.paymentKind === "quality_retention_release";
  const isInvoiceBatch = (batch?.paymentKind ?? "invoice") === "invoice";
  const status = batch?.status as TreasuryBatchStatus | undefined;
  const isCentral =
    user?.role === "admin" || user?.buildreqRole === "administracion_central";
  const canManageDrafts =
    isCentral || user?.buildreqRole === "administrador_proyecto";
  const isAccountant =
    user?.role === "admin" || user?.buildreqRole === "contable";
  const approvalsEnabled =
    settingsQuery.data?.treasuryBatchApprovalsEnabled === true;
  const isApprover = settingsQuery.data?.isApprover === true;
  const canManageBankResponse = isCentral;
  const editableAdjustments =
    approvalsEnabled && status === "enviado_depuracion" && isCentral;
  const canReopenClosedBatch =
    status === "cerrado" &&
    isCentral &&
    (detail?.items ?? []).some(
      (item: any) => item.status === "rechazada_banco"
    ) &&
    (detail?.items ?? []).every((item: any) =>
      ["rechazada_banco", "excluida"].includes(item.status)
    );
  const canReopenRejectedBatch =
    status === "rechazado" && (isCentral || (approvalsEnabled && isApprover));

  function currentPaymentAmount(item: any) {
    if (item.status === "excluida" || excludedIds.has(item.id)) return 0;
    const value = editableAdjustments
      ? amounts[item.id]
      : (item.bankPaidAmount ?? item.approvedAmount ?? item.requestedAmount);
    const amount = Number(value ?? 0);
    return roundTreasuryMoney(Number.isFinite(amount) ? amount : 0);
  }

  function pendingInvoiceBalance(item: any) {
    const invoiceTotal = roundTreasuryMoney(
      Number(item.invoiceNetPayable ?? 0)
    );
    const previousPaid = roundTreasuryMoney(
      Number(item.previousPaidAmount ?? 0)
    );
    const appliedAdvance = roundTreasuryMoney(
      Number(item.appliedAdvanceAmount ?? 0)
    );
    const balance =
      (Number.isFinite(invoiceTotal) ? invoiceTotal : 0) -
      (Number.isFinite(appliedAdvance) ? appliedAdvance : 0) -
      (Number.isFinite(previousPaid) ? previousPaid : 0) -
      currentPaymentAmount(item);
    return roundTreasuryMoney(Math.max(0, balance));
  }

  function adjustments() {
    return (detail?.items ?? [])
      .filter(
        (item: any) => item.activeReservation && item.status !== "excluida"
      )
      .map((item: any) => ({
        itemId: item.id,
        amount: excludedIds.has(item.id) ? undefined : Number(amounts[item.id]),
        excluded: excludedIds.has(item.id),
        reason: exclusionReasons[item.id],
      }));
  }

  function recordBankResponse() {
    if (!batch || !detail) return;
    if (!batchBankReference.trim()) {
      toast.error("Ingrese la referencia bancaria del lote.");
      return;
    }
    if (!bankPaymentDate) {
      toast.error("Ingrese la fecha de registro o pago.");
      return;
    }
    if (!bankAttachment) {
      toast.error("Adjunte el comprobante de pago del banco.");
      return;
    }
    recordBankResponseMutation.mutate({
      id: batch.id,
      bankReference: batchBankReference.trim(),
      paidDate: bankPaymentDate,
      attachment: {
        fileName: bankAttachment.fileName,
        mimeType: bankAttachment.mimeType,
        base64: bankAttachment.base64,
      },
    });
  }

  async function generatePaymentReport() {
    if (!batch || generatingPaymentReport) return;
    const reportWindow = window.open(
      "",
      "_blank",
      "width=1200,height=800,noopener=no"
    );
    if (!reportWindow) {
      toast.error(
        "El navegador bloqueó la ventana del reporte. Habilite las ventanas emergentes e intente de nuevo."
      );
      return;
    }

    reportWindow.document.open();
    reportWindow.document.write(
      '<!doctype html><html lang="es"><head><title>Generando reporte...</title></head><body style="font-family:Arial,sans-serif;padding:32px">Generando detalle de pago...</body></html>'
    );
    reportWindow.document.close();
    setGeneratingPaymentReport(true);
    try {
      const payload = await utils.treasury.paymentDetailReport.fetch({
        id: batch.id,
      });
      reportWindow.document.open();
      reportWindow.document.write(
        buildTreasuryPaymentReportHtml(payload as TreasuryPaymentReportPayload)
      );
      reportWindow.document.close();
      printWindowWhenReady(reportWindow);
    } catch (error) {
      reportWindow.close();
      toast.error(
        error instanceof Error
          ? error.message
          : "No se pudo generar el reporte de pago."
      );
    } finally {
      setGeneratingPaymentReport(false);
    }
  }

  function removeDraftItem() {
    if (!batch || !detail || !removingItem || status !== "borrador") return;
    const remainingItems = detail.items.filter(
      (item: any) => item.status !== "excluida" && item.id !== removingItem.id
    );
    if (!remainingItems.length) {
      toast.error(
        "El lote debe conservar al menos un documento. Para eliminarlo por completo, anule el lote."
      );
      return;
    }
    removeDraftItemMutation.mutate({
      id: batch.id,
      requestedPaymentDate: toDateInput(batch.requestedPaymentDate),
      notes: batch.notes ?? undefined,
      items: remainingItems.map((item: any) =>
        item.sourceType === "purchase_order_advance"
          ? {
              sourceType: "purchase_order_advance" as const,
              purchaseOrderAdvanceId: item.purchaseOrderAdvanceId,
              requestedAmount: Number(item.requestedAmount),
            }
          : item.sourceType === "quality_retention_release"
            ? {
                sourceType: "quality_retention_release" as const,
                qualityRetentionReleaseId: item.qualityRetentionReleaseId,
                requestedAmount: Number(item.requestedAmount),
              }
            : {
                sourceType: "invoice" as const,
                invoiceId: item.invoiceId,
                requestedAmount: Number(item.requestedAmount),
              }
      ),
    });
  }

  function requestReason(action: PendingReasonAction) {
    setActionReason("");
    setPendingReasonAction(action);
  }

  function submitReasonAction() {
    if (!detail || !pendingReasonAction || actionReason.trim().length < 5)
      return;
    const onSuccess = () => {
      setPendingReasonAction(undefined);
      setActionReason("");
    };
    if (pendingReasonAction.type === "return") {
      returnMutation.mutate(
        { id: detail.batch.id, reason: actionReason },
        { onSuccess }
      );
      return;
    }
    if (pendingReasonAction.type === "cancel") {
      cancelMutation.mutate(
        { id: detail.batch.id, reason: actionReason },
        { onSuccess }
      );
      return;
    }
    if (pendingReasonAction.type === "reopen") {
      reopenMutation.mutate(
        { id: detail.batch.id, reason: actionReason },
        { onSuccess }
      );
      return;
    }
    if (pendingReasonAction.type === "reject") {
      rejectMutation.mutate(
        { id: detail.batch.id, reason: actionReason },
        { onSuccess }
      );
      return;
    }
    if (pendingReasonAction.type === "reopenRejected") {
      reopenRejectedMutation.mutate(
        { id: detail.batch.id, reason: actionReason },
        { onSuccess }
      );
      return;
    }
    resolveMutation.mutate(
      {
        id: detail.batch.id,
        itemId: pendingReasonAction.itemId,
        resolution: pendingReasonAction.resolution,
        comment: actionReason,
      },
      { onSuccess }
    );
  }

  const pending = [
    submitMutation,
    saveReviewMutation,
    approveMutation,
    rejectMutation,
    returnMutation,
    cancelMutation,
    exportMutation,
    recordBankResponseMutation,
    removeDraftItemMutation,
    resolveMutation,
    accountMutation,
    reopenMutation,
    reopenRejectedMutation,
  ].some(mutation => mutation.isPending);

  return (
    <Dialog open={Boolean(batchId)} onOpenChange={open => !open && onClose()}>
      <DialogContent className="grid max-h-[96vh] w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:max-w-[calc(100vw-1.5rem)]">
        <DialogHeader className="border-b px-6 py-5 pr-14">
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {batch?.batchNumber || "Lote de Tesorería"}
            {batch && (
              <Badge variant="outline">
                {
                  TREASURY_PAYMENT_KIND_LABELS[
                    (batch.paymentKind ??
                      "invoice") as keyof typeof TREASURY_PAYMENT_KIND_LABELS
                  ]
                }
              </Badge>
            )}
            {status && (
              <Badge variant={statusVariant(status)}>
                {getTreasuryBatchStatusLabel(
                  status,
                  batch?.approvalBypassed === true
                )}
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription className="max-w-5xl leading-relaxed">
            {detail
              ? `${treasuryProjectSummary(detail).label} · ${detail.batch.currency} · Pago previsto ${formatDate(detail.batch.requestedPaymentDate)}`
              : detailQuery.isError
                ? "No se pudo cargar el detalle."
                : "Cargando..."}
          </DialogDescription>
        </DialogHeader>

        {detailQuery.isError ? (
          <div className="flex min-h-48 items-center justify-center px-6 py-5">
            <Alert variant="destructive" className="max-w-2xl">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>No se pudo abrir el lote</AlertTitle>
              <AlertDescription className="space-y-4">
                <p>{detailQuery.error.message}</p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void detailQuery.refetch()}
                  >
                    <RefreshCcw className="mr-2 h-4 w-4" /> Reintentar
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={onClose}
                  >
                    Cerrar
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          </div>
        ) : detailQuery.isLoading || !detail ? (
          <div className="flex min-h-48 items-center justify-center px-6 py-5">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : (
          <div className="min-h-0 space-y-5 overflow-y-auto px-6 py-5">
            {detail.batch.returnReason && (
              <Alert variant="destructive">
                <RotateCcw />
                <AlertTitle>
                  {status === "rechazado" ? "Lote rechazado" : "Lote devuelto"}
                </AlertTitle>
                <AlertDescription>{detail.batch.returnReason}</AlertDescription>
              </Alert>
            )}

            {detail.sourceBatches?.length > 0 && (
              <Alert>
                <WalletCards />
                <AlertTitle>
                  Lote consolidado de {detail.sourceBatches.length} lotes
                </AlertTitle>
                <AlertDescription>
                  Origen:{" "}
                  {detail.sourceBatches
                    .map((source: any) => source.batchNumber)
                    .join(", ")}
                </AlertDescription>
              </Alert>
            )}

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Card>
                <CardContent className="pt-5">
                  <div className="text-xs text-muted-foreground">
                    Solicitado
                  </div>
                  <div className="text-lg font-semibold">
                    {formatMoney(
                      detail.items
                        .filter((item: any) => item.status !== "excluida")
                        .reduce(
                          (sum: number, item: any) =>
                            sum +
                            roundTreasuryMoney(Number(item.requestedAmount)),
                          0
                        ),
                      detail.batch.currency
                    )}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-5">
                  <div className="text-xs text-muted-foreground">
                    {detail.batch.approvalBypassed
                      ? "Listo para banco"
                      : "Aprobado"}
                  </div>
                  <div className="text-lg font-semibold">
                    {formatMoney(
                      detail.items.reduce(
                        (sum: number, item: any) =>
                          sum +
                          roundTreasuryMoney(Number(item.approvedAmount ?? 0)),
                        0
                      ),
                      detail.batch.currency
                    )}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-5">
                  <div className="text-xs text-muted-foreground">
                    Pagado por banco
                  </div>
                  <div className="text-lg font-semibold">
                    {formatMoney(
                      detail.items.reduce(
                        (sum: number, item: any) =>
                          sum +
                          roundTreasuryMoney(Number(item.bankPaidAmount ?? 0)),
                        0
                      ),
                      detail.batch.currency
                    )}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-5">
                  <div className="text-xs text-muted-foreground">Versión</div>
                  <div className="text-lg font-semibold">
                    {detail.batch.version}
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="overflow-hidden rounded-lg border bg-card [&_[data-slot=table-container]]:max-h-[42vh] [&_[data-slot=table-container]]:overflow-auto">
              <Table
                className={
                  status === "borrador" && canManageDrafts
                    ? isInvoiceBatch
                      ? "min-w-[2250px]"
                      : "min-w-[2100px]"
                    : isInvoiceBatch
                      ? "min-w-[2150px]"
                      : "min-w-[2000px]"
                }
              >
                <TableHeader className="[&_th]:sticky [&_th]:top-0 [&_th]:z-20 [&_th]:bg-muted">
                  <TableRow>
                    {status === "pendiente_contabilizacion" && isAccountant && (
                      <TableHead className="w-10" />
                    )}
                    <TableHead className="min-w-48">Proveedor</TableHead>
                    <TableHead className="min-w-40">
                      {isAdvanceBatch
                        ? "Anticipo"
                        : isQualityReleaseBatch
                          ? "Factura original"
                          : "Factura"}
                    </TableHead>
                    <TableHead className="min-w-40">
                      {isAdvanceBatch ? "Orden de compra" : "Factura fiscal"}
                    </TableHead>
                    {isInvoiceBatch && (
                      <TableHead className="min-w-36">
                        Fecha de vencimiento
                      </TableHead>
                    )}
                    <TableHead className="min-w-48">Proyecto</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead className="text-right">Subtotal</TableHead>
                    <TableHead className="text-right">ISV</TableHead>
                    <TableHead className="text-right">Total factura</TableHead>
                    <TableHead className="text-right">
                      Retenciones fiscales
                    </TableHead>
                    <TableHead className="text-right">
                      Otras retenciones
                    </TableHead>
                    <TableHead className="text-right">Descuentos</TableHead>
                    <TableHead className="text-right">
                      {isAdvanceBatch
                        ? "Importe objetivo"
                        : isQualityReleaseBatch
                          ? "Monto liberado"
                          : "Neto a pagar"}
                    </TableHead>
                    <TableHead className="text-right">
                      Anticipo aplicado
                    </TableHead>
                    <TableHead className="text-right">
                      {isAdvanceBatch || isQualityReleaseBatch
                        ? "Pagos anteriores"
                        : "Abonos anteriores"}
                    </TableHead>
                    <TableHead className="text-right">
                      {isAdvanceBatch || isQualityReleaseBatch
                        ? "Pago"
                        : "Abono"}
                    </TableHead>
                    <TableHead className="text-right">
                      Saldo pendiente
                    </TableHead>
                    {editableAdjustments && <TableHead>Excluir</TableHead>}
                    {status === "borrador" && canManageDrafts && (
                      <TableHead className="w-24 text-right">
                        Acciones
                      </TableHead>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.items.map((item: any) => (
                    <TableRow key={item.id}>
                      {status === "pendiente_contabilizacion" &&
                        isAccountant && (
                          <TableCell>
                            <Checkbox
                              disabled={item.status !== "pagada"}
                              checked={accountItemIds.has(item.id)}
                              onCheckedChange={checked =>
                                setAccountItemIds(current => {
                                  const next = new Set(current);
                                  if (checked === true) next.add(item.id);
                                  else next.delete(item.id);
                                  return next;
                                })
                              }
                            />
                          </TableCell>
                        )}
                      <TableCell className="whitespace-normal">
                        <div className="font-medium">{item.supplierName}</div>
                        {item.exclusionReason && (
                          <div className="mt-1 text-xs text-destructive">
                            {item.exclusionReason}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-normal font-medium">
                        {item.invoiceDocumentNumber}
                      </TableCell>
                      <TableCell className="whitespace-normal">
                        {item.invoiceNumber ||
                          (isAdvanceBatch ? "Sin OC" : "Sin número fiscal")}
                      </TableCell>
                      {isInvoiceBatch && (
                        <TableCell className="whitespace-nowrap">
                          {formatDateOnly(item.invoiceDocumentDueDate)}
                        </TableCell>
                      )}
                      <TableCell className="whitespace-normal">
                        <div>{item.invoiceProjectCode}</div>
                        <div className="text-xs text-muted-foreground">
                          {item.invoiceProjectName}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(item.status)}>
                          {detail.batch.approvalBypassed &&
                          item.status === "aprobada"
                            ? "Lista para banco"
                            : (TREASURY_ITEM_STATUS_LABELS[
                                item.status as keyof typeof TREASURY_ITEM_STATUS_LABELS
                              ] ?? item.status)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(
                          item.invoiceSubtotal,
                          detail.batch.currency
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(
                          item.invoiceTaxAmount,
                          detail.batch.currency
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(item.invoiceTotal, detail.batch.currency)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(
                          item.invoiceRetentionTotal,
                          detail.batch.currency
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        <TreasuryDocumentAdjustmentsAccordion
                          total={item.invoiceOtherRetentionTotal}
                          adjustments={item.otherRetentionAdjustments}
                          currency={detail.batch.currency}
                          labels={OTHER_RETENTION_LABELS}
                          fallbackLabel="Otra retención"
                        />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        <TreasuryDocumentAdjustmentsAccordion
                          total={item.invoiceDocumentDiscountTotal}
                          adjustments={item.documentDiscountAdjustments}
                          currency={detail.batch.currency}
                          labels={DOCUMENT_DISCOUNT_LABELS}
                          fallbackLabel="Descuento"
                        />
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {formatMoney(
                          item.invoiceNetPayable,
                          detail.batch.currency
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(
                          item.appliedAdvanceAmount,
                          detail.batch.currency
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(
                          item.previousPaidAmount,
                          detail.batch.currency
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {editableAdjustments && item.status !== "excluida" ? (
                          <Input
                            className="ml-auto w-36 text-right tabular-nums"
                            type="number"
                            min="0.01"
                            step="0.01"
                            max={item.requestedAmount}
                            disabled={excludedIds.has(item.id)}
                            value={amounts[item.id] ?? ""}
                            onChange={event =>
                              setAmounts(current => ({
                                ...current,
                                [item.id]: event.target.value,
                              }))
                            }
                          />
                        ) : (
                          <div className="tabular-nums">
                            {formatMoney(
                              item.bankPaidAmount ??
                                item.approvedAmount ??
                                item.requestedAmount,
                              detail.batch.currency
                            )}
                            {item.bankReference && (
                              <div className="text-xs text-muted-foreground">
                                Ref. {item.bankReference}
                              </div>
                            )}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {formatMoney(
                          pendingInvoiceBalance(item),
                          detail.batch.currency
                        )}
                      </TableCell>
                      {editableAdjustments && (
                        <TableCell>
                          {item.status !== "excluida" && (
                            <div className="space-y-2">
                              <Checkbox
                                checked={excludedIds.has(item.id)}
                                onCheckedChange={checked =>
                                  setExcludedIds(current => {
                                    const next = new Set(current);
                                    if (checked === true) next.add(item.id);
                                    else next.delete(item.id);
                                    return next;
                                  })
                                }
                              />
                              {excludedIds.has(item.id) && (
                                <Input
                                  className="w-52"
                                  placeholder="Motivo de exclusión"
                                  value={exclusionReasons[item.id] ?? ""}
                                  onChange={event =>
                                    setExclusionReasons(current => ({
                                      ...current,
                                      [item.id]: event.target.value,
                                    }))
                                  }
                                />
                              )}
                            </div>
                          )}
                        </TableCell>
                      )}
                      {status === "borrador" && canManageDrafts && (
                        <TableCell className="text-right">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                            disabled={
                              pending ||
                              detail.items.filter(
                                (row: any) => row.status !== "excluida"
                              ).length <= 1
                            }
                            title={
                              detail.items.filter(
                                (row: any) => row.status !== "excluida"
                              ).length <= 1
                                ? "Un lote debe conservar al menos una factura"
                                : "Quitar factura del borrador"
                            }
                            onClick={() => setRemovingItem(item)}
                          >
                            <Trash2 className="mr-2 h-4 w-4" /> Quitar
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {status === "enviado_banco" && canManageBankResponse && (
              <div className="space-y-4">
                <div>
                  <h3 className="font-semibold">Registrar pago bancario</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Ingrese la fecha y referencia del lote, y adjunte el
                    comprobante de pago emitido por el banco.
                  </p>
                </div>
                <Alert>
                  <Banknote />
                  <AlertTitle>Pago completo del lote</AlertTitle>
                  <AlertDescription>
                    Al registrar, todas las facturas listas se marcarán como
                    pagadas por el monto preparado para banco.
                  </AlertDescription>
                </Alert>
                <div className="space-y-3 rounded-lg border bg-muted/20 p-4">
                  <div className="grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(220px,1fr)]">
                    <div className="space-y-2">
                      <Label htmlFor="batch-bank-reference">
                        Referencia bancaria del lote
                      </Label>
                      <Input
                        id="batch-bank-reference"
                        value={batchBankReference}
                        onChange={event =>
                          setBatchBankReference(event.target.value)
                        }
                        placeholder="Ingrese la referencia bancaria"
                        maxLength={255}
                        disabled={pending}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="bank-payment-date">
                        Fecha de registro o pago
                      </Label>
                      <Input
                        id="bank-payment-date"
                        type="date"
                        value={bankPaymentDate}
                        onChange={event =>
                          setBankPaymentDate(event.target.value)
                        }
                        disabled={pending}
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="bank-response-attachment">
                      Comprobante de pago del banco
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Obligatorio. PDF, imagen o Excel de hasta 10 MB. Se
                      guardará en Archivos bancarios.
                    </p>
                  </div>
                  <Input
                    id="bank-response-attachment"
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png,.webp,.xls,.xlsx"
                    disabled={pending || preparingBankAttachment}
                    onChange={async event => {
                      const input = event.currentTarget;
                      const file = input.files?.[0];
                      if (!file) {
                        setBankAttachment(undefined);
                        return;
                      }
                      setPreparingBankAttachment(true);
                      try {
                        setBankAttachment(await prepareBankAttachment(file));
                      } catch (error) {
                        input.value = "";
                        setBankAttachment(undefined);
                        toast.error(
                          error instanceof Error
                            ? error.message
                            : "No se pudo preparar el adjunto bancario."
                        );
                      } finally {
                        setPreparingBankAttachment(false);
                      }
                    }}
                  />
                  {preparingBankAttachment && (
                    <div className="flex items-center text-sm text-muted-foreground">
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Preparando adjunto…
                    </div>
                  )}
                  {bankAttachment && (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-background px-3 py-2 text-sm">
                      <span className="min-w-0 truncate">
                        {bankAttachment.fileName} ·{" "}
                        {(bankAttachment.fileSize / 1024 / 1024).toFixed(2)} MB
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setBankAttachment(undefined)}
                      >
                        Quitar
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {status === "conciliacion" && canManageBankResponse && (
              <div className="space-y-3">
                <h3 className="font-semibold">Diferencias bancarias</h3>
                {detail.items
                  .filter((item: any) => item.status === "con_diferencia")
                  .map((item: any) => (
                    <div
                      key={item.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
                    >
                      <div>
                        <div className="font-medium">
                          {item.supplierName} · {item.invoiceDocumentNumber}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {detail.batch.approvalBypassed
                            ? "Listo para banco "
                            : "Aprobado "}
                          {formatMoney(
                            item.approvedAmount,
                            detail.batch.currency
                          )}{" "}
                          · Banco{" "}
                          {formatMoney(
                            item.bankPaidAmount,
                            detail.batch.currency
                          )}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={pending}
                          onClick={() =>
                            requestReason({
                              type: "resolve",
                              itemId: item.id,
                              resolution: "reject",
                            })
                          }
                        >
                          <XCircle className="mr-2 h-4 w-4" /> Rechazar línea
                        </Button>
                        <Button
                          size="sm"
                          disabled={pending}
                          onClick={() =>
                            requestReason({
                              type: "resolve",
                              itemId: item.id,
                              resolution: "accept",
                            })
                          }
                        >
                          <CheckCircle2 className="mr-2 h-4 w-4" /> Aceptar
                          abono real
                        </Button>
                      </div>
                    </div>
                  ))}
              </div>
            )}

            {detail.attachments.length > 0 && (
              <div className="space-y-2">
                <h3 className="font-semibold">Archivos bancarios</h3>
                <div className="flex flex-wrap gap-2">
                  {detail.attachments.map((attachment: any) => (
                    <Button
                      key={attachment.id}
                      variant="outline"
                      size="sm"
                      asChild
                    >
                      <a
                        href={attachment.fileUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <FileSpreadsheet className="mr-2 h-4 w-4" />{" "}
                        {attachment.fileName}
                      </a>
                    </Button>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-2">
              <h3 className="font-semibold">Auditoría</h3>
              <div className="max-h-44 space-y-2 overflow-y-auto rounded-md border p-3">
                {detail.events.map((event: any) => (
                  <div key={event.id} className="text-sm">
                    <span className="font-medium">{event.actorName}</span>{" "}
                    <span className="text-muted-foreground">
                      · {auditActionLabel(event.action)} ·{" "}
                      {formatDate(event.createdAt)}
                    </span>
                    {event.comment && (
                      <div className="text-xs text-muted-foreground">
                        {event.comment}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {detail && (
          <DialogFooter className="flex-wrap border-t bg-muted/20 px-6 py-4 sm:items-center sm:justify-between">
            <div className="flex flex-wrap gap-2">
              {(status === "borrador" || status === "devuelto") &&
                canManageDrafts && (
                  <>
                    <Button
                      variant="outline"
                      onClick={() => onEdit(detail)}
                      disabled={pending}
                    >
                      Editar
                    </Button>
                    <Button
                      onClick={() =>
                        submitMutation.mutate({ id: detail.batch.id })
                      }
                      disabled={pending}
                    >
                      <Send className="mr-2 h-4 w-4" />{" "}
                      {approvalsEnabled
                        ? "Enviar a revisión"
                        : "Generar detalle de pago"}
                    </Button>
                  </>
                )}
              {approvalsEnabled &&
                status === "enviado_depuracion" &&
                isCentral && (
                  <Button
                    onClick={() =>
                      saveReviewMutation.mutate({
                        id: detail.batch.id,
                        adjustments: adjustments(),
                      })
                    }
                    disabled={pending}
                  >
                    <Save className="mr-2 h-4 w-4" /> Guardar
                  </Button>
                )}
              {approvalsEnabled &&
                status === "pendiente_aprobacion" &&
                isApprover && (
                  <>
                    <Button
                      onClick={() =>
                        approveMutation.mutate({ id: detail.batch.id })
                      }
                      disabled={pending}
                    >
                      <CheckCircle2 className="mr-2 h-4 w-4" /> Aprobar lote
                    </Button>
                    <Button
                      variant="destructive"
                      disabled={pending}
                      onClick={() => requestReason({ type: "reject" })}
                    >
                      <XCircle className="mr-2 h-4 w-4" /> Rechazar lote
                    </Button>
                  </>
                )}
              {approvalsEnabled &&
              status === "enviado_depuracion" &&
              isCentral ? (
                <Button
                  variant="outline"
                  disabled={pending}
                  onClick={() => requestReason({ type: "return" })}
                >
                  <RotateCcw className="mr-2 h-4 w-4" /> Devolver
                </Button>
              ) : null}
              {(status === "aprobado" || status === "enviado_banco") &&
                canManageBankResponse && (
                  <Button
                    onClick={() =>
                      exportMutation.mutate({ id: detail.batch.id })
                    }
                    disabled={pending}
                  >
                    <Download className="mr-2 h-4 w-4" /> Descargar Excel banco
                  </Button>
                )}
              {status === "enviado_banco" && canManageBankResponse && (
                <Button
                  onClick={recordBankResponse}
                  disabled={
                    pending ||
                    preparingBankAttachment ||
                    !batchBankReference.trim() ||
                    !bankPaymentDate ||
                    !bankAttachment ||
                    detail.items.every(
                      (item: any) => item.status !== "aprobada"
                    )
                  }
                >
                  <CheckCircle2 className="mr-2 h-4 w-4" /> Registrar
                </Button>
              )}
              {status === "pendiente_contabilizacion" && isAccountant && (
                <Button
                  onClick={() =>
                    accountMutation.mutate({
                      id: detail.batch.id,
                      itemIds: Array.from(accountItemIds),
                    })
                  }
                  disabled={pending || accountItemIds.size === 0}
                >
                  <Banknote className="mr-2 h-4 w-4" /> Contabilizar abonos
                </Button>
              )}
              <Button
                variant="outline"
                onClick={() => void generatePaymentReport()}
                disabled={pending || generatingPaymentReport}
              >
                {generatingPaymentReport ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Printer className="mr-2 h-4 w-4" />
                )}
                {generatingPaymentReport
                  ? "Generando reporte..."
                  : "Generar reporte de pago"}
              </Button>
              {canReopenClosedBatch && (
                <Button
                  variant="outline"
                  disabled={pending}
                  onClick={() => requestReason({ type: "reopen" })}
                >
                  <RotateCcw className="mr-2 h-4 w-4" /> Reabrir lote
                </Button>
              )}
              {canReopenRejectedBatch && (
                <Button
                  variant="outline"
                  disabled={pending}
                  onClick={() => requestReason({ type: "reopenRejected" })}
                >
                  <RotateCcw className="mr-2 h-4 w-4" /> Reabrir lote
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              {status &&
                ![
                  "conciliacion",
                  "pendiente_contabilizacion",
                  "cerrado",
                  "anulado",
                  "consolidado",
                ].includes(status) &&
                (isCentral ||
                  ((status === "borrador" || status === "devuelto") &&
                    canManageDrafts)) && (
                  <Button
                    variant="destructive"
                    disabled={pending}
                    onClick={() => requestReason({ type: "cancel" })}
                  >
                    Anular
                  </Button>
                )}
              <Button variant="outline" onClick={onClose}>
                Cerrar
              </Button>
            </div>
          </DialogFooter>
        )}
      </DialogContent>
      <AlertDialog
        open={Boolean(removingItem)}
        onOpenChange={open => !open && setRemovingItem(undefined)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Quitar esta factura?</AlertDialogTitle>
            <AlertDialogDescription>
              {removingItem
                ? `${removingItem.supplierName} · ${removingItem.invoiceDocumentNumber} se quitará del borrador y su saldo quedará disponible para otro lote.`
                : "La factura se quitará del borrador."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removeDraftItemMutation.isPending}>
              Conservar factura
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              disabled={removeDraftItemMutation.isPending}
              onClick={removeDraftItem}
            >
              {removeDraftItemMutation.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Quitar factura
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={Boolean(pendingReasonAction)}
        onOpenChange={open => {
          if (!open) {
            setPendingReasonAction(undefined);
            setActionReason("");
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingReasonAction?.type === "return"
                ? "Devolver lote"
                : pendingReasonAction?.type === "cancel"
                  ? "Anular lote"
                  : pendingReasonAction?.type === "reopen"
                    ? "Reabrir lote"
                    : pendingReasonAction?.type === "reject"
                      ? "Rechazar lote"
                      : pendingReasonAction?.type === "reopenRejected"
                        ? "Reabrir lote rechazado"
                        : pendingReasonAction?.resolution === "accept"
                          ? "Aceptar abono real"
                          : "Rechazar línea bancaria"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingReasonAction?.type === "reopen"
                ? "El lote volverá a Enviado al banco y las líneas rechazadas regresarán a Aprobada. Escriba el motivo para registrarlo en la auditoría."
                : pendingReasonAction?.type === "cancel"
                  ? "El lote quedará anulado y sus facturas volverán a estar disponibles para incluirlas en otro lote. Esta acción solo se permite antes de registrar una respuesta o pago bancario."
                  : pendingReasonAction?.type === "reject"
                    ? "El lote completo quedará rechazado. Escriba el motivo obligatorio para registrarlo en la auditoría."
                    : pendingReasonAction?.type === "reopenRejected"
                      ? approvalsEnabled
                        ? "El lote volverá a quedar pendiente de aprobación. Escriba el motivo de la reapertura."
                        : "El lote quedará listo para banco sin revisión ni aprobación. Escriba el motivo de la reapertura."
                      : "Escriba un motivo de al menos 5 caracteres para registrar esta acción en la auditoría."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="treasury-action-reason">Motivo</Label>
            <Textarea
              id="treasury-action-reason"
              autoFocus
              value={actionReason}
              onChange={event => setActionReason(event.target.value)}
              placeholder="Escriba el motivo"
              maxLength={2000}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending || actionReason.trim().length < 5}
              onClick={submitReasonAction}
            >
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirmar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}

export default function Tesoreria() {
  const utils = trpc.useUtils();
  const [, setLocation] = useLocation();
  const urlSearch = useSearch();
  const [invoicePaymentReportStatus, setInvoicePaymentReportStatus] =
    useState<InvoicePaymentReportStatus>("all");
  const [invoiceReportDateFrom, setInvoiceReportDateFrom] = useState("");
  const [invoiceReportDateTo, setInvoiceReportDateTo] = useState("");
  const [invoiceReportSearch, setInvoiceReportSearch] = useState("");
  const debouncedInvoiceReportSearch = useDebouncedValue(invoiceReportSearch);
  const [invoiceReportPreviewOpen, setInvoiceReportPreviewOpen] =
    useState(false);
  const [invoiceReportPage, setInvoiceReportPage] = useState(1);
  const [exportingInvoiceSummary, setExportingInvoiceSummary] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("todos");
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [batchPage, setBatchPage] = useState(1);
  const [exporting, setExporting] = useState(false);
  const [exportingPaymentsReport, setExportingPaymentsReport] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [advanceRequestOpen, setAdvanceRequestOpen] = useState(false);
  const [initialAdvance, setInitialAdvance] = useState<any>();
  const [formKind, setFormKind] = useState<
    "invoice" | "purchase_order_advance" | "quality_retention_release"
  >("invoice");
  const [releaseDecision, setReleaseDecision] = useState<any>();
  const [releaseDecisionApproved, setReleaseDecisionApproved] = useState(true);
  const [releaseDecisionAmount, setReleaseDecisionAmount] = useState("");
  const [releaseDecisionComment, setReleaseDecisionComment] = useState("");
  const [selectedBatchId, setSelectedBatchId] = useState<number | null>(() =>
    getRequestedTreasuryBatchId(urlSearch)
  );
  const [editingDetail, setEditingDetail] = useState<any>();
  const [selectedConsolidationBatchIds, setSelectedConsolidationBatchIds] =
    useState<Set<number>>(new Set());
  const settingsQuery = trpc.treasury.settings.useQuery();
  const approvalsEnabled =
    settingsQuery.data?.treasuryBatchApprovalsEnabled === true;
  const canConsolidate = settingsQuery.data?.permissions.canDepurate === true;

  useEffect(() => {
    const requestedBatchId = getRequestedTreasuryBatchId(urlSearch);
    if (requestedBatchId) setSelectedBatchId(requestedBatchId);
  }, [urlSearch]);

  const invoiceSummaryQuery = trpc.treasury.invoiceSummaryReport.useQuery(
    {
      paymentStatus: invoicePaymentReportStatus,
      dateFrom: invoiceReportDateFrom || null,
      dateTo: invoiceReportDateTo || null,
      search: debouncedInvoiceReportSearch.trim() || null,
      page: invoiceReportPage,
      pageSize: INVOICE_REPORT_PAGE_SIZE,
    },
    {
      enabled:
        settingsQuery.data?.treasuryEnabled === true &&
        settingsQuery.data?.canAccess === true,
    }
  );
  const exportInvoiceSummaryPdfMutation =
    trpc.treasury.invoiceSummaryReportPdf.useMutation();
  const paymentsReportMutation = trpc.treasury.paymentsReport.useMutation();
  const invoiceReportRows = invoiceSummaryQuery.data?.invoices ?? [];
  const invoiceReportTotal = invoiceSummaryQuery.data?.pagination.total ?? 0;
  const resolvedInvoiceReportTotalPages =
    invoiceSummaryQuery.data?.pagination.totalPages;
  const invoiceReportTotalPages = resolvedInvoiceReportTotalPages ?? 1;
  const currentInvoiceReportPage =
    invoiceSummaryQuery.data?.pagination.page ?? invoiceReportPage;

  useEffect(() => {
    setInvoiceReportPage(1);
  }, [
    invoicePaymentReportStatus,
    invoiceReportDateFrom,
    invoiceReportDateTo,
    invoiceReportSearch,
  ]);

  useEffect(() => {
    if (resolvedInvoiceReportTotalPages === undefined) return;
    setInvoiceReportPage(current =>
      Math.min(current, resolvedInvoiceReportTotalPages)
    );
  }, [resolvedInvoiceReportTotalPages]);

  useEffect(() => {
    if (
      !approvalsEnabled &&
      ["enviado_depuracion", "pendiente_aprobacion"].includes(statusFilter)
    ) {
      setStatusFilter("todos");
    }
  }, [approvalsEnabled, statusFilter]);

  const batchesQuery = trpc.treasury.list.useQuery(
    statusFilter === "todos"
      ? undefined
      : { status: statusFilter as TreasuryBatchStatus },
    {
      enabled:
        settingsQuery.data?.treasuryEnabled === true &&
        settingsQuery.data?.canAccess === true,
    }
  );
  const qualityReleaseQueueQuery = trpc.qualityRetentionReleases.list.useQuery(
    { statuses: ["pending_approval", "approved", "partially_paid"] },
    {
      enabled:
        settingsQuery.data?.treasuryEnabled === true &&
        settingsQuery.data?.canAccess === true,
    }
  );
  const decideQualityReleaseMutation =
    trpc.qualityRetentionReleases.decide.useMutation({
      onSuccess: async () => {
        toast.success(
          releaseDecisionApproved
            ? "Liberación aprobada"
            : "Liberación rechazada"
        );
        setReleaseDecision(undefined);
        setReleaseDecisionComment("");
        await Promise.all([
          utils.qualityRetentionReleases.invalidate(),
          utils.treasury.eligibleQualityRetentionReleases.invalidate(),
          utils.notifications.unreadCount.invalidate(),
        ]);
      },
      onError: error => toast.error(error.message),
    });
  const consolidateMutation = trpc.treasury.consolidateForApproval.useMutation({
    onSuccess: async data => {
      setSelectedConsolidationBatchIds(new Set());
      toast.success(
        data.consolidated
          ? data.approvalBypassed
            ? `Lote consolidado ${data.batchNumber} creado con ${data.sourceBatchIds.length} lotes y listo para banco.`
            : `Lote consolidado ${data.batchNumber} creado con ${data.sourceBatchIds.length} lotes y enviado a aprobación.`
          : `Lote ${data.batchNumber} enviado a aprobación.`
      );
      await Promise.all([
        utils.treasury.list.invalidate(),
        utils.treasury.getById.invalidate(),
        utils.notifications.unreadCount.invalidate(),
      ]);
      setSelectedBatchId(data.batchId);
    },
    onError: error => toast.error(error.message),
  });

  const visibleBatches = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("es-HN");
    return (batchesQuery.data ?? []).filter((row: any) => {
      const paymentRegistrationDate = toDateKey(row.paymentRegistrationDate);
      const projectSummary = treasuryProjectSummary(row);
      const matchesSearch =
        !term ||
        [
          row.batch.batchNumber,
          projectSummary.code,
          projectSummary.name,
          row.batch.status,
          getTreasuryBatchStatusLabel(
            row.batch.status as TreasuryBatchStatus,
            row.batch.approvalBypassed === true
          ),
        ]
          .join(" ")
          .toLocaleLowerCase("es-HN")
          .includes(term);
      const matchesDateRange =
        (!dateFrom && !dateTo) ||
        (Boolean(paymentRegistrationDate) &&
          (!dateFrom || paymentRegistrationDate >= dateFrom) &&
          (!dateTo || paymentRegistrationDate <= dateTo));
      return matchesSearch && matchesDateRange;
    });
  }, [batchesQuery.data, dateFrom, dateTo, search]);
  const batchTotalPages = Math.max(
    1,
    Math.ceil(visibleBatches.length / TREASURY_BATCH_PAGE_SIZE)
  );
  const currentBatchPage = Math.min(batchPage, batchTotalPages);
  const paginatedBatches = useMemo(() => {
    const start = (currentBatchPage - 1) * TREASURY_BATCH_PAGE_SIZE;
    return visibleBatches.slice(start, start + TREASURY_BATCH_PAGE_SIZE);
  }, [currentBatchPage, visibleBatches]);
  const visibleConsolidatableBatches = useMemo(
    () =>
      visibleBatches.filter((row: any) =>
        (approvalsEnabled
          ? ["enviado_depuracion", "pendiente_aprobacion"]
          : ["aprobado"]
        ).includes(row.batch.status)
      ),
    [approvalsEnabled, visibleBatches]
  );
  const paginatedConsolidatableBatches = useMemo(
    () =>
      paginatedBatches.filter((row: any) =>
        (approvalsEnabled
          ? ["enviado_depuracion", "pendiente_aprobacion"]
          : ["aprobado"]
        ).includes(row.batch.status)
      ),
    [approvalsEnabled, paginatedBatches]
  );
  const allVisibleConsolidatableBatchesSelected =
    paginatedConsolidatableBatches.length > 0 &&
    paginatedConsolidatableBatches.every((row: any) =>
      selectedConsolidationBatchIds.has(row.batch.id)
    );
  const someVisibleConsolidatableBatchesSelected =
    paginatedConsolidatableBatches.some((row: any) =>
      selectedConsolidationBatchIds.has(row.batch.id)
    );
  const selectedConsolidationBatches = (batchesQuery.data ?? []).filter(
    (row: any) => selectedConsolidationBatchIds.has(row.batch.id)
  );
  const singleSelectedBatchAlreadyPendingApproval =
    approvalsEnabled &&
    selectedConsolidationBatches.length === 1 &&
    selectedConsolidationBatches[0]?.batch.status === "pendiente_aprobacion";
  const needsMoreBatchesWithoutApproval =
    !approvalsEnabled && selectedConsolidationBatches.length === 1;

  useEffect(() => {
    const visibleIds = new Set(
      visibleConsolidatableBatches.map((row: any) => row.batch.id)
    );
    setSelectedConsolidationBatchIds(current => {
      const next = new Set(
        Array.from(current).filter(batchId => visibleIds.has(batchId))
      );
      return next.size === current.size ? current : next;
    });
  }, [visibleConsolidatableBatches]);

  useEffect(() => {
    setBatchPage(current => Math.min(current, batchTotalPages));
  }, [batchTotalPages]);

  function toggleVisibleConsolidatableBatches() {
    const shouldSelect = !allVisibleConsolidatableBatchesSelected;
    setSelectedConsolidationBatchIds(current => {
      const next = new Set(current);
      paginatedConsolidatableBatches.forEach((row: any) => {
        if (shouldSelect) next.add(row.batch.id);
        else next.delete(row.batch.id);
      });
      return next;
    });
  }

  function consolidateSelectedBatches() {
    const selectedRows = selectedConsolidationBatches;
    if (!selectedRows.length) {
      toast.error("Seleccione al menos un lote.");
      return;
    }
    if (!approvalsEnabled && selectedRows.length < 2) {
      toast.error(
        "Seleccione al menos dos lotes para crear un consolidado listo para banco."
      );
      return;
    }
    const currencies = new Set(
      selectedRows.map((row: any) => row.batch.currency)
    );
    if (currencies.size > 1) {
      toast.error(
        "Seleccione lotes de una sola moneda para crear el consolidado."
      );
      return;
    }
    const paymentKinds = new Set(
      selectedRows.map((row: any) => row.batch.paymentKind ?? "invoice")
    );
    if (paymentKinds.size > 1) {
      toast.error(
        "Seleccione únicamente lotes de facturas o únicamente lotes de anticipos."
      );
      return;
    }
    consolidateMutation.mutate({
      batchIds: Array.from(selectedConsolidationBatchIds),
    });
  }

  async function exportInvoiceSummary() {
    if (exportingInvoiceSummary) return;
    setExportingInvoiceSummary(true);
    try {
      const payload = await utils.treasury.invoiceSummaryReport.fetch({
        paymentStatus: invoicePaymentReportStatus,
        dateFrom: invoiceReportDateFrom || null,
        dateTo: invoiceReportDateTo || null,
        search: invoiceReportSearch.trim() || null,
      });
      if (payload.summary.invoiceCount === 0) {
        toast.error("No hay facturas para exportar con los filtros actuales.");
        return;
      }
      await downloadTreasuryInvoiceSummaryWorkbook(payload);
      toast.success(
        `Reporte resumido generado con ${payload.summary.invoiceCount.toLocaleString("es-HN")} factura(s).`
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "No se pudo generar el reporte resumido de facturas."
      );
    } finally {
      setExportingInvoiceSummary(false);
    }
  }

  async function exportInvoiceSummaryPdf() {
    if (exportInvoiceSummaryPdfMutation.isPending) return;
    try {
      const file = await exportInvoiceSummaryPdfMutation.mutateAsync({
        paymentStatus: invoicePaymentReportStatus,
        dateFrom: invoiceReportDateFrom || null,
        dateTo: invoiceReportDateTo || null,
        search: invoiceReportSearch.trim() || null,
      });
      downloadBase64File(file.fileName, file.mimeType, file.base64);
      toast.success(
        `Reporte PDF generado con ${file.invoiceCount.toLocaleString("es-HN")} factura(s).`
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "No se pudo generar el reporte PDF de facturas."
      );
    }
  }

  async function exportFilteredBatches() {
    if (!visibleBatches.length) {
      toast.error("No hay lotes para exportar con los filtros actuales.");
      return;
    }
    setExporting(true);
    try {
      const fileName =
        dateFrom || dateTo
          ? `lotes-tesoreria-${dateFrom || "inicio"}-${dateTo || "fin"}.xlsx`
          : buildDatedExcelFileName("lotes-tesoreria");
      await downloadExcel(
        fileName,
        "Lotes de pago",
        TREASURY_BATCH_EXPORT_COLUMNS,
        visibleBatches
      );
      toast.success(
        `${visibleBatches.length} ${
          visibleBatches.length === 1 ? "lote exportado" : "lotes exportados"
        } a Excel.`
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "No se pudo generar el archivo Excel."
      );
    } finally {
      setExporting(false);
    }
  }

  async function exportPaymentsReport() {
    if (!visibleBatches.length) {
      toast.error("No hay lotes para exportar con los filtros actuales.");
      return;
    }
    setExportingPaymentsReport(true);
    try {
      const payload = await paymentsReportMutation.mutateAsync({
        batchIds: visibleBatches.map(row => row.batch.id),
      });
      const fileName =
        dateFrom || dateTo
          ? `pagos-efectuados-${dateFrom || "inicio"}-${dateTo || "fin"}.xlsx`
          : buildDatedExcelFileName("pagos-efectuados");
      await downloadWorkbook(
        fileName,
        buildTreasuryPaymentsWorksheets({
          batchColumns: TREASURY_BATCH_EXPORT_COLUMNS,
          batches: visibleBatches,
          payments: payload.payments,
        })
      );
      toast.success(
        `Pagos efectuados generado con ${visibleBatches.length.toLocaleString(
          "es-HN"
        )} lote(s) y ${payload.payments.length.toLocaleString(
          "es-HN"
        )} factura(s).`
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "No se pudo generar el reporte Payments."
      );
    } finally {
      setExportingPaymentsReport(false);
    }
  }

  if (settingsQuery.isLoading) {
    return (
      <div className="flex min-h-64 items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin" />
      </div>
    );
  }
  if (!settingsQuery.data?.canAccess) {
    return (
      <Alert variant="destructive">
        <AlertTriangle />
        <AlertTitle>Acceso restringido</AlertTitle>
        <AlertDescription>
          No está autorizado para operar Tesorería.
        </AlertDescription>
      </Alert>
    );
  }
  if (!settingsQuery.data.treasuryEnabled) {
    return (
      <Alert>
        <WalletCards />
        <AlertTitle>Tesorería todavía no está habilitada</AlertTitle>
        <AlertDescription>
          Un administrador debe activar el módulo en Configuración.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="order-[-2] flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2">
            <WalletCards className="h-6 w-6" /> Tesorería
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {approvalsEnabled
              ? "Lotes, abonos parciales, aprobación, banco y contabilización."
              : "Lotes, abonos parciales, banco y contabilización."}
          </p>
        </div>
        {settingsQuery.data.permissions.canCreate && (
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => {
                setEditingDetail(undefined);
                setFormKind("invoice");
                setFormOpen(true);
              }}
            >
              <Plus className="mr-2 h-4 w-4" /> Pago de facturas
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setEditingDetail(undefined);
                setInitialAdvance(undefined);
                setFormKind("quality_retention_release");
                setFormOpen(true);
              }}
            >
              <CheckCircle2 className="mr-2 h-4 w-4" /> Liberar retención de
              calidad
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setEditingDetail(undefined);
                setInitialAdvance(undefined);
                setFormKind("purchase_order_advance");
                setFormOpen(true);
              }}
            >
              <Banknote className="mr-2 h-4 w-4" /> Anticipo a proveedor
            </Button>
            <Button
              variant="outline"
              onClick={() => setAdvanceRequestOpen(true)}
            >
              <Plus className="mr-2 h-4 w-4" /> Cargar OC
            </Button>
          </div>
        )}
      </div>

      {!approvalsEnabled && (
        <Alert className="order-last">
          <Banknote />
          <AlertTitle>Aprobaciones de lotes desactivadas</AlertTitle>
          <AlertDescription>
            Los lotes enviados pasan directamente a Listo para banco.
            Administración Central conserva la exportación y el registro del
            pago bancario.
          </AlertDescription>
        </Alert>
      )}

      <Card className="order-[1]">
        <Accordion type="single" collapsible>
          <AccordionItem value="quality-retentions" className="border-b-0">
            <AccordionTrigger className="px-6 py-5 hover:no-underline">
              <span className="flex min-w-0 flex-1 flex-col items-start gap-1 text-left">
                <span className="flex items-center gap-3 text-lg font-semibold">
                  <span className="h-5 w-1 rounded-full bg-primary" />
                  Retenciones de calidad
                  {qualityReleaseQueueQuery.isFetching ? (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  ) : (
                    <Badge variant="secondary">
                      {(
                        qualityReleaseQueueQuery.data ?? []
                      ).length.toLocaleString("es-HN")}
                    </Badge>
                  )}
                </span>
                <span className="pl-4 text-sm font-normal text-muted-foreground">
                  Solicitudes pendientes de autorización y liberaciones
                  disponibles para pago.
                </span>
              </span>
            </AccordionTrigger>
            <AccordionContent className="pb-0">
              <CardContent className="border-t pt-6">
                <div className="overflow-auto rounded-lg border">
                  <Table className="min-w-[1050px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Factura</TableHead>
                        <TableHead>Proveedor</TableHead>
                        <TableHead>Proyecto</TableHead>
                        <TableHead>Estado</TableHead>
                        <TableHead className="text-right">Retenido</TableHead>
                        <TableHead className="text-right">Solicitado</TableHead>
                        <TableHead className="text-right">Aprobado</TableHead>
                        <TableHead className="text-right">Pagado</TableHead>
                        <TableHead className="text-right">Saldo</TableHead>
                        <TableHead />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {qualityReleaseQueueQuery.isLoading ? (
                        <TableRow>
                          <TableCell colSpan={10} className="py-10 text-center">
                            <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                          </TableCell>
                        </TableRow>
                      ) : (qualityReleaseQueueQuery.data ?? []).length ? (
                        (qualityReleaseQueueQuery.data ?? []).map(
                          (row: any) => (
                            <TableRow key={row.release.id}>
                              <TableCell>
                                <div className="font-medium">
                                  {row.invoice.invoiceDocumentNumber}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {row.invoice.invoiceNumber ||
                                    "Sin número fiscal"}
                                </div>
                              </TableCell>
                              <TableCell>
                                {row.supplier?.name || "Proveedor"}
                              </TableCell>
                              <TableCell>
                                {row.project.code} - {row.project.name}
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline">
                                  {row.release.status === "pending_approval"
                                    ? "Pendiente de aprobación"
                                    : row.release.status === "partially_paid"
                                      ? "Parcialmente pagada"
                                      : "Aprobada"}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-right">
                                {formatMoney(
                                  row.adjustment.amount,
                                  row.invoice.currency
                                )}
                              </TableCell>
                              <TableCell className="text-right">
                                {formatMoney(
                                  row.release.requestedAmount,
                                  row.invoice.currency
                                )}
                              </TableCell>
                              <TableCell className="text-right">
                                {formatMoney(
                                  row.release.approvedAmount,
                                  row.invoice.currency
                                )}
                              </TableCell>
                              <TableCell className="text-right">
                                {formatMoney(
                                  row.paidAmount,
                                  row.invoice.currency
                                )}
                              </TableCell>
                              <TableCell className="text-right font-semibold">
                                {formatMoney(
                                  row.availableToPayAmount,
                                  row.invoice.currency
                                )}
                              </TableCell>
                              <TableCell className="text-right">
                                {row.release.status === "pending_approval" &&
                                settingsQuery.data?.permissions.canDepurate ? (
                                  <div className="flex justify-end gap-2">
                                    <Button
                                      size="sm"
                                      onClick={() => {
                                        setReleaseDecision(row);
                                        setReleaseDecisionApproved(true);
                                        setReleaseDecisionAmount(
                                          formatMoneyInputValue(
                                            row.release.requestedAmount
                                          )
                                        );
                                        setReleaseDecisionComment("");
                                      }}
                                    >
                                      Aprobar
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="destructive"
                                      onClick={() => {
                                        setReleaseDecision(row);
                                        setReleaseDecisionApproved(false);
                                        setReleaseDecisionAmount("");
                                        setReleaseDecisionComment("");
                                      }}
                                    >
                                      Rechazar
                                    </Button>
                                  </div>
                                ) : null}
                              </TableCell>
                            </TableRow>
                          )
                        )
                      ) : (
                        <TableRow>
                          <TableCell
                            colSpan={10}
                            className="py-10 text-center text-muted-foreground"
                          >
                            No hay solicitudes o liberaciones activas.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </Card>

      <Card className="order-[-1]">
        <Accordion
          type="single"
          collapsible
          value={invoiceReportPreviewOpen ? "invoice-report" : ""}
          onValueChange={value =>
            setInvoiceReportPreviewOpen(value === "invoice-report")
          }
        >
          <AccordionItem value="invoice-report" className="border-b-0">
            <AccordionTrigger className="px-6 py-5 hover:no-underline">
              <span className="flex min-w-0 flex-1 flex-col items-start gap-1 text-left">
                <span className="flex items-center gap-3 text-lg font-semibold">
                  <span className="h-5 w-1 rounded-full bg-primary" />
                  Reporte de Facturas
                  {invoiceSummaryQuery.isFetching ? (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  ) : (
                    <Badge variant="secondary">
                      {invoiceReportTotal.toLocaleString("es-HN")}
                    </Badge>
                  )}
                </span>
                <span className="pl-4 text-sm font-normal text-muted-foreground">
                  Genera una fila por factura con su total, retenciones y neto a
                  pagar, sin detalle por artículo.
                </span>
              </span>
            </AccordionTrigger>
            <AccordionContent className="pb-0">
              <CardContent className="space-y-4 border-t pt-6">
                <div className="grid items-end gap-3 md:grid-cols-2 xl:grid-cols-[14rem_11rem_11rem_minmax(16rem,1fr)_auto_auto]">
                  <div className="space-y-2">
                    <Label>Estado de factura</Label>
                    <Select
                      value={invoicePaymentReportStatus}
                      onValueChange={value =>
                        setInvoicePaymentReportStatus(
                          value as InvoicePaymentReportStatus
                        )
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(
                          INVOICE_PAYMENT_REPORT_STATUS_LABELS
                        ).map(([status, label]) => (
                          <SelectItem key={status} value={status}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="treasury-invoice-date-from">Desde</Label>
                    <Input
                      id="treasury-invoice-date-from"
                      type="date"
                      value={invoiceReportDateFrom}
                      max={invoiceReportDateTo || undefined}
                      onChange={event => {
                        const value = event.target.value;
                        setInvoiceReportDateFrom(value);
                        if (
                          value &&
                          invoiceReportDateTo &&
                          value > invoiceReportDateTo
                        ) {
                          setInvoiceReportDateTo(value);
                        }
                      }}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="treasury-invoice-date-to">Hasta</Label>
                    <Input
                      id="treasury-invoice-date-to"
                      type="date"
                      value={invoiceReportDateTo}
                      min={invoiceReportDateFrom || undefined}
                      onChange={event => {
                        const value = event.target.value;
                        setInvoiceReportDateTo(value);
                        if (
                          value &&
                          invoiceReportDateFrom &&
                          value < invoiceReportDateFrom
                        ) {
                          setInvoiceReportDateFrom(value);
                        }
                      }}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="treasury-invoice-report-search">
                      Buscar
                    </Label>
                    <div className="relative">
                      <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="treasury-invoice-report-search"
                        className="pl-9"
                        placeholder="Documento, factura, proveedor, proyecto o lote"
                        value={invoiceReportSearch}
                        onChange={event =>
                          setInvoiceReportSearch(event.target.value)
                        }
                      />
                    </div>
                  </div>
                  <Button
                    onClick={() => void exportInvoiceSummary()}
                    disabled={exportingInvoiceSummary}
                  >
                    {exportingInvoiceSummary ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Download className="mr-2 h-4 w-4" />
                    )}
                    Exportar Excel
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => void exportInvoiceSummaryPdf()}
                    disabled={exportInvoiceSummaryPdfMutation.isPending}
                  >
                    {exportInvoiceSummaryPdfMutation.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <FileText className="mr-2 h-4 w-4" />
                    )}
                    Exportar PDF
                  </Button>
                </div>

                {invoiceSummaryQuery.isLoading ? (
                  <div className="flex min-h-32 items-center justify-center gap-2 border-t px-4 py-8 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Cargando facturas con los filtros seleccionados...
                  </div>
                ) : invoiceSummaryQuery.isError ? (
                  <div className="border-t p-4">
                    <Alert variant="destructive">
                      <AlertTriangle className="h-4 w-4" />
                      <AlertTitle>No se pudo cargar la vista previa</AlertTitle>
                      <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                        <span>{invoiceSummaryQuery.error.message}</span>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => void invoiceSummaryQuery.refetch()}
                        >
                          Reintentar
                        </Button>
                      </AlertDescription>
                    </Alert>
                  </div>
                ) : (
                  <div className="border-t">
                    <div className="overflow-x-auto">
                      <Table className="min-w-[980px]">
                        <TableHeader>
                          <TableRow>
                            <TableHead>Proveedor</TableHead>
                            <TableHead className="whitespace-nowrap">
                              Nro. factura
                            </TableHead>
                            <TableHead className="whitespace-nowrap">
                              Fecha
                            </TableHead>
                            <TableHead className="whitespace-nowrap text-right">
                              Total
                            </TableHead>
                            <TableHead className="whitespace-nowrap text-right">
                              Retenciones
                            </TableHead>
                            <TableHead className="whitespace-nowrap text-right">
                              Neto
                            </TableHead>
                            <TableHead>Estado</TableHead>
                            <TableHead className="whitespace-nowrap">
                              Documento
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {invoiceReportRows.length ? (
                            invoiceReportRows.map(row => {
                              const currency =
                                row.Moneda === "USD" ? "USD" : "HNL";
                              return (
                                <TableRow
                                  key={`${row["Documento interno"]}-${row["N° Registro"]}`}
                                >
                                  <TableCell className="min-w-52">
                                    {formatReportText(row.Proveedor)}
                                  </TableCell>
                                  <TableCell className="whitespace-nowrap">
                                    {formatReportText(row["Nro. Factura"])}
                                  </TableCell>
                                  <TableCell className="whitespace-nowrap">
                                    {formatDateOnly(row["Fecha factura"])}
                                  </TableCell>
                                  <TableCell className="whitespace-nowrap text-right">
                                    {formatMoney(
                                      row["Total factura"],
                                      currency
                                    )}
                                  </TableCell>
                                  <TableCell className="whitespace-nowrap text-right">
                                    {formatMoney(
                                      Number(row["Retenciones fiscales"] ?? 0) +
                                        Number(row["Otras retenciones"] ?? 0),
                                      currency
                                    )}
                                  </TableCell>
                                  <TableCell className="whitespace-nowrap text-right font-semibold">
                                    {formatMoney(row["Neto a pagar"], currency)}
                                  </TableCell>
                                  <TableCell className="whitespace-nowrap">
                                    {formatReportText(row.Estado)}
                                  </TableCell>
                                  <TableCell className="whitespace-nowrap font-medium">
                                    <button
                                      type="button"
                                      className="text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                      onClick={() =>
                                        setLocation(
                                          `/facturas?editar=${row.navigation.invoiceId}`
                                        )
                                      }
                                    >
                                      {formatReportText(
                                        row["Documento interno"]
                                      )}
                                    </button>
                                  </TableCell>
                                </TableRow>
                              );
                            })
                          ) : (
                            <TableRow>
                              <TableCell
                                colSpan={8}
                                className="py-10 text-center text-muted-foreground"
                              >
                                No hay facturas con los filtros seleccionados.
                              </TableCell>
                            </TableRow>
                          )}
                        </TableBody>
                      </Table>
                    </div>
                    <DataPagination
                      page={currentInvoiceReportPage}
                      pageSize={INVOICE_REPORT_PAGE_SIZE}
                      total={invoiceReportTotal}
                      totalPages={invoiceReportTotalPages}
                      onPageChange={setInvoiceReportPage}
                    />
                  </div>
                )}
              </CardContent>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </Card>

      <Card>
        <Accordion type="single" collapsible>
          <AccordionItem value="payment-batches" className="border-b-0">
            <AccordionTrigger className="px-6 py-5 hover:no-underline">
              <span className="flex min-w-0 flex-1 flex-col items-start gap-1 text-left">
                <span className="flex items-center gap-3 text-lg font-semibold">
                  <span className="h-5 w-1 rounded-full bg-primary" />
                  Lotes de pago
                  {batchesQuery.isFetching ? (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  ) : (
                    <Badge variant="secondary">
                      {visibleBatches.length.toLocaleString("es-HN")}
                    </Badge>
                  )}
                </span>
                <span className="pl-4 text-sm font-normal text-muted-foreground">
                  Consulta y gestiona los lotes de pago procesados en el
                  sistema.
                </span>
              </span>
            </AccordionTrigger>
            <AccordionContent className="pb-0">
              <CardContent className="space-y-4 border-t pt-6">
                <div className="grid items-end gap-3 md:grid-cols-2 xl:grid-cols-[minmax(18rem,1fr)_15rem_11rem_11rem_auto_auto_auto]">
                  <div className="space-y-2">
                    <Label htmlFor="treasury-search">Buscar</Label>
                    <div className="relative">
                      <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="treasury-search"
                        className="pl-9"
                        placeholder="Buscar lote o proyecto"
                        value={search}
                        onChange={event => {
                          setSearch(event.target.value);
                          setBatchPage(1);
                        }}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Estado</Label>
                    <Select
                      value={statusFilter}
                      onValueChange={value => {
                        setStatusFilter(value);
                        setBatchPage(1);
                      }}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="todos">Todos los estados</SelectItem>
                        {TREASURY_BATCH_STATUS_CODES.filter(
                          status =>
                            approvalsEnabled ||
                            ![
                              "enviado_depuracion",
                              "pendiente_aprobacion",
                            ].includes(status)
                        ).map(status => (
                          <SelectItem key={status} value={status}>
                            {status === "aprobado" && !approvalsEnabled
                              ? "Listo para banco"
                              : TREASURY_BATCH_STATUS_LABELS[status]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="treasury-date-from">Desde</Label>
                    <Input
                      id="treasury-date-from"
                      type="date"
                      value={dateFrom}
                      max={dateTo || undefined}
                      onChange={event => {
                        setDateFrom(event.target.value);
                        setBatchPage(1);
                      }}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="treasury-date-to">Hasta</Label>
                    <Input
                      id="treasury-date-to"
                      type="date"
                      value={dateTo}
                      min={dateFrom || undefined}
                      onChange={event => {
                        setDateTo(event.target.value);
                        setBatchPage(1);
                      }}
                    />
                  </div>
                  <Button
                    variant="outline"
                    className="hidden"
                    onClick={() => void exportFilteredBatches()}
                    disabled={
                      exporting ||
                      batchesQuery.isFetching ||
                      visibleBatches.length === 0
                    }
                  >
                    {exporting ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <FileSpreadsheet className="mr-2 h-4 w-4" />
                    )}
                    Exportar Excel
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => void exportPaymentsReport()}
                    disabled={
                      exportingPaymentsReport ||
                      batchesQuery.isFetching ||
                      visibleBatches.length === 0
                    }
                    title="Exportar Pagos efectuados con las hojas Lotes de pago y Payments"
                  >
                    {exportingPaymentsReport ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <FileSpreadsheet className="mr-2 h-4 w-4" />
                    )}
                    Pagos efectuados
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => void batchesQuery.refetch()}
                    title="Actualizar"
                  >
                    <RefreshCcw className="h-4 w-4" />
                  </Button>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
                  <span>
                    {visibleBatches.length}{" "}
                    {visibleBatches.length === 1
                      ? "lote encontrado"
                      : "lotes encontrados"}
                  </span>
                  {(dateFrom || dateTo) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setDateFrom("");
                        setDateTo("");
                        setBatchPage(1);
                      }}
                    >
                      Limpiar rango de fechas
                    </Button>
                  )}
                </div>

                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {canConsolidate && (
                          <TableHead className="w-10">
                            <Checkbox
                              checked={
                                allVisibleConsolidatableBatchesSelected
                                  ? true
                                  : someVisibleConsolidatableBatchesSelected
                                    ? "indeterminate"
                                    : false
                              }
                              disabled={
                                consolidateMutation.isPending ||
                                paginatedConsolidatableBatches.length === 0
                              }
                              onCheckedChange={
                                toggleVisibleConsolidatableBatches
                              }
                              aria-label="Seleccionar todos los lotes disponibles para consolidar"
                              title="Seleccionar lotes disponibles para consolidar"
                            />
                          </TableHead>
                        )}
                        <TableHead>Lote</TableHead>
                        <TableHead>Tipo</TableHead>
                        <TableHead>Proyecto</TableHead>
                        <TableHead>Estado</TableHead>
                        <TableHead>Fecha de registro de pago</TableHead>
                        <TableHead>Proveedores</TableHead>
                        <TableHead>Solicitado</TableHead>
                        <TableHead>Pagado</TableHead>
                        <TableHead />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {batchesQuery.isLoading ? (
                        <TableRow>
                          <TableCell
                            colSpan={9 + (canConsolidate ? 1 : 0)}
                            className="py-12 text-center"
                          >
                            <Loader2 className="mx-auto h-6 w-6 animate-spin" />
                          </TableCell>
                        </TableRow>
                      ) : visibleBatches.length ? (
                        paginatedBatches.map((row: any) => (
                          <TableRow key={row.batch.id}>
                            {canConsolidate && (
                              <TableCell>
                                <Checkbox
                                  checked={selectedConsolidationBatchIds.has(
                                    row.batch.id
                                  )}
                                  disabled={
                                    consolidateMutation.isPending ||
                                    !(
                                      approvalsEnabled
                                        ? [
                                            "enviado_depuracion",
                                            "pendiente_aprobacion",
                                          ]
                                        : ["aprobado"]
                                    ).includes(row.batch.status)
                                  }
                                  onCheckedChange={checked =>
                                    setSelectedConsolidationBatchIds(
                                      current => {
                                        const next = new Set(current);
                                        if (checked === true)
                                          next.add(row.batch.id);
                                        else next.delete(row.batch.id);
                                        return next;
                                      }
                                    )
                                  }
                                  aria-label={`Seleccionar lote ${row.batch.batchNumber}`}
                                />
                              </TableCell>
                            )}
                            <TableCell className="font-medium">
                              <button
                                type="button"
                                className="rounded-sm text-left text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                                onClick={() => setSelectedBatchId(row.batch.id)}
                                aria-label={`Abrir lote ${row.batch.batchNumber}`}
                              >
                                {row.batch.batchNumber}
                              </button>
                              {row.sourceBatchNumbers?.length > 0 && (
                                <div className="text-xs font-normal text-muted-foreground">
                                  Consolidado de {row.sourceBatchNumbers.length}{" "}
                                  lotes
                                </div>
                              )}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline">
                                {
                                  TREASURY_PAYMENT_KIND_LABELS[
                                    (row.batch.paymentKind ??
                                      "invoice") as keyof typeof TREASURY_PAYMENT_KIND_LABELS
                                  ]
                                }
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <div>{treasuryProjectSummary(row).code}</div>
                              <div className="max-w-64 truncate text-xs text-muted-foreground">
                                {treasuryProjectSummary(row).name}
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge variant={statusVariant(row.batch.status)}>
                                {getTreasuryBatchStatusLabel(
                                  row.batch.status as TreasuryBatchStatus,
                                  row.batch.approvalBypassed === true
                                )}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              {formatDate(row.paymentRegistrationDate)}
                            </TableCell>
                            <TableCell>{row.supplierCount}</TableCell>
                            <TableCell>
                              {formatMoney(
                                row.requestedTotal,
                                row.batch.currency
                              )}
                            </TableCell>
                            <TableCell>
                              {formatMoney(row.paidTotal, row.batch.currency)}
                            </TableCell>
                            <TableCell>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setSelectedBatchId(row.batch.id)}
                              >
                                <Eye className="mr-2 h-4 w-4" /> Abrir
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))
                      ) : (
                        <TableRow>
                          <TableCell
                            colSpan={9 + (canConsolidate ? 1 : 0)}
                            className="py-12 text-center text-muted-foreground"
                          >
                            No hay lotes con estos filtros.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                  {!batchesQuery.isLoading && (
                    <DataPagination
                      page={currentBatchPage}
                      pageSize={TREASURY_BATCH_PAGE_SIZE}
                      total={visibleBatches.length}
                      totalPages={batchTotalPages}
                      onPageChange={setBatchPage}
                    />
                  )}
                </div>
                {canConsolidate && (
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-muted/20 p-4">
                    <div className="text-sm text-muted-foreground">
                      <span className="font-medium text-foreground">
                        {selectedConsolidationBatchIds.size}
                      </span>{" "}
                      {selectedConsolidationBatchIds.size === 1
                        ? "lote seleccionado"
                        : "lotes seleccionados"}
                    </div>
                    <Button
                      onClick={consolidateSelectedBatches}
                      disabled={
                        consolidateMutation.isPending ||
                        selectedConsolidationBatchIds.size === 0 ||
                        singleSelectedBatchAlreadyPendingApproval ||
                        needsMoreBatchesWithoutApproval
                      }
                    >
                      {consolidateMutation.isPending ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <CheckCircle2 className="mr-2 h-4 w-4" />
                      )}
                      {singleSelectedBatchAlreadyPendingApproval
                        ? "Ya enviado a aprobación"
                        : needsMoreBatchesWithoutApproval
                          ? "Seleccione al menos 2 lotes"
                          : approvalsEnabled
                            ? selectedConsolidationBatchIds.size === 1
                              ? "Enviar a aprobación"
                              : "Consolidar y enviar a aprobación"
                            : "Consolidar y dejar listo para banco"}
                    </Button>
                  </div>
                )}
              </CardContent>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </Card>

      {formKind === "purchase_order_advance" ? (
        <AdvanceBatchFormDialog
          open={formOpen}
          onOpenChange={setFormOpen}
          existing={editingDetail}
          initialAdvance={initialAdvance}
          onSaved={id => setSelectedBatchId(id)}
        />
      ) : formKind === "quality_retention_release" ? (
        <QualityReleaseBatchFormDialog
          open={formOpen}
          onOpenChange={setFormOpen}
          existing={editingDetail}
          onSaved={id => setSelectedBatchId(id)}
        />
      ) : (
        <BatchFormDialog
          open={formOpen}
          onOpenChange={setFormOpen}
          existing={editingDetail}
          onSaved={id => setSelectedBatchId(id)}
        />
      )}
      <BatchDetailDialog
        batchId={selectedBatchId}
        onClose={() => {
          setSelectedBatchId(null);
          if (getRequestedTreasuryBatchId(urlSearch)) {
            setLocation("/tesoreria");
          }
        }}
        onEdit={detail => {
          setEditingDetail(detail);
          setInitialAdvance(undefined);
          setFormKind(detail.batch.paymentKind ?? "invoice");
          setSelectedBatchId(null);
          if (getRequestedTreasuryBatchId(urlSearch)) {
            setLocation("/tesoreria");
          }
          setFormOpen(true);
        }}
      />
      <PurchaseOrderAdvanceDialog
        open={advanceRequestOpen}
        onOpenChange={setAdvanceRequestOpen}
        onSaved={advance => {
          setInitialAdvance(advance);
          setEditingDetail(undefined);
          setFormKind("purchase_order_advance");
          setFormOpen(true);
        }}
      />
      <Dialog
        open={Boolean(releaseDecision)}
        onOpenChange={open => !open && setReleaseDecision(undefined)}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {releaseDecisionApproved
                ? "Aprobar liberación"
                : "Rechazar liberación"}
            </DialogTitle>
            <DialogDescription>
              {releaseDecisionApproved
                ? "Puede autorizar un monto igual o menor al solicitado; la diferencia volverá al saldo disponible."
                : "Indique el motivo del rechazo."}
            </DialogDescription>
          </DialogHeader>
          {releaseDecisionApproved ? (
            <div className="space-y-2">
              <Label>Monto aprobado</Label>
              <Input
                type="number"
                min="0.01"
                step="0.01"
                max={Number(releaseDecision?.release?.requestedAmount ?? 0)}
                value={releaseDecisionAmount}
                onChange={event => setReleaseDecisionAmount(event.target.value)}
              />
            </div>
          ) : null}
          <div className="space-y-2">
            <Label>Comentario *</Label>
            <Textarea
              rows={4}
              maxLength={4000}
              value={releaseDecisionComment}
              onChange={event => setReleaseDecisionComment(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setReleaseDecision(undefined)}
            >
              Cancelar
            </Button>
            <Button
              variant={releaseDecisionApproved ? "default" : "destructive"}
              disabled={
                decideQualityReleaseMutation.isPending ||
                releaseDecisionComment.trim().length < 5 ||
                (releaseDecisionApproved && Number(releaseDecisionAmount) <= 0)
              }
              onClick={() =>
                decideQualityReleaseMutation.mutate({
                  releaseId: releaseDecision.release.id,
                  approved: releaseDecisionApproved,
                  approvedAmount: releaseDecisionApproved
                    ? Number(releaseDecisionAmount)
                    : undefined,
                  comment: releaseDecisionComment,
                })
              }
            >
              {decideQualityReleaseMutation.isPending
                ? "Guardando..."
                : releaseDecisionApproved
                  ? "Aprobar"
                  : "Rechazar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
