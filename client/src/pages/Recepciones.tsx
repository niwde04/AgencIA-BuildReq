import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
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
import { Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

const STATUS_LABELS: Record<string, string> = {
  pendiente: "Pendiente",
  parcial: "Parcial",
  completa: "Completa",
};

const SOURCE_TYPE_LABELS: Record<"purchase_order" | "transfer", string> = {
  purchase_order: "Orden de Compra",
  transfer: "Solicitud de traslado",
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
  anulado: "Anulado",
};

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
  return Math.max(
    Number(item.quantity ?? item.quantityExpected ?? 0) - Number(item.receivedQuantity ?? 0),
    0
  );
}

function getSourceItemCode(item: any) {
  return item.currentSapItemCode ?? item.originalSapItemCode ?? item.sapItemCode ?? null;
}

export default function Recepciones() {
  const utils = trpc.useUtils();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [sourceType, setSourceType] = useState<"purchase_order" | "transfer">("purchase_order");
  const [sourceId, setSourceId] = useState("");
  const [notes, setNotes] = useState("");
  const [cai, setCai] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [documentDate, setDocumentDate] = useState("");
  const [postingDate, setPostingDate] = useState(todayDateValue());
  const [receivedMap, setReceivedMap] = useState<Record<number, string>>({});

  const { data: receipts, isLoading } = trpc.receipts.list.useQuery();
  const { data: purchaseOrders } = trpc.purchaseOrders.list.useQuery();
  const { data: transfers } = trpc.transfers.list.useQuery();
  const {
    data: purchaseOrderDetail,
    isLoading: purchaseOrderDetailLoading,
  } = trpc.purchaseOrders.getById.useQuery(
    { id: Number(sourceId) },
    { enabled: dialogOpen && sourceType === "purchase_order" && Boolean(sourceId) }
  );
  const {
    data: transferDetail,
    isLoading: transferDetailLoading,
  } = trpc.transfers.getById.useQuery(
    { id: Number(sourceId) },
    { enabled: dialogOpen && sourceType === "transfer" && Boolean(sourceId) }
  );

  const activeSourceDetail =
    sourceType === "purchase_order" ? purchaseOrderDetail : transferDetail;
  const activeSourceLoading =
    sourceType === "purchase_order" ? purchaseOrderDetailLoading : transferDetailLoading;

  const resetForm = () => {
    setSourceType("purchase_order");
    setSourceId("");
    setNotes("");
    setCai("");
    setInvoiceNumber("");
    setDocumentDate("");
    setPostingDate(todayDateValue());
    setReceivedMap({});
  };

  useEffect(() => {
    if (!activeSourceDetail) return;

    const nextMap: Record<number, string> = {};
    for (const item of activeSourceDetail.items || []) {
      nextMap[item.id] = String(getPendingQuantity(item));
    }
    setReceivedMap(nextMap);
  }, [activeSourceDetail]);

  const registerMutation = trpc.receipts.register.useMutation({
    onSuccess: () => {
      toast.success("Recepción registrada");
      setDialogOpen(false);
      resetForm();
      void Promise.all([
        utils.receipts.list.invalidate(),
        utils.purchaseOrders.list.invalidate(),
        utils.transfers.list.invalidate(),
      ]);
    },
    onError: (error) => toast.error(error.message),
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

  const sourceItems = useMemo(() => activeSourceDetail?.items ?? [], [activeSourceDetail]);

  const sourceProjectId =
    sourceType === "purchase_order"
      ? purchaseOrderDetail?.purchaseOrder.projectId
      : transferDetail?.transferRequest?.destinationType === "proyecto"
        ? transferDetail.transferRequest.destinationProjectId
        : undefined;

  const sourceProjectLabel =
    sourceType === "purchase_order"
      ? purchaseOrderDetail?.project
        ? `${purchaseOrderDetail.project.code} — ${purchaseOrderDetail.project.name}`
        : purchaseOrderDetail?.purchaseOrder.projectId
          ? `Proyecto ${purchaseOrderDetail.purchaseOrder.projectId}`
          : "Seleccione documento"
      : transferDetail?.project
        ? `${transferDetail.project.code} — ${transferDetail.project.name}`
        : transferDetail?.transferRequest?.projectId
          ? `Proyecto ${transferDetail.transferRequest.projectId}`
          : "Seleccione documento";

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
      : transferDetail?.transferRequest?.destinationType === "proyecto"
        ? `Destino: Proyecto ${transferDetail.transferRequest.destinationProjectId ?? "—"}`
        : transferDetail?.transferRequest
          ? "Destino: Bodega Central"
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

    const receiptItems = sourceItems.map((item: any) => ({
      sourceItemId: item.id,
      itemName: item.itemName,
      quantityExpected: String(getPendingQuantity(item)),
      quantityReceived: receivedMap[item.id] || "0",
      unit: item.unit || undefined,
    }));

    if (!receiptItems.some((item) => Number(item.quantityReceived || 0) > 0)) {
      toast.error("Ingresa al menos una cantidad mayor que cero");
      return;
    }

    registerMutation.mutate({
      sourceType,
      sourceId: Number(sourceId),
      projectId: sourceProjectId,
      cai: cai || undefined,
      invoiceNumber: invoiceNumber || undefined,
      documentDate: documentDate || undefined,
      postingDate,
      receiptDate: postingDate,
      notes: notes || undefined,
      items: receiptItems,
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1>Recepciones</h1>

        <Dialog
          open={dialogOpen}
          onOpenChange={(open) => {
            setDialogOpen(open);
            if (!open) resetForm();
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
                    onValueChange={(value) => {
                      setSourceType(value as "purchase_order" | "transfer");
                      setSourceId("");
                      setReceivedMap({});
                      setCai("");
                      setInvoiceNumber("");
                      setDocumentDate("");
                      setPostingDate(todayDateValue());
                    }}
                  >
                    <SelectTrigger className="h-11 w-full text-sm sm:h-12 sm:text-base">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="purchase_order">Orden de Compra</SelectItem>
                      <SelectItem value="transfer">Solicitud de traslado</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2.5 rounded-2xl border border-border/70 bg-muted/20 p-3.5 sm:p-4 md:col-span-5">
                  <Label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground sm:text-xs">
                    Documento origen
                  </Label>
                  <Select
                    value={sourceId}
                    onValueChange={(value) => {
                      setSourceId(value);
                      setReceivedMap({});
                      setCai("");
                      setInvoiceNumber("");
                      setDocumentDate("");
                      setPostingDate(todayDateValue());
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
                              {row.purchaseOrder.orderNumber} — {row.supplier?.name || "Proveedor pendiente"}
                            </SelectItem>
                          ))
                        : availableTransfers.map((row: any) => (
                            <SelectItem
                              key={row.transfer.id}
                              value={String(row.transfer.id)}
                              className="py-2.5"
                            >
                              {row.transfer.transferNumber} — {row.project?.name || "Proyecto origen"}
                            </SelectItem>
                          ))}
                    </SelectContent>
                  </Select>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {sourceType === "purchase_order"
                      ? "Solo aparecen órdenes emitidas con saldo pendiente por recibir."
                      : "Solo aparecen traslados confirmados o con saldo pendiente."}
                  </p>
                </div>

                <div className="space-y-1.5 rounded-2xl border border-border/70 bg-muted/20 p-3.5 sm:p-4 md:col-span-2">
                  <Label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground sm:text-xs">
                    Proyecto
                  </Label>
                  <p className="text-sm font-semibold leading-snug sm:text-base">{sourceProjectLabel}</p>
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
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                  <div className="space-y-2">
                    <Label htmlFor="receipt-cai">CAI</Label>
                    <Input
                      id="receipt-cai"
                      value={cai}
                      onChange={(event) => setCai(event.target.value)}
                      placeholder="CAI de la factura"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="receipt-invoice-number">Número de factura</Label>
                    <Input
                      id="receipt-invoice-number"
                      value={invoiceNumber}
                      onChange={(event) => setInvoiceNumber(event.target.value)}
                      placeholder="Correlativo de factura"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="receipt-document-date">Fecha documento</Label>
                    <Input
                      id="receipt-document-date"
                      type="date"
                      value={documentDate}
                      onChange={(event) => setDocumentDate(event.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="receipt-posting-date">Fecha contabilización</Label>
                    <Input
                      id="receipt-posting-date"
                      type="date"
                      value={postingDate}
                      onChange={(event) => setPostingDate(event.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="receipt-receipt-date">Fecha recepción</Label>
                    <Input
                      id="receipt-receipt-date"
                      type="date"
                      value={postingDate}
                      readOnly
                      className="bg-muted/40"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="receipt-notes">Notas</Label>
                  <Textarea
                    id="receipt-notes"
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    rows={3}
                    placeholder="Observaciones, referencia de factura o comentarios de recepción"
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
                    </tr>
                  </thead>
                  <tbody>
                    {!sourceId ? (
                      <tr>
                        <td className="p-4 text-sm text-muted-foreground" colSpan={5}>
                          Selecciona una orden de compra o solicitud de traslado para cargar sus ítems.
                        </td>
                      </tr>
                    ) : activeSourceLoading ? (
                      <tr>
                        <td className="p-4 text-sm text-muted-foreground" colSpan={5}>
                          Cargando detalle del documento...
                        </td>
                      </tr>
                    ) : sourceItems.length === 0 ? (
                      <tr>
                        <td className="p-4 text-sm text-muted-foreground" colSpan={5}>
                          Este documento no tiene ítems pendientes por recibir.
                        </td>
                      </tr>
                    ) : (
                      sourceItems.map((item: any) => {
                        const pendingQuantity = getPendingQuantity(item);
                        const sourceCode = getSourceItemCode(item);
                        return (
                          <tr key={item.id} className="border-b border-border/70 last:border-0">
                            <td className="p-4">
                              <div className="font-semibold">{item.itemName}</div>
                              {sourceCode ? (
                                <div className="mt-1 text-xs text-muted-foreground">
                                  Original: {sourceCode}
                                </div>
                              ) : null}
                            </td>
                            <td className="p-4 font-mono text-sm">{sourceCode || "—"}</td>
                            <td className="p-4 text-right font-semibold">
                              {formatQuantity(pendingQuantity)} {item.unit || ""}
                            </td>
                            <td className="p-4 text-right text-muted-foreground">
                              {formatQuantity(item.receivedQuantity)} {item.unit || ""}
                            </td>
                            <td className="p-4 text-right">
                              <Input
                                type="number"
                                min="0"
                                step="0.01"
                                className="ml-auto w-36 text-right"
                                value={receivedMap[item.id] ?? ""}
                                onChange={(event) =>
                                  setReceivedMap((current) => ({
                                    ...current,
                                    [item.id]: event.target.value,
                                  }))
                                }
                                disabled={pendingQuantity <= 0}
                              />
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
                  disabled={registerMutation.isPending || !sourceId || activeSourceLoading}
                >
                  {registerMutation.isPending ? "Registrando..." : "Registrar recepción"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
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
                  </tr>
                </thead>
                <tbody>
                  {(receipts || []).map((row: any) => (
                    <tr key={row.receipt.id} className="border-b border-border last:border-0">
                      <td className="p-3 font-medium">{row.receipt.receiptNumber}</td>
                      <td className="p-3 text-xs">
                        {row.project ? `${row.project.code} — ${row.project.name}` : "—"}
                      </td>
                      <td className="p-3 text-xs">
                        {row.receipt.sourceType === "purchase_order"
                          ? SOURCE_TYPE_LABELS.purchase_order
                          : SOURCE_TYPE_LABELS.transfer}
                      </td>
                      <td className="p-3">
                        <Badge variant="outline" className="text-xs">
                          {STATUS_LABELS[row.receipt.status] || row.receipt.status}
                        </Badge>
                      </td>
                      <td className="p-3 text-xs">
                        {formatDateLabel(row.receipt.receiptDate || row.receipt.createdAt)}
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
