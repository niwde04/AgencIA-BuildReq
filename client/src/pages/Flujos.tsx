import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
import { formatPurchaseOrderCurrency } from "@shared/purchase-orders";
import {
  ArrowLeft,
  ArrowLeftRight,
  Check,
  Package,
  RotateCcw,
  ShoppingCart,
  Truck,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";

type QueueFlowType =
  | "compra_directa"
  | "despacho_bodega"
  | "traslado_proyecto"
  | "solicitud_compra";
type PurchaseType = "local" | "extranjera" | "compra_directa";
type DirectPurchasePaymentMethod =
  | "linea_credito"
  | "fondo_proyecto"
  | "caja_chica";

const PURCHASE_TYPE_LABELS: Record<PurchaseType, string> = {
  local: "Compra Local",
  extranjera: "Compra Extranjera",
  compra_directa: "Compra Directa",
};

const getPurchaseTypeLabel = (value?: string | null) =>
  PURCHASE_TYPE_LABELS[value as PurchaseType] ?? "—";

const PAYMENT_METHOD_LABELS: Record<DirectPurchasePaymentMethod, string> = {
  linea_credito: "Línea de Crédito",
  fondo_proyecto: "Fondo del proyecto",
  caja_chica: "Fondo del proyecto",
};

const getPaymentMethodLabel = (value?: string | null) =>
  PAYMENT_METHOD_LABELS[value as DirectPurchasePaymentMethod] ?? "—";

const FLOW_ORDER: QueueFlowType[] = [
  "despacho_bodega",
  "compra_directa",
  "traslado_proyecto",
  "solicitud_compra",
];

const FLOW_LABELS: Record<QueueFlowType, string> = {
  despacho_bodega: "Salida de inventario",
  compra_directa: "Compra directa",
  traslado_proyecto: "Solicitud de traslado",
  solicitud_compra: "Solicitud de compra",
};

const FLOW_DESCRIPTIONS: Record<QueueFlowType, string> = {
  despacho_bodega: "Crea una salida de inventario en borrador para la requisición seleccionada.",
  compra_directa: "Genera una solicitud de compra directa para luego convertirla en OC.",
  traslado_proyecto: "Crea la solicitud de traslado entre proyectos.",
  solicitud_compra: "Genera la solicitud de compra para Oficina Central.",
};

const FLOW_ROUTE_HINTS: Record<QueueFlowType, string> = {
  despacho_bodega: "Se atiende aquí, genera una salida SB en borrador y continúa en Salidas de Inventario.",
  compra_directa: "Se atiende aquí, genera una SC y luego continúa en Solicitudes de Compra.",
  traslado_proyecto: "Se atiende aquí y luego continúa en Solicitudes de Traslado.",
  solicitud_compra: "Se atiende aquí y luego continúa en Solicitudes de Compra.",
};

const FLOW_ICONS: Record<QueueFlowType, any> = {
  despacho_bodega: Truck,
  compra_directa: Package,
  traslado_proyecto: ArrowLeftRight,
  solicitud_compra: ShoppingCart,
};

const FLOW_COLORS: Record<QueueFlowType, string> = {
  despacho_bodega: "bg-emerald-50 border-emerald-200 text-emerald-700",
  compra_directa: "bg-blue-50 border-blue-200 text-blue-700",
  traslado_proyecto: "bg-amber-50 border-amber-200 text-amber-700",
  solicitud_compra: "bg-fuchsia-50 border-fuchsia-200 text-fuchsia-700",
};

const STATUS_LABELS: Record<string, string> = {
  pendiente: "Pendiente",
  en_proceso: "En proceso",
  completado: "Completado",
  cancelado: "Cancelado",
};

const STATUS_COLORS: Record<string, string> = {
  pendiente: "border-amber-300 bg-amber-50 text-amber-700",
  en_proceso: "border-blue-300 bg-blue-50 text-blue-700",
  completado: "border-emerald-300 bg-emerald-50 text-emerald-700",
  cancelado: "border-rose-300 bg-rose-50 text-rose-700",
};

type PendingQueueRow = {
  item: any;
  request: any;
  project: any;
  purchaseInsight?: {
    sapDescription: string | null;
    lastPurchase: {
      unitPrice: string;
      supplierId: number | null;
      supplierCode: string | null;
      supplierName: string | null;
      orderNumber: string | null;
      purchasedAt: string | Date | null;
    } | null;
    minimumPurchase: {
      unitPrice: string;
      supplierId: number | null;
      supplierCode: string | null;
      supplierName: string | null;
      orderNumber: string | null;
      purchasedAt: string | Date | null;
    } | null;
  } | null;
};

const parseQuantityValue = (value: unknown) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatQuantityValue = (value: unknown) => parseQuantityValue(value).toFixed(2);

const getPendingDispatchQuantity = (item: any) =>
  Math.max(
    parseQuantityValue(item.quantity) - parseQuantityValue(item.dispatchedQuantity),
    0
  );

const getAvailableDispatchQuantity = (item: any) =>
  Math.max(parseQuantityValue(item.projectStock), 0);

const getSuggestedDispatchQuantity = (item: any) =>
  Math.min(getPendingDispatchQuantity(item), getAvailableDispatchQuantity(item));

const getDispatchWarehouseOptionId = (warehouse: any) =>
  Number(warehouse?.warehouseId ?? warehouse?.id ?? 0);

const getDispatchWarehouseOptionQuantity = (warehouse: any) => {
  if (warehouse?.quantity === undefined || warehouse?.quantity === null) {
    return null;
  }

  return parseQuantityValue(warehouse.quantity);
};

const getDispatchWarehouseOptionLabel = (warehouse: any) =>
  warehouse?.displayName ||
  warehouse?.warehouseDisplayName ||
  warehouse?.warehouseName ||
  warehouse?.name ||
  (warehouse?.warehouseCode
    ? `${warehouse.warehouseCode}`
    : `Almacén #${getDispatchWarehouseOptionId(warehouse)}`);

const getDispatchWarehouseOptionsForRow = (row: PendingQueueRow) => {
  const stockWarehouses = ((row.item?.projectStockWarehouses ?? []) as any[]).filter(
    (warehouse) =>
      getDispatchWarehouseOptionId(warehouse) > 0 && warehouse.isActive !== false
  );

  if (stockWarehouses.length > 0) {
    return stockWarehouses;
  }

  return ((row.project?.warehouses ?? []) as any[]).filter(
    (warehouse) =>
      getDispatchWarehouseOptionId(warehouse) > 0 && warehouse.isActive !== false
  );
};

const getDefaultDispatchWarehouseIdForRow = (row: PendingQueueRow) => {
  const warehouses = getDispatchWarehouseOptionsForRow(row);
  const warehouseWithStock =
    warehouses.find((warehouse) => {
      const quantity = getDispatchWarehouseOptionQuantity(warehouse);
      return quantity === null || quantity > 0;
    }) ?? warehouses[0];

  return getDispatchWarehouseOptionId(warehouseWithStock);
};

const formatSupplierReferenceLabel = (reference: {
  supplierCode?: string | null;
  supplierName?: string | null;
} | null | undefined) => {
  if (!reference?.supplierCode && !reference?.supplierName) {
    return "Proveedor pendiente";
  }

  if (reference?.supplierCode && reference?.supplierName) {
    return `${reference.supplierCode} — ${reference.supplierName}`;
  }

  return reference?.supplierName || reference?.supplierCode || "Proveedor pendiente";
};

const getTransferSourceOptionValue = (option: {
  projectId: number;
  warehouseId: number;
}) => `${option.projectId}:${option.warehouseId}`;

const parseTransferSourceOptionValue = (value?: string | null) => {
  if (!value) return null;
  const [projectId, warehouseId] = value.split(":").map(Number);
  if (
    !Number.isInteger(projectId) ||
    projectId <= 0 ||
    !Number.isInteger(warehouseId) ||
    warehouseId <= 0
  ) {
    return null;
  }

  return { projectId, warehouseId };
};

export default function Flujos() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();
  const [flowFilter, setFlowFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [processingFlowType, setProcessingFlowType] = useState<QueueFlowType | null>(null);
  const [returningQueuedFlowType, setReturningQueuedFlowType] =
    useState<QueueFlowType | null>(null);
  const [returningDispatchItemId, setReturningDispatchItemId] = useState<number | null>(null);
  const [returningTransferItemId, setReturningTransferItemId] = useState<number | null>(null);
  const [dispatchNotesByFlowType, setDispatchNotesByFlowType] = useState<
    Partial<Record<QueueFlowType, string>>
  >({});
  const [dispatchReceivedByFlowType, setDispatchReceivedByFlowType] = useState<
    Partial<Record<QueueFlowType, string>>
  >({});
  const [dispatchQuantityByItemId, setDispatchQuantityByItemId] = useState<Record<number, string>>(
    {}
  );
  const [dispatchWarehouseByItemId, setDispatchWarehouseByItemId] = useState<Record<number, string>>(
    {}
  );
  const [dispatchCheckedByItemId, setDispatchCheckedByItemId] = useState<
    Record<number, boolean>
  >({});
  const [directPurchasePaymentMethodByFlowType, setDirectPurchasePaymentMethodByFlowType] =
    useState<Partial<Record<QueueFlowType, DirectPurchasePaymentMethod>>>({});
  const [directPurchaseNotesByFlowType, setDirectPurchaseNotesByFlowType] = useState<
    Partial<Record<QueueFlowType, string>>
  >({});
  const [directPurchaseCheckedByItemId, setDirectPurchaseCheckedByItemId] = useState<
    Record<number, boolean>
  >({});
  const [directPurchaseQuantityByItemId, setDirectPurchaseQuantityByItemId] = useState<
    Record<number, string>
  >({});
  const [transferCheckedByItemId, setTransferCheckedByItemId] = useState<
    Record<number, boolean>
  >({});
  const [transferWarehouseByItemId, setTransferWarehouseByItemId] = useState<
    Record<number, string>
  >({});
  const [transferNotesByFlowType, setTransferNotesByFlowType] = useState<
    Partial<Record<QueueFlowType, string>>
  >({});
  const [purchaseRequestTypeByFlowType, setPurchaseRequestTypeByFlowType] = useState<
    Partial<Record<QueueFlowType, string>>
  >({});
  const [purchaseRequestNotesByFlowType, setPurchaseRequestNotesByFlowType] = useState<
    Partial<Record<QueueFlowType, string>>
  >({});
  const [purchaseRequestCheckedByItemId, setPurchaseRequestCheckedByItemId] = useState<
    Record<number, boolean>
  >({});

  const userRole = (user as any)?.buildreqRole || "";
  const isAdmin = user?.role === "admin";
  const canProcessAllFlows =
    isAdmin ||
    userRole === "jefe_bodega_central" ||
    userRole === "administracion_central";
  const canProcessAnyFlow =
    canProcessAllFlows ||
    userRole === "administrador_proyecto" ||
    userRole === "bodeguero_proyecto";
  const canProcessFlow = (flowType: QueueFlowType) =>
    canProcessAllFlows ||
    (userRole === "administrador_proyecto" &&
      (flowType === "compra_directa" || flowType === "solicitud_compra")) ||
    (userRole === "bodeguero_proyecto" &&
      flowType === "despacho_bodega");
  const isReadOnlyFlowViewer = !canProcessAnyFlow;
  const readOnlyScopeLabel =
    userRole === "ingeniero_residente" ? "tus requisiciones" : "tu proyecto";

  const allowedFlowTypes = useMemo(() => {
    if (canProcessAllFlows || userRole === "ingeniero_residente") {
      return FLOW_ORDER;
    }

    if (userRole === "administrador_proyecto") {
      return ["compra_directa", "solicitud_compra"] as QueueFlowType[];
    }

    if (userRole === "bodeguero_proyecto") {
      return [
        "despacho_bodega",
        "compra_directa",
        "traslado_proyecto",
      ] as QueueFlowType[];
    }

    return [] as QueueFlowType[];
  }, [canProcessAllFlows, userRole]);

  const pendingQueueQueryInput =
    flowFilter !== "all" ? { flowType: flowFilter } : undefined;
  const historyQueryInput = {
    ...(flowFilter !== "all" ? { flowType: flowFilter } : {}),
    ...(statusFilter !== "all" ? { status: statusFilter } : {}),
  };

  const { data: pendingQueue, isLoading: pendingQueueLoading } =
    trpc.supplyFlows.pendingQueue.useQuery(pendingQueueQueryInput);
  const { data: flowHistory, isLoading: historyLoading } =
    trpc.supplyFlows.list.useQuery(historyQueryInput);
  const directPurchaseMutation = trpc.supplyFlows.createDirectPurchaseBatch.useMutation();
  const projectTransferBatchMutation =
    trpc.supplyFlows.createProjectTransferBatch.useMutation();
  const purchaseRequestMutation = trpc.supplyFlows.createPurchaseRequest.useMutation();
  const purchaseRequestBatchMutation =
    trpc.supplyFlows.createPurchaseRequestBatch.useMutation();
  const warehouseExitBatchMutation = trpc.requestItems.recordWarehouseExitBatch.useMutation();
  const returnQueuedMutation =
    trpc.requestItems.returnQueuedToRequisition.useMutation();
  const returnDispatchMutation =
    trpc.requestItems.returnDispatchToRequisition.useMutation();
  const returnTransferMutation =
    trpc.requestItems.returnTransferToRequisition.useMutation();

  const invalidateAll = () =>
    Promise.all([
      utils.materialRequests.list.invalidate(),
      utils.supplyFlows.pendingQueue.invalidate(),
      utils.supplyFlows.list.invalidate(),
      utils.purchaseOrders.list.invalidate(),
      utils.purchaseRequests.list.invalidate(),
      utils.transferRequests.list.invalidate(),
      utils.transfers.list.invalidate(),
      utils.warehouseExits.list.invalidate(),
      utils.inventory.list.invalidate(),
      utils.inventory.projectStockForItems.invalidate(),
      utils.inventory.visibleWarehouseStockForItems.invalidate(),
    ]);

  const visiblePendingRows = useMemo(
    () =>
      (pendingQueue || []).filter((row: PendingQueueRow) =>
        allowedFlowTypes.includes(row.item.assignedFlow as QueueFlowType)
      ),
    [allowedFlowTypes, pendingQueue]
  );

  const pendingRowsByFlow = useMemo(() => {
    const grouped = Object.fromEntries(
      FLOW_ORDER.map((flowType) => [flowType, [] as PendingQueueRow[]])
    ) as Record<QueueFlowType, PendingQueueRow[]>;

    for (const row of visiblePendingRows) {
      const flowType = row.item.assignedFlow as QueueFlowType;
      if (!flowType) continue;
      grouped[flowType].push(row);
    }

    return grouped;
  }, [visiblePendingRows]);

  const pendingCountByFlow = useMemo(
    () =>
      Object.fromEntries(
        FLOW_ORDER.map((flowType) => [
          flowType,
          pendingRowsByFlow[flowType].length,
        ])
      ) as Record<QueueFlowType, number>,
    [pendingRowsByFlow]
  );

  const transferStockItems = useMemo(
    () =>
      (pendingRowsByFlow.traslado_proyecto || []).map((row) => ({
        id: row.item.id,
        sapItemCode: row.item.sapItemCode || null,
        itemName: row.item.itemName || "",
      })),
    [pendingRowsByFlow]
  );
  const { data: transferOriginStock, isFetching: transferOriginStockLoading } =
    trpc.inventory.visibleWarehouseStockForItems.useQuery(
      {
        items: transferStockItems,
      },
      {
        enabled:
          canProcessAllFlows &&
          transferStockItems.length > 0,
      }
    );
  const transferOriginStockByItemId = useMemo(
    () =>
      new Map(
        (transferOriginStock || []).map((entry: any) => [
          Number(entry.itemId),
          entry.quantity,
        ])
      ),
    [transferOriginStock]
  );
  const transferOriginStockRowsByItemId = useMemo(
    () =>
      new Map(
        (transferOriginStock || []).map((entry: any) => [
          Number(entry.itemId),
          entry,
        ])
      ),
    [transferOriginStock]
  );

  const visibleHistoryRows = useMemo(
    () =>
      (flowHistory || []).filter((row: any) =>
        allowedFlowTypes.includes(row.flow.flowType as QueueFlowType)
      ),
    [allowedFlowTypes, flowHistory]
  );

  const historyCountByFlow = useMemo(
    () =>
      Object.fromEntries(
        FLOW_ORDER.map((flowType) => [
          flowType,
          visibleHistoryRows.filter((row: any) => row.flow.flowType === flowType).length,
        ])
      ) as Record<QueueFlowType, number>,
    [visibleHistoryRows]
  );

  const visibleFlowSections = useMemo(
    () => (flowFilter === "all" ? allowedFlowTypes : allowedFlowTypes.filter((type) => type === flowFilter)),
    [allowedFlowTypes, flowFilter]
  );

  const getErrorMessage = (error: unknown) =>
    error instanceof Error ? error.message : "No se pudo procesar el flujo";

  const resetProcessedItemDrafts = (itemIds: number[]) => {
    setDispatchQuantityByItemId((current) => {
      const next = { ...current };
      for (const itemId of itemIds) delete next[itemId];
      return next;
    });
    setDispatchWarehouseByItemId((current) => {
      const next = { ...current };
      for (const itemId of itemIds) delete next[itemId];
      return next;
    });
    setDispatchCheckedByItemId((current) => {
      const next = { ...current };
      for (const itemId of itemIds) delete next[itemId];
      return next;
    });
    setDirectPurchaseCheckedByItemId((current) => {
      const next = { ...current };
      for (const itemId of itemIds) delete next[itemId];
      return next;
    });
    setDirectPurchaseQuantityByItemId((current) => {
      const next = { ...current };
      for (const itemId of itemIds) delete next[itemId];
      return next;
    });
    setTransferCheckedByItemId((current) => {
      const next = { ...current };
      for (const itemId of itemIds) delete next[itemId];
      return next;
    });
    setTransferWarehouseByItemId((current) => {
      const next = { ...current };
      for (const itemId of itemIds) delete next[itemId];
      return next;
    });
    setPurchaseRequestCheckedByItemId((current) => {
      const next = { ...current };
      for (const itemId of itemIds) delete next[itemId];
      return next;
    });
  };

  const processDirectPurchaseFlow = async (flowType: QueueFlowType) => {
    const rows = pendingRowsByFlow[flowType];
    const paymentMethod = directPurchasePaymentMethodByFlowType[flowType];
    const selectedRows = rows.filter(
      (row) => directPurchaseCheckedByItemId[row.item.id] === true
    );

    if (!paymentMethod) {
      toast.error("Seleccione el método de pago para la compra directa");
      return;
    }
    if (selectedRows.length === 0) {
      toast.error("Seleccione al menos un detalle para la compra directa");
      return;
    }

    const invalidItem = selectedRows.find((row) => {
      const item = row.item;
      const selectedQuantity = Number(
        directPurchaseQuantityByItemId[item.id] ?? String(item.quantity ?? "0.00")
      );
      const maxQuantity = Number(item.quantity ?? 0);
      return (
        !Number.isFinite(selectedQuantity) ||
        selectedQuantity <= 0 ||
        selectedQuantity > maxQuantity
      );
    });

    if (invalidItem) {
      toast.error(`La cantidad de ${invalidItem.item.itemName} no es válida`);
      return;
    }

    setProcessingFlowType(flowType);
    try {
      const result = await directPurchaseMutation.mutateAsync({
        paymentMethod: paymentMethod as "linea_credito" | "fondo_proyecto",
        notes: directPurchaseNotesByFlowType[flowType] || undefined,
        items: selectedRows.map((row) => ({
          requestId: row.request.id,
          requestItemId: row.item.id,
          quantity:
            directPurchaseQuantityByItemId[row.item.id] ??
            String(row.item.quantity ?? "0.00"),
        })),
      });

      const purchaseRequestNumbers =
        "purchaseRequests" in result && Array.isArray(result.purchaseRequests)
          ? result.purchaseRequests.map((entry) => entry.purchaseRequestNumber)
          : result.purchaseRequestNumber
            ? [result.purchaseRequestNumber]
            : [];

      resetProcessedItemDrafts(selectedRows.map((row) => row.item.id));
      await invalidateAll();
      toast.success(
        purchaseRequestNumbers.length === 1
          ? `Se generó la solicitud ${purchaseRequestNumbers[0]} para ${result.processedItems} ítem(s)`
          : `Se generaron ${purchaseRequestNumbers.length} solicitudes para ${result.processedItems} ítem(s)`
      );
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setProcessingFlowType(null);
    }
  };

  const getSelectedQueuedRows = (flowType: QueueFlowType) => {
    if (flowType === "compra_directa") {
      return pendingRowsByFlow[flowType].filter(
        (row) => directPurchaseCheckedByItemId[row.item.id] === true
      );
    }

    if (flowType === "solicitud_compra") {
      return pendingRowsByFlow[flowType].filter(
        (row) => purchaseRequestCheckedByItemId[row.item.id] === true
      );
    }

    return [] as PendingQueueRow[];
  };

  const returnSelectedQueuedToRequisition = async (flowType: QueueFlowType) => {
    const selectedRows = getSelectedQueuedRows(flowType);

    if (selectedRows.length === 0) {
      toast.error("Seleccione al menos un detalle para quitar del flujo");
      return;
    }

    setReturningQueuedFlowType(flowType);
    try {
      const result = await returnQueuedMutation.mutateAsync({
        flowType,
        itemIds: selectedRows.map((row) => row.item.id),
      });

      resetProcessedItemDrafts(selectedRows.map((row) => row.item.id));
      await invalidateAll();
      toast.success(
        `Se quitaron ${result.returnedItems} ítem(s) del flujo y volvieron a la requisición`
      );
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setReturningQueuedFlowType(null);
    }
  };

  const processWarehouseDispatchFlow = async (flowType: QueueFlowType) => {
    const receivedByName = dispatchReceivedByFlowType[flowType]?.trim() ?? "";
    if (!receivedByName) {
      toast.error("Ingrese quién recibe la salida");
      return;
    }

    const rows = pendingRowsByFlow[flowType];
    const selectedRows = rows.filter(
      (row) => dispatchCheckedByItemId[row.item.id] === true
    );
    const dispatchRows: Array<{
      row: PendingQueueRow;
      dispatchedQuantity: string;
      warehouseId: number;
    }> = [];

    if (rows.length === 0) {
      toast.error("No hay ítems pendientes para crear salida de bodega");
      return;
    }
    if (selectedRows.length === 0) {
      toast.error("Seleccione al menos un detalle para crear salida de inventario");
      return;
    }
    for (const row of selectedRows) {
      const item = row.item;
      const defaultWarehouseId = getDefaultDispatchWarehouseIdForRow(row);
      const warehouseId = Number(
        dispatchWarehouseByItemId[item.id] ?? defaultWarehouseId ?? 0
      );
      const selectedWarehouse = getDispatchWarehouseOptionsForRow(row).find(
        (warehouse) => getDispatchWarehouseOptionId(warehouse) === warehouseId
      );
      const selectedWarehouseQuantity =
        getDispatchWarehouseOptionQuantity(selectedWarehouse);
      const pendingQuantity = getPendingDispatchQuantity(item);
      const availableQuantity = getAvailableDispatchQuantity(item);
      const dispatchedQuantity =
        dispatchQuantityByItemId[item.id] ??
        getSuggestedDispatchQuantity(item).toFixed(2);
      const dispatchedNumber = Number(dispatchedQuantity);

      if (!Number.isFinite(dispatchedNumber) || dispatchedNumber < 0) {
        toast.error(`${item.itemName}: revise la cantidad a despachar`);
        return;
      }
      if (dispatchedNumber <= 0) continue;
      if (!warehouseId) {
        toast.error(`${item.itemName}: seleccione almacén origen`);
        return;
      }
      if (dispatchedNumber - pendingQuantity > 0.000001) {
        toast.error(
          `${item.itemName}: la cantidad despachada no puede exceder la cantidad pendiente`
        );
        return;
      }
      if (dispatchedNumber - availableQuantity > 0.000001) {
        toast.error(
          `${item.itemName}: la cantidad despachada no puede exceder la existencia disponible`
        );
        return;
      }
      if (
        selectedWarehouseQuantity !== null &&
        dispatchedNumber - selectedWarehouseQuantity > 0.000001
      ) {
        toast.error(
          `${item.itemName}: la cantidad despachada no puede exceder la existencia de la bodega seleccionada`
        );
        return;
      }

      dispatchRows.push({ row, dispatchedQuantity, warehouseId });
    }

    if (dispatchRows.length === 0) {
      toast.error(
        "No hay existencia disponible para crear salida. Use A requisición para cambiar el saldo a otro flujo"
      );
      return;
    }

    const rowsByRequestId = new Map<number, typeof dispatchRows>();
    for (const dispatchRow of dispatchRows) {
      const requestId = dispatchRow.row.request.id;
      const currentRows = rowsByRequestId.get(requestId) ?? [];
      currentRows.push(dispatchRow);
      rowsByRequestId.set(requestId, currentRows);
    }

    setProcessingFlowType(flowType);

    const processedItemIds: number[] = [];
    const createdExitNumbers: string[] = [];

    try {
      for (const [requestId, requestRows] of Array.from(rowsByRequestId.entries())) {
        const result = await warehouseExitBatchMutation.mutateAsync({
          requestId,
        items: requestRows.map(({ row, dispatchedQuantity, warehouseId }) => ({
            requestItemId: row.item.id,
            dispatchedQuantity,
            warehouseId,
          })),
          note: dispatchNotesByFlowType[flowType] || undefined,
          receivedByName,
        });

        if (result?.exitNumber) {
          createdExitNumbers.push(result.exitNumber);
        }
        processedItemIds.push(...requestRows.map(({ row }) => row.item.id));
      }

      resetProcessedItemDrafts(processedItemIds);
      setDispatchReceivedByFlowType((current) => ({
        ...current,
        [flowType]: "",
      }));
      await invalidateAll();

      if (createdExitNumbers.length <= 1) {
        const exitLabel = createdExitNumbers[0] ? ` ${createdExitNumbers[0]}` : "";
        toast.success(
          `Salida de inventario${exitLabel} creada en borrador para ${processedItemIds.length} ítem(s)`
        );
      } else {
        toast.success(
          `Se crearon ${createdExitNumbers.length} salidas de inventario para ${processedItemIds.length} ítem(s)`
        );
      }
    } catch (error) {
      if (processedItemIds.length > 0) {
        resetProcessedItemDrafts(processedItemIds);
        await invalidateAll();
        toast.error(
          `Se procesaron ${processedItemIds.length} de ${dispatchRows.length} ítem(s). ${getErrorMessage(error)}`
        );
        return;
      }

      toast.error(getErrorMessage(error));
    } finally {
      setProcessingFlowType(null);
    }
  };

  const returnDispatchItemToRequisition = async (row: PendingQueueRow) => {
    setReturningDispatchItemId(row.item.id);
    try {
      const result = await returnDispatchMutation.mutateAsync({ id: row.item.id });
      resetProcessedItemDrafts([row.item.id, result.pendingRequestItemId].filter(Boolean));
      await invalidateAll();
      toast.success(
        `Se devolvió ${result.pendingQuantity} ${row.item.unit || ""} de ${row.item.itemName} a la requisición`
      );
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setReturningDispatchItemId((current) =>
        current === row.item.id ? null : current
      );
    }
  };

  const returnTransferItemToRequisition = async (row: PendingQueueRow) => {
    setReturningTransferItemId(row.item.id);
    try {
      const result = await returnTransferMutation.mutateAsync({ id: row.item.id });
      resetProcessedItemDrafts([row.item.id]);
      await invalidateAll();
      toast.success(
        `Se devolvió ${result.pendingQuantity} ${row.item.unit || ""} de ${row.item.itemName} a la requisición`
      );
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setReturningTransferItemId((current) =>
        current === row.item.id ? null : current
      );
    }
  };

  const processTransferFlow = async (flowType: QueueFlowType) => {
    const rows = pendingRowsByFlow[flowType];
    const selectedRows = rows.filter(
      (row) => transferCheckedByItemId[row.item.id] === true
    );

    if (selectedRows.length === 0) {
      toast.error("Seleccione al menos un detalle para la solicitud de traslado");
      return;
    }

    const destinationProjectIds = Array.from(
      new Set(selectedRows.map((row) => row.request.projectId))
    );
    if (destinationProjectIds.length !== 1) {
      toast.error(
        "Seleccione ítems del mismo proyecto destino para crear una sola solicitud de traslado"
      );
      return;
    }
    if (transferOriginStockLoading) {
      toast.error("Espere a que se cargue la existencia de las bodegas");
      return;
    }

    const preparedTransferRows: Array<{
      row: PendingQueueRow;
      sourceProjectId: number;
      sourceWarehouseId: number;
    }> = [];
    const requestedTransferStockByKey = new Map<
      string,
      { itemName: string; availableQuantity: number; requestedQuantity: number }
    >();
    for (const row of selectedRows) {
      const sapItemCode = row.item.sapItemCode?.trim();
      const source = parseTransferSourceOptionValue(
        transferWarehouseByItemId[row.item.id]
      );
      if (!source) {
        toast.error(`Seleccione almacén origen para ${row.item.itemName}`);
        return;
      }
      const stockRow = transferOriginStockRowsByItemId.get(row.item.id) as any;
      const warehouseStock = (stockRow?.warehouses ?? []).find(
        (entry: any) =>
          Number(entry.warehouseId) === source.warehouseId &&
          Number(entry.projectId) === source.projectId
      );
      const availableQuantity = parseQuantityValue(warehouseStock?.quantity ?? 0);
      const requestedQuantity = parseQuantityValue(row.item.quantity);
      const key = `${
        sapItemCode
          ? `sap:${sapItemCode}`
          : `name:${String(row.item.itemName || "").trim().toLowerCase()}`
      }::${source.projectId}:${source.warehouseId}`;
      const current = requestedTransferStockByKey.get(key) ?? {
        itemName: row.item.itemName,
        availableQuantity,
        requestedQuantity: 0,
      };
      current.availableQuantity = availableQuantity;
      current.requestedQuantity += requestedQuantity;
      requestedTransferStockByKey.set(key, current);
      preparedTransferRows.push({
        row,
        sourceProjectId: source.projectId,
        sourceWarehouseId: source.warehouseId,
      });
    }
    const invalidStockEntry = Array.from(
      requestedTransferStockByKey.values()
    ).find(
      (entry) =>
        entry.availableQuantity <= 0 ||
        entry.availableQuantity + 0.000001 < entry.requestedQuantity
    );
    if (invalidStockEntry) {
      toast.error(
        `La bodega origen no tiene existencia suficiente para ${invalidStockEntry.itemName}. Disponible: ${formatQuantityValue(
          invalidStockEntry.availableQuantity
        )}.`
      );
      return;
    }

    setProcessingFlowType(flowType);
    const rowsBySourceProjectId = new Map<number, typeof preparedTransferRows>();
    for (const transferRow of preparedTransferRows) {
      const current = rowsBySourceProjectId.get(transferRow.sourceProjectId) ?? [];
      current.push(transferRow);
      rowsBySourceProjectId.set(transferRow.sourceProjectId, current);
    }

    const processedItemIds: number[] = [];
    const createdRequestNumbers: string[] = [];
    try {
      for (const [sourceProjectId, projectRows] of Array.from(
        rowsBySourceProjectId.entries()
      )) {
        const result = await projectTransferBatchMutation.mutateAsync({
          sourceProjectId,
          notes: transferNotesByFlowType[flowType] || undefined,
          items: projectRows.map(({ row, sourceWarehouseId }) => ({
            requestId: row.request.id,
            requestItemId: row.item.id,
            sourceWarehouseId,
          })),
        });

        if (result?.transferRequestNumber) {
          createdRequestNumbers.push(result.transferRequestNumber);
        }
        processedItemIds.push(...projectRows.map(({ row }) => row.item.id));
      }

      resetProcessedItemDrafts(processedItemIds);
      await invalidateAll();
      if (createdRequestNumbers.length <= 1) {
        toast.success(
          `Solicitud ${createdRequestNumbers[0]} generada para ${processedItemIds.length} ítem(s)`
        );
      } else {
        toast.success(
          `Se generaron ${createdRequestNumbers.length} solicitudes de traslado para ${processedItemIds.length} ítem(s)`
        );
      }
    } catch (error) {
      if (processedItemIds.length > 0) {
        resetProcessedItemDrafts(processedItemIds);
        await invalidateAll();
        toast.error(
          `Se generaron ${createdRequestNumbers.length} solicitud(es), pero faltaron ítems por procesar. ${getErrorMessage(error)}`
        );
        return;
      }

      toast.error(getErrorMessage(error));
    } finally {
      setProcessingFlowType(null);
    }
  };

  const processPurchaseRequestFlow = async (flowType: QueueFlowType) => {
    const selectedRows = pendingRowsByFlow[flowType].filter(
      (row) => purchaseRequestCheckedByItemId[row.item.id] === true
    );
    const purchaseType = purchaseRequestTypeByFlowType[flowType];
    const consolidate = selectedRows.length > 1;

    if (!purchaseType) {
      toast.error("Seleccione el tipo de compra para la solicitud");
      return;
    }
    if (selectedRows.length === 0) {
      toast.error("Seleccione al menos un detalle para la solicitud de compra");
      return;
    }

    if (consolidate) {
      const projectIds = Array.from(new Set(selectedRows.map((row) => row.request.projectId)));
      if (projectIds.length !== 1) {
        toast.error(
          "Seleccione ítems del mismo proyecto para consolidar en una sola solicitud"
        );
        return;
      }
    }

    setProcessingFlowType(flowType);
    const processedItemIds: number[] = [];
    const failedItems: string[] = [];

    if (consolidate) {
      try {
        const result = await purchaseRequestBatchMutation.mutateAsync({
          purchaseType: purchaseType as PurchaseType,
          notes: purchaseRequestNotesByFlowType[flowType] || undefined,
          items: selectedRows.map((row) => ({
            requestId: row.request.id,
            requestItemId: row.item.id,
          })),
        });

        resetProcessedItemDrafts(selectedRows.map((row) => row.item.id));
        await invalidateAll();
        toast.success(
          `Solicitud ${result.purchaseRequestNumber} generada con ${result.processedItems} ítem(s)`
        );
      } catch (error) {
        toast.error(getErrorMessage(error));
      } finally {
        setProcessingFlowType(null);
      }
      return;
    }

    for (const row of selectedRows) {
      const item = row.item;
      try {
        await purchaseRequestMutation.mutateAsync({
          requestId: row.request.id,
          requestItemId: item.id,
          purchaseType: purchaseType as PurchaseType,
          notes: purchaseRequestNotesByFlowType[flowType] || undefined,
        });

        processedItemIds.push(item.id);
      } catch (error) {
        failedItems.push(`${item.itemName}: ${getErrorMessage(error)}`);
      }
    }

    if (processedItemIds.length > 0) {
      resetProcessedItemDrafts(processedItemIds);
      await invalidateAll();
    }

    if (failedItems.length === 0) {
      toast.success(`Solicitud de compra generada para ${processedItemIds.length} ítem(s)`);
    } else if (processedItemIds.length > 0) {
      toast.error(
        `Se procesaron ${processedItemIds.length} de ${selectedRows.length} ítems. ${failedItems[0]}`
      );
    } else {
      toast.error(failedItems[0]);
    }

    setProcessingFlowType(null);
  };

  const handleBack = () => {
    if (flowFilter !== "all" || statusFilter !== "all") {
      setFlowFilter("all");
      setStatusFilter("all");
      return;
    }

    if (typeof window !== "undefined" && window.history.length > 1) {
      window.history.back();
      return;
    }

    setLocation("/solicitudes");
  };

  const handleViewPending = (flowType: QueueFlowType, pendingCount: number) => {
    setFlowFilter(flowType);

    if (!pendingQueueLoading && pendingCount === 0) {
      toast("No hay pendientes");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-start gap-3">
          <Button variant="outline" size="sm" onClick={handleBack} className="mt-0.5">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Atrás
          </Button>

          <div className="space-y-1">
            <h1>Flujos de Abastecimiento</h1>
            <p className="text-sm text-muted-foreground">
              {isReadOnlyFlowViewer
                ? `Vista de seguimiento para los procesos enviados desde ${readOnlyScopeLabel}.`
                : "Panel principal para atender los procesos enviados desde las requisiciones."}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Select value={flowFilter} onValueChange={setFlowFilter}>
            <SelectTrigger className="w-48 h-9">
              <SelectValue placeholder="Tipo de flujo" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los flujos</SelectItem>
              {allowedFlowTypes.includes("despacho_bodega") && (
                <SelectItem value="despacho_bodega">Salida de inventario</SelectItem>
              )}
              {allowedFlowTypes.includes("compra_directa") && (
                <SelectItem value="compra_directa">Compra directa</SelectItem>
              )}
              {allowedFlowTypes.includes("traslado_proyecto") && (
                <SelectItem value="traslado_proyecto">Solicitud de traslado</SelectItem>
              )}
              {allowedFlowTypes.includes("solicitud_compra") && (
                <SelectItem value="solicitud_compra">Solicitud de compra</SelectItem>
              )}
            </SelectContent>
          </Select>

          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-44 h-9">
              <SelectValue placeholder="Estatus" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los estatus</SelectItem>
              <SelectItem value="pendiente">Pendiente</SelectItem>
              <SelectItem value="en_proceso">En proceso</SelectItem>
              <SelectItem value="completado">Completado</SelectItem>
              <SelectItem value="cancelado">Cancelado</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {visibleFlowSections.map((flowType) => {
          const FlowIcon = FLOW_ICONS[flowType];
          const pendingCount = pendingCountByFlow[flowType];
          return (
            <Card key={flowType} className="border-border/80">
              <CardContent className="flex h-full flex-col gap-3 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="rounded-lg border border-border/70 bg-muted/20 p-2">
                      <FlowIcon className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="font-medium text-sm">{FLOW_LABELS[flowType]}</p>
                      <p className="text-xs text-muted-foreground">
                        {FLOW_ROUTE_HINTS[flowType]}
                      </p>
                    </div>
                  </div>
                  <Badge variant="outline" className={`text-xs ${FLOW_COLORS[flowType]}`}>
                    {pendingCount}
                  </Badge>
                </div>

                <p className="text-xs text-muted-foreground">{FLOW_DESCRIPTIONS[flowType]}</p>

                <div className="space-y-1 rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                  <div className="flex items-center justify-between gap-3">
                    <span>Pendientes</span>
                    <span className="font-medium text-foreground">{pendingCount}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span>Registrados</span>
                    <span className="font-medium text-foreground">
                      {historyCountByFlow[flowType]}
                    </span>
                  </div>
                </div>

                <div className="mt-auto flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => handleViewPending(flowType, pendingCount)}
                  >
                    Ver pendientes
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="space-y-4">
        {pendingQueueLoading ? (
          <Card>
            <CardContent className="p-8 text-center text-muted-foreground">
              Cargando panel de flujos...
            </CardContent>
          </Card>
        ) : visiblePendingRows.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center text-muted-foreground">
              {visibleHistoryRows.length > 0
                ? "No hay pendientes por procesar para este filtro. Los flujos ya creados aparecen en Historial reciente."
                : "No hay pendientes enviados desde requisiciones para este filtro"}
            </CardContent>
          </Card>
        ) : (
          visibleFlowSections.map((flowType) => {
            const FlowIcon = FLOW_ICONS[flowType];
            const rows = pendingRowsByFlow[flowType];
            const isProcessing = processingFlowType === flowType;
            const isReturningQueued = returningQueuedFlowType === flowType;
            const canProcessThisFlow = canProcessFlow(flowType);

            if (rows.length === 0) {
              return null;
            }

            return (
              <Card key={flowType} className="border-border/80 bg-background">
                <CardHeader className="space-y-3 pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="rounded-lg border border-border/70 bg-muted/20 p-2">
                        <FlowIcon className="h-4 w-4" />
                      </div>
                      <div>
                        <CardTitle className="text-base font-semibold">
                          {FLOW_LABELS[flowType]}
                        </CardTitle>
                        <p className="text-xs text-muted-foreground">
                          {FLOW_DESCRIPTIONS[flowType]}
                        </p>
                      </div>
                    </div>

                    <Badge variant="outline" className={`text-xs ${FLOW_COLORS[flowType]}`}>
                      {rows.length} ítem(s)
                    </Badge>
                  </div>
                </CardHeader>

                <CardContent className="space-y-4">
                  {!canProcessThisFlow &&
                    userRole === "bodeguero_proyecto" &&
                    flowType === "compra_directa" ? (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                      Siguiente responsable: Administrador del Proyecto.
                    </div>
                  ) : null}
                  {!canProcessThisFlow &&
                    userRole === "bodeguero_proyecto" &&
                    flowType === "traslado_proyecto" ? (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                      Solo seguimiento: este traslado lo procesa Jefe de Bodega o Administración Central.
                    </div>
                  ) : null}
                  <div className="overflow-hidden rounded-lg border border-border/70">
                    <table className="w-full table-fixed text-sm">
                      <thead>
                        <tr className="border-b border-border bg-muted/30">
                          {canProcessThisFlow && (flowType === "despacho_bodega" ||
                            flowType === "compra_directa" ||
                            flowType === "traslado_proyecto" ||
                            flowType === "solicitud_compra") && (
                            <th className="w-16 p-2 text-center text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                              Sel.
                            </th>
                          )}
                          <th className="w-52 p-2 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                            Req.
                          </th>
                          <th className="p-2 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                            Ítem
                          </th>
                          <th className="w-28 p-2 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                            Cant.
                          </th>
                          {canProcessThisFlow && flowType === "traslado_proyecto" && (
                            <th className="w-80 p-2 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                              Almacén origen
                            </th>
                          )}
                          {canProcessThisFlow && flowType === "traslado_proyecto" && (
                            <th className="w-28 p-2 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                              Exist. origen
                            </th>
                          )}
                          {flowType === "despacho_bodega" && (
                            <th className="w-32 p-2 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                              Disponible
                            </th>
                          )}
                          {canProcessThisFlow && flowType === "despacho_bodega" && (
                            <th className="w-72 p-2 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                              Almacén origen
                            </th>
                          )}
                          {canProcessThisFlow && flowType === "compra_directa" && (
                            <th className="w-40 p-2 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                              Comprar
                            </th>
                          )}
                          {canProcessThisFlow && flowType === "despacho_bodega" && (
                            <th className="w-40 p-2 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                              Despachar
                            </th>
                          )}
                          {canProcessThisFlow && flowType === "despacho_bodega" && (
                            <th className="w-32 p-2 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                              Saldo
                            </th>
                          )}
                          <th className="w-24 p-2 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                            Unidad
                          </th>
                          {canProcessThisFlow && (flowType === "despacho_bodega" ||
                            flowType === "traslado_proyecto") && (
                            <th className="w-40 p-2 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                              Acciones
                            </th>
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row) => {
                          const item = row.item;
                          const pendingDispatchQuantity = getPendingDispatchQuantity(item);
                          const availableDispatchQuantity = getAvailableDispatchQuantity(item);
                          const hasAvailableStock = availableDispatchQuantity > 0;
                          const projectWarehouses = getDispatchWarehouseOptionsForRow(row);
                          const defaultWarehouseId =
                            getDefaultDispatchWarehouseIdForRow(row);
                          const defaultDispatchWarehouseId =
                            dispatchWarehouseByItemId[item.id] ||
                            (defaultWarehouseId ? String(defaultWarehouseId) : "");
                          const dispatchInputValue =
                            dispatchQuantityByItemId[item.id] ??
                            getSuggestedDispatchQuantity(item).toFixed(2);
                          const selectedDispatchQuantity = parseQuantityValue(dispatchInputValue);
                          const dispatchBalanceQuantity = Math.max(
                            pendingDispatchQuantity - selectedDispatchQuantity,
                            0
                          );
                          const projectedStockQuantity =
                            availableDispatchQuantity - selectedDispatchQuantity;
                          const transferStockRow =
                            flowType === "traslado_proyecto"
                              ? (transferOriginStockRowsByItemId.get(item.id) as any)
                              : null;
                          const transferWarehouseOptions =
                            transferStockRow?.warehouses ?? [];
                          const selectedTransferSourceValue =
                            transferWarehouseByItemId[item.id] || "";
                          const selectedTransferSource = parseTransferSourceOptionValue(
                            selectedTransferSourceValue
                          );
                          const selectedTransferWarehouseStock =
                            transferWarehouseOptions.find(
                              (entry: any) =>
                                selectedTransferSourceValue ===
                                getTransferSourceOptionValue(entry)
                            );
                          const transferOriginQuantity =
                            flowType === "traslado_proyecto" &&
                            selectedTransferSource
                              ? parseQuantityValue(
                                  selectedTransferWarehouseStock?.quantity ?? 0
                                )
                              : null;
                          const transferHasEnoughStock =
                            transferOriginQuantity !== null &&
                            transferOriginQuantity + 0.000001 >=
                              parseQuantityValue(item.quantity);
                          const transferSelectionDisabled =
                            isProcessing ||
                            isReturningQueued ||
                            transferOriginStockLoading ||
                            !selectedTransferSource ||
                            !transferHasEnoughStock;

                          return (
                            <tr
                              key={`${flowType}:${row.request.id}:${item.id}`}
                              className="border-b border-border last:border-0"
                            >
                              {canProcessThisFlow && (flowType === "despacho_bodega" ||
                                flowType === "compra_directa" ||
                                flowType === "traslado_proyecto" ||
                                flowType === "solicitud_compra") && (
                                <td className="p-2 text-center">
                                  {flowType === "despacho_bodega" ? (
                                    <Checkbox
                                      checked={dispatchCheckedByItemId[item.id] === true}
                                      onCheckedChange={(checked) =>
                                        setDispatchCheckedByItemId((current) => ({
                                          ...current,
                                          [item.id]: checked === true,
                                        }))
                                      }
                                      disabled={
                                        isProcessing ||
                                        isReturningQueued ||
                                        !hasAvailableStock ||
                                        pendingDispatchQuantity <= 0
                                      }
                                    />
                                  ) : flowType === "compra_directa" ? (
                                    <Checkbox
                                      checked={directPurchaseCheckedByItemId[item.id] === true}
                                      onCheckedChange={(checked) =>
                                        setDirectPurchaseCheckedByItemId((current) => ({
                                          ...current,
                                          [item.id]: checked === true,
                                        }))
                                      }
                                      disabled={isProcessing || isReturningQueued}
                                    />
                                  ) : flowType === "traslado_proyecto" ? (
                                    <Checkbox
                                      checked={transferCheckedByItemId[item.id] === true}
                                      onCheckedChange={(checked) => {
                                        setTransferCheckedByItemId((current) => ({
                                          ...current,
                                          [item.id]: checked === true,
                                        }));
                                      }}
                                      disabled={transferSelectionDisabled}
                                    />
                                  ) : (
                                    <Checkbox
                                      checked={purchaseRequestCheckedByItemId[item.id] === true}
                                      onCheckedChange={(checked) =>
                                        setPurchaseRequestCheckedByItemId((current) => ({
                                          ...current,
                                          [item.id]: checked === true,
                                        }))
                                      }
                                      disabled={isProcessing || isReturningQueued}
                                    />
                                  )}
                                </td>
                              )}
                              <td className="p-2">
                                <button
                                  type="button"
                                  onClick={() => setLocation(`/solicitudes/${row.request.id}`)}
                                  className="text-left transition-colors hover:text-primary"
                                >
                                  <p className="font-medium">{row.request.requestNumber}</p>
                                  <p className="text-[11px] text-muted-foreground">
                                    {row.project
                                      ? `${row.project.code} — ${row.project.name}`
                                      : `Proyecto ${row.request.projectId}`}
                                  </p>
                                </button>
                              </td>
                              <td className="p-2">
                                <p className="font-medium">{item.itemName}</p>
                                <p className="text-[11px] text-muted-foreground">
                                  SAP: {item.sapItemCode || "Pendiente"}
                                </p>
                                {item.sapItemDescription && (
                                  <p className="text-[11px] text-muted-foreground">
                                    {item.sapItemDescription}
                                  </p>
                                )}
                                {flowType === "compra_directa" &&
                                  row.purchaseInsight?.lastPurchase && (
                                    <p className="text-[11px] text-muted-foreground">
                                      Últ. compra:{" "}
                                      <span className="font-medium text-foreground">
                                        {formatPurchaseOrderCurrency(
                                          row.purchaseInsight.lastPurchase.unitPrice
                                        )}
                                      </span>{" "}
                                      con{" "}
                                      {formatSupplierReferenceLabel(
                                        row.purchaseInsight.lastPurchase
                                      )}
                                    </p>
                                  )}
                                {flowType === "compra_directa" &&
                                  row.purchaseInsight?.minimumPurchase && (
                                    <p className="text-[11px] text-muted-foreground">
                                      Mejor precio:{" "}
                                      <span className="font-medium text-foreground">
                                        {formatPurchaseOrderCurrency(
                                          row.purchaseInsight.minimumPurchase.unitPrice
                                        )}
                                      </span>{" "}
                                      con{" "}
                                      {formatSupplierReferenceLabel(
                                        row.purchaseInsight.minimumPurchase
                                      )}
                                    </p>
                                  )}
                                {flowType === "compra_directa" &&
                                  item.sapItemCode &&
                                  !row.purchaseInsight?.lastPurchase &&
                                  !row.purchaseInsight?.minimumPurchase && (
                                    <p className="text-[11px] text-muted-foreground">
                                      Sin historial de compra registrado para este SAP.
                                    </p>
                                  )}
                                {flowType === "despacho_bodega" &&
                                  parseQuantityValue(item.dispatchedQuantity) > 0 && (
                                    <p className="text-[11px] text-muted-foreground">
                                      Ya despachado: {formatQuantityValue(item.dispatchedQuantity)}
                                    </p>
                                  )}
                              </td>
                              <td className="p-2 text-right font-mono">
                                {formatQuantityValue(item.quantity)}
                              </td>
                              {canProcessThisFlow && flowType === "traslado_proyecto" && (
                                <td className="p-2">
                                  <Select
                                    value={selectedTransferSourceValue || undefined}
                                    onValueChange={(value) =>
                                      setTransferWarehouseByItemId((current) => ({
                                        ...current,
                                        [item.id]: value,
                                      }))
                                    }
                                    disabled={
                                      transferOriginStockLoading ||
                                      transferWarehouseOptions.length === 0
                                    }
                                  >
                                    <SelectTrigger className="h-9 w-full min-w-0 overflow-hidden">
                                      <SelectValue placeholder="Seleccione almacén" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {transferWarehouseOptions.map((warehouse: any) => {
                                        const optionValue =
                                          getTransferSourceOptionValue(warehouse);
                                        const warehouseLabel =
                                          warehouse.displayName ||
                                          warehouse.warehouseName ||
                                          `Almacén #${warehouse.warehouseId}`;

                                        return (
                                          <SelectItem
                                            key={optionValue}
                                            value={optionValue}
                                          >
                                            {warehouseLabel} - Disp.{" "}
                                            {formatQuantityValue(warehouse.quantity)}
                                            {warehouse.projectCode
                                              ? ` (${warehouse.projectCode})`
                                              : ""}
                                          </SelectItem>
                                        );
                                      })}
                                    </SelectContent>
                                  </Select>
                                </td>
                              )}
                              {canProcessThisFlow && flowType === "traslado_proyecto" && (
                                <td className="p-2 text-right font-mono">
                                  {transferOriginStockLoading ? (
                                    <span className="font-sans text-xs text-muted-foreground">
                                      Cargando...
                                    </span>
                                  ) : transferWarehouseOptions.length === 0 ? (
                                    <span className="font-sans text-xs text-muted-foreground">
                                      Sin existencia
                                    </span>
                                  ) : !selectedTransferSource ? (
                                    <span className="font-sans text-xs text-muted-foreground">
                                      Seleccione bodega
                                    </span>
                                  ) : (
                                    <>
                                      <span
                                        className={
                                          transferHasEnoughStock
                                            ? "text-foreground"
                                            : "font-semibold text-destructive"
                                        }
                                      >
                                        {formatQuantityValue(transferOriginQuantity)}
                                      </span>
                                      {transferOriginQuantity !== null &&
                                      transferOriginQuantity <= 0 ? (
                                        <p className="font-sans text-[10px] font-medium text-destructive">
                                          Sin existencia
                                        </p>
                                      ) : transferOriginQuantity !== null &&
                                        !transferHasEnoughStock ? (
                                        <p className="font-sans text-[10px] font-medium text-destructive">
                                          Insuficiente
                                        </p>
                                      ) : null}
                                    </>
                                  )}
                                </td>
                              )}
                              {flowType === "despacho_bodega" && (
                                <td className="p-2 text-right font-mono">
                                  <span
                                    className={
                                      hasAvailableStock
                                        ? "text-foreground"
                                        : "font-semibold text-destructive"
                                    }
                                  >
                                    {formatQuantityValue(availableDispatchQuantity)}
                                  </span>
                                </td>
                              )}
                              {canProcessThisFlow && flowType === "despacho_bodega" && (
                                <td className="p-2">
                                  <Select
                                    value={defaultDispatchWarehouseId || undefined}
                                    onValueChange={(value) =>
                                      setDispatchWarehouseByItemId((current) => ({
                                        ...current,
                                        [item.id]: value,
                                      }))
                                    }
                                    disabled={isProcessing || projectWarehouses.length === 0}
                                  >
                                    <SelectTrigger className="h-9 w-full min-w-0 overflow-hidden px-2 text-[11px] [&_svg]:size-3.5">
                                      <SelectValue placeholder="Seleccione almacén" />
                                    </SelectTrigger>
                                    <SelectContent className="min-w-[var(--radix-select-trigger-width)]">
                                      {projectWarehouses.length === 0 ? (
                                        <SelectItem
                                          value="sin-almacenes"
                                          disabled
                                          className="text-xs"
                                        >
                                          Sin almacenes disponibles
                                        </SelectItem>
                                      ) : (
                                        projectWarehouses.map((warehouse: any) => {
                                          const warehouseId =
                                            getDispatchWarehouseOptionId(warehouse);
                                          const warehouseQuantity =
                                            getDispatchWarehouseOptionQuantity(warehouse);
                                          const disabled =
                                            warehouseQuantity !== null &&
                                            warehouseQuantity <= 0;

                                          return (
                                            <SelectItem
                                              key={warehouseId}
                                              value={String(warehouseId)}
                                              disabled={disabled}
                                              className="text-xs"
                                            >
                                              {getDispatchWarehouseOptionLabel(warehouse)}
                                              {warehouseQuantity !== null
                                                ? ` - Disp. ${formatQuantityValue(
                                                    warehouseQuantity
                                                  )}`
                                                : ""}
                                            </SelectItem>
                                          );
                                        })
                                      )}
                                    </SelectContent>
                                  </Select>
                                </td>
                              )}
                              {canProcessThisFlow && flowType === "compra_directa" && (
                                <td className="p-2">
                                  <Input
                                    value={
                                      directPurchaseQuantityByItemId[item.id] ??
                                      String(item.quantity ?? "0.00")
                                    }
                                    onChange={(event) =>
                                      setDirectPurchaseQuantityByItemId((current) => ({
                                        ...current,
                                        [item.id]: event.target.value,
                                      }))
                                    }
                                    type="number"
                                    min="0"
                                    step="any"
                                    className="ml-auto h-9 w-28 text-right"
                                    disabled={isProcessing || isReturningQueued}
                                  />
                                  <p className="mt-1 text-right text-[10px] text-muted-foreground">
                                    Max: {formatQuantityValue(item.quantity)}
                                  </p>
                                </td>
                              )}
                              {canProcessThisFlow && flowType === "despacho_bodega" && (
                                <td className="p-2">
                                  <Input
                                    value={dispatchInputValue}
                                    onChange={(event) =>
                                      setDispatchQuantityByItemId((current) => ({
                                        ...current,
                                        [item.id]: event.target.value,
                                      }))
                                    }
                                    type="number"
                                    min="0"
                                    max={Math.min(
                                      pendingDispatchQuantity,
                                      availableDispatchQuantity
                                    )}
                                    step="any"
                                    className="ml-auto h-9 w-28 text-right"
                                    disabled={isProcessing}
                                  />
                                  <p className="mt-1 text-right text-[10px] text-muted-foreground">
                                    Pendiente: {pendingDispatchQuantity.toFixed(2)}
                                  </p>
                                  {!hasAvailableStock ? (
                                    <p className="mt-1 text-right text-[10px] font-medium text-destructive">
                                      Sin stock para emitir
                                    </p>
                                  ) : (
                                    <p
                                      className={`mt-1 text-right text-[10px] ${
                                        projectedStockQuantity < 0
                                          ? "font-medium text-destructive"
                                          : "text-muted-foreground"
                                      }`}
                                    >
                                      Nueva existencia:{" "}
                                      {projectedStockQuantity.toFixed(2)}
                                    </p>
                                  )}
                                </td>
                              )}
                              {canProcessThisFlow && flowType === "despacho_bodega" && (
                                <td className="p-2 text-right">
                                  <p className="font-mono">
                                    {dispatchBalanceQuantity.toFixed(2)}
                                  </p>
                                  {dispatchBalanceQuantity > 0 ? (
                                    <p className="text-[10px] text-muted-foreground">
                                      Queda en flujo
                                    </p>
                                  ) : null}
                                </td>
                              )}
                              <td className="p-2 text-xs">{item.unit || "—"}</td>
                              {canProcessThisFlow && (flowType === "despacho_bodega" ||
                                flowType === "traslado_proyecto") && (
                                <td className="p-2 text-right">
                                  {flowType === "despacho_bodega" ? (
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      className="h-8 px-2 text-[11px]"
                                      disabled={
                                        isProcessing ||
                                        returningDispatchItemId === item.id ||
                                        returnDispatchMutation.isPending
                                      }
                                      onClick={() =>
                                        void returnDispatchItemToRequisition(row)
                                      }
                                    >
                                      <RotateCcw className="mr-1 h-3.5 w-3.5" />
                                      {returningDispatchItemId === item.id
                                        ? "Devolviendo..."
                                        : "A requisición"}
                                    </Button>
                                  ) : (
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      className="h-8 px-2 text-[11px]"
                                      disabled={
                                        isProcessing ||
                                        returningTransferItemId === item.id ||
                                        returnTransferMutation.isPending
                                      }
                                      onClick={() =>
                                        void returnTransferItemToRequisition(row)
                                      }
                                    >
                                      <RotateCcw className="mr-1 h-3.5 w-3.5" />
                                      {returningTransferItemId === item.id
                                        ? "Devolviendo..."
                                        : "A requisición"}
                                    </Button>
                                  )}
                                </td>
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {canProcessThisFlow && flowType === "compra_directa" && (
                    <div className="grid gap-3">
                      <div className="min-w-0 space-y-2">
                        <Label className="text-sm font-medium">Método de pago *</Label>
                        <Select
                          value={directPurchasePaymentMethodByFlowType[flowType] || ""}
                          onValueChange={(value) =>
                            setDirectPurchasePaymentMethodByFlowType((current) => ({
                              ...current,
                              [flowType]: value as DirectPurchasePaymentMethod,
                            }))
                          }
                        >
                          <SelectTrigger className="w-full min-w-0">
                            <SelectValue placeholder="Seleccione" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="linea_credito">Línea de Crédito</SelectItem>
                            <SelectItem value="fondo_proyecto">Fondo del proyecto</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label className="text-sm font-medium">Notas</Label>
                        <Textarea
                          value={directPurchaseNotesByFlowType[flowType] || ""}
                          onChange={(event) =>
                            setDirectPurchaseNotesByFlowType((current) => ({
                              ...current,
                              [flowType]: event.target.value,
                            }))
                          }
                          placeholder="Observaciones para la solicitud de compra directa"
                          rows={3}
                        />
                      </div>

                      <div className="rounded-lg border border-border/70 bg-muted/15 px-3 py-2 text-xs text-muted-foreground">
                        Marca solo los detalles que quieres incluir en esta solicitud. También puedes bajar la cantidad para hacer compras parciales; el resto quedará pendiente en este mismo panel.
                      </div>
                    </div>
                  )}

                  {canProcessThisFlow && flowType === "despacho_bodega" && (
                    <div className="space-y-3">
                      <div className="space-y-2">
                        <Label className="text-sm font-medium">
                          Recibido por *
                        </Label>
                        <Input
                          value={dispatchReceivedByFlowType[flowType] || ""}
                          onChange={(event) =>
                            setDispatchReceivedByFlowType((current) => ({
                              ...current,
                              [flowType]: event.target.value,
                            }))
                          }
                          placeholder="Nombre de quien recibe"
                          maxLength={255}
                          required
                        />
                      </div>

                      <div className="space-y-2">
                        <Label className="text-sm font-medium">
                          Notas del despacho
                        </Label>
                        <Textarea
                          value={dispatchNotesByFlowType[flowType] || ""}
                          onChange={(event) =>
                            setDispatchNotesByFlowType((current) => ({
                              ...current,
                              [flowType]: event.target.value,
                            }))
                          }
                          placeholder="Observaciones para las salidas de bodega"
                          rows={3}
                        />
                      </div>
                    </div>
                  )}

                  {canProcessThisFlow && flowType === "traslado_proyecto" && (
                    <div className="space-y-3">
                      <div className="rounded-lg border border-border/70 bg-muted/15 p-3 text-xs text-muted-foreground">
                        Selecciona la bodega origen por línea. El destino se tomará automáticamente desde la requisición indicada en la columna `Req.`.
                      </div>

                      <div className="space-y-2">
                        <Label className="text-sm font-medium">Notas</Label>
                        <Textarea
                          value={transferNotesByFlowType[flowType] || ""}
                          onChange={(event) =>
                            setTransferNotesByFlowType((current) => ({
                              ...current,
                              [flowType]: event.target.value,
                            }))
                          }
                          placeholder="Observaciones para el traslado"
                          rows={3}
                        />
                      </div>
                    </div>
                  )}

                  {canProcessThisFlow && flowType === "solicitud_compra" && (
                    <div className="space-y-3">
                      <div className="space-y-2">
                        <Label className="text-sm font-medium">Tipo de compra *</Label>
                        <Select
                          value={purchaseRequestTypeByFlowType[flowType] || ""}
                          onValueChange={(value) =>
                            setPurchaseRequestTypeByFlowType((current) => ({
                              ...current,
                              [flowType]: value,
                            }))
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Seleccione" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="local">Compra Local</SelectItem>
                            <SelectItem value="extranjera">Compra Extranjera</SelectItem>
                            <SelectItem value="compra_directa">Compra Directa</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label className="text-sm font-medium">Notas</Label>
                        <Textarea
                          value={purchaseRequestNotesByFlowType[flowType] || ""}
                          onChange={(event) =>
                            setPurchaseRequestNotesByFlowType((current) => ({
                              ...current,
                              [flowType]: event.target.value,
                            }))
                          }
                          placeholder="Observaciones para la solicitud de compra"
                          rows={3}
                        />
                      </div>

                      <div className="rounded-lg border border-border/70 bg-muted/15 px-3 py-2 text-xs text-muted-foreground">
                        Si seleccionas más de un ítem del mismo proyecto, se generará una sola solicitud de compra consolidada.
                      </div>
                    </div>
                  )}

                  {canProcessThisFlow && (
                    <div className="flex flex-wrap justify-end gap-3 border-t border-border/70 pt-3">
                      {(flowType === "compra_directa" ||
                        flowType === "solicitud_compra") && (
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() =>
                            void returnSelectedQueuedToRequisition(flowType)
                          }
                          disabled={
                            isProcessing ||
                            isReturningQueued ||
                            returnQueuedMutation.isPending
                          }
                        >
                          <RotateCcw className="mr-2 h-4 w-4" />
                          {isReturningQueued ? "Quitando..." : "Quitar del flujo"}
                        </Button>
                      )}

                      {flowType === "compra_directa" && (
                        <Button
                          onClick={() => void processDirectPurchaseFlow(flowType)}
                          disabled={isProcessing || isReturningQueued}
                        >
                          {isProcessing ? "Procesando..." : "Procesar compra directa"}
                        </Button>
                      )}

                      {flowType === "despacho_bodega" && (
                        <Button
                          onClick={() => void processWarehouseDispatchFlow(flowType)}
                          disabled={
                            isProcessing ||
                            !dispatchReceivedByFlowType[flowType]?.trim()
                          }
                        >
                          {isProcessing ? "Creando..." : "Crear salida de inventario"}
                        </Button>
                      )}

                      {flowType === "traslado_proyecto" && (
                        <Button
                          onClick={() => void processTransferFlow(flowType)}
                          disabled={isProcessing}
                        >
                          {isProcessing ? "Procesando..." : "Procesar solicitud de traslado"}
                        </Button>
                      )}

                      {flowType === "solicitud_compra" && (
                        <Button
                          onClick={() => void processPurchaseRequestFlow(flowType)}
                          disabled={isProcessing || isReturningQueued}
                        >
                          {isProcessing ? "Procesando..." : "Procesar solicitud de compra"}
                        </Button>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">Historial reciente</CardTitle>
        </CardHeader>
        <CardContent>
          {historyLoading ? (
            <div className="p-4 text-center text-muted-foreground">
              Cargando historial de flujos...
            </div>
          ) : !(flowHistory || []).length ? (
            <div className="p-4 text-center text-muted-foreground">
              No se encontraron flujos registrados
            </div>
          ) : (
            <div className="space-y-3">
              {visibleHistoryRows.map((row: any) => {
                  const flowType = row.flow.flowType as QueueFlowType;
                  const FlowIcon = FLOW_ICONS[flowType] || Package;

                  return (
                    <Card key={row.flow.id} className="hover:border-primary/20 transition-colors">
                      <CardContent className="p-4">
                        <div className="flex items-start gap-4">
                          <div className="w-10 h-10 bg-primary/10 rounded flex items-center justify-center shrink-0">
                            <FlowIcon className="h-5 w-5 text-primary" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <p className="font-medium text-sm">{FLOW_LABELS[flowType]}</p>
                              <Badge
                                variant="outline"
                                className={`text-xs capitalize shrink-0 ${
                                  STATUS_COLORS[row.flow.status] || ""
                                }`}
                              >
                                {STATUS_LABELS[row.flow.status] || row.flow.status}
                              </Badge>
                            </div>
                            <div className="mt-1 space-y-0.5">
                              {row.request?.requestNumber && (
                                <p className="text-xs text-muted-foreground">
                                  Requisición: {row.request.requestNumber}
                                </p>
                              )}
                              {row.project?.name && (
                                <p className="text-xs text-muted-foreground">
                                  Proyecto: {row.project.code} — {row.project.name}
                                </p>
                              )}
                              {row.flow.paymentMethod && (
                                <p className="text-xs text-muted-foreground">
                                  Método: {getPaymentMethodLabel(row.flow.paymentMethod)}
                                </p>
                              )}
                              {row.flow.purchaseType && (
                                <p className="text-xs text-muted-foreground">
                                  Tipo:{" "}
                                  {getPurchaseTypeLabel(row.flow.purchaseType)}
                                </p>
                              )}
                              {row.flow.purchaseOrderNumber && (
                                <p className="text-xs text-muted-foreground">
                                  {row.flow.sapDocumentType === "solicitud_compra" ? "SC" : "OC"}:{" "}
                                  {row.flow.purchaseOrderNumber}
                                </p>
                              )}
                              {row.flow.notes && (
                                <p className="text-xs text-muted-foreground mt-1">
                                  {row.flow.notes}
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
