import { trpc } from "@/lib/trpc";
import { downloadBase64Document } from "@/lib/document-download";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ArrowRightLeft,
  Check,
  ChevronsUpDown,
  Download,
  Loader2,
  Pencil,
  Plus,
  Printer,
  Search,
  Send,
  ShoppingCart,
  ShieldX,
  Trash2,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
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
const STATUS_COLORS: Record<string, string> = {
  borrador: "border-slate-300 bg-slate-50 text-slate-700",
  emitida: "border-blue-300 bg-blue-50 text-blue-700",
  enviada: "border-blue-300 bg-blue-50 text-blue-700",
  parcialmente_recibida: "border-cyan-300 bg-cyan-50 text-cyan-700",
  recibida: "border-emerald-300 bg-emerald-50 text-emerald-700",
  anulada: "border-rose-300 bg-rose-50 text-rose-700",
};
const PURCHASE_TYPE_LABELS: Record<string, string> = {
  local: "Compra Local",
  extranjera: "Compra Extranjera",
  compra_directa: "Compra Directa",
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
const PURCHASE_REQUEST_ORIGIN_STATUSES = new Set([
  "pendiente",
  "en_revision",
  "aprobada",
  "parcialmente_convertida",
]);

function formatSupplierOptionLabel(supplier?: any | null) {
  if (!supplier) return "Seleccione proveedor";
  return [supplier.supplierCode, supplier.name].filter(Boolean).join(" — ");
}

function SupplierCommandList({
  suppliers,
  selectedSupplierId,
  onSelect,
}: {
  suppliers: any[];
  selectedSupplierId: string;
  onSelect: (supplierId: string) => void;
}) {
  const [search, setSearch] = useState("");
  const commandContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const list = commandContainerRef.current?.querySelector<HTMLElement>(
        '[data-slot="command-list"]'
      );
      list?.scrollTo({ top: 0 });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [search]);

  return (
    <div ref={commandContainerRef}>
      <Command>
        <CommandInput
          placeholder="Buscar proveedor por código o nombre..."
          value={search}
          onValueChange={setSearch}
        />
        <CommandList>
          <CommandEmpty>No se encontraron proveedores.</CommandEmpty>
          <CommandGroup>
            {suppliers.map((supplier: any) => {
              const supplierId = String(supplier.id);
              const selected = selectedSupplierId === supplierId;

              return (
                <CommandItem
                  key={supplier.id}
                  value={`${supplier.id} ${supplier.supplierCode} ${supplier.name}`}
                  onSelect={() => onSelect(supplierId)}
                >
                  <Check
                    className={`h-4 w-4 ${
                      selected ? "opacity-100" : "opacity-0"
                    }`}
                  />
                  <span className="truncate">
                    {formatSupplierOptionLabel(supplier)}
                  </span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        </CommandList>
      </Command>
    </div>
  );
}

function getPurchaseRequestProjectLabel(row: any) {
  return (
    row?.projectSummary?.label ||
    (row?.project ? `${row.project.code} — ${row.project.name}` : "Proyecto pendiente")
  );
}

function getPurchaseRequestOriginLabel(row: any) {
  const requestNumber = row?.purchaseRequest?.requestNumber ?? "SC pendiente";
  return `${requestNumber} — ${getPurchaseRequestProjectLabel(row)}`;
}

function getPurchaseRequestItemPendingConversionQuantity(item: any) {
  const explicitPending = item?.pendingConversionQuantity;
  if (explicitPending !== null && explicitPending !== undefined) {
    const parsed = Number(explicitPending);
    return Number.isFinite(parsed) ? Math.max(parsed, 0) : 0;
  }

  const requestedQuantity = Number(item?.quantity ?? 0);
  const convertedQuantity = Number(item?.convertedQuantity ?? 0);
  if (!Number.isFinite(requestedQuantity)) return 0;
  return Math.max(
    requestedQuantity - (Number.isFinite(convertedQuantity) ? convertedQuantity : 0),
    0
  );
}

function formatQuantity(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return "0.00";
  return parsed.toLocaleString("es-HN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
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
  if (!Number.isFinite(parsed)) return "0.00";
  return parsed.toLocaleString("es-HN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
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

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatQuantityPayload(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed.toFixed(2) : "0.00";
}

type PurchaseOrderItemDraft = {
  quantity: string;
  unitPrice: string;
  taxCode: PurchaseOrderTaxCode;
};

const EMPTY_ORIGIN_ITEMS: any[] = [];

function getDefaultOriginItemDraft(item: any): PurchaseOrderItemDraft {
  return {
    quantity: formatQuantityPayload(
      getPurchaseRequestItemPendingConversionQuantity(item)
    ),
    unitPrice: formatQuantityPayload(item.unitPrice ?? "0.00"),
    taxCode: normalizePurchaseOrderTaxCode(item.taxCode),
  };
}

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
  const { user } = useAuth();
  const userRole = (user as any)?.buildreqRole;
  const canManagePurchaseOrders =
    user?.role === "admin" ||
    userRole === "jefe_bodega_central" ||
    userRole === "administracion_central" ||
    userRole === "administrador_proyecto";
  const canCreatePurchaseOrder =
    user?.role === "admin" ||
    userRole === "administracion_central" ||
    userRole === "administrador_proyecto";
  const isProjectAdmin = userRole === "administrador_proyecto";
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [newOrderDialogOpen, setNewOrderDialogOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [purchaseTypeFilter, setPurchaseTypeFilter] = useState("all");
  const [originPopoverOpen, setOriginPopoverOpen] = useState(false);
  const [originSearch, setOriginSearch] = useState("");
  const [selectedOriginId, setSelectedOriginId] = useState("");
  const [replaceItemId, setReplaceItemId] = useState<number | null>(null);
  const [replacementSearch, setReplacementSearch] = useState("");
  const [selectedSupplierId, setSelectedSupplierId] = useState("");
  const [supplierPopoverOpen, setSupplierPopoverOpen] = useState(false);
  const [savingItemId, setSavingItemId] = useState<number | null>(null);
  const [deletingItemId, setDeletingItemId] = useState<number | null>(null);
  const [itemDrafts, setItemDrafts] = useState<
    Record<number, PurchaseOrderItemDraft>
  >({});
  const [originItemDrafts, setOriginItemDrafts] = useState<
    Record<number, PurchaseOrderItemDraft>
  >({});
  const [confirmState, setConfirmState] = useState<PurchaseOrderConfirmState>({
    kind: null,
  });

  const { data: orders, isLoading } = trpc.purchaseOrders.list.useQuery();
  const {
    data: purchaseRequestOrigins,
    isLoading: isLoadingPurchaseRequestOrigins,
  } = trpc.purchaseRequests.list.useQuery(undefined, {
    enabled: canCreatePurchaseOrder && newOrderDialogOpen,
  });
  const selectedOriginIdNumber = Number(selectedOriginId || 0);
  const {
    data: selectedOriginDetail,
    isLoading: isLoadingSelectedOriginDetail,
  } = trpc.purchaseRequests.getById.useQuery(
    { id: selectedOriginIdNumber },
    {
      enabled:
        canCreatePurchaseOrder &&
        newOrderDialogOpen &&
        selectedOriginIdNumber > 0,
    }
  );
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

  const createFromOriginMutation =
    trpc.purchaseOrders.createFromPurchaseRequest.useMutation({
      onSuccess: result => {
        const purchaseOrderNumbers =
          "purchaseOrders" in result && Array.isArray(result.purchaseOrders)
            ? result.purchaseOrders.map(entry => entry.purchaseOrderNumber)
            : result.purchaseOrderNumber
              ? [result.purchaseOrderNumber]
              : [];
        const purchaseOrderId =
          "purchaseOrderId" in result && result.purchaseOrderId
            ? result.purchaseOrderId
            : "purchaseOrders" in result && Array.isArray(result.purchaseOrders)
              ? result.purchaseOrders[0]?.purchaseOrderId
              : null;

        toast.success(
          purchaseOrderNumbers.length === 1
            ? `OC ${purchaseOrderNumbers[0]} generada`
            : `Se generaron ${purchaseOrderNumbers.length} órdenes de compra`
        );
        setNewOrderDialogOpen(false);
        setSelectedOriginId("");
        setOriginSearch("");
        setOriginPopoverOpen(false);
        setOriginItemDrafts({});
        void Promise.all([
          utils.purchaseOrders.list.invalidate(),
          utils.purchaseRequests.list.invalidate(),
        ]);
        if (purchaseOrderId) {
          setSelectedId(purchaseOrderId);
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
          canManagePurchaseOrders &&
          Boolean(selectedId) &&
          Boolean(selectedSupplierId) &&
          purchaseOrderSapCodes.length > 0,
      }
    );
  const currentSupplierEmail =
    detail?.purchaseOrder.supplierEmail ?? detail?.supplier?.email ?? "";
  const orderStatus = detail?.purchaseOrder.status ?? "";
  const canEditOrderStructure =
    canManagePurchaseOrders && ORDER_STRUCTURE_EDITABLE_STATUSES.has(orderStatus);
  const isOrderCancelled = orderStatus === "anulada";
  const isOrderReceived = orderStatus === "recibida";
  const isOrderReadOnly = Boolean(
    !canManagePurchaseOrders || isOrderCancelled || isOrderReceived
  );
  const hasReceivedItems = items.some(
    (item: any) => Number(item.receivedQuantity ?? 0) > 0
  );
  const hasOrderReceipts =
    hasReceivedItems || RECEIVED_ORDER_STATUSES.has(orderStatus);
  const canReopenDraft =
    canManagePurchaseOrders &&
    ["emitida", "enviada"].includes(orderStatus) &&
    !hasOrderReceipts;
  const filteredOrders = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();

    return (orders ?? []).filter((row: any) => {
      const purchaseOrder = row.purchaseOrder;
      const projectLabel = row.project
        ? `${row.project.code} ${row.project.name}`
        : "";
      const matchesSearch =
        !normalizedSearch ||
        [
          purchaseOrder.orderNumber,
          purchaseOrder.classification,
          PURCHASE_TYPE_LABELS[purchaseOrder.purchaseType],
          row.supplier?.name,
          row.supplier?.supplierCode,
          projectLabel,
        ]
          .filter(Boolean)
          .some(value =>
            String(value).toLowerCase().includes(normalizedSearch)
          );
      const matchesStatus =
        statusFilter === "all" || purchaseOrder.status === statusFilter;
      const matchesType =
        purchaseTypeFilter === "all" ||
        purchaseOrder.purchaseType === purchaseTypeFilter;

      return matchesSearch && matchesStatus && matchesType;
    });
  }, [orders, purchaseTypeFilter, searchTerm, statusFilter]);
  const purchaseRequestOriginRows = useMemo(() => {
    const normalizedSearch = originSearch.trim().toLowerCase();

    return (purchaseRequestOrigins ?? []).filter((row: any) => {
      const purchaseRequest = row.purchaseRequest;
      if (!PURCHASE_REQUEST_ORIGIN_STATUSES.has(purchaseRequest.status)) {
        return false;
      }
      if (
        row.pendingConversionItemCount !== undefined &&
        Number(row.pendingConversionItemCount) <= 0
      ) {
        return false;
      }
      if (isProjectAdmin && purchaseRequest.purchaseType !== "compra_directa") {
        return false;
      }

      if (!normalizedSearch) {
        return true;
      }

      return [
        purchaseRequest.requestNumber,
        purchaseRequest.sapDocumentNumber,
        PURCHASE_TYPE_LABELS[purchaseRequest.purchaseType] || purchaseRequest.purchaseType,
        getPurchaseRequestProjectLabel(row),
      ]
        .filter(Boolean)
        .some(value =>
          String(value).toLowerCase().includes(normalizedSearch)
        );
    });
  }, [isProjectAdmin, originSearch, purchaseRequestOrigins]);
  const selectedOriginRow = useMemo(
    () =>
      purchaseRequestOriginRows.find(
        (row: any) => String(row.purchaseRequest.id) === selectedOriginId
      ) ??
      (purchaseRequestOrigins ?? []).find(
        (row: any) => String(row.purchaseRequest.id) === selectedOriginId
      ) ??
      null,
    [purchaseRequestOriginRows, purchaseRequestOrigins, selectedOriginId]
  );
  const selectedOriginAllItems =
    selectedOriginDetail?.items ?? EMPTY_ORIGIN_ITEMS;
  const selectedOriginItems = useMemo(() => {
    if (!selectedOriginDetail) return [];
    if (
      !PURCHASE_REQUEST_ORIGIN_STATUSES.has(
        selectedOriginDetail.purchaseRequest.status
      )
    ) {
      return [];
    }
    if (
      isProjectAdmin &&
      selectedOriginDetail.purchaseRequest.purchaseType !== "compra_directa"
    ) {
      return [];
    }
    const assignedProjectId = (user as any)?.assignedProjectId;

    return selectedOriginAllItems.filter((item: any) => {
      if (getPurchaseRequestItemPendingConversionQuantity(item) <= 0) {
        return false;
      }

      if (!isProjectAdmin) return true;
      const itemProjectId =
        item.sourceProject?.id ?? selectedOriginDetail.purchaseRequest.projectId;
      return assignedProjectId === itemProjectId;
    });
  }, [isProjectAdmin, selectedOriginAllItems, selectedOriginDetail, user]);
  const getOriginItemDraft = (item: any): PurchaseOrderItemDraft =>
    originItemDrafts[item.id] ?? getDefaultOriginItemDraft(item);
  const selectedOriginItemsToConvert = useMemo(
    () =>
      selectedOriginItems.map((item: any) => {
        const draft = getOriginItemDraft(item);
        return {
          purchaseRequestItemId: item.id,
          quantity: formatQuantityPayload(draft.quantity),
          unitPrice: formatQuantityPayload(draft.unitPrice),
          taxCode: draft.taxCode,
        };
      }),
    [originItemDrafts, selectedOriginItems]
  );
  const selectedOriginItemIds = useMemo(
    () =>
      selectedOriginItemsToConvert.map(
        (item: { purchaseRequestItemId: number }) => item.purchaseRequestItemId
      ),
    [selectedOriginItemsToConvert]
  );
  const selectedOriginTotalPendingQuantity = useMemo(
    () =>
      selectedOriginItems.reduce(
        (sum: number, item: any) =>
          sum + getPurchaseRequestItemPendingConversionQuantity(item),
        0
      ),
    [selectedOriginItems]
  );
  const originPricingSummary = useMemo(
    () =>
      summarizePurchaseOrderLines(
        selectedOriginItems.map((item: any) => {
          const draft = getOriginItemDraft(item);
          return {
            quantity: draft.quantity,
            unitPrice: draft.unitPrice,
            taxCode: draft.taxCode,
          };
        })
      ),
    [originItemDrafts, selectedOriginItems]
  );
  const originDraftValidationMessage = useMemo(() => {
    for (const item of selectedOriginItems) {
      const draft = getOriginItemDraft(item);
      const quantity = Number(draft.quantity);
      const unitPrice = Number(draft.unitPrice);
      const pendingQuantity = getPurchaseRequestItemPendingConversionQuantity(item);

      if (!Number.isFinite(quantity) || quantity <= 0) {
        return `Ingrese una cantidad mayor que cero para ${item.itemName}`;
      }
      if (quantity > pendingQuantity) {
        return `La cantidad de ${item.itemName} excede el pendiente`;
      }
      if (!Number.isFinite(unitPrice) || unitPrice < 0) {
        return `Ingrese un precio válido para ${item.itemName}`;
      }
    }

    return null;
  }, [originItemDrafts, selectedOriginItems]);
  const selectedSupplierIdNumber = Number(selectedSupplierId || 0);
  const selectedSupplierCreatePayload = useMemo(
    () =>
      selectedSupplierIdNumber > 0
        ? {
            supplierId: selectedSupplierIdNumber,
            ...(selectedSupplier?.email
              ? { supplierEmail: selectedSupplier.email }
              : {}),
          }
        : {},
    [selectedSupplier?.email, selectedSupplierIdNumber]
  );
  const canCreateFromSelectedOrigin =
    selectedOriginIdNumber > 0 &&
    !isLoadingSelectedOriginDetail &&
    selectedOriginItemIds.length > 0 &&
    !originDraftValidationMessage &&
    !createFromOriginMutation.isPending;

  useEffect(() => {
    if (!newOrderDialogOpen || selectedOriginItems.length === 0) {
      setOriginItemDrafts(current =>
        Object.keys(current).length > 0 ? {} : current
      );
      return;
    }

    setOriginItemDrafts(current => {
      let changed = Object.keys(current).length !== selectedOriginItems.length;
      const nextEntries = selectedOriginItems.map((item: any) => {
        const draft = current[item.id] ?? getDefaultOriginItemDraft(item);
        if (!current[item.id]) {
          changed = true;
        }
        return [item.id, draft];
      });

      return changed ? Object.fromEntries(nextEntries) : current;
    });
  }, [newOrderDialogOpen, selectedOriginItems]);

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

    const updates: Array<{
      itemId: number;
      draft: PurchaseOrderItemDraft;
    }> = [];
    const nextDrafts = { ...itemDrafts };

    for (const item of detail.items) {
      const sapCode = item.currentSapItemCode ?? item.originalSapItemCode;
      if (!sapCode) continue;

      const latestPrice = latestSupplierPrices[sapCode];
      if (!latestPrice?.unitPrice) continue;

      const currentDraft = itemDrafts[item.id] ?? {
        quantity: String(item.quantity ?? "0.00"),
        unitPrice: String(item.unitPrice ?? "0.00"),
        taxCode: normalizePurchaseOrderTaxCode(item.taxCode),
      };

      if (Number(item.unitPrice ?? 0) > 0) continue;
      if (Number(currentDraft.unitPrice ?? 0) > 0) continue;

      const nextDraft = {
        ...currentDraft,
        unitPrice: latestPrice.unitPrice,
      };

      nextDrafts[item.id] = nextDraft;
      updates.push({
        itemId: item.id,
        draft: nextDraft,
      });
    }

    if (updates.length === 0) return;

    setItemDrafts(nextDrafts);
    for (const update of updates) {
      updateItemLineMutation.mutate({
        purchaseOrderItemId: update.itemId,
        quantity: update.draft.quantity,
        unitPrice: update.draft.unitPrice,
        taxCode: update.draft.taxCode,
      });
    }
  }, [canEditOrderStructure, detail?.items, latestSupplierPrices]);

  const getItemDraft = (item: any): PurchaseOrderItemDraft =>
    itemDrafts[item.id] ?? {
      quantity: String(item.quantity ?? "0.00"),
      unitPrice: String(item.unitPrice ?? "0.00"),
      taxCode: normalizePurchaseOrderTaxCode(item.taxCode),
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
      items.some((item: any) => {
        const draft = getItemDraft(item);
        return (
          Number(draft.quantity || 0) !== Number(item.quantity ?? 0) ||
          Number(draft.unitPrice || 0) !== Number(item.unitPrice ?? 0) ||
          draft.taxCode !== normalizePurchaseOrderTaxCode(item.taxCode)
        );
      }),
    [canEditOrderStructure, items, itemDrafts]
  );
  const emissionBlockReason = useMemo(() => {
    if (!detail) return null;
    if (!selectedSupplierId && !detail.purchaseOrder.supplierId) {
      return "Seleccione un proveedor antes de emitir la OC";
    }

    const itemWithoutPrice = items.find((item: any) => {
      const unitPrice = Number(getItemDraft(item).unitPrice || 0);
      return !Number.isFinite(unitPrice) || unitPrice <= 0;
    });
    if (itemWithoutPrice) {
      return `Ingrese un precio unitario mayor que cero para ${itemWithoutPrice.itemName}`;
    }

    return null;
  }, [detail, items, itemDrafts, selectedSupplierId]);

  const confirmActionPending =
    deleteItemMutation.isPending ||
    cancelOrderMutation.isPending ||
    reopenDraftMutation.isPending ||
    closeReceiptLineMutation.isPending ||
    movePendingToPurchaseRequestMutation.isPending;

  const handleSupplierChange = (value: string) => {
    setSelectedSupplierId(value);
    if (!detail) return;
    if (!canEditOrderStructure) {
      toast.error("La OC ya fue emitida y no se puede actualizar");
      return;
    }
    if (!value) {
      toast.error("Seleccione un proveedor");
      return;
    }

    const nextSupplier = (suppliersList || []).find(
      (supplier: any) => supplier.id === Number(value)
    );
    const nextSupplierEmail = nextSupplier?.email ?? "";
    const supplierChanged =
      Number(value) !== detail.purchaseOrder.supplierId ||
      nextSupplierEmail !== currentSupplierEmail;

    if (!supplierChanged) {
      return;
    }

    updateMutation.mutate({
      id: detail.purchaseOrder.id,
      supplierId: Number(value),
      supplierEmail: nextSupplier?.email ?? null,
    });
  };

  const handleSaveItemLine = (item: any, draftOverride?: PurchaseOrderItemDraft) => {
    if (!canEditOrderStructure) {
      toast.error("La OC ya fue emitida y no se puede actualizar");
      return;
    }

    const draft = draftOverride ?? getItemDraft(item);
    if (
      Number(draft.quantity || 0) === Number(item.quantity ?? 0) &&
      Number(draft.unitPrice || 0) === Number(item.unitPrice ?? 0) &&
      draft.taxCode === normalizePurchaseOrderTaxCode(item.taxCode)
    ) {
      return;
    }
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
    if (!canManagePurchaseOrders) {
      toast.error("El Bodeguero de Proyecto solo puede consultar la OC");
      return;
    }
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

  const handlePrintPurchaseOrder = () => {
    if (!detail) return;

    const purchaseOrder = detail.purchaseOrder;
    const supplierName = detail.supplier?.name ?? "Proveedor pendiente";
    const projectLabel = detail.project
      ? `${detail.project.code} ${detail.project.name}`
      : `Proyecto ${purchaseOrder.projectId}`;
    const destinationLabel =
      detail.purchaseRequest?.printDestination?.trim() ||
      detail.project?.name ||
      projectLabel;
    const requestedByLabel = detail.createdBy?.name || user?.name || "-";
    const deliveryDate = purchaseOrder.neededBy
      ? formatPrintDate(purchaseOrder.neededBy)
      : "INMEDIATA";
    const observations = purchaseOrder.notes?.trim() || "-";
    const quoteLabel = detail.purchaseRequest?.quoteAttachmentId
      ? String(detail.purchaseRequest.quoteAttachmentId)
      : "-";
    const itemRows = items
      .map((item: any, index: number) => {
        const draft = getItemDraft(item);
        const amounts = calculatePurchaseOrderLineAmounts({
          quantity: draft.quantity,
          unitPrice: draft.unitPrice,
          taxCode: draft.taxCode,
        });
        return `
          <tr>
            <td class="center">${index + 1}</td>
            <td>${escapeHtml(item.itemName)}</td>
            <td class="center">${escapeHtml(
              item.currentSapItemCode || item.originalSapItemCode || "-"
            )}</td>
            <td class="numeric">${escapeHtml(formatPrintNumber(draft.quantity))}</td>
            <td class="numeric">${escapeHtml(formatPrintMoney(draft.unitPrice))}</td>
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
          <title>${escapeHtml(purchaseOrder.orderNumber)}</title>
          <style>
            @page { size: A4 landscape; margin: 8mm; }
            * { box-sizing: border-box; }
            body {
              color: #000;
              font-family: Arial, Helvetica, sans-serif;
              font-size: 12px;
              margin: 0;
              background: #fff;
            }
            .sheet {
              margin: 0 auto;
              max-width: 280mm;
              padding: 0 1mm 4mm;
            }
            .header {
              align-items: start;
              display: grid;
              grid-template-columns: 150px 1fr 150px;
              gap: 12px;
            }
            .logo {
              border: 1px solid #333;
              border-radius: 3px;
              height: 70px;
              padding-top: 7px;
              text-align: center;
              width: 134px;
            }
            .logo-small {
              font-size: 8px;
              font-weight: 700;
              line-height: 1;
            }
            .logo-main {
              font-size: 39px;
              font-weight: 900;
              letter-spacing: 0.01em;
              line-height: 0.95;
            }
            .logo-foot {
              font-size: 12px;
              font-weight: 800;
            }
            .title {
              font-size: 16px;
              font-weight: 800;
              line-height: 1.2;
              text-align: center;
              text-transform: uppercase;
            }
            .title .company {
              font-size: 18px;
            }
            .rule {
              border-top: 4px double #333;
              margin: 4px 0 24px;
            }
            .meta {
              display: grid;
              gap: 12px;
              grid-template-columns: 1.15fr 0.85fr;
            }
            .meta-left,
            .meta-right {
              display: grid;
              gap: 6px;
            }
            .field {
              display: grid;
              gap: 8px;
              grid-template-columns: 106px 1fr;
            }
            .meta-right .field {
              grid-template-columns: 80px 1fr;
            }
            .label {
              font-weight: 800;
            }
            .value {
              font-weight: 700;
            }
            table {
              border-collapse: collapse;
              margin-top: 24px;
              width: 100%;
            }
            th {
              border-bottom: 2px solid #999;
              font-weight: 800;
              padding: 4px 5px;
              text-align: center;
            }
            td {
              border-bottom: 1px solid #d7d7d7;
              padding: 5px;
              vertical-align: top;
            }
            .center { text-align: center; }
            .numeric {
              font-variant-numeric: tabular-nums;
              text-align: right;
            }
            .lower {
              display: grid;
              grid-template-columns: 1fr 245px;
              gap: 34px;
              margin-top: 12px;
            }
            .delivery {
              display: grid;
              gap: 5px;
            }
            .summary {
              border-collapse: collapse;
              margin-top: 0;
              width: 100%;
            }
            .summary td {
              border-bottom: 1px solid #999;
              font-weight: 800;
              padding: 4px 5px;
            }
            .summary td:first-child {
              text-align: left;
            }
            .signatures {
              display: grid;
              gap: 80px;
              grid-template-columns: repeat(2, 170px);
              justify-content: center;
              margin: 34px 0 28px;
            }
            .signature {
              border-top: 2px solid #111;
              font-weight: 700;
              padding-top: 6px;
              text-align: center;
            }
            .note {
              border: 2px solid #111;
              border-radius: 18px;
              font-size: 15px;
              line-height: 1.45;
              margin: 22px auto 0;
              max-width: 94%;
              padding: 12px 22px;
              text-align: center;
            }
            .note-title {
              display: block;
              font-weight: 800;
              margin-bottom: 2px;
            }
            .footer-user {
              font-size: 11px;
              margin-top: 16px;
            }
            @media print {
              .sheet { max-width: none; padding: 0; }
            }
          </style>
        </head>
        <body>
          <main class="sheet">
            <section class="header">
              <div class="logo">
                <div class="logo-small">HIDALGO e HIDALGO S.A.</div>
                <div class="logo-main">HeH</div>
                <div class="logo-foot">CONSTRUCTORES</div>
              </div>
              <div class="title">
                <div class="company">HIDALGO E HIDALGO HONDURAS SA DE CV</div>
                <div>RTN: 08019013549808</div>
                <div>ORDEN DE COMPRA</div>
                <div>${escapeHtml(projectLabel)}</div>
              </div>
              <div></div>
            </section>
            <div class="rule"></div>

            <section class="meta">
              <div class="meta-left">
                <div class="field">
                  <div class="label">Fecha:</div>
                  <div class="value">${escapeHtml(formatPrintDate(purchaseOrder.createdAt))}</div>
                </div>
                <div class="field">
                  <div class="label">Proveedor:</div>
                  <div class="value">${escapeHtml(supplierName)}</div>
                </div>
                <div class="field">
                  <div class="label">Asesor Vta:</div>
                  <div class="value">-</div>
                </div>
                <div class="field">
                  <div class="label">Destino:</div>
                  <div class="value">${escapeHtml(destinationLabel)}</div>
                </div>
              </div>
              <div class="meta-right">
                <div class="field">
                  <div class="label">Pedido:</div>
                  <div class="value">${escapeHtml(purchaseOrder.id)}</div>
                </div>
                <div class="field">
                  <div class="label">F Pago:</div>
                  <div class="value">CREDITO</div>
                </div>
                <div class="field">
                  <div class="label">Moneda:</div>
                  <div class="value">LEMPIRA</div>
                </div>
                <div class="field">
                  <div class="label">O Compra:</div>
                  <div class="value">${escapeHtml(purchaseOrder.orderNumber)}</div>
                </div>
              </div>
            </section>

            <table>
              <thead>
                <tr>
                  <th style="width: 8%;">Ítem</th>
                  <th>Descripcion</th>
                  <th style="width: 16%;">No. Parte</th>
                  <th style="width: 12%;">Cantidad</th>
                  <th style="width: 14%;">Valor U</th>
                  <th style="width: 14%;">Valor T</th>
                </tr>
              </thead>
              <tbody>
                ${itemRows || `<tr><td colspan="6">Sin ítems</td></tr>`}
              </tbody>
            </table>

            <section class="lower">
              <div class="delivery">
                <div class="field">
                  <div class="label">Fecha Entrega:</div>
                  <div class="value">${escapeHtml(deliveryDate)}</div>
                </div>
                <div class="field">
                  <div class="label">Solicitado:</div>
                  <div class="value">${escapeHtml(requestedByLabel)}</div>
                </div>
                <div class="field">
                  <div class="label">Observaciones:</div>
                  <div class="value">${escapeHtml(observations)}</div>
                </div>
                <div class="field">
                  <div class="label">Cotización:</div>
                  <div class="value">${escapeHtml(quoteLabel)}</div>
                </div>
              </div>
              <table class="summary">
                <tbody>
                  <tr>
                    <td>Subtotal</td>
                    <td class="numeric">${escapeHtml(formatPrintMoney(pricingSummary.subtotal))}</td>
                  </tr>
                  <tr>
                    <td>ISV 15%</td>
                    <td class="numeric">${escapeHtml(formatPrintMoney(pricingSummary.totalIsv))}</td>
                  </tr>
                  <tr>
                    <td>Total</td>
                    <td class="numeric">${escapeHtml(formatPrintMoney(pricingSummary.total))}</td>
                  </tr>
                  <tr>
                    <td>(-) Ret. ISV</td>
                    <td class="numeric">0.00</td>
                  </tr>
                  <tr>
                    <td>(-) Ret. ISR y Hon.</td>
                    <td class="numeric">0.00</td>
                  </tr>
                  <tr>
                    <td>Neto Pagar</td>
                    <td class="numeric">${escapeHtml(formatPrintMoney(pricingSummary.total))}</td>
                  </tr>
                </tbody>
              </table>
            </section>

            <section class="signatures">
              <div class="signature">Elaborado por:</div>
              <div class="signature">Autorizado por:</div>
            </section>

            <section class="note">
              <span class="note-title">Tomar Nota:</span>
              Emitir factura a nombre de: HIDALGO e HIDALGO HONDURAS SA DE CV; RTN: 08019013549808;
              Dirección: Blvd. Suyapa, Edificio Metropolis, Torre 2, Piso 20, Ofi. 22004.
              <br />
              Presentar con la factura su constancia de estar sujetos al RÉGIMEN DE PAGOS A CUENTA vigente,
              caso contrario se procederá
            </section>

            <div class="footer-user">${escapeHtml(requestedByLabel)}</div>
          </main>
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1>Órdenes de Compra</h1>
        {canCreatePurchaseOrder ? (
          <Button onClick={() => setNewOrderDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Nueva OC
          </Button>
        ) : null}
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchTerm}
            onChange={event => setSearchTerm(event.target.value)}
            placeholder="Buscar por OC, proyecto, proveedor o clasificación..."
            className="h-10 pl-9"
          />
        </div>
        <Select value={purchaseTypeFilter} onValueChange={setPurchaseTypeFilter}>
          <SelectTrigger className="h-10 w-full lg:w-56">
            <SelectValue placeholder="Tipo de compra" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los tipos</SelectItem>
            <SelectItem value="compra_directa">Compra Directa</SelectItem>
            <SelectItem value="local">Compra Local</SelectItem>
            <SelectItem value="extranjera">Compra Extranjera</SelectItem>
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
              Cargando órdenes de compra...
            </div>
          ) : !(orders || []).length ? (
            <div className="p-8 text-center text-muted-foreground">
              No hay órdenes de compra registradas
            </div>
          ) : !filteredOrders.length ? (
            <div className="p-8 text-center text-muted-foreground">
              No hay órdenes de compra que coincidan con los filtros
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
                  {filteredOrders.map((row: any) => (
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
                        {PURCHASE_TYPE_LABELS[row.purchaseOrder.purchaseType] || "—"}
                      </td>
                      <td className="p-3 text-xs">
                        {row.supplier?.name || "Proveedor pendiente"}
                      </td>
                      <td className="p-3">
                        <Badge
                          variant="outline"
                          className={`text-xs ${
                            STATUS_COLORS[row.purchaseOrder.status] || ""
                          }`}
                        >
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
        open={false}
        onOpenChange={open => {
          setNewOrderDialogOpen(open);
          if (!open) {
            setOriginPopoverOpen(false);
            setOriginSearch("");
            setSelectedOriginId("");
            setOriginItemDrafts({});
          }
        }}
      >
        <DialogContent className="scrollbar-none max-h-[calc(100vh-1rem)] w-[calc(100vw-1rem)] max-w-[980px] overflow-y-auto rounded-2xl p-5 sm:p-6">
          <DialogHeader className="border-b border-border/70 pb-4 pr-10">
            <DialogTitle className="text-2xl font-bold tracking-tight">
              Nueva orden de compra
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-5">
            <div className="grid gap-4 md:grid-cols-12">
              <div className="space-y-2 md:col-span-8">
                <Label>Origen</Label>
                <Popover
                  open={originPopoverOpen}
                  onOpenChange={setOriginPopoverOpen}
                >
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      role="combobox"
                      aria-expanded={originPopoverOpen}
                      className="h-11 w-full justify-between overflow-hidden px-3 font-normal"
                    >
                      <span className="truncate">
                        {selectedOriginRow
                          ? getPurchaseRequestOriginLabel(selectedOriginRow)
                          : "Seleccione una solicitud de compra"}
                      </span>
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    align="start"
                    className="w-[var(--radix-popover-trigger-width)] p-0"
                  >
                    <Command shouldFilter={false}>
                      <CommandInput
                        placeholder="Buscar SC por número, proyecto o documento..."
                        value={originSearch}
                        onValueChange={setOriginSearch}
                      />
                      <CommandList>
                        {isLoadingPurchaseRequestOrigins ? (
                          <div className="p-3 text-sm text-muted-foreground">
                            Cargando orígenes...
                          </div>
                        ) : (
                          <>
                            <CommandEmpty>No hay orígenes disponibles.</CommandEmpty>
                            <CommandGroup heading="Solicitudes de compra">
                              {purchaseRequestOriginRows.map((row: any) => {
                                const originId = String(row.purchaseRequest.id);
                                const selected = selectedOriginId === originId;

                                return (
                                  <CommandItem
                                    key={row.purchaseRequest.id}
                                    value={getPurchaseRequestOriginLabel(row)}
                                    onSelect={() => {
                                      setSelectedOriginId(originId);
                                      setOriginPopoverOpen(false);
                                      setOriginSearch("");
                                    }}
                                  >
                                    <Check
                                      className={`mr-2 h-4 w-4 ${
                                        selected ? "opacity-100" : "opacity-0"
                                      }`}
                                    />
                                    <div className="min-w-0">
                                      <p className="truncate text-sm font-medium">
                                        {getPurchaseRequestOriginLabel(row)}
                                      </p>
                                      <p className="truncate text-xs text-muted-foreground">
                                        {PURCHASE_TYPE_LABELS[
                                          row.purchaseRequest.purchaseType
                                        ] || row.purchaseRequest.purchaseType}
                                        {row.purchaseRequest.sapDocumentNumber
                                          ? ` · ${row.purchaseRequest.sapDocumentNumber}`
                                          : ""}
                                      </p>
                                    </div>
                                  </CommandItem>
                                );
                              })}
                            </CommandGroup>
                          </>
                        )}
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>

              <div className="space-y-2 md:col-span-4">
                <Label>Tipo de compra</Label>
                <div className="flex h-11 items-center rounded-md border border-input bg-muted/20 px-3 text-sm font-medium">
                  {selectedOriginDetail
                    ? PURCHASE_TYPE_LABELS[
                        selectedOriginDetail.purchaseRequest.purchaseType
                      ] || selectedOriginDetail.purchaseRequest.purchaseType
                    : "Pendiente"}
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-border/70">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 bg-muted/20 px-4 py-3">
                <div>
                  <p className="text-sm font-semibold">Ítems del origen</p>
                  <p className="text-xs text-muted-foreground">
                    {selectedOriginDetail
                      ? `${selectedOriginItemIds.length} ítem(s) · ${formatQuantity(
                          selectedOriginTotalPendingQuantity
                        )} pendiente`
                      : "Seleccione un origen para cargar los ítems"}
                  </p>
                </div>
                {selectedOriginDetail ? (
                  <Badge variant="outline" className="text-xs">
                    {selectedOriginDetail.purchaseRequest.requestNumber}
                  </Badge>
                ) : null}
              </div>

              {isLoadingSelectedOriginDetail ? (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  Cargando ítems...
                </div>
              ) : selectedOriginDetail ? (
                <div className="max-h-[340px] overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border/70">
                        <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          Ítem
                        </th>
                        <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          SAP
                        </th>
                        <th className="p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          Pendiente a convertir
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedOriginItems.length > 0 ? (
                        selectedOriginItems.map((item: any) => (
                          <tr
                            key={item.id}
                            className="border-b border-border/70 last:border-0"
                          >
                            <td className="p-3">
                              <p className="font-medium">{item.itemName}</p>
                              {item.sourceRequest?.requestNumber ? (
                                <p className="mt-0.5 text-xs text-muted-foreground">
                                  {item.sourceRequest.requestNumber}
                                </p>
                              ) : null}
                            </td>
                            <td className="p-3 font-mono text-xs">
                              {item.currentSapItemCode ||
                                item.originalSapItemCode ||
                                "—"}
                            </td>
                            <td className="p-3 text-right font-medium">
                              {formatQuantity(
                                getPurchaseRequestItemPendingConversionQuantity(item)
                              )}{" "}
                              {item.unit || ""}
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td
                            colSpan={3}
                            className="p-6 text-center text-sm text-muted-foreground"
                          >
                            La solicitud no tiene saldo pendiente por convertir.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  No hay origen seleccionado.
                </div>
              )}
            </div>

            <div className="flex flex-wrap justify-end gap-3 border-t border-border/70 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setNewOrderDialogOpen(false)}
                disabled={createFromOriginMutation.isPending}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                onClick={() =>
                  createFromOriginMutation.mutate({
                    purchaseRequestId: selectedOriginIdNumber,
                    itemsToConvert: selectedOriginItemsToConvert,
                    ...selectedSupplierCreatePayload,
                  })
                }
                disabled={!canCreateFromSelectedOrigin}
              >
                {createFromOriginMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <ShoppingCart className="mr-2 h-4 w-4" />
                )}
                {createFromOriginMutation.isPending ? "Creando..." : "Crear OC"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={newOrderDialogOpen || Boolean(selectedId)}
        onOpenChange={open => {
          if (!open) {
            setNewOrderDialogOpen(false);
            setOriginPopoverOpen(false);
            setOriginSearch("");
            setSelectedOriginId("");
            setSelectedId(null);
            setReplaceItemId(null);
            setReplacementSearch("");
            setSelectedSupplierId("");
            setSupplierPopoverOpen(false);
            setSavingItemId(null);
            setDeletingItemId(null);
            setItemDrafts({});
            setOriginItemDrafts({});
            setConfirmState({ kind: null });
          }
        }}
      >
        <DialogContent className="scrollbar-none max-h-[calc(100vh-0.75rem)] w-[calc(100vw-0.5rem)] max-w-[calc(100vw-0.5rem)] overflow-x-hidden overflow-y-auto rounded-2xl p-4 sm:max-h-[calc(100vh-1.5rem)] sm:w-[calc(100vw-2rem)] sm:max-w-[1600px] sm:p-6 lg:p-7">
          <DialogHeader className="border-b border-border/70 pb-4 pr-10">
            <div className="flex flex-wrap items-center gap-3">
              <DialogTitle className="text-[2.1rem] font-bold tracking-tight sm:text-[2.5rem]">
                {newOrderDialogOpen
                  ? "Nueva orden de compra"
                  : detail?.purchaseOrder.orderNumber || "Orden de Compra"}
              </DialogTitle>
              {newOrderDialogOpen ? (
                <Badge
                  variant="outline"
                  className={`text-sm ${STATUS_COLORS.borrador}`}
                >
                  Borrador
                </Badge>
              ) : detail?.purchaseOrder.status ? (
                <Badge
                  variant="outline"
                  className={`text-sm ${
                    STATUS_COLORS[detail.purchaseOrder.status] || ""
                  }`}
                >
                  {STATUS_LABELS[detail.purchaseOrder.status] ||
                    detail.purchaseOrder.status}
                </Badge>
              ) : null}
            </div>
          </DialogHeader>

          {newOrderDialogOpen ? (
            <div className="space-y-5">
              <div className="grid gap-3 md:grid-cols-12">
                <div className="space-y-2.5 rounded-2xl border border-border/70 bg-muted/20 p-3.5 sm:p-4 md:col-span-6 lg:col-span-4">
                  <Label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground sm:text-xs">
                    Origen
                  </Label>
                  <Popover
                    open={originPopoverOpen}
                    onOpenChange={setOriginPopoverOpen}
                  >
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        role="combobox"
                        aria-expanded={originPopoverOpen}
                        className="h-11 w-full justify-between overflow-hidden px-3 text-sm font-normal sm:h-12 sm:text-base"
                      >
                        <span className="truncate">
                          {selectedOriginRow
                            ? getPurchaseRequestOriginLabel(selectedOriginRow)
                            : "Seleccione una solicitud de compra"}
                        </span>
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent
                      align="start"
                      className="w-[var(--radix-popover-trigger-width)] p-0"
                    >
                      <Command shouldFilter={false}>
                        <CommandInput
                          placeholder="Buscar SC por número, proyecto o documento..."
                          value={originSearch}
                          onValueChange={setOriginSearch}
                        />
                        <CommandList>
                          {isLoadingPurchaseRequestOrigins ? (
                            <div className="p-3 text-sm text-muted-foreground">
                              Cargando orígenes...
                            </div>
                          ) : (
                            <>
                              <CommandEmpty>No hay orígenes disponibles.</CommandEmpty>
                              <CommandGroup heading="Solicitudes de compra">
                                {purchaseRequestOriginRows.map((row: any) => {
                                  const originId = String(row.purchaseRequest.id);
                                  const selected = selectedOriginId === originId;

                                  return (
                                    <CommandItem
                                      key={row.purchaseRequest.id}
                                      value={getPurchaseRequestOriginLabel(row)}
                                      onSelect={() => {
                                        setSelectedOriginId(originId);
                                        setOriginPopoverOpen(false);
                                        setOriginSearch("");
                                      }}
                                    >
                                      <Check
                                        className={`h-4 w-4 ${
                                          selected ? "opacity-100" : "opacity-0"
                                        }`}
                                      />
                                      <span className="truncate">
                                        {getPurchaseRequestOriginLabel(row)}
                                      </span>
                                    </CommandItem>
                                  );
                                })}
                              </CommandGroup>
                            </>
                          )}
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {selectedOriginDetail
                      ? getPurchaseRequestProjectLabel(selectedOriginRow)
                    : "Selecciona el origen para cargar los ítems."}
                  </p>
                </div>

                <div className="space-y-2.5 rounded-2xl border border-border/70 bg-muted/20 p-3.5 sm:p-4 md:col-span-6 lg:col-span-4">
                  <Label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground sm:text-xs">
                    Proveedor
                  </Label>
                  <Popover
                    open={supplierPopoverOpen}
                    onOpenChange={setSupplierPopoverOpen}
                  >
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        role="combobox"
                        aria-expanded={supplierPopoverOpen}
                        className="h-11 w-full justify-between overflow-hidden px-3 text-sm font-normal sm:h-12 sm:text-base"
                      >
                        <span className="truncate">
                          {formatSupplierOptionLabel(selectedSupplier)}
                        </span>
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent
                      align="start"
                      className="w-[var(--radix-popover-trigger-width)] p-0"
                    >
                      <SupplierCommandList
                        suppliers={suppliersList || []}
                        selectedSupplierId={selectedSupplierId}
                        onSelect={(supplierId) => {
                          setSelectedSupplierId(supplierId);
                          setSupplierPopoverOpen(false);
                        }}
                      />
                    </PopoverContent>
                  </Popover>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {selectedSupplier
                      ? selectedSupplier.email || "Proveedor sin correo configurado"
                      : "Seleccione proveedor antes de crear la OC."}
                  </p>
                </div>

                <div className="space-y-1.5 rounded-2xl border border-border/70 bg-muted/20 p-3.5 sm:p-4 md:col-span-4 lg:col-span-1">
                  <Label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground sm:text-xs">
                    Clasificación
                  </Label>
                  <p className="text-base font-semibold uppercase leading-tight sm:text-lg">
                    OC
                  </p>
                </div>

                <div className="space-y-1.5 rounded-2xl border border-border/70 bg-muted/20 p-3.5 sm:p-4 md:col-span-4 lg:col-span-2">
                  <Label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground sm:text-xs">
                    Fecha necesaria
                  </Label>
                  <p className="text-base font-semibold leading-tight sm:text-lg">
                    {selectedOriginDetail?.purchaseRequest.neededBy
                      ? new Date(
                          selectedOriginDetail.purchaseRequest.neededBy
                        ).toLocaleDateString("es-HN")
                      : "—"}
                  </p>
                </div>

                <div className="space-y-1.5 rounded-2xl border border-border/70 bg-muted/20 p-3.5 sm:p-4 md:col-span-4 lg:col-span-1">
                  <Label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground sm:text-xs">
                    Estado de emisión
                  </Label>
                  <p className="text-base font-semibold leading-tight sm:text-lg">
                    Pendiente
                  </p>
                </div>
              </div>

              <div className="overflow-x-auto rounded-2xl border border-border/70">
                <table className="min-w-[1220px] table-auto text-sm lg:text-[15px]">
                  <colgroup>
                    <col className="w-[310px]" />
                    <col className="w-[150px]" />
                    <col className="w-[210px]" />
                    <col className="w-[190px]" />
                    <col className="w-[170px]" />
                    <col className="w-[130px]" />
                    <col className="w-[130px]" />
                    <col className="w-[150px]" />
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
                        Pendiente a convertir
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
                    </tr>
                  </thead>
                  <tbody>
                    {isLoadingSelectedOriginDetail ? (
                      <tr>
                        <td
                          colSpan={8}
                          className="p-8 text-center text-sm text-muted-foreground"
                        >
                          Cargando ítems...
                        </td>
                      </tr>
                    ) : selectedOriginDetail && selectedOriginItems.length > 0 ? (
                      selectedOriginItems.map((item: any) => {
                        const draft = getOriginItemDraft(item);
                        const pendingQuantity =
                          getPurchaseRequestItemPendingConversionQuantity(item);
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
                              {(item.currentSapItemCode ||
                                item.originalSapItemCode) && (
                                <div className="mt-1.5 text-sm text-muted-foreground">
                                  Original:{" "}
                                  {item.currentSapItemCode ||
                                    item.originalSapItemCode}
                                </div>
                              )}
                            </td>
                            <td className="p-3 align-middle font-mono text-sm font-medium sm:p-4">
                              {item.currentSapItemCode ||
                                item.originalSapItemCode ||
                                "—"}
                            </td>
                            <td className="p-3 align-middle sm:p-4">
                              <div className="flex items-center justify-end gap-2">
                                <Input
                                  type="number"
                                  min="0.01"
                                  max={pendingQuantity}
                                  step="0.01"
                                  value={draft.quantity}
                                  onChange={event =>
                                    setOriginItemDrafts(current => ({
                                      ...current,
                                      [item.id]: {
                                        ...draft,
                                        quantity: event.target.value,
                                      },
                                    }))
                                  }
                                  className="h-10 w-28 text-right"
                                />
                                <span className="w-12 text-left font-medium">
                                  {item.unit || ""}
                                </span>
                              </div>
                              <p className="mt-1 text-right text-xs text-muted-foreground">
                                Máx. {formatQuantity(pendingQuantity)}
                              </p>
                            </td>
                            <td className="p-3 align-middle sm:p-4">
                              <Input
                                type="number"
                                min="0"
                                step="0.01"
                                value={draft.unitPrice}
                                onChange={event =>
                                  setOriginItemDrafts(current => ({
                                    ...current,
                                    [item.id]: {
                                      ...draft,
                                      unitPrice: event.target.value,
                                    },
                                  }))
                                }
                                className="h-10 text-right"
                              />
                            </td>
                            <td className="p-3 align-middle sm:p-4">
                              <Select
                                value={draft.taxCode}
                                onValueChange={(value: PurchaseOrderTaxCode) =>
                                  setOriginItemDrafts(current => ({
                                    ...current,
                                    [item.id]: {
                                      ...draft,
                                      taxCode: value,
                                    },
                                  }))
                                }
                              >
                                <SelectTrigger className="h-10">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {PURCHASE_ORDER_TAX_OPTIONS.map(option => (
                                    <SelectItem
                                      key={option.value}
                                      value={option.value}
                                    >
                                      {option.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </td>
                            <td className="p-3 text-right align-middle font-semibold sm:p-4">
                              {formatPurchaseOrderCurrency(lineAmounts.subtotal)}
                            </td>
                            <td className="p-3 text-right align-middle font-semibold sm:p-4">
                              {formatPurchaseOrderCurrency(lineAmounts.taxAmount)}
                            </td>
                            <td className="p-3 text-right align-middle font-semibold sm:p-4">
                              {formatPurchaseOrderCurrency(lineAmounts.total)}
                            </td>
                          </tr>
                        );
                      })
                    ) : selectedOriginDetail ? (
                      <tr>
                        <td
                          colSpan={8}
                          className="p-8 text-center text-sm text-muted-foreground"
                        >
                          La solicitud no tiene saldo pendiente por convertir.
                        </td>
                      </tr>
                    ) : (
                      <tr>
                        <td
                          colSpan={8}
                          className="p-8 text-center text-sm text-muted-foreground"
                        >
                          Selecciona un origen para cargar los ítems.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="flex justify-end border-t border-border bg-muted/10 px-3 py-4 sm:px-4">
                <div className="w-full max-w-[320px] space-y-2.5 rounded-2xl border border-border/70 bg-background p-4">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Subtotal</span>
                    <span className="font-medium">
                      {formatPurchaseOrderCurrency(originPricingSummary.subtotal)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Total exento</span>
                    <span className="font-medium">
                      {formatPurchaseOrderCurrency(
                        originPricingSummary.totalExempt
                      )}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Total ISV</span>
                    <span className="font-medium">
                      {formatPurchaseOrderCurrency(originPricingSummary.totalIsv)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between border-t border-border pt-3 text-base font-semibold">
                    <span>Total</span>
                    <span>{formatPurchaseOrderCurrency(originPricingSummary.total)}</span>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/70 pt-1">
                <p className="min-h-5 text-sm text-destructive">
                  {originDraftValidationMessage ?? ""}
                </p>
                <div className="flex flex-wrap justify-end gap-3">
                <Button
                  variant="outline"
                  size="lg"
                  className="h-10 min-w-[180px] px-5 text-sm font-semibold sm:h-11 sm:text-base"
                  onClick={() => {
                    setNewOrderDialogOpen(false);
                    setOriginPopoverOpen(false);
                    setOriginSearch("");
                    setSelectedOriginId("");
                    setOriginItemDrafts({});
                  }}
                  disabled={createFromOriginMutation.isPending}
                >
                  Cancelar
                </Button>
                <Button
                  size="lg"
                  className="h-10 min-w-[220px] px-5 text-sm font-semibold sm:h-11 sm:text-base"
                  onClick={() =>
                    createFromOriginMutation.mutate({
                      purchaseRequestId: selectedOriginIdNumber,
                      itemsToConvert: selectedOriginItemsToConvert,
                      ...selectedSupplierCreatePayload,
                    })
                  }
                  disabled={!canCreateFromSelectedOrigin}
                >
                  {createFromOriginMutation.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <ShoppingCart className="mr-2 h-4 w-4" />
                  )}
                  {createFromOriginMutation.isPending ? "Creando..." : "Crear OC"}
                </Button>
                </div>
              </div>
            </div>
          ) : detailLoading ? (
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
                  <Popover
                    open={supplierPopoverOpen}
                    onOpenChange={setSupplierPopoverOpen}
                  >
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        role="combobox"
                        aria-expanded={supplierPopoverOpen}
                        className="h-11 w-full justify-between overflow-hidden px-3 text-sm font-normal sm:h-12 sm:text-base"
                        disabled={!canEditOrderStructure}
                      >
                        <span className="truncate">
                          {formatSupplierOptionLabel(selectedSupplier)}
                        </span>
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent
                      align="start"
                      className="w-[var(--radix-popover-trigger-width)] p-0"
                    >
                      <SupplierCommandList
                        suppliers={suppliersList || []}
                        selectedSupplierId={selectedSupplierId}
                        onSelect={(supplierId) => {
                          handleSupplierChange(supplierId);
                          setSupplierPopoverOpen(false);
                        }}
                      />
                    </PopoverContent>
                  </Popover>
                  <div className="flex flex-wrap items-center gap-3">
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      {updateMutation.isPending
                        ? "Guardando proveedor..."
                        : selectedSupplier
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
                <table className="min-w-[1420px] table-auto text-sm lg:text-[15px]">
                  <colgroup>
                    <col className="w-[250px]" />
                    <col className="w-[150px]" />
                    <col className="w-[230px]" />
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
                      const isSavingThisLine = savingItemId === item.id;
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
                                onChange={event => {
                                  const nextDraft = {
                                    ...getItemDraft(item),
                                    quantity: event.target.value,
                                  };
                                  setItemDrafts(current => ({
                                    ...current,
                                    [item.id]: nextDraft,
                                  }));
                                }}
                                onBlur={() => handleSaveItemLine(item)}
                                className="h-10 w-full max-w-[190px] text-right text-sm sm:max-w-[200px] sm:text-base"
                                placeholder="0.00"
                                disabled={!canEditOrderStructure || isSavingThisLine}
                              />
                              <span className="min-w-[56px] text-right text-xs font-medium text-muted-foreground sm:min-w-[64px] sm:text-sm">
                                {item.unit || "—"}
                              </span>
                            </div>
                            {isSavingThisLine ? (
                              <div className="mt-1.5 text-right text-[11px] text-muted-foreground">
                                Guardando...
                              </div>
                            ) : null}
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
                                onChange={event => {
                                  const nextDraft = {
                                    ...getItemDraft(item),
                                    unitPrice: event.target.value,
                                  };
                                  setItemDrafts(current => ({
                                    ...current,
                                    [item.id]: nextDraft,
                                  }));
                                }}
                                onBlur={() => handleSaveItemLine(item)}
                                className="h-10 w-full text-right text-sm sm:text-base"
                                placeholder="0.00"
                                disabled={!canEditOrderStructure || isSavingThisLine}
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
                              onValueChange={value => {
                                const nextDraft = {
                                  ...getItemDraft(item),
                                  taxCode: value as PurchaseOrderTaxCode,
                                };
                                setItemDrafts(current => ({
                                  ...current,
                                  [item.id]: nextDraft,
                                }));
                                handleSaveItemLine(item, nextDraft);
                              }}
                              disabled={!canEditOrderStructure || isSavingThisLine}
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
                  Hay cambios de cantidad, precio o impuesto pendientes de guardado automático. Sal del campo para terminar la actualización antes de descargar o emitir la OC.
                </div>
              ) : null}
              {canEditOrderStructure && emissionBlockReason ? (
                <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                  {emissionBlockReason}
                </div>
              ) : null}

              <div className="flex flex-wrap justify-end gap-3 border-t border-border/70 pt-1">
                {canManagePurchaseOrders && !isOrderReceived ? (
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
                  onClick={handlePrintPurchaseOrder}
                  disabled={
                    items.length === 0 ||
                    updateItemLineMutation.isPending ||
                    deleteItemMutation.isPending ||
                    updateMutation.isPending ||
                    cancelOrderMutation.isPending ||
                    reopenDraftMutation.isPending
                  }
                >
                  <Printer className="mr-2 h-4 w-4" />
                  Imprimir documento
                </Button>

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
                    onClick={() => {
                      if (emissionBlockReason) {
                        toast.error(emissionBlockReason);
                        return;
                      }
                      sendMutation.mutate({ id: detail.purchaseOrder.id });
                    }}
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
