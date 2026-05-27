import { trpc } from "@/lib/trpc";
import { DocumentAttachmentsPanel } from "@/components/DocumentAttachmentsPanel";
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
  Eye,
  AlertTriangle,
  FileText,
  ImageIcon,
  Loader2,
  Plus,
  Printer,
  RotateCcw,
  Search,
  ShieldX,
  Trash2,
  Upload,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import { getPrintLogoMarkup, printWindowWhenReady } from "@/lib/print-logo";
import {
  calculatePurchaseOrderLineAmounts,
  getPurchaseOrderContractSummary,
} from "@shared/purchase-orders";
import {
  CAI_FORMAT_EXAMPLE,
  INVOICE_NUMBER_FORMAT_EXAMPLE,
  formatCaiInput,
  EMISSION_DEADLINE_ISSUE_MESSAGE,
  getDocumentTypeLabelFromNumber,
  formatInvoiceNumberInput,
  hasEmissionDeadlineIssue,
  isValidCai,
  isValidInvoiceNumber,
} from "@shared/invoices";

const STATUS_LABELS: Record<string, string> = {
  pendiente: "Pendiente",
  parcial: "Parcial",
  completa: "Completa",
  cierre_incompleto: "Cierre incompleto",
};

const STATUS_COLORS: Record<string, string> = {
  pendiente: "border-amber-300 bg-amber-50 text-amber-700",
  parcial: "border-cyan-300 bg-cyan-50 text-cyan-700",
  completa: "border-emerald-300 bg-emerald-50 text-emerald-700",
  cierre_incompleto: "border-yellow-300 bg-yellow-50 text-yellow-700",
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

function todayDateValue() {
  return new Date().toISOString().slice(0, 10);
}

function formatDateLabel(value: string | Date | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("es-HN");
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

function formatProjectReference(project: any, fallback: string) {
  return project ? `${project.code} — ${project.name}` : fallback;
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
    return "Bodega Central";
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

type PendingReceiptAttachment = PreparedDocumentAttachment & {
  id: string;
};

export default function Recepciones() {
  const utils = trpc.useUtils();
  const { user } = useAuth();
  const receiptAttachmentInputRef = useRef<HTMLInputElement>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [viewReceiptId, setViewReceiptId] = useState<number | null>(null);
  const [sourceType, setSourceType] = useState<"purchase_order" | "transfer">(
    "purchase_order"
  );
  const [sourceId, setSourceId] = useState("");
  const [notes, setNotes] = useState("");
  const [isFiscalDocument, setIsFiscalDocument] = useState(true);
  const [cai, setCai] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [documentDate, setDocumentDate] = useState("");
  const [postingDate, setPostingDate] = useState(todayDateValue());
  const [receiptDate, setReceiptDate] = useState(todayDateValue());
  const [emissionDeadline, setEmissionDeadline] = useState("");
  const [receivedMap, setReceivedMap] = useState<Record<number, string>>({});
  const [priceMap, setPriceMap] = useState<Record<number, string>>({});
  const [closeReceiptLineItem, setCloseReceiptLineItem] = useState<any | null>(
    null
  );
  const [closeTransferLineItem, setCloseTransferLineItem] = useState<any | null>(
    null
  );
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

  const { data: receipts, isLoading } = trpc.receipts.list.useQuery();
  const { data: receiptDetail, isLoading: receiptDetailLoading } =
    trpc.receipts.getById.useQuery(
      { id: viewReceiptId ?? 0 },
      { enabled: viewReceiptId !== null }
    );
  const { data: purchaseOrders } = trpc.purchaseOrders.list.useQuery();
  const { data: transfers } = trpc.transfers.list.useQuery({
    receivableOnly: true,
  });
  const { data: purchaseOrderDetail, isLoading: purchaseOrderDetailLoading } =
    trpc.purchaseOrders.getById.useQuery(
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
        enabled:
          dialogOpen &&
          sourceType === "transfer" &&
          Boolean(sourceId),
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
  } =
    trpc.purchaseOrders.getById.useQuery(
      { id: receiptDetail?.receipt.sourceId ?? 0 },
      {
        enabled:
          viewReceiptId !== null &&
          receiptDetail?.receipt.sourceType === "purchase_order" &&
          Boolean(receiptDetail?.receipt.sourceId),
      }
    );
  const { data: receiptTransferDetail, isLoading: receiptTransferDetailLoading } =
    trpc.transfers.getById.useQuery(
      { id: receiptDetail?.receipt.sourceId ?? 0 },
      {
        enabled:
          viewReceiptId !== null &&
          receiptDetail?.receipt.sourceType === "transfer" &&
          Boolean(receiptDetail?.receipt.sourceId),
      }
    );

  const resetForm = () => {
    setSourceType("purchase_order");
    setSourceId("");
    setNotes("");
    setIsFiscalDocument(true);
    setCai("");
    setInvoiceNumber("");
    setDocumentDate("");
    setPostingDate(todayDateValue());
    setReceiptDate(todayDateValue());
    setEmissionDeadline("");
    setReceivedMap({});
    setPriceMap({});
    setTransferClosureDrafts({});
    setCloseTransferLineItem(null);
    setTransferCloseReason(TRANSFER_CLOSE_REASONS[0].value);
    setTransferCloseNote("");
    setPendingReceiptAttachments([]);
    setPreparingReceiptAttachment(false);
  };

  const sourceItems = useMemo(
    () =>
      (activeSourceDetail?.items ?? []).filter(
        (item: any) =>
          isContractPurchaseOrder ? !item.receiptClosed : getPendingQuantity(item) > 0
      ),
    [activeSourceDetail, isContractPurchaseOrder]
  );
  const getReceivableQuantity = (item: any) =>
    isContractPurchaseOrder
      ? Math.max(Number(item.quantity ?? item.quantityExpected ?? 0), 0)
      : getPendingQuantity(item);

  useEffect(() => {
    if (!sourceItems.length) {
      setReceivedMap({});
      setPriceMap({});
      return;
    }

    const nextMap: Record<number, string> = {};
    const nextPriceMap: Record<number, string> = {};
    for (const item of sourceItems) {
      nextMap[item.id] = String(getReceivableQuantity(item));
      nextPriceMap[item.id] = String((item as any).unitPrice ?? "0.00");
    }
    setReceivedMap(nextMap);
    setPriceMap(nextPriceMap);
  }, [sourceItems]);

  const uploadPendingReceiptAttachmentMutation =
    trpc.attachments.upload.useMutation();

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
          toast.success(
            attachmentsToUpload.length === 1
              ? "Adjunto subido a la recepción"
              : `${attachmentsToUpload.length} adjuntos subidos a la recepción`
          );
          void utils.attachments.getByEntity.invalidate({
            entityType: "receipt",
            entityId: result.id,
          });
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
        RECEIVABLE_PURCHASE_ORDER_STATUSES.has(row.purchaseOrder.status)
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

  const sourceProjectId =
    sourceType === "purchase_order"
      ? purchaseOrderDetail?.purchaseOrder.projectId
      : transferDetail?.transferRequest?.destinationType === "proyecto"
        ? transferDetail.transferRequest.destinationProjectId
        : undefined;

  const canCloseTransferLines =
    sourceType === "transfer" &&
    ((user as any)?.buildreqRole === "administracion_central" ||
      ((user as any)?.buildreqRole === "administrador_proyecto" &&
        sourceProjectId !== undefined &&
        (user as any)?.assignedProjectId === sourceProjectId));
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

  const sourceNeededByLabel =
    sourceType === "purchase_order"
      ? formatDateLabel(purchaseOrderDetail?.purchaseOrder.neededBy)
      : transferDetail?.transferRequest?.neededBy
        ? formatDateLabel(transferDetail.transferRequest.neededBy)
        : "—";

  const totals = useMemo(
    () =>
      sourceItems.reduce(
        (acc, item: any) => {
          acc.pending += getReceivableQuantity(item);
          acc.receiving += Number(receivedMap[item.id] ?? 0) || 0;
          return acc;
        },
        { pending: 0, receiving: 0 }
      ),
    [receivedMap, sourceItems]
  );
  const currentDocumentHasEmissionDeadlineIssue = hasEmissionDeadlineIssue({
    isFiscalDocument: sourceType === "purchase_order" && isFiscalDocument,
    documentDate,
    emissionDeadline,
  });

  const getTransferCloseQuantity = (item: any) => {
    const requestedQuantity = Math.max(Number(receivedMap[item.id] ?? 0) || 0, 0);
    return Math.max(getPendingQuantity(item) - requestedQuantity, 0);
  };

  const handleRegisterReceipt = () => {
    if (!sourceId || !sourceProjectId) {
      toast.error("Selecciona un documento origen válido");
      return;
    }
    if (contractReceiptBlockReason) {
      toast.error(contractReceiptBlockReason);
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
      if (!documentDate) {
        toast.error("Selecciona la fecha del documento");
        return;
      }
      if (!emissionDeadline) {
        toast.error("Selecciona la fecha límite de emisión");
        return;
      }
    }

    const receiptItems = sourceItems.map((item: any) => {
      const closureDraft = transferClosureDrafts[item.id];
      const closeQuantity =
        sourceType === "transfer" && closureDraft
          ? getTransferCloseQuantity(item)
          : 0;

      return {
        sourceItemId: item.id,
        itemName: item.itemName,
        quantityExpected: String(getReceivableQuantity(item)),
        quantityReceived: receivedMap[item.id] || "0",
        unit: item.unit || undefined,
        unitPrice:
          sourceType === "purchase_order"
            ? priceMap[item.id] || String(item.unitPrice ?? "0.00")
            : "0.00",
        closeRemaining: closeQuantity > 0,
        closeReason:
          closeQuantity > 0
            ? TRANSFER_CLOSE_REASONS.find(
                reason => reason.value === closureDraft?.reason
              )?.label || closureDraft?.reason
            : undefined,
        closeNote: closeQuantity > 0 ? closureDraft?.note : undefined,
      };
    });

    const hasPositiveReceipt = receiptItems.some(
      item => Number(item.quantityReceived || 0) > 0
    );
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

    const currentPostingDate = todayDateValue();
    setPostingDate(currentPostingDate);

    registerMutation.mutate({
      sourceType,
      sourceId: Number(sourceId),
      projectId: sourceProjectId,
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
      documentDate: documentDate || undefined,
      postingDate: currentPostingDate,
      receiptDate,
      emissionDeadline: emissionDeadline || undefined,
      notes: notes || undefined,
      items: receiptItems,
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
        error instanceof Error ? error.message : "No se pudo preparar el adjunto"
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
      : receiptTransferDetail?.transfer?.transferNumber ||
        "Traslado";

  const receiptSourceSecondaryLabel =
    receiptDetail?.receipt.sourceType === "purchase_order"
      ? receiptPurchaseOrderDetail?.supplier
        ? `${receiptPurchaseOrderDetail.supplier.supplierCode} — ${receiptPurchaseOrderDetail.supplier.name}`
        : "Proveedor pendiente"
      : receiptTransferDetail?.transferRequest
        ? `Origen: ${getTransferOriginLabel(receiptTransferDetail, "Proyecto origen")}`
        : "—";

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

  const handlePrintReceipt = () => {
    if (!receiptDetail) return;

    const receipt = receiptDetail.receipt;
    const isPurchaseOrderReceipt = receipt.sourceType === "purchase_order";
    const sourceItems = isPurchaseOrderReceipt
      ? receiptPurchaseOrderDetail?.items ?? []
      : receiptTransferDetail?.items ?? [];
    const sourceItemsById = new Map(
      sourceItems.map((item: any) => [item.id, item])
    );
    const projectLabel = receiptDetail.project
      ? `${receiptDetail.project.code} ${receiptDetail.project.name}`
      : `Proyecto ${receipt.projectId}`;
    const warehouseLabel =
      (receiptDetail as any).warehouse?.displayName ||
      receiptDetail.project?.name ||
      projectLabel;
    const receivedByLabel = formatUserReference(
      (receiptDetail as any).receivedBy,
      receipt.receivedById
    );
    const requestedByLabel = isPurchaseOrderReceipt
      ? receiptPurchaseOrderDetail?.createdBy?.name || receivedByLabel
      : receivedByLabel;
    const destinationLabel = isPurchaseOrderReceipt
      ? receiptPurchaseOrderDetail?.purchaseRequest?.printDestination?.trim() ||
        receiptDetail.project?.name ||
        projectLabel
      : getTransferDestinationLabel(receiptTransferDetail, "-");
    const sourceWarehouseLabel = isPurchaseOrderReceipt
      ? "N/A"
      : getTransferOriginLabel(receiptTransferDetail, "-");
    const supplierLabel = isPurchaseOrderReceipt
      ? receiptPurchaseOrderDetail?.supplier?.name ||
        receiptDetail.supplier?.name ||
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

    let subtotal = 0;
    let taxTotal = 0;
    let total = 0;
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
          sourceItem?.currentSapItemCode ||
          sourceItem?.sapItemCode ||
          sourceItem?.originalSapItemCode ||
          sourceCode;
        const unitPrice = isPurchaseOrderReceipt
          ? item.unitPrice ?? sourceItem?.unitPrice ?? "0.00"
          : "0.00";
        const amounts = calculatePurchaseOrderLineAmounts({
          quantity: item.quantityReceived,
          unitPrice,
          taxCode: sourceItem?.taxCode,
        });
        subtotal += amounts.subtotal;
        taxTotal += amounts.taxAmount;
        total += amounts.total;

        return `
          <tr>
            <td>${escapeHtml(companyCode || "-")}</td>
            <td>${escapeHtml(item.itemName)}</td>
            <td class="center">${escapeHtml(partNumber || "-")}</td>
            <td class="numeric">${escapeHtml(formatPrintNumber(item.quantityReceived))}</td>
            <td class="center">${escapeHtml(item.unit || "-")}</td>
            <td class="numeric">${escapeHtml(formatPrintMoney(unitPrice))}</td>
            <td class="numeric">${escapeHtml(formatPrintMoney(amounts.subtotal))}</td>
          </tr>
        `;
      })
      .join("");

    const printWindow = window.open("", "_blank", "width=1100,height=780");
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
            @page { size: A4 landscape; margin: 9mm; }
            * { box-sizing: border-box; }
            body {
              background: #fff;
              color: #000;
              font-family: Arial, Helvetica, sans-serif;
              font-size: 10px;
              margin: 0;
            }
            .sheet {
              margin: 0 auto;
              max-width: 279mm;
              padding: 6mm 4mm 8mm;
            }
            .header {
              align-items: start;
              display: grid;
              gap: 18px;
              grid-template-columns: 112px 1fr 120px;
            }
            .logo {
              display: block;
              height: 52px;
              margin-left: 6px;
              object-fit: contain;
              width: 70px;
            }
            .title {
              color: #06344f;
              font-size: 13px;
              font-weight: 800;
              line-height: 1.5;
              text-align: center;
              text-transform: uppercase;
            }
            .company {
              color: #000;
              font-size: 15px;
              margin-bottom: 2px;
            }
            .document-number {
              border: 5px double #222;
              color: #06344f;
              font-size: 14px;
              font-weight: 800;
              margin-top: 1mm;
              padding: 4px 8px;
              text-align: center;
            }
            .meta {
              display: grid;
              gap: 22px;
              grid-template-columns: 1fr 1.08fr;
              margin-top: 12mm;
            }
            .meta-column {
              display: grid;
              gap: 5px;
            }
            .field {
              display: grid;
              gap: 8px;
              grid-template-columns: 118px 1fr;
              min-height: 14px;
            }
            .meta-column.right .field {
              grid-template-columns: 96px 1fr;
            }
            .label {
              font-weight: 800;
            }
            .value {
              font-weight: 700;
            }
            table {
              border-collapse: collapse;
              margin-top: 5mm;
              width: 100%;
            }
            th {
              border-bottom: 2px solid #56a944;
              border-top: 2px solid #56a944;
              font-size: 9px;
              font-weight: 800;
              padding: 4px 5px;
              text-align: left;
            }
            td {
              border-bottom: 1px solid #8ac37c;
              padding: 5px;
              vertical-align: top;
            }
            .center { text-align: center; }
            .numeric {
              font-variant-numeric: tabular-nums;
              text-align: right;
            }
            .summary {
              display: grid;
              grid-template-columns: 1fr 210px;
              margin-top: 0;
            }
            .summary-table {
              border-collapse: collapse;
              grid-column: 2;
              margin-top: 0;
              width: 100%;
            }
            .summary-table td {
              border-bottom: 1px solid #56a944;
              font-weight: 800;
              padding: 4px 5px;
            }
            .signatures {
              display: grid;
              grid-template-columns: 260px;
              justify-content: center;
              margin-top: 18mm;
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
                  <div class="label">Destino:</div>
                  <div class="value">${escapeHtml(destinationLabel)}</div>
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
                  <div class="label">Tipo Documento:</div>
                  <div class="value">${escapeHtml(documentTypeLabel)}</div>
                </div>
                <div class="field">
                  <div class="label">No Documento:</div>
                  <div class="value">${escapeHtml(receipt.invoiceNumber || "-")}</div>
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
                  <th style="width: 13%;">Código Empresa</th>
                  <th>Descripción</th>
                  <th style="width: 15%;" class="center">No. Parte/No. Serie</th>
                  <th style="width: 9%;" class="numeric">Cantidad</th>
                  <th style="width: 10%;" class="center">U Medida</th>
                  <th style="width: 11%;" class="numeric">Valor U</th>
                  <th style="width: 11%;" class="numeric">Valor T</th>
                </tr>
              </thead>
              <tbody>
                ${itemRows || `<tr><td colspan="7">Sin ítems</td></tr>`}
              </tbody>
            </table>

            <section class="summary">
              <table class="summary-table">
                <tbody>
                  <tr>
                    <td>Subtotal</td>
                    <td class="numeric">${escapeHtml(formatPrintMoney(subtotal))}</td>
                  </tr>
                  <tr>
                    <td>ISV 15%</td>
                    <td class="numeric">${escapeHtml(formatPrintMoney(taxTotal))}</td>
                  </tr>
                  <tr>
                    <td>Total</td>
                    <td class="numeric">${escapeHtml(formatPrintMoney(total))}</td>
                  </tr>
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
          row.purchaseOrder?.orderNumber,
          row.supplier?.name,
          row.supplier?.supplierCode,
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1>Recepciones</h1>

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
          <DialogContent className="scrollbar-none max-h-[calc(100vh-0.75rem)] w-[calc(100vw-0.5rem)] max-w-[calc(100vw-0.5rem)] overflow-x-hidden overflow-y-auto rounded-2xl p-4 sm:max-h-[calc(100vh-1.5rem)] sm:w-[calc(100vw-2rem)] sm:max-w-[1480px] sm:p-6 lg:p-7">
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

            <div className="space-y-5">
              <div className="grid gap-3 md:grid-cols-12">
                <div className="space-y-2.5 rounded-2xl border border-border/70 bg-muted/20 p-3.5 sm:p-4 md:col-span-3">
                  <Label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground sm:text-xs">
                    Tipo de origen
                  </Label>
                  <Select
                    value={sourceType}
                    onValueChange={value => {
                      setSourceType(value as "purchase_order" | "transfer");
                      setSourceId("");
                      setReceivedMap({});
                      setPriceMap({});
                      setIsFiscalDocument(true);
                      setCai("");
                      setInvoiceNumber("");
                      setDocumentDate("");
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
                      <SelectItem value="transfer">
                        Traslado
                      </SelectItem>
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
                      setSourceId(value);
                      setReceivedMap({});
                      setPriceMap({});
                      setIsFiscalDocument(true);
                      setCai("");
                      setInvoiceNumber("");
                      setDocumentDate("");
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
                              {row.transferRequest?.requestNumber || "Solicitud"}
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
                      ? "Solo aparecen órdenes emitidas con saldo pendiente por recibir."
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
                <div className="space-y-1.5 rounded-2xl border border-border/70 bg-muted/20 p-3.5 sm:p-4 md:col-span-4">
                  <Label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground sm:text-xs">
                    Referencia del origen
                  </Label>
                  <p className="text-sm font-semibold leading-snug sm:text-base">
                    {sourceSecondaryLabel}
                  </p>
                </div>
                <div className="space-y-1.5 rounded-2xl border border-border/70 bg-muted/20 p-3.5 sm:p-4 md:col-span-3">
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
                      onCheckedChange={checked =>
                        setIsFiscalDocument(checked === true)
                      }
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
                  className={`grid gap-3 md:grid-cols-2 ${
                    sourceType === "purchase_order"
                      ? "xl:grid-cols-[minmax(22rem,2fr)_minmax(12rem,1fr)_repeat(4,minmax(10.5rem,1fr))]"
                      : "xl:grid-cols-2"
                  }`}
                >
                  {sourceType === "purchase_order" ? (
                    <>
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
                        <Label htmlFor="receipt-document-date">
                          Fecha documento
                        </Label>
                        <Input
                          id="receipt-document-date"
                          type="date"
                          value={documentDate}
                          onChange={event => setDocumentDate(event.target.value)}
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
                      {EMISSION_DEADLINE_ISSUE_MESSAGE}. Se permitirá registrar
                      la recepción, pero quedará marcada con alerta.
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
                  <h3 className="text-lg font-semibold">Adjuntos</h3>
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
                      onClick={() => receiptAttachmentInputRef.current?.click()}
                      disabled={
                        preparingReceiptAttachment ||
                        registerMutation.isPending ||
                        uploadPendingReceiptAttachmentMutation.isPending
                      }
                    >
                      <Upload className="mr-2 h-4 w-4" />
                      {preparingReceiptAttachment ? "Preparando..." : "Adjuntar"}
                    </Button>
                  </div>
                </div>

                {pendingReceiptAttachments.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                    Sin archivos seleccionados.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {pendingReceiptAttachments.map(attachment => {
                      const AttachmentIcon = attachment.mimeType.startsWith("image/")
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

              <div className="rounded-2xl border border-border/70">
                <table className="w-full text-sm">
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
                      <th className="p-3 text-right text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground sm:text-xs">
                        Recibir ahora
                      </th>
                      <th className="p-3 text-right text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground sm:text-xs">
                        Acción
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {!sourceId ? (
                      <tr>
                        <td
                          className="p-4 text-sm text-muted-foreground"
                          colSpan={7}
                        >
                          Selecciona una orden de compra o traslado para cargar
                          sus ítems.
                        </td>
                      </tr>
                    ) : activeSourceLoading ? (
                      <tr>
                        <td
                          className="p-4 text-sm text-muted-foreground"
                          colSpan={7}
                        >
                          Cargando detalle del documento...
                        </td>
                      </tr>
                    ) : sourceItems.length === 0 ? (
                      <tr>
                        <td
                          className="p-4 text-sm text-muted-foreground"
                          colSpan={7}
                        >
                          Este documento no tiene ítems pendientes por recibir.
                        </td>
                      </tr>
                    ) : (
                      sourceItems.map((item: any) => {
                        const pendingQuantity = getReceivableQuantity(item);
                        const receivingQuantity =
                          Number(receivedMap[item.id] ?? 0) || 0;
                        const excessQuantity = Math.max(
                          receivingQuantity - pendingQuantity,
                          0
                        );
                        const sourceCode = getSourceItemCode(item);
                        const transferCloseQuantity = getTransferCloseQuantity(item);
                        const transferClosureDraft =
                          transferClosureDrafts[item.id];
                        return (
                          <tr
                            key={item.id}
                            className="border-b border-border/70 last:border-0"
                          >
                            <td className="p-4">
                              <div className="font-semibold">
                                {item.itemName}
                              </div>
                              {sourceCode ? (
                                <div className="mt-1 text-xs text-muted-foreground">
                                  Original: {sourceCode}
                                </div>
                              ) : null}
                            </td>
                            <td className="p-4 font-mono text-sm">
                              {sourceCode || "—"}
                            </td>
                            <td className="p-4 text-right font-semibold">
                              {formatQuantity(pendingQuantity)}{" "}
                              {item.unit || ""}
                            </td>
                            <td className="p-4 text-right text-muted-foreground">
                              {formatQuantity(item.receivedQuantity)}{" "}
                              {item.unit || ""}
                            </td>
                            <td className="p-4 text-right">
                              {sourceType === "purchase_order" ? (
                                <Input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  className="ml-auto w-36 text-right"
                                  value={priceMap[item.id] ?? ""}
                                  onChange={event =>
                                    setPriceMap(current => ({
                                      ...current,
                                      [item.id]: event.target.value,
                                    }))
                                  }
                                />
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </td>
                            <td className="p-4 text-right">
                              <Input
                                type="number"
                                min="0"
                                step="0.01"
                                className="ml-auto w-36 text-right"
                                value={receivedMap[item.id] ?? ""}
                                onChange={event =>
                                  setReceivedMap(current => ({
                                    ...current,
                                    [item.id]: event.target.value,
                                  }))
                                }
                                disabled={pendingQuantity <= 0}
                              />
                              {excessQuantity > 0 ? (
                                <p className="mt-1 text-xs font-medium text-emerald-700">
                                  Exceso permitido:{" "}
                                  {formatQuantity(excessQuantity)}{" "}
                                  {item.unit || ""}
                                </p>
                              ) : null}
                            </td>
                            <td className="p-4 text-right">
                              {sourceType === "purchase_order" &&
                              !isContractPurchaseOrder &&
                              canManuallyCloseReceiptLine(item) ? (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="ml-auto gap-2"
                                  onClick={() => setCloseReceiptLineItem(item)}
                                  disabled={closeReceiptLineMutation.isPending}
                                >
                                  {closeReceiptLineMutation.isPending &&
                                  closeReceiptLineItem?.id === item.id ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : (
                                    <ShieldX className="h-4 w-4" />
                                  )}
                                  Cerrar línea
                                </Button>
                              ) : sourceType === "transfer" ? (
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
                                      {formatQuantity(transferCloseQuantity)}{" "}
                                      {item.unit || ""} al origen y a requisición
                                    </span>
                                  ) : canCloseTransferLines &&
                                    transferCloseQuantity <= 0 ? (
                                    <span className="max-w-48 text-right text-xs text-muted-foreground">
                                      Baja Recibir ahora para cerrar saldo.
                                    </span>
                                  ) : null}
                                </div>
                              ) : (
                                <span className="text-xs text-muted-foreground">
                                  —
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              <div className="flex justify-end border-t border-border/70 pt-4">
                <Button
                  size="lg"
                  className="min-w-[240px] text-sm font-semibold sm:h-11 sm:text-base"
                  onClick={handleRegisterReceipt}
                  disabled={
                    registerMutation.isPending ||
                    !sourceId ||
                    activeSourceLoading ||
                    Boolean(contractReceiptBlockReason)
                  }
                >
                  {registerMutation.isPending
                    ? "Registrando..."
                    : "Registrar recepción"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Dialog
        open={viewReceiptId !== null}
        onOpenChange={open => {
          if (!open) setViewReceiptId(null);
        }}
      >
        <DialogContent className="scrollbar-none max-h-[calc(100vh-0.75rem)] w-[calc(100vw-0.5rem)] max-w-[calc(100vw-0.5rem)] overflow-x-hidden overflow-y-auto rounded-2xl p-4 sm:max-h-[calc(100vh-1.5rem)] sm:w-[calc(100vw-2rem)] sm:max-w-[1480px] sm:p-6 lg:p-7">
          <DialogHeader className="border-b border-border/70 pb-4 pr-10">
            <div className="flex flex-wrap items-center gap-3">
              <DialogTitle className="text-[2rem] font-bold tracking-tight sm:text-[2.4rem]">
                {receiptDetail?.receipt.receiptNumber || "Detalle de recepción"}
              </DialogTitle>
              {receiptDetail ? (
                <Badge
                  variant="outline"
                  className={`text-sm ${
                    getReceiptStatusColor(
                      receiptDetail.receipt,
                      receiptDetail.invoice
                    )
                  }`}
                >
                  {getReceiptStatusLabel(
                    receiptDetail.receipt,
                    receiptDetail.invoice
                  )}
                </Badge>
              ) : null}
            </div>
          </DialogHeader>

          {receiptDetailLoading ||
          (viewReceiptId !== null && !receiptDetail) ? (
            <div className="py-8 text-center text-muted-foreground">
              Cargando recepción...
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
                    Referencia del origen
                  </Label>
                  <p className="text-sm font-semibold leading-snug sm:text-base">
                    {receiptSourceSecondaryLabel}
                  </p>
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
                    Número documento
                  </Label>
                  <p className="text-sm font-semibold leading-snug sm:text-base">
                    {receiptDetail.receipt.invoiceNumber || "—"}
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

              <div className="grid gap-3 md:grid-cols-3">
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

              <div className="rounded-2xl border border-border/70">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/70 bg-muted/20">
                      <th className="p-3 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground sm:text-xs">
                        Ítem
                      </th>
                      <th className="p-3 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground sm:text-xs">
                        Código
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
                    </tr>
                  </thead>
                  <tbody>
                    {receiptDetail.items.length === 0 ? (
                      <tr>
                        <td
                          className="p-4 text-sm text-muted-foreground"
                          colSpan={5}
                        >
                          Esta recepción no tiene ítems registrados.
                        </td>
                      </tr>
                    ) : (
                      receiptDetail.items.map((item: any) => {
                        const itemCode =
                          receiptSourceItemCodes.get(item.sourceItemId) ?? null;

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
                            </td>
                            <td className="p-4 font-mono text-sm">
                              {itemCode || "—"}
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
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              <DocumentAttachmentsPanel
                entityType="receipt"
                entityId={receiptDetail.receipt.id}
                category="comprobante_entrega"
                title="Adjuntos"
                canManage={canManageReceiptAttachments}
              />

              <div className="flex flex-wrap justify-end gap-3 border-t border-border/70 pt-1">
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
                        {row.receipt.sourceType === "purchase_order"
                          ? SOURCE_TYPE_LABELS.purchase_order
                          : SOURCE_TYPE_LABELS.transfer}
                      </td>
                      <td className="p-3">
                        <Badge
                          variant="outline"
                          className={`text-xs ${
                            getReceiptStatusColor(row.receipt, row.invoice)
                          }`}
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
                          onClick={() => setViewReceiptId(row.receipt.id)}
                        >
                          <Eye className="h-4 w-4" />
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
    </div>
  );
}
