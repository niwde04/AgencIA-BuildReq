import { trpc } from "@/lib/trpc";
import { downloadBase64Document } from "@/lib/document-download";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  ArrowRightLeft,
  Download,
  Loader2,
  Pencil,
  Save,
  Send,
  ShoppingCart,
  ShieldX,
  Trash2,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  calculatePurchaseOrderLineAmounts,
  formatPurchaseOrderCurrency,
  normalizePurchaseOrderTaxCode,
  PURCHASE_ORDER_TAX_OPTIONS,
  summarizePurchaseOrderLines,
  type PurchaseOrderTaxCode,
} from "@shared/purchase-orders";

const STATUS_LABELS: Record<string, string> = {
  borrador: "Borrador",
  emitida: "Emitida",
  enviada: "Enviada",
  parcialmente_recibida: "Parcialmente recibida",
  recibida: "Recibida",
  anulada: "Anulada",
};

const EMISSION_STATUS_LABELS: Record<string, string> = {
  borrador: "Pendiente",
  emitida: "Emitida",
  enviada: "Emitida",
  parcialmente_recibida: "Emitida",
  recibida: "Emitida",
  anulada: "Anulada",
};

const RECEIVED_ORDER_STATUSES = new Set(["parcialmente_recibida", "recibida"]);
const RECEIPT_CLOSABLE_ORDER_STATUSES = new Set([
  "emitida",
  "enviada",
  "parcialmente_recibida",
]);
const ORDER_STRUCTURE_EDITABLE_STATUSES = new Set(["borrador"]);

type PurchaseOrderItemDraft = {
  quantity: string;
  unitPrice: string;
  taxCode: PurchaseOrderTaxCode;
};

type PurchaseOrderConfirmState =
  | { kind: null }
  | {
      kind: "delete-item";
      itemId: number;
      itemName: string;
      isLastItem: boolean;
    }
  | {
      kind: "close-receipt-line";
      itemId: number;
      itemName: string;
      pendingQuantity: number;
      unit: string | null;
    }
  | {
      kind: "cancel-order";
      orderId: number;
      orderNumber: string;
    };

