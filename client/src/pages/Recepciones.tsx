import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { Eye, Loader2, Plus, RotateCcw, ShieldX } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";

const STATUS_LABELS: Record<string, string> = {
  pendiente: "Pendiente",
  parcial: "Parcial",
  completa: "Completa",
  cierre_incompleto: "Cierre incompleto",
};

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

const TRANSFER_STATUS_LABELS: Record<string, string> = {
  pendiente: "Pendiente",
  confirmado: "Confirmado",
  en_transito: "En tránsito",
  parcialmente_recibido: "Parcialmente recibido",
  recibido: "Recibido",
  cerrado_incompleto: "Cerrado incompleto",
  anulado: "Anulado",
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

export default function Recepciones() {
  const utils = trpc.useUtils();
  const { user } = useAuth();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [viewReceiptId, setViewReceiptId] = useState<number | null>(null);
  const [sourceType, setSourceType] = useState<"purchase_order" | "transfer">(
    "purchase_order"
  );
  const [sourceId, setSourceId] = useState("");
  const [notes, setNotes] = useState("");
  const [cai, setCai] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [documentDate, setDocumentDate] = useState("");
  const [postingDate, setPostingDate] = useState(todayDateValue());
  const [receiptDate, setReceiptDate] = useState(todayDateValue());
  const [receivedMap, setReceivedMap] = useState<Record<number, string>>({});
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

  const { data: receiptPurchaseOrderDetail } =
    trpc.purchaseOrders.getById.useQuery(
      { id: receiptDetail?.receipt.sourceId ?? 0 },
      {
        enabled:
          viewReceiptId !== null &&
          receiptDetail?.receipt.sourceType === "purchase_order" &&
          Boolean(receiptDetail?.receipt.sourceId),
      }
    );
  const { data: receiptTransferDetail } = trpc.transfers.getById.useQuery(
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
    setCai("");
    setInvoiceNumber("");
    setDocumentDate("");
    setPostingDate(todayDateValue());
    setReceiptDate(todayDateValue());
    setReceivedMap({});
    setTransferClosureDrafts({});
    setCloseTransferLineItem(null);
    setTransferCloseReason(TRANSFER_CLOSE_REASONS[0].value);
    setTransferCloseNote("");
  };

  const sourceItems = useMemo(
    () =>
      (activeSourceDetail?.items ?? []).filter(
        (item: any) => getPendingQuantity(item) > 0
      ),
    [activeSourceDetail]
  );

  useEffect(() => {
    if (!sourceItems.length) {
      setReceivedMap({});
      return;
    }

    const nextMap: Record<number, string> = {};
    for (const item of sourceItems) {
      nextMap[item.id] = String(getPendingQuantity(item));
    }
    setReceivedMap(nextMap);
  }, [sourceItems]);

  const registerMutation = trpc.receipts.register.useMutation({
    onSuccess: () => {
      toast.success("Recepción registrada");
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
      ? PURCHASE_ORDER_STATUS_LABELS[sourceStatusKey] || sourceStatusKey
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
          acc.pending += getPendingQuantity(item);
          acc.receiving += Number(receivedMap[item.id] ?? 0) || 0;
          return acc;
        },
        { pending: 0, receiving: 0 }
      ),
    [receivedMap, sourceItems]
  );

  const getTransferCloseQuantity = (item: any) => {
    const requestedQuantity = Math.max(Number(receivedMap[item.id] ?? 0) || 0, 0);
    return Math.max(getPendingQuantity(item) - requestedQuantity, 0);
  };

  const handleRegisterReceipt = () => {
    if (!sourceId || !sourceProjectId) {
      toast.error("Selecciona un documento origen válido");
      return;
    }

    if (sourceType === "purchase_order") {
      if (!cai.trim()) {
        toast.error("Ingresa el CAI de la factura");
        return;
      }
      if (!invoiceNumber.trim()) {
        toast.error("Ingresa el número de factura");
        return;
      }
      if (!documentDate) {
        toast.error("Selecciona la fecha del documento");
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
        quantityExpected: String(getPendingQuantity(item)),
        quantityReceived: receivedMap[item.id] || "0",
        unit: item.unit || undefined,
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
      cai: cai || undefined,
      invoiceNumber: invoiceNumber || undefined,
      documentDate: documentDate || undefined,
      postingDate: currentPostingDate,
      receiptDate,
      notes: notes || undefined,
      items: receiptItems,
    });
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
                  <Badge variant="outline" className="text-sm">
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
                <div className="space-y-1.5 rounded-2xl border border-border/70 bg-muted/20 p-3.5 sm:p-4 md:col-span-5">
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

              <div className="space-y-4 rounded-2xl border border-border/70 bg-muted/10 p-4 sm:p-5">
                <div
                  className={`grid gap-3 md:grid-cols-2 ${
                    sourceType === "purchase_order"
                      ? "xl:grid-cols-5"
                      : "xl:grid-cols-2"
                  }`}
                >
                  {sourceType === "purchase_order" ? (
                    <>
                      <div className="space-y-2">
                        <Label htmlFor="receipt-cai">CAI</Label>
                        <Input
                          id="receipt-cai"
                          value={cai}
                          onChange={event => setCai(event.target.value)}
                          placeholder="CAI de la factura"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="receipt-invoice-number">
                          Número de factura
                        </Label>
                        <Input
                          id="receipt-invoice-number"
                          value={invoiceNumber}
                          onChange={event => setInvoiceNumber(event.target.value)}
                          placeholder="Correlativo de factura"
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

                <div className="space-y-2">
                  <Label htmlFor="receipt-notes">Notas</Label>
                  <Textarea
                    id="receipt-notes"
                    value={notes}
                    onChange={event => setNotes(event.target.value)}
                    rows={3}
                    placeholder={
                      sourceType === "purchase_order"
                        ? "Observaciones, referencia de factura o comentarios de recepción"
                        : "Observaciones o comentarios de recepción"
                    }
                  />
                </div>
              </div>

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
                          colSpan={6}
                        >
                          Selecciona una orden de compra o traslado para cargar
                          sus ítems.
                        </td>
                      </tr>
                    ) : activeSourceLoading ? (
                      <tr>
                        <td
                          className="p-4 text-sm text-muted-foreground"
                          colSpan={6}
                        >
                          Cargando detalle del documento...
                        </td>
                      </tr>
                    ) : sourceItems.length === 0 ? (
                      <tr>
                        <td
                          className="p-4 text-sm text-muted-foreground"
                          colSpan={6}
                        >
                          Este documento no tiene ítems pendientes por recibir.
                        </td>
                      </tr>
                    ) : (
                      sourceItems.map((item: any) => {
                        const pendingQuantity = getPendingQuantity(item);
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
                            </td>
                            <td className="p-4 text-right">
                              {sourceType === "purchase_order" &&
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
                    activeSourceLoading
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
                <Badge variant="outline" className="text-sm">
                  {STATUS_LABELS[receiptDetail.receipt.status] ||
                    receiptDetail.receipt.status}
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
                <div className="space-y-1.5 rounded-2xl border border-border/70 bg-muted/20 p-3.5 sm:p-4 md:col-span-5">
                  <Label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground sm:text-xs">
                    Referencia del origen
                  </Label>
                  <p className="text-sm font-semibold leading-snug sm:text-base">
                    {receiptSourceSecondaryLabel}
                  </p>
                </div>
                <div className="space-y-1.5 rounded-2xl border border-border/70 bg-muted/20 p-3.5 sm:p-4 md:col-span-2">
                  <Label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground sm:text-xs">
                    CAI
                  </Label>
                  <p className="text-sm font-semibold leading-snug sm:text-base">
                    {receiptDetail.receipt.cai || "—"}
                  </p>
                </div>
                <div className="space-y-1.5 rounded-2xl border border-border/70 bg-muted/20 p-3.5 sm:p-4 md:col-span-2">
                  <Label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground sm:text-xs">
                    Número de factura
                  </Label>
                  <p className="text-sm font-semibold leading-snug sm:text-base">
                    {receiptDetail.receipt.invoiceNumber || "—"}
                  </p>
                </div>
                <div className="space-y-1.5 rounded-2xl border border-border/70 bg-muted/20 p-3.5 sm:p-4 md:col-span-3">
                  <Label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground sm:text-xs">
                    Registrada por
                  </Label>
                  <p className="text-sm font-semibold leading-snug sm:text-base">
                    Usuario #{receiptDetail.receipt.receivedById}
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
                    </tr>
                  </thead>
                  <tbody>
                    {receiptDetail.items.length === 0 ? (
                      <tr>
                        <td
                          className="p-4 text-sm text-muted-foreground"
                          colSpan={4}
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
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
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
                  {(receipts || []).map((row: any) => (
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
                        <Badge variant="outline" className="text-xs">
                          {STATUS_LABELS[row.receipt.status] ||
                            row.receipt.status}
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
