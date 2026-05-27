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
  Search,
  Save,
  Send,
  Trash2,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { formatPurchaseOrderCurrency } from "@shared/purchase-orders";
import {
  CAI_FORMAT_EXAMPLE,
  EMISSION_DEADLINE_ISSUE_MESSAGE,
  INVOICE_NUMBER_FORMAT_EXAMPLE,
  formatCaiInput,
  formatInvoiceNumberInput,
  hasEmissionDeadlineIssue,
  isValidCai,
  isValidInvoiceNumber,
} from "@shared/invoices";

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

function dateInputValue(value: string | Date | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function formatDateLabel(value: string | Date | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleDateString("es-HN");
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

function getRetentionAmount(draft: RetentionDraft) {
  return (toNumber(draft.baseAmount) * toNumber(draft.percentage)) / 100;
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
      return `El CAI debe tener el formato ${CAI_FORMAT_EXAMPLE}`;
    }
    if (path.includes("invoiceNumber")) {
      return `El número documento debe tener el formato ${INVOICE_NUMBER_FORMAT_EXAMPLE}`;
    }

    return typeof issue?.message === "string" ? issue.message : message;
  } catch {
    return message;
  }
}

export default function Facturas() {
  const utils = trpc.useUtils();
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
  const [invoiceDraft, setInvoiceDraft] = useState({
    isFiscalDocument: true,
    cai: "",
    invoiceNumber: "",
    documentDate: "",
    documentDueDate: "",
    postingDate: "",
    receiptDate: "",
    emissionDeadline: "",
    notes: "",
  });
  const [retentionDrafts, setRetentionDrafts] = useState<RetentionDraft[]>([]);
  const [attachmentState, setAttachmentState] = useState({
    count: 0,
    isLoading: false,
  });
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

  const { data: invoices, isLoading } = trpc.invoices.list.useQuery(listFilters);
  const { data: detail, isLoading: detailLoading } =
    trpc.invoices.getById.useQuery(
      { id: selectedId ?? 0 },
      { enabled: selectedId !== null }
    );
  const { data: activeRetentionOptions } =
    trpc.retentions.activeOptions.useQuery(undefined, {
      enabled: selectedId !== null,
    });
  const updateMutation = trpc.invoices.update.useMutation({
    onSuccess: () => {
      toast.success("Factura actualizada");
      void utils.invoices.list.invalidate();
      if (selectedId) void utils.invoices.getById.invalidate({ id: selectedId });
    },
    onError: error => toast.error(getFriendlyMutationError(error.message)),
  });
  const replaceRetentionsMutation = trpc.invoices.replaceRetentions.useMutation({
    onSuccess: () => {
      toast.success("Retenciones actualizadas");
      void utils.invoices.list.invalidate();
      if (selectedId) void utils.invoices.getById.invalidate({ id: selectedId });
    },
    onError: error => toast.error(getFriendlyMutationError(error.message)),
  });
  const reviewMutation = trpc.invoices.review.useMutation({
    onSuccess: () => {
      toast.success("Factura enviada a revisión");
      void utils.invoices.list.invalidate();
      if (selectedId) void utils.invoices.getById.invalidate({ id: selectedId });
    },
    onError: error => toast.error(getFriendlyMutationError(error.message)),
  });
  const accountMutation = trpc.invoices.account.useMutation({
    onSuccess: () => {
      toast.success("Factura contabilizada");
      setAccountingComment("");
      void utils.invoices.list.invalidate();
      if (selectedId) void utils.invoices.getById.invalidate({ id: selectedId });
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
      if (selectedId) void utils.invoices.getById.invalidate({ id: selectedId });
      setSelectedId(null);
    },
    onError: error => toast.error(getFriendlyMutationError(error.message)),
  });
  useEffect(() => {
    if (!detail?.invoice) return;
    setInvoiceDraft({
      isFiscalDocument: detail.invoice.isFiscalDocument ?? true,
      cai: detail.invoice.cai ?? "",
      invoiceNumber: detail.invoice.invoiceNumber ?? "",
      documentDate: dateInputValue(detail.invoice.documentDate),
      documentDueDate: dateInputValue(detail.invoice.documentDueDate),
      postingDate: dateInputValue(detail.invoice.postingDate),
      receiptDate: dateInputValue(detail.invoice.receiptDate),
      emissionDeadline: dateInputValue(detail.invoice.emissionDeadline),
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
  }, [detail?.invoice?.id]);

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
          invoice.cai,
          row.purchaseOrder?.orderNumber,
          row.receipt?.receiptNumber,
          row.supplier?.name,
          row.supplier?.supplierCode,
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
          header: "Origen OC",
          value: (row: any) => row.purchaseOrder?.orderNumber || "OC",
        },
        {
          header: "Recepción",
          value: (row: any) => row.receipt?.receiptNumber || "Recepción",
        },
        {
          header: "Fecha vencimiento",
          value: (row: any) => formatDateLabel(row.invoice.documentDueDate),
        },
        {
          header: "Fecha límite emisión",
          value: (row: any) => formatDateLabel(row.invoice.emissionDeadline),
        },
        {
          header: "Total",
          value: (row: any) => formatPurchaseOrderCurrency(row.invoice.total),
        },
        {
          header: "Retenciones",
          value: (row: any) =>
            formatPurchaseOrderCurrency(row.invoice.retentionTotal),
        },
        {
          header: "Neto",
          value: (row: any) =>
            formatPurchaseOrderCurrency(row.invoice.netPayable),
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
    ((activeRetentionOptions ?? []) as RetentionOption[]).forEach((option) => {
      optionMap.set(option.id, option);
    });

    retentionDrafts.forEach((draft) => {
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
  const canEditSelectedInvoice = canEditInvoices && isDraft;
  const canEditRetentions =
    canEditSelectedInvoice && canRetainSelectedInvoice;
  const canManageInvoiceAttachments = canReviewInvoices && isDraft;
  const canReviewSelectedInvoice = canReviewInvoices && isDraft;
  const canAccountSelectedInvoice = canAccountInvoices && isReviewed;
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

  const handleSaveInvoice = () => {
    if (!selectedId) return;
    if (invoiceDraft.isFiscalDocument && !invoiceDraft.cai.trim()) {
      toast.error("Ingresa el CAI del documento");
      return;
    }
    if (invoiceDraft.isFiscalDocument && !isValidCai(invoiceDraft.cai)) {
      toast.error(`El CAI debe tener el formato ${CAI_FORMAT_EXAMPLE}`);
      return;
    }
    if (invoiceDraft.isFiscalDocument && !invoiceDraft.invoiceNumber.trim()) {
      toast.error("Ingresa el número documento");
      return;
    }
    if (
      invoiceDraft.isFiscalDocument &&
      !isValidInvoiceNumber(invoiceDraft.invoiceNumber)
    ) {
      toast.error(
        `El número documento debe tener el formato ${INVOICE_NUMBER_FORMAT_EXAMPLE}`
      );
      return;
    }
    if (invoiceDraft.isFiscalDocument && !invoiceDraft.documentDueDate) {
      toast.error("Selecciona la fecha de vencimiento del documento");
      return;
    }
    updateMutation.mutate({
      id: selectedId,
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
      documentDate: invoiceDraft.documentDate,
      documentDueDate: invoiceDraft.documentDueDate,
      postingDate: invoiceDraft.postingDate,
      receiptDate: invoiceDraft.receiptDate,
      emissionDeadline: invoiceDraft.emissionDeadline,
      notes: invoiceDraft.notes,
    });
  };

  const getLineRetentionDrafts = (itemId: number) =>
    retentionDrafts.filter(retention => retention.invoiceItemId === itemId);

  const getAvailableLineRetentionOptions = (itemId: number) => {
    const selectedRetentionIds = new Set(
      getLineRetentionDrafts(itemId).map(retention => retention.retentionCatalogId)
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

    setRetentionDrafts(current => {
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
          baseAmount: String(toNumber(item.subtotal).toFixed(2)),
        },
      ]);
    });
  };

  const handleSaveRetentions = () => {
    if (!selectedId) return;
    if (retentionDrafts.length > 0 && !canRetainSelectedInvoice) {
      toast.error(retentionDisabledReason || "La factura no permite retenciones");
      return;
    }
    const lineRetentionCounts = new Map<number, number>();
    const lineRetentionCatalogs = new Set<string>();
    for (let index = 0; index < retentionDrafts.length; index += 1) {
      const retention = retentionDrafts[index];
      const lineItem = retention.invoiceItemId
        ? detail?.items?.find((item: any) => item.id === retention.invoiceItemId)
        : null;
      const allowedBase = lineItem ? toNumber(lineItem.subtotal) : withholdingBase;
      const retentionLabel =
        lineItem?.itemName
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
    replaceRetentionsMutation.mutate({
      id: selectedId,
      retentions: retentionDrafts.map(retention => ({
        invoiceItemId: retention.invoiceItemId ?? undefined,
        retentionCatalogId: Number(retention.retentionCatalogId),
        baseAmount: String(toNumber(retention.baseAmount)),
      })),
    });
  };

  const handleReviewInvoice = () => {
    if (!selectedId) return;
    if (attachmentState.count === 0) {
      toast.error("Adjunte al menos un archivo antes de enviar a revisión");
      return;
    }
    reviewMutation.mutate({ id: selectedId });
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
            placeholder="Buscar por factura, OC, recepción, proveedor o proyecto..."
            className="h-10 pl-9"
          />
        </div>
        <Select
          value={statusFilter}
          onValueChange={setStatusFilter}
        >
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
                        {row.supplier
                          ? `${row.supplier.supplierCode} — ${row.supplier.name}`
                          : "Proveedor pendiente"}
                      </td>
                      <td className="p-3">
                        <div>{row.purchaseOrder?.orderNumber || "OC"}</div>
                        <div className="text-xs text-muted-foreground">
                          {row.receipt?.receiptNumber || "Recepción"}
                        </div>
                      </td>
                      <td className="p-3">
                        <div>{formatDateLabel(row.invoice.documentDueDate)}</div>
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
        <DialogContent className="scrollbar-none max-h-[calc(100vh-0.75rem)] w-[calc(100vw-0.5rem)] max-w-[calc(100vw-0.5rem)] overflow-x-hidden overflow-y-auto rounded-lg p-0 sm:max-h-[calc(100vh-1.5rem)] sm:w-[calc(100vw-2rem)] sm:max-w-[1580px]">
          <DialogHeader className="min-w-0 border-b border-border/70 px-4 py-4 pr-12 sm:px-6">
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
                <div className="flex flex-wrap items-center gap-2">
                  {canReviewSelectedInvoice ? (
                    <Button
                      onClick={handleReviewInvoice}
                      disabled={
                        reviewMutation.isPending ||
                        attachmentState.isLoading ||
                        attachmentState.count === 0
                      }
                    >
                      <Send className="mr-2 h-4 w-4" />
                      {reviewMutation.isPending
                        ? "Enviando..."
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
                          setInvoiceDraft(current => ({
                            ...current,
                            isFiscalDocument: checked === true,
                            cai: checked === true
                              ? formatCaiInput(current.cai)
                              : current.cai,
                            invoiceNumber: checked === true
                              ? formatInvoiceNumberInput(current.invoiceNumber)
                              : current.invoiceNumber,
                          }))
                        }
                      />
                      <Label htmlFor="invoice-fiscal-document">
                        Documento fiscal
                      </Label>
                    </div>
                    <div className="grid min-w-0 gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
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
                            setInvoiceDraft(current => ({
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
                        <Label>Número documento</Label>
                        <Input
                          value={invoiceDraft.invoiceNumber}
                          disabled={!canEditSelectedInvoice}
                          onChange={event =>
                            setInvoiceDraft(current => ({
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
                        <Label>Fecha documento</Label>
                        <Input
                          type="date"
                          value={invoiceDraft.documentDate}
                          disabled={!canEditSelectedInvoice}
                          onChange={event =>
                            setInvoiceDraft(current => ({
                              ...current,
                              documentDate: event.target.value,
                            }))
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Fecha vencimiento</Label>
                        <Input
                          type="date"
                          value={invoiceDraft.documentDueDate}
                          disabled={!canEditSelectedInvoice}
                          onChange={event =>
                            setInvoiceDraft(current => ({
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
                            setInvoiceDraft(current => ({
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
                            setInvoiceDraft(current => ({
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
                            setInvoiceDraft(current => ({
                              ...current,
                              emissionDeadline: event.target.value,
                            }))
                          }
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>Notas</Label>
                      <Textarea
                        value={invoiceDraft.notes}
                        disabled={!canEditSelectedInvoice}
                        onChange={event =>
                          setInvoiceDraft(current => ({
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
                        disabled={updateMutation.isPending}
                      >
                        <Save className="mr-2 h-4 w-4" />
                        Guardar factura
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
                          const lineRetentions = getLineRetentionDrafts(item.id);
                          const availableRetentionOptions =
                            getAvailableLineRetentionOptions(item.id);
                          const canAddLineRetention =
                            canEditRetentions &&
                            lineRetentions.length < 2 &&
                            availableRetentionOptions.length > 0;

                          return (
                            <tr
                              key={item.id}
                              className="border-b border-border last:border-0"
                            >
                              <td className="p-3 font-medium">
                                {item.itemName}
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
                                            handleAddLineRetention(item, value)
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
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex flex-wrap justify-end gap-5 border-t border-border/70 px-4 py-3 text-sm font-semibold">
                    <span>
                      Subtotal:{" "}
                      {formatPurchaseOrderCurrency(detail.invoice.subtotal)}
                    </span>
                    <span>
                      ISV: {formatPurchaseOrderCurrency(detail.invoice.taxAmount)}
                    </span>
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
                                          item.id ===
                                          retention.invoiceItemId
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
                                        setRetentionDrafts(current =>
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
                        disabled={
                          replaceRetentionsMutation.isPending ||
                          (retentionDrafts.length > 0 &&
                            !canRetainSelectedInvoice)
                        }
                      >
                        <Save className="mr-2 h-4 w-4" />
                        Guardar retenciones
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
                    <div className="flex justify-between gap-3 border-b border-border pb-2 text-sm">
                      <span className="text-muted-foreground">Total factura</span>
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
                  <h3 className="font-semibold">Detalle de retenciones</h3>
                  {retentionDrafts.length === 0 ? (
                    <p className="mt-3 text-sm text-muted-foreground">
                      Sin retenciones aplicadas.
                    </p>
                  ) : (
                    <div className="mt-3 space-y-2">
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
                        <span>{formatPurchaseOrderCurrency(retentionTotal)}</span>
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
                    {getInvoiceHistoryRows(detail.invoice).map((entry, index) => (
                      <div key={`${entry.label}-${index}`} className="flex gap-3">
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
                    ))}
                  </div>
                </section>
              </aside>
            </div>
          )}
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