export default function OrdenesCompra() {
  const utils = trpc.useUtils();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [replaceItemId, setReplaceItemId] = useState<number | null>(null);
  const [replacementSearch, setReplacementSearch] = useState("");
  const [selectedSupplierId, setSelectedSupplierId] = useState("");
  const [savingItemId, setSavingItemId] = useState<number | null>(null);
  const [deletingItemId, setDeletingItemId] = useState<number | null>(null);
  const [itemDrafts, setItemDrafts] = useState<
    Record<number, PurchaseOrderItemDraft>
  >({});
  const [confirmState, setConfirmState] = useState<PurchaseOrderConfirmState>({
    kind: null,
  });

  const { data: orders, isLoading } = trpc.purchaseOrders.list.useQuery();
  const { data: suppliersList } = trpc.requestItems.listSuppliers.useQuery();
  const {
    data: detail,
    error: detailError,
    isLoading: detailLoading,
    refetch: refetchDetail,
  } = trpc.purchaseOrders.getById.useQuery(
    { id: selectedId ?? 0 },
    { enabled: Boolean(selectedId) }
  );
  const { data: sapMatches } = trpc.requestItems.searchSapCatalog.useQuery(
    { search: replacementSearch },
    { enabled: replacementSearch.trim().length >= 2 }
  );

  const replaceMutation = trpc.purchaseOrders.replaceItem.useMutation({
    onSuccess: () => {
      toast.success("Ítem actualizado en la OC");
      if (selectedId) {
        void utils.purchaseOrders.getById.invalidate({ id: selectedId });
      }
      setReplaceItemId(null);
      setReplacementSearch("");
    },
    onError: error => toast.error(error.message),
  });

  const updateMutation = trpc.purchaseOrders.update.useMutation({
    onSuccess: () => {
      toast.success("Proveedor actualizado en la OC");
      void utils.purchaseOrders.list.invalidate();
      if (selectedId) {
        void utils.purchaseOrders.getById.invalidate({ id: selectedId });
      }
    },
    onError: error => toast.error(error.message),
  });

  const updateItemLineMutation = trpc.purchaseOrders.updateItemLine.useMutation(
    {
      onSuccess: () => {
        toast.success("Linea actualizada en la OC");
        if (selectedId) {
          void utils.purchaseOrders.getById.invalidate({ id: selectedId });
        }
      },
      onError: error => toast.error(error.message),
    }
  );

  const closeReceiptLineMutation =
    trpc.purchaseOrders.closeReceiptLine.useMutation({
      onSuccess: result => {
        toast.success(
          result.orderStatus === "recibida"
            ? "Línea cerrada. La orden ya no tiene recepciones pendientes."
            : "Línea cerrada para recepción"
        );
        if (selectedId) {
          void utils.purchaseOrders.getById.invalidate({ id: selectedId });
        }
        void utils.purchaseOrders.list.invalidate();
        setConfirmState({ kind: null });
      },
      onError: error => toast.error(error.message),
    });

  const movePendingToPurchaseRequestMutation =
    trpc.purchaseOrders.movePendingToPurchaseRequest.useMutation({
      onSuccess: result => {
        toast.success(
          result.reused
            ? `Saldo pendiente agregado a la ${result.purchaseRequestNumber}`
            : `Saldo pendiente enviado a la ${result.purchaseRequestNumber}`
        );
        if (selectedId) {
          void utils.purchaseOrders.getById.invalidate({ id: selectedId });
        }
        void Promise.all([
          utils.purchaseOrders.list.invalidate(),
          utils.purchaseRequests.list.invalidate(),
        ]);
        setConfirmState({ kind: null });
      },
      onError: error => toast.error(error.message),
    });

  const deleteItemMutation = trpc.purchaseOrders.deleteItem.useMutation({
    onSuccess: result => {
      toast.success(
        result.orderCancelled
          ? "Se elimino la ultima linea y la OC quedo anulada"
          : "Linea eliminada de la OC"
      );
      if (selectedId) {
        void utils.purchaseOrders.getById.invalidate({ id: selectedId });
        void utils.purchaseOrders.list.invalidate();
      }
    },
    onError: error => toast.error(error.message),
  });

  const cancelOrderMutation = trpc.purchaseOrders.cancelOrder.useMutation({
    onSuccess: () => {
      toast.success("Orden de compra anulada");
      void utils.purchaseOrders.list.invalidate();
      if (selectedId) {
        void utils.purchaseOrders.getById.invalidate({ id: selectedId });
      }
    },
    onError: error => toast.error(error.message),
  });

  const reopenDraftMutation = trpc.purchaseOrders.reopenDraft.useMutation({
    onSuccess: () => {
      toast.success("OC reabierta para edición");
      void utils.purchaseOrders.list.invalidate();
      if (selectedId) {
        void utils.purchaseOrders.getById.invalidate({ id: selectedId });
      }
    },
    onError: error => toast.error(error.message),
  });

  const sendMutation = trpc.purchaseOrders.sendToSupplier.useMutation({
    onSuccess: () => {
      toast.success("OC emitida");
      void utils.purchaseOrders.list.invalidate();
      if (selectedId) {
        void utils.purchaseOrders.getById.invalidate({ id: selectedId });
      }
    },
    onError: error => toast.error(error.message),
  });

  const items = useMemo(() => detail?.items ?? [], [detail]);
  const purchaseOrderSapCodes = useMemo(
    () =>
      Array.from(
        new Set(
          items
            .map(
              (item: any) => item.currentSapItemCode ?? item.originalSapItemCode
            )
            .filter((value): value is string => Boolean(value))
        )
      ),
    [items]
  );
  const selectedSupplier = useMemo(
    () =>
      (suppliersList || []).find(
        (supplier: any) => supplier.id === Number(selectedSupplierId)
      ) ?? null,
    [selectedSupplierId, suppliersList]
  );
  const { data: latestSupplierPrices } =
    trpc.purchaseOrders.latestSupplierPrices.useQuery(
      {
        supplierId: Number(selectedSupplierId || 0),
        sapCodes: purchaseOrderSapCodes,
      },
      {
        enabled:
          Boolean(selectedId) &&
          Boolean(selectedSupplierId) &&
          purchaseOrderSapCodes.length > 0,
      }
    );
  const currentSupplierEmail =
    detail?.purchaseOrder.supplierEmail ?? detail?.supplier?.email ?? "";
  const selectedSupplierEmail = selectedSupplier?.email ?? "";
  const supplierChanged =
    !!detail &&
    !!selectedSupplierId &&
    (Number(selectedSupplierId) !== detail.purchaseOrder.supplierId ||
      selectedSupplierEmail !== currentSupplierEmail);
  const orderStatus = detail?.purchaseOrder.status ?? "";
  const canEditOrderStructure =
    ORDER_STRUCTURE_EDITABLE_STATUSES.has(orderStatus);
  const isOrderCancelled = orderStatus === "anulada";
  const isOrderReceived = orderStatus === "recibida";
  const isOrderReadOnly = Boolean(isOrderCancelled || isOrderReceived);
  const hasReceivedItems = items.some(
    (item: any) => Number(item.receivedQuantity ?? 0) > 0
  );
  const hasOrderReceipts =
    hasReceivedItems || RECEIVED_ORDER_STATUSES.has(orderStatus);
  const canReopenDraft =
    ["emitida", "enviada"].includes(orderStatus) && !hasOrderReceipts;

  useEffect(() => {
    setSelectedSupplierId(
      detail?.purchaseOrder.supplierId
        ? String(detail.purchaseOrder.supplierId)
        : ""
    );
  }, [detail?.purchaseOrder.id, detail?.purchaseOrder.supplierId]);

  useEffect(() => {
    if (!detail?.items) {
      setItemDrafts({});
      return;
    }

    setItemDrafts(
      Object.fromEntries(
        detail.items.map((item: any) => [
          item.id,
          {
            quantity: String(item.quantity ?? "0.00"),
            unitPrice: String(item.unitPrice ?? "0.00"),
            taxCode: normalizePurchaseOrderTaxCode(item.taxCode),
          },
        ])
      )
    );
  }, [detail?.items, detail?.purchaseOrder.id]);

  useEffect(() => {
    if (
      !canEditOrderStructure ||
      !detail?.items?.length ||
      !latestSupplierPrices
    ) {
      return;
    }

    setItemDrafts(current => {
      let changed = false;
      const next = { ...current };

      for (const item of detail.items) {
        const sapCode = item.currentSapItemCode ?? item.originalSapItemCode;
        if (!sapCode) continue;

        const latestPrice = latestSupplierPrices[sapCode];
        if (!latestPrice?.unitPrice) continue;

        const currentDraft = current[item.id] ?? {
          quantity: String(item.quantity ?? "0.00"),
          unitPrice: String(item.unitPrice ?? "0.00"),
          taxCode: normalizePurchaseOrderTaxCode(item.taxCode),
        };

        if (Number(item.unitPrice ?? 0) > 0) continue;
        if (Number(currentDraft.unitPrice ?? 0) > 0) continue;

        next[item.id] = {
          ...currentDraft,
          unitPrice: latestPrice.unitPrice,
        };
        changed = true;
      }

      return changed ? next : current;
    });
  }, [canEditOrderStructure, detail?.items, latestSupplierPrices]);

  const getItemDraft = (item: any): PurchaseOrderItemDraft =>
    itemDrafts[item.id] ?? {
      quantity: String(item.quantity ?? "0.00"),
      unitPrice: String(item.unitPrice ?? "0.00"),
      taxCode: normalizePurchaseOrderTaxCode(item.taxCode),
    };

  const hasItemLineChanged = (item: any) => {
    const draft = getItemDraft(item);
    return (
      Number(draft.quantity || 0) !== Number(item.quantity ?? 0) ||
      Number(draft.unitPrice || 0) !== Number(item.unitPrice ?? 0) ||
      draft.taxCode !== normalizePurchaseOrderTaxCode(item.taxCode)
    );
  };

  const pricingSummary = useMemo(
    () =>
      summarizePurchaseOrderLines(
        items.map((item: any) => {
          const draft = getItemDraft(item);
          return {
            quantity: draft.quantity,
            unitPrice: draft.unitPrice,
            taxCode: draft.taxCode,
          };
        })
      ),
    [items, itemDrafts]
  );

  const hasPendingPricingChanges = useMemo(
    () =>
      canEditOrderStructure &&
      items.some((item: any) => hasItemLineChanged(item)),
    [canEditOrderStructure, items, itemDrafts]
  );

  const confirmActionPending =
    deleteItemMutation.isPending ||
    cancelOrderMutation.isPending ||
    reopenDraftMutation.isPending ||
    closeReceiptLineMutation.isPending ||
    movePendingToPurchaseRequestMutation.isPending;

  const handleSaveSupplier = () => {
    if (!detail) return;
    if (!canEditOrderStructure) {
      toast.error("La OC ya fue emitida y no se puede actualizar");
      return;
    }
    if (!selectedSupplierId) {
      toast.error("Seleccione un proveedor");
      return;
    }

    updateMutation.mutate({
      id: detail.purchaseOrder.id,
      supplierId: Number(selectedSupplierId),
      supplierEmail: selectedSupplier?.email ?? null,
    });
  };

  const handleSaveItemLine = (item: any) => {
    if (!canEditOrderStructure) {
      toast.error("La OC ya fue emitida y no se puede actualizar");
      return;
    }

    const draft = getItemDraft(item);
    if (!draft.quantity.trim()) {
      toast.error("Ingrese la cantidad");
      return;
    }
    if (!draft.unitPrice.trim()) {
      toast.error("Ingrese el precio unitario");
      return;
    }

    setSavingItemId(item.id);
    updateItemLineMutation.mutate(
      {
        purchaseOrderItemId: item.id,
        quantity: draft.quantity,
        unitPrice: draft.unitPrice,
        taxCode: draft.taxCode,
      },
      {
        onSettled: () => {
          setSavingItemId(current => (current === item.id ? null : current));
        },
      }
    );
  };

  const getDeleteBlockReason = (item: any) => {
    if (!canEditOrderStructure) {
      return "No se pueden eliminar lineas de una orden emitida";
    }
    if (Number(item.receivedQuantity ?? 0) > 0) {
      return "No se puede eliminar una linea que ya tiene recepciones registradas";
    }
    return null;
  };

  const canCloseReceiptLine = (item: any) => {
    const orderedQuantity = Number(item.quantity ?? 0);
    const receivedQuantity = Number(item.receivedQuantity ?? 0);
    return (
      !isOrderReadOnly &&
      !item.receiptClosed &&
      RECEIPT_CLOSABLE_ORDER_STATUSES.has(detail?.purchaseOrder.status ?? "") &&
      receivedQuantity > 0 &&
      receivedQuantity < orderedQuantity
    );
  };

  const handleDeleteItem = (item: any) => {
    const blockReason = getDeleteBlockReason(item);
    if (blockReason) {
      toast.error(blockReason);
      return;
    }

    setConfirmState({
      kind: "delete-item",
      itemId: item.id,
      itemName: item.itemName,
      isLastItem: items.length <= 1,
    });
  };

  const handleCloseReceiptLine = (item: any) => {
    if (!canCloseReceiptLine(item)) {
      toast.error(
        "Solo se pueden cerrar líneas que estén parcialmente recibidas"
      );
      return;
    }

    const pendingQuantity = Math.max(
      Number(item.quantity ?? 0) - Number(item.receivedQuantity ?? 0),
      0
    );

    setConfirmState({
      kind: "close-receipt-line",
      itemId: item.id,
      itemName: item.itemName,
      pendingQuantity,
      unit: item.unit ?? null,
    });
  };

  const handleCancelOrder = () => {
    if (!detail) return;
    if (hasReceivedItems) {
      toast.error(
        "No se puede cancelar una orden que ya tiene recepciones registradas"
      );
      return;
    }

    setConfirmState({
      kind: "cancel-order",
      orderId: detail.purchaseOrder.id,
      orderNumber: detail.purchaseOrder.orderNumber,
    });
  };

  const handleConfirmAction = () => {
    if (confirmState.kind === "delete-item") {
      setDeletingItemId(confirmState.itemId);
      deleteItemMutation.mutate(
        { purchaseOrderItemId: confirmState.itemId },
        {
          onSuccess: () => {
            setReplaceItemId(current =>
              current === confirmState.itemId ? null : current
            );
            setConfirmState({ kind: null });
          },
          onSettled: () => {
            setDeletingItemId(current =>
              current === confirmState.itemId ? null : current
            );
          },
        }
      );
      return;
    }

    if (confirmState.kind === "cancel-order") {
      cancelOrderMutation.mutate(
        { id: confirmState.orderId },
        {
          onSuccess: () => {
            setConfirmState({ kind: null });
          },
        }
      );
      return;
    }

    if (confirmState.kind === "close-receipt-line") {
      closeReceiptLineMutation.mutate({
        purchaseOrderItemId: confirmState.itemId,
      });
    }
  };

  const handleMovePendingToPurchaseRequest = () => {
    if (confirmState.kind !== "close-receipt-line") return;
    movePendingToPurchaseRequestMutation.mutate({
      purchaseOrderItemId: confirmState.itemId,
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1>Órdenes de Compra</h1>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">
              Cargando órdenes de compra...
            </div>
          ) : !(orders || []).length ? (
            <div className="p-8 text-center text-muted-foreground">
              No hay órdenes de compra registradas
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      No. OC
                    </th>
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Clasificación
                    </th>
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Proyecto
                    </th>
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Tipo Compra
                    </th>
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Proveedor
                    </th>
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Estatus
                    </th>
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Emisión
                    </th>
                    <th className="p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Acciones
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {(orders || []).map((row: any) => (
                    <tr
                      key={row.purchaseOrder.id}
                      className="border-b border-border last:border-0"
                    >
                      <td className="p-3 font-medium">
                        {row.purchaseOrder.orderNumber}
                      </td>
                      <td className="p-3 text-xs uppercase">
                        {row.purchaseOrder.classification}
                      </td>
                      <td className="p-3 text-xs">
                        {row.project
                          ? `${row.project.code} — ${row.project.name}`
                          : "—"}
                      </td>
                      <td className="p-3 text-xs">
                        {row.purchaseOrder.purchaseType === "local"
                          ? "Compra Local"
                          : row.purchaseOrder.purchaseType === "extranjera"
                            ? "Compra Extranjera"
                            : "—"}
                      </td>
                      <td className="p-3 text-xs">
                        {row.supplier?.name || "Proveedor pendiente"}
                      </td>
                      <td className="p-3">
                        <Badge variant="outline" className="text-xs">
                          {STATUS_LABELS[row.purchaseOrder.status] ||
                            row.purchaseOrder.status}
                        </Badge>
                      </td>
                      <td className="p-3 text-xs">
                        {EMISSION_STATUS_LABELS[row.purchaseOrder.status] ||
                          "Pendiente"}
                      </td>
                      <td className="p-3 text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setSelectedId(row.purchaseOrder.id)}
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
        open={Boolean(selectedId)}
        onOpenChange={open => {
          if (!open) {
            setSelectedId(null);
            setReplaceItemId(null);
            setReplacementSearch("");
            setSelectedSupplierId("");
            setSavingItemId(null);
            setDeletingItemId(null);
            setItemDrafts({});
            setConfirmState({ kind: null });
          }
        }}
      >
        <DialogContent className="scrollbar-none max-h-[calc(100vh-0.75rem)] w-[calc(100vw-0.5rem)] max-w-[calc(100vw-0.5rem)] overflow-x-hidden overflow-y-auto rounded-2xl p-4 sm:max-h-[calc(100vh-1.5rem)] sm:w-[calc(100vw-2rem)] sm:max-w-[1600px] sm:p-6 lg:p-7">
          <DialogHeader className="border-b border-border/70 pb-4 pr-10">
            <div className="flex flex-wrap items-center gap-3">
              <DialogTitle className="text-[2.1rem] font-bold tracking-tight sm:text-[2.5rem]">
                {detail?.purchaseOrder.orderNumber || "Orden de Compra"}
              </DialogTitle>
              {detail?.purchaseOrder.status ? (
                <Badge variant="outline" className="text-sm">
                  {STATUS_LABELS[detail.purchaseOrder.status] ||
                    detail.purchaseOrder.status}
                </Badge>
              ) : null}
            </div>
          </DialogHeader>

          {detailLoading ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              Cargando detalle de la orden de compra...
            </div>
          ) : detailError ? (
            <div className="space-y-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-5 text-sm text-destructive">
              <p>No se pudo cargar la orden de compra. {detailError.message}</p>
              <div>
                <Button variant="outline" onClick={() => void refetchDetail()}>
                  Reintentar
                </Button>
              </div>
            </div>
          ) : detail ? (
            <div className="space-y-5">
              <div className="grid gap-3 md:grid-cols-12">
                <div className="space-y-1.5 rounded-2xl border border-border/70 bg-muted/20 p-3.5 sm:p-4 md:col-span-2">
                  <Label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground sm:text-xs">
                    Clasificación
                  </Label>
                  <p className="text-base font-semibold uppercase leading-tight sm:text-lg">
                    {detail.purchaseOrder.classification}
                  </p>
                </div>
                <div className="space-y-2.5 rounded-2xl border border-border/70 bg-muted/20 p-3.5 sm:p-4 md:col-span-6 lg:col-span-5">
                  <Label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground sm:text-xs">
                    Proveedor
                  </Label>
                  <Select
                    value={selectedSupplierId}
                    onValueChange={setSelectedSupplierId}
                    disabled={!canEditOrderStructure}
                  >
                    <SelectTrigger className="h-11 w-full text-sm sm:h-12 sm:text-base">
                      <SelectValue placeholder="Seleccione proveedor" />
                    </SelectTrigger>
                    <SelectContent className="max-h-[320px]">
                      {(suppliersList || []).map((supplier: any) => (
                        <SelectItem
                          key={supplier.id}
                          value={String(supplier.id)}
                          className="py-2.5 text-sm sm:text-base"
                        >
                          {supplier.supplierCode} — {supplier.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="flex flex-wrap items-center gap-3">
                    {canEditOrderStructure ? (
                      <Button
                        variant="outline"
                        size="lg"
                        className="h-10 px-4 text-sm font-semibold sm:h-11 sm:text-base"
                        onClick={handleSaveSupplier}
                        disabled={!supplierChanged || updateMutation.isPending}
                      >
                        {updateMutation.isPending
                          ? "Guardando..."
                          : "Guardar proveedor"}
                      </Button>
                    ) : null}
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      {selectedSupplier
                        ? selectedSupplier.email ||
                          "Proveedor sin correo configurado"
                        : detail.supplier?.name || "Proveedor pendiente"}
                    </p>
                  </div>
                </div>
                <div className="space-y-1.5 rounded-2xl border border-border/70 bg-muted/20 p-3.5 sm:p-4 md:col-span-3 lg:col-span-2">
                  <Label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground sm:text-xs">
                    Fecha necesaria
                  </Label>
                  <p className="text-base font-semibold leading-tight sm:text-lg">
                    {detail.purchaseOrder.neededBy
                      ? new Date(
                          detail.purchaseOrder.neededBy
                        ).toLocaleDateString("es-HN")
                      : "—"}
                  </p>
                </div>
                <div className="space-y-1.5 rounded-2xl border border-border/70 bg-muted/20 p-3.5 sm:p-4 md:col-span-3 lg:col-span-3">
                  <Label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground sm:text-xs">
                    Estado de emisión
                  </Label>
                  <p className="text-base font-semibold leading-tight sm:text-lg">
                    {EMISSION_STATUS_LABELS[detail.purchaseOrder.status] ||
                      "Pendiente"}
                  </p>
                </div>
              </div>

              <div className="overflow-x-auto rounded-2xl border border-border/70">
                <table className="min-w-[1360px] table-auto text-sm lg:text-[15px]">
                  <colgroup>
                    <col className="w-[250px]" />
                    <col className="w-[150px]" />
                    <col className="w-[170px]" />
                    <col className="w-[190px]" />
                    <col className="w-[150px]" />
                    <col className="w-[120px]" />
                    <col className="w-[110px]" />
                    <col className="w-[130px]" />
                    <col className="w-[160px]" />
                  </colgroup>
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="p-3 text-left text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground sm:p-4">
                        Ítem
                      </th>
                      <th className="p-3 text-left text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground sm:p-4">
                        SAP actual
                      </th>
                      <th className="whitespace-nowrap p-3 text-right text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground sm:p-4">
                        Cantidad
                      </th>
                      <th className="whitespace-nowrap p-3 text-right text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground sm:p-4">
                        Precio unitario
                      </th>
                      <th className="whitespace-nowrap p-3 text-left text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground sm:p-4">
                        Impuesto
                      </th>
                      <th className="whitespace-nowrap p-3 text-right text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground sm:p-4">
                        Subtotal
                      </th>
                      <th className="whitespace-nowrap p-3 text-right text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground sm:p-4">
                        ISV
                      </th>
                      <th className="whitespace-nowrap p-3 text-right text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground sm:p-4">
                        Total
                      </th>
                      <th className="whitespace-nowrap p-3 text-right text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground sm:p-4">
                        Acciones
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item: any) => {
                      const draft = getItemDraft(item);
                      const itemSapCode =
                        item.currentSapItemCode ??
                        item.originalSapItemCode ??
                        null;
                      const hasLatestSupplierPrice = Boolean(
                        itemSapCode && latestSupplierPrices?.[itemSapCode]
                      );
                      const shouldShowMissingHistoryHint =
                        Boolean(selectedSupplierId) &&
                        Boolean(itemSapCode) &&
                        Number(draft.unitPrice ?? 0) === 0 &&
                        !hasLatestSupplierPrice;
                      const deleteBlockReason = getDeleteBlockReason(item);
                      const canCloseThisReceiptLine = canCloseReceiptLine(item);
                      const shouldShowLineActions =
                        canEditOrderStructure || canCloseThisReceiptLine;
                      const lineAmounts = calculatePurchaseOrderLineAmounts({
                        quantity: draft.quantity,
                        unitPrice: draft.unitPrice,
                        taxCode: draft.taxCode,
                      });

                      return (
                        <tr
                          key={item.id}
                          className="border-b border-border last:border-0"
                        >
                          <td className="p-3 align-middle sm:p-4">
                            <div className="text-base font-semibold leading-snug sm:text-lg">
                              {item.itemName}
                            </div>
                            {item.originalSapItemCode && (
                              <div className="mt-1.5 text-sm text-muted-foreground">
                                Original: {item.originalSapItemCode}
                              </div>
                            )}
                            {item.receiptClosed ? (
                              <div className="mt-2">
                                <Badge
                                  variant="outline"
                                  className="text-[11px]"
                                >
                                  Línea cerrada en recepción
                                </Badge>
                              </div>
                            ) : null}
                          </td>
                          <td className="p-3 align-middle font-mono text-sm font-medium sm:p-4">
                            {item.currentSapItemCode || "—"}
                          </td>
                          <td className="p-3 align-middle sm:p-4">
                            <div className="flex items-center justify-end gap-2">
                              <Input
                                type="number"
                                min="0.01"
                                step="0.01"
                                value={draft.quantity}
                                onChange={event =>
                                  setItemDrafts(current => ({
                                    ...current,
                                    [item.id]: {
                                      ...getItemDraft(item),
                                      quantity: event.target.value,
                                    },
                                  }))
                                }
                                className="h-10 w-full max-w-[140px] text-right text-sm sm:max-w-[150px] sm:text-base"
                                placeholder="0.00"
                                disabled={!canEditOrderStructure}
                              />
                              <span className="min-w-[44px] text-right text-xs font-medium text-muted-foreground sm:min-w-[52px] sm:text-sm">
                                {item.unit || "—"}
                              </span>
                            </div>
                            {Number(item.receivedQuantity ?? 0) > 0 ? (
                              <div className="mt-1.5 text-right text-[11px] text-muted-foreground">
                                Recibido: {item.receivedQuantity}{" "}
                                {item.unit || ""}
                              </div>
                            ) : null}
                            {item.receiptClosed ? (
                              <div className="mt-1 text-right text-[11px] text-muted-foreground">
                                Ya no admite recepciones adicionales
                              </div>
                            ) : null}
                          </td>
                          <td className="p-3 align-middle sm:p-4">
                            <div
                              className={`ml-auto flex w-full max-w-[220px] flex-col items-end ${
                                shouldShowMissingHistoryHint
                                  ? "min-h-[92px]"
                                  : ""
                              }`}
                            >
                              <Input
                                type="number"
                                min="0"
                                step="0.01"
                                value={draft.unitPrice}
                                onChange={event =>
                                  setItemDrafts(current => ({
                                    ...current,
                                    [item.id]: {
                                      ...getItemDraft(item),
                                      unitPrice: event.target.value,
                                    },
                                  }))
                                }
                                className="h-10 w-full text-right text-sm sm:text-base"
                                placeholder="0.00"
                                disabled={!canEditOrderStructure}
                              />
                              {shouldShowMissingHistoryHint && (
                                <div className="mt-3 w-full px-1 text-right text-[11px] leading-snug text-muted-foreground">
                                  Sin historial con este proveedor.
                                </div>
                              )}
                            </div>
                          </td>
                          <td className="p-3 align-middle sm:p-4">
                            <Select
                              value={draft.taxCode}
                              onValueChange={value =>
                                setItemDrafts(current => ({
                                  ...current,
                                  [item.id]: {
                                    ...getItemDraft(item),
                                    taxCode: value as PurchaseOrderTaxCode,
                                  },
                                }))
                              }
                              disabled={!canEditOrderStructure}
                            >
                              <SelectTrigger className="h-10 w-full min-w-0 text-sm sm:text-base">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {PURCHASE_ORDER_TAX_OPTIONS.map(taxOption => (
                                  <SelectItem
                                    key={taxOption.value}
                                    value={taxOption.value}
                                  >
                                    {taxOption.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </td>
                          <td className="p-3 text-right align-middle sm:p-4">
                            <div className="whitespace-nowrap text-base font-semibold sm:text-lg">
                              {formatPurchaseOrderCurrency(
                                lineAmounts.subtotal
                              )}
                            </div>
                          </td>
                          <td className="p-3 text-right align-middle sm:p-4">
                            <div className="whitespace-nowrap text-base font-semibold sm:text-lg">
                              {formatPurchaseOrderCurrency(
                                lineAmounts.taxAmount
                              )}
                            </div>
                          </td>
                          <td className="p-3 text-right align-middle sm:p-4">
                            <div className="whitespace-nowrap text-base font-semibold sm:text-lg">
                              {formatPurchaseOrderCurrency(lineAmounts.total)}
                            </div>
                          </td>
                          <td className="p-3 text-right align-middle sm:p-4">
                            {shouldShowLineActions ? (
                              <div className="ml-auto flex w-fit items-center justify-end gap-2">
                                {canEditOrderStructure ? (
                                  <>
                                    <Button
                                      variant="outline"
                                      size="icon-sm"
                                      onClick={() => {
                                        setReplaceItemId(item.id);
                                        setReplacementSearch("");
                                      }}
                                      title="Reemplazar ítem"
                                      aria-label="Reemplazar ítem"
                                    >
                                      <ArrowRightLeft className="h-4 w-4" />
                                    </Button>
                                    <Button
                                      size="icon-sm"
                                      disabled={
                                        !hasItemLineChanged(item) ||
                                        savingItemId === item.id ||
                                        updateItemLineMutation.isPending
                                      }
                                      onClick={() => handleSaveItemLine(item)}
                                      title="Guardar línea"
                                      aria-label="Guardar línea"
                                    >
                                      {savingItemId === item.id ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                      ) : (
                                        <Save className="h-4 w-4" />
                                      )}
                                    </Button>
                                  </>
                                ) : null}
                                {canCloseThisReceiptLine ? (
                                  <Button
                                    variant="outline"
                                    size="icon-sm"
                                    disabled={
                                      closeReceiptLineMutation.isPending
                                    }
                                    onClick={() => handleCloseReceiptLine(item)}
                                    title="Cerrar línea para recepción"
                                    aria-label="Cerrar línea para recepción"
                                  >
                                    {closeReceiptLineMutation.isPending &&
                                    confirmState.kind ===
                                      "close-receipt-line" &&
                                    confirmState.itemId === item.id ? (
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                      <ShieldX className="h-4 w-4" />
                                    )}
                                  </Button>
                                ) : null}
                                {canEditOrderStructure ? (
                                  <Button
                                    variant="destructive"
                                    size="icon-sm"
                                    disabled={
                                      Boolean(deleteBlockReason) ||
                                      deletingItemId === item.id
                                    }
                                    title={
                                      deleteBlockReason ?? "Eliminar línea"
                                    }
                                    aria-label="Eliminar línea"
                                    onClick={() => handleDeleteItem(item)}
                                  >
                                    {deletingItemId === item.id ? (
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                      <Trash2 className="h-4 w-4" />
                                    )}
                                  </Button>
                                ) : null}
                              </div>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="flex justify-end border-t border-border bg-muted/10 px-3 py-4 sm:px-4">
                <div className="w-full max-w-[320px] space-y-2.5 rounded-2xl border border-border/70 bg-background p-4">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Subtotal</span>
                    <span className="font-medium">
                      {formatPurchaseOrderCurrency(pricingSummary.subtotal)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Total exento</span>
                    <span className="font-medium">
                      {formatPurchaseOrderCurrency(pricingSummary.totalExempt)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Total ISV</span>
                    <span className="font-medium">
                      {formatPurchaseOrderCurrency(pricingSummary.totalIsv)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between border-t border-border pt-3 text-base font-semibold">
                    <span>Total</span>
                    <span>
                      {formatPurchaseOrderCurrency(pricingSummary.total)}
                    </span>
                  </div>
                </div>
              </div>

              {canEditOrderStructure && replaceItemId && (
                <div className="space-y-4 rounded-2xl border border-border/70 bg-muted/10 p-5 sm:p-6">
                  <div className="space-y-2">
                    <Label className="text-sm font-semibold sm:text-base">
                      Buscar reemplazo en SAP
                    </Label>
                    <Input
                      className="h-12 text-base sm:h-14 sm:text-lg"
                      value={replacementSearch}
                      onChange={event =>
                        setReplacementSearch(event.target.value)
                      }
                      placeholder="Buscar por código o descripción"
                    />
                  </div>

                  <div className="max-h-72 overflow-y-auto rounded-2xl border border-border/70 bg-background">
                    {(sapMatches || []).length === 0 ? (
                      <div className="p-4 text-base text-muted-foreground">
                        Escribe al menos 2 caracteres para buscar en SAP.
                      </div>
                    ) : (
                      <div className="divide-y divide-border">
                        {(sapMatches || []).map((match: any) => (
                          <button
                            key={match.id}
                            className="w-full px-4 py-4 text-left hover:bg-muted/50"
                            onClick={() =>
                              replaceMutation.mutate({
                                purchaseOrderItemId: replaceItemId,
                                currentSapItemCode: match.itemCode,
                                itemName: match.description,
                              })
                            }
                          >
                            <div className="font-mono text-sm font-medium text-primary">
                              {match.itemCode}
                            </div>
                            <div className="text-base">{match.description}</div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {hasPendingPricingChanges ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  Hay cambios de cantidad, precio o impuesto sin guardar. Guarde
                  las lineas antes de descargar o enviar la OC.
                </div>
              ) : null}

              <div className="flex flex-wrap justify-end gap-3 border-t border-border/70 pt-1">
                {!isOrderReceived ? (
                  <Button
                    variant="outline"
                    size="lg"
                    className="h-10 min-w-[220px] px-5 text-sm font-semibold text-destructive sm:h-11 sm:text-base"
                    onClick={handleCancelOrder}
                    disabled={
                      items.length === 0 ||
                      Boolean(isOrderCancelled) ||
                      hasReceivedItems ||
                      cancelOrderMutation.isPending ||
                      sendMutation.isPending ||
                      updateMutation.isPending ||
                      updateItemLineMutation.isPending ||
                      deleteItemMutation.isPending ||
                      reopenDraftMutation.isPending ||
                      hasPendingPricingChanges
                    }
                  >
                    <XCircle className="mr-2 h-4 w-4" />
                    {cancelOrderMutation.isPending
                      ? "Cancelando..."
                      : "Cancelar orden"}
                  </Button>
                ) : null}

                <Button
                  variant="outline"
                  size="lg"
                  className="h-10 min-w-[210px] px-5 text-sm font-semibold sm:h-11 sm:text-base"
                  onClick={() => {
                    const downloaded = downloadBase64Document({
                      base64: detail.purchaseOrder.printedDocumentContent,
                      fileName: detail.purchaseOrder.printedDocumentName,
                      mimeType: detail.purchaseOrder.printedDocumentMimeType,
                    });
                    if (!downloaded)
                      toast.error("La OC no tiene documento generado");
                  }}
                  disabled={
                    items.length === 0 ||
                    detail.purchaseOrder.status === "anulada" ||
                    hasPendingPricingChanges ||
                    updateItemLineMutation.isPending ||
                    deleteItemMutation.isPending ||
                    updateMutation.isPending ||
                    cancelOrderMutation.isPending ||
                    reopenDraftMutation.isPending
                  }
                >
                  <Download className="mr-2 h-4 w-4" />
                  Descargar PDF
                </Button>

                {canEditOrderStructure ? (
                  <Button
                    size="lg"
                    className="h-10 min-w-[220px] px-5 text-sm font-semibold sm:h-11 sm:text-base"
                    onClick={() =>
                      sendMutation.mutate({ id: detail.purchaseOrder.id })
                    }
                    disabled={
                      items.length === 0 ||
                      sendMutation.isPending ||
                      updateMutation.isPending ||
                      updateItemLineMutation.isPending ||
                      deleteItemMutation.isPending ||
                      cancelOrderMutation.isPending ||
                      reopenDraftMutation.isPending ||
                      hasOrderReceipts ||
                      hasPendingPricingChanges
                    }
                  >
                    <Send className="mr-2 h-4 w-4" />
                    {sendMutation.isPending ? "Emitiendo..." : "Emitir orden"}
                  </Button>
                ) : null}

                {canReopenDraft && !canEditOrderStructure ? (
                  <Button
                    size="lg"
                    className="h-10 min-w-[220px] px-5 text-sm font-semibold sm:h-11 sm:text-base"
                    onClick={() =>
                      reopenDraftMutation.mutate({
                        id: detail.purchaseOrder.id,
                      })
                    }
                    disabled={
                      reopenDraftMutation.isPending ||
                      updateMutation.isPending ||
                      updateItemLineMutation.isPending ||
                      deleteItemMutation.isPending ||
                      cancelOrderMutation.isPending ||
                      sendMutation.isPending
                    }
                  >
                    <Pencil className="mr-2 h-4 w-4" />
                    {reopenDraftMutation.isPending
                      ? "Reabriendo..."
                      : "Volver a edición"}
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={confirmState.kind !== null}
        onOpenChange={open => {
          if (!open && !confirmActionPending) {
            setConfirmState({ kind: null });
          }
        }}
      >
        <AlertDialogContent className="max-w-[560px] overflow-hidden rounded-2xl border-border/70 p-0 shadow-2xl">
          <div className="border-b border-border/70 bg-muted/20 px-6 py-5">
            <div className="flex items-start gap-4">
              <div
                className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${
                  confirmState.kind === "close-receipt-line"
                    ? "bg-amber-100 text-amber-700"
                    : "bg-destructive/10 text-destructive"
                }`}
              >
                {confirmState.kind === "delete-item" ? (
                  <Trash2 className="h-5 w-5" />
                ) : confirmState.kind === "close-receipt-line" ? (
                  <ShieldX className="h-5 w-5" />
                ) : (
                  <XCircle className="h-5 w-5" />
                )}
              </div>
              <AlertDialogHeader className="gap-2 text-left">
                <AlertDialogTitle className="text-xl font-semibold tracking-tight">
                  {confirmState.kind === "delete-item"
                    ? confirmState.isLastItem
                      ? "Eliminar última línea"
                      : "Eliminar línea"
                    : confirmState.kind === "close-receipt-line"
                      ? "Cerrar línea para recepción"
                      : "Cancelar orden de compra"}
                </AlertDialogTitle>
                <AlertDialogDescription className="text-sm leading-6 text-muted-foreground">
                  {confirmState.kind === "delete-item"
                    ? confirmState.isLastItem
                      ? `Se eliminará la última línea "${confirmState.itemName}" y la orden de compra quedará anulada.`
                      : `Se eliminará la línea "${confirmState.itemName}" de la orden de compra.`
                    : confirmState.kind === "close-receipt-line"
                      ? `La línea "${confirmState.itemName}" quedará cerrada con un saldo pendiente de ${confirmState.pendingQuantity.toLocaleString(
                          "es-HN",
                          {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          }
                        )} ${confirmState.unit || ""}. Después de eso ya no aparecerá en Recepciones. Si lo necesitas, también puedes mandar ese saldo a una nueva solicitud de compra.`
                      : confirmState.kind === "cancel-order"
                        ? `Se anulará la orden ${confirmState.orderNumber}. El detalle no se borrará, pero los ítems volverán a quedar habilitados en la requisición.`
                        : ""}
                </AlertDialogDescription>
              </AlertDialogHeader>
            </div>
          </div>

          <div className="space-y-4 px-6 py-5">
            <div className="rounded-2xl border border-border/70 bg-muted/10 px-4 py-3 text-sm text-muted-foreground">
              {confirmState.kind === "delete-item"
                ? "Esta acción no se puede deshacer."
                : confirmState.kind === "close-receipt-line"
                  ? "Puedes solo cerrar la línea o enviar el saldo pendiente a una solicitud de compra reutilizable para esta misma orden."
                  : "La orden quedará visible como historial, pero ya no se podrá editar ni enviar al proveedor."}
            </div>

            <AlertDialogFooter className="gap-3 sm:justify-end">
              {confirmState.kind === "close-receipt-line" ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleMovePendingToPurchaseRequest}
                  disabled={confirmActionPending}
                  className="h-11 rounded-xl px-5 text-sm font-semibold"
                >
                  {movePendingToPurchaseRequestMutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Enviando a SC...
                    </>
                  ) : (
                    <>
                      <ShoppingCart className="mr-2 h-4 w-4" />
                      Pasar pendiente a SC
                    </>
                  )}
                </Button>
              ) : null}
              <AlertDialogCancel
                disabled={confirmActionPending}
                className="h-11 rounded-xl px-5 text-sm font-semibold"
              >
                Volver
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={handleConfirmAction}
                disabled={confirmActionPending}
                className="h-11 rounded-xl bg-destructive px-5 text-sm font-semibold text-destructive-foreground hover:bg-destructive/90"
              >
                {confirmActionPending
                  ? confirmState.kind === "delete-item"
                    ? "Eliminando..."
                    : confirmState.kind === "close-receipt-line"
                      ? "Cerrando..."
                      : "Cancelando..."
                  : confirmState.kind === "delete-item"
                    ? "Confirmar eliminación"
                    : confirmState.kind === "close-receipt-line"
                      ? "Confirmar cierre"
                      : "Confirmar cancelación"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
