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
import { ArrowLeft, ArrowLeftRight, Package, ShoppingCart, Truck } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";

type QueueFlowType =
  | "compra_directa"
  | "despacho_bodega"
  | "traslado_proyecto"
  | "solicitud_compra";

const FLOW_ORDER: QueueFlowType[] = [
  "despacho_bodega",
  "compra_directa",
  "traslado_proyecto",
  "solicitud_compra",
];

const FLOW_LABELS: Record<QueueFlowType, string> = {
  despacho_bodega: "Salida de bodega",
  compra_directa: "Compra directa",
  traslado_proyecto: "Solicitud de traslado",
  solicitud_compra: "Solicitud de compra",
};

const FLOW_DESCRIPTIONS: Record<QueueFlowType, string> = {
  despacho_bodega: "Despacha inventario disponible hacia la requisición seleccionada.",
  compra_directa: "Genera una compra directa y crea la OC correspondiente.",
  traslado_proyecto: "Crea la solicitud de traslado entre proyectos.",
  solicitud_compra: "Genera la solicitud de compra para Oficina Central.",
};

const FLOW_ROUTE_HINTS: Record<QueueFlowType, string> = {
  despacho_bodega: "Se atiende en este panel y luego queda reflejado en Inventario.",
  compra_directa: "Se atiende aquí y luego continúa en Órdenes de Compra.",
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

export default function Flujos() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();
  const [flowFilter, setFlowFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [processingFlowType, setProcessingFlowType] = useState<QueueFlowType | null>(null);
  const [dispatchNotesByFlowType, setDispatchNotesByFlowType] = useState<
    Partial<Record<QueueFlowType, string>>
  >({});
  const [dispatchQuantityByItemId, setDispatchQuantityByItemId] = useState<Record<number, string>>(
    {}
  );
  const [directPurchasePaymentMethodByFlowType, setDirectPurchasePaymentMethodByFlowType] =
    useState<Partial<Record<QueueFlowType, string>>>({});
  const [directPurchaseSupplierIdByFlowType, setDirectPurchaseSupplierIdByFlowType] =
    useState<Partial<Record<QueueFlowType, string>>>({});
  const [directPurchaseNotesByFlowType, setDirectPurchaseNotesByFlowType] = useState<
    Partial<Record<QueueFlowType, string>>
  >({});
  const [directPurchaseCheckedByItemId, setDirectPurchaseCheckedByItemId] = useState<
    Record<number, boolean>
  >({});
  const [directPurchaseQuantityByItemId, setDirectPurchaseQuantityByItemId] = useState<
    Record<number, string>
  >({});
  const [transferSourceProjectIdByFlowType, setTransferSourceProjectIdByFlowType] = useState<
    Partial<Record<QueueFlowType, string>>
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

  const userRole = (user as any)?.buildreqRole || "";
  const isAdmin = user?.role === "admin";

  const allowedFlowTypes = useMemo(() => {
    if (
      isAdmin ||
      userRole === "jefe_bodega_central" ||
      userRole === "administracion_central"
    ) {
      return FLOW_ORDER;
    }

    if (userRole === "administrador_proyecto") {
      return ["solicitud_compra"] as QueueFlowType[];
    }

    return ["compra_directa", "traslado_proyecto", "solicitud_compra"] as QueueFlowType[];
  }, [isAdmin, userRole]);

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
  const { data: suppliersList } = trpc.requestItems.listSuppliers.useQuery();
  const { data: projects } = trpc.projects.list.useQuery({ status: "activo" });

  const directPurchaseMutation = trpc.supplyFlows.createDirectPurchaseBatch.useMutation();
  const projectTransferMutation = trpc.supplyFlows.createProjectTransfer.useMutation();
  const purchaseRequestMutation = trpc.supplyFlows.createPurchaseRequest.useMutation();
  const warehouseExitMutation = trpc.requestItems.recordWarehouseExit.useMutation();

  const invalidateAll = () =>
    Promise.all([
      utils.supplyFlows.pendingQueue.invalidate(),
      utils.supplyFlows.list.invalidate(),
      utils.purchaseOrders.list.invalidate(),
      utils.purchaseRequests.list.invalidate(),
      utils.transferRequests.list.invalidate(),
      utils.transfers.list.invalidate(),
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
  };

  const processDirectPurchaseFlow = async (flowType: QueueFlowType) => {
    const rows = pendingRowsByFlow[flowType];
    const paymentMethod = directPurchasePaymentMethodByFlowType[flowType];
    const supplierId = directPurchaseSupplierIdByFlowType[flowType];
    const selectedRows = rows.filter(
      (row) => directPurchaseCheckedByItemId[row.item.id] === true
    );

    if (!paymentMethod) {
      toast.error("Seleccione el método de pago para la compra directa");
      return;
    }
    if (!supplierId) {
      toast.error("Seleccione el proveedor para la compra directa");
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
        supplierId: Number(supplierId),
        paymentMethod: paymentMethod as "linea_credito" | "caja_chica",
        notes: directPurchaseNotesByFlowType[flowType] || undefined,
        items: selectedRows.map((row) => ({
          requestId: row.request.id,
          requestItemId: row.item.id,
          quantity:
            directPurchaseQuantityByItemId[row.item.id] ??
            String(row.item.quantity ?? "0.00"),
        })),
      });

      const purchaseOrderNumbers =
        "purchaseOrders" in result && Array.isArray(result.purchaseOrders)
          ? result.purchaseOrders.map((entry) => entry.purchaseOrderNumber)
          : result.purchaseOrderNumber
            ? [result.purchaseOrderNumber]
            : [];

      resetProcessedItemDrafts(selectedRows.map((row) => row.item.id));
      await invalidateAll();
      toast.success(
        purchaseOrderNumbers.length === 1
          ? `Se generó la orden ${purchaseOrderNumbers[0]} para ${result.processedItems} ítem(s)`
          : `Se generaron ${purchaseOrderNumbers.length} órdenes para ${result.processedItems} ítem(s)`
      );
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setProcessingFlowType(null);
    }
  };

  const processWarehouseDispatchFlow = async (flowType: QueueFlowType) => {
    const rows = pendingRowsByFlow[flowType];
    setProcessingFlowType(flowType);

    const processedItemIds: number[] = [];
    const failedItems: string[] = [];

    for (const row of rows) {
      const item = row.item;
      try {
        const pendingQuantity = Math.max(
          parseQuantityValue(item.quantity) - parseQuantityValue(item.dispatchedQuantity),
          0
        );
        const dispatchedQuantity =
          dispatchQuantityByItemId[item.id] ?? pendingQuantity.toFixed(2);
        const dispatchedNumber = Number(dispatchedQuantity);

        if (!Number.isFinite(dispatchedNumber) || dispatchedNumber <= 0) {
          throw new Error("La cantidad despachada debe ser mayor que cero");
        }
        if (dispatchedNumber - pendingQuantity > 0.000001) {
          throw new Error("La cantidad despachada no puede exceder la cantidad pendiente");
        }

        await warehouseExitMutation.mutateAsync({
          requestId: row.request.id,
          requestItemId: item.id,
          dispatchedQuantity,
          note: dispatchNotesByFlowType[flowType] || undefined,
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
      toast.success(`Salida de bodega procesada para ${processedItemIds.length} ítem(s)`);
    } else if (processedItemIds.length > 0) {
      toast.error(
        `Se procesaron ${processedItemIds.length} de ${rows.length} ítems. ${failedItems[0]}`
      );
    } else {
      toast.error(failedItems[0]);
    }

    setProcessingFlowType(null);
  };

  const processTransferFlow = async (flowType: QueueFlowType) => {
    const rows = pendingRowsByFlow[flowType];
    const sourceProjectId = transferSourceProjectIdByFlowType[flowType];

    if (!sourceProjectId) {
      toast.error("Seleccione el proyecto origen para el traslado");
      return;
    }

    setProcessingFlowType(flowType);
    const processedItemIds: number[] = [];
    const failedItems: string[] = [];

    for (const row of rows) {
      const item = row.item;
      try {
        await projectTransferMutation.mutateAsync({
          requestId: row.request.id,
          requestItemId: item.id,
          sourceProjectId: Number(sourceProjectId),
          destinationProjectId: row.request.projectId,
          notes: transferNotesByFlowType[flowType] || undefined,
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
      toast.success(`Solicitud de traslado generada para ${processedItemIds.length} ítem(s)`);
    } else if (processedItemIds.length > 0) {
      toast.error(
        `Se procesaron ${processedItemIds.length} de ${rows.length} ítems. ${failedItems[0]}`
      );
    } else {
      toast.error(failedItems[0]);
    }

    setProcessingFlowType(null);
  };

  const processPurchaseRequestFlow = async (flowType: QueueFlowType) => {
    const rows = pendingRowsByFlow[flowType];
    const purchaseType = purchaseRequestTypeByFlowType[flowType];

    if (!purchaseType) {
      toast.error("Seleccione el tipo de compra para la solicitud");
      return;
    }

    setProcessingFlowType(flowType);
    const processedItemIds: number[] = [];
    const failedItems: string[] = [];

    for (const row of rows) {
      const item = row.item;
      try {
        await purchaseRequestMutation.mutateAsync({
          requestId: row.request.id,
          requestItemId: item.id,
          purchaseType: purchaseType as "local" | "extranjera",
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
        `Se procesaron ${processedItemIds.length} de ${rows.length} ítems. ${failedItems[0]}`
      );
    } else {
      toast.error(failedItems[0]);
    }

    setProcessingFlowType(null);
  };

  const handleBack = () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      window.history.back();
      return;
    }

    setLocation("/solicitudes");
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
              Panel principal para atender los procesos enviados desde las requisiciones.
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
                <SelectItem value="despacho_bodega">Salida de bodega</SelectItem>
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
                    onClick={() => setFlowFilter(flowType)}
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
                  <div className="overflow-hidden rounded-lg border border-border/70">
                    <table className="w-full table-fixed text-sm">
                      <thead>
                        <tr className="border-b border-border bg-muted/30">
                          {flowType === "compra_directa" && (
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
                          {flowType === "compra_directa" && (
                            <th className="w-40 p-2 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                              Comprar
                            </th>
                          )}
                          {flowType === "despacho_bodega" && (
                            <th className="w-40 p-2 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                              Despachar
                            </th>
                          )}
                          <th className="w-24 p-2 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                            Unidad
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row) => {
                          const item = row.item;
                          const pendingDispatchQuantity = Math.max(
                            parseQuantityValue(item.quantity) -
                              parseQuantityValue(item.dispatchedQuantity),
                            0
                          );

                          return (
                            <tr
                              key={`${flowType}:${row.request.id}:${item.id}`}
                              className="border-b border-border last:border-0"
                            >
                              {flowType === "compra_directa" && (
                                <td className="p-2 text-center">
                                  <Checkbox
                                    checked={directPurchaseCheckedByItemId[item.id] === true}
                                    onCheckedChange={(checked) =>
                                      setDirectPurchaseCheckedByItemId((current) => ({
                                        ...current,
                                        [item.id]: checked === true,
                                      }))
                                    }
                                    disabled={isProcessing}
                                  />
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
                              {flowType === "compra_directa" && (
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
                                    disabled={isProcessing}
                                  />
                                  <p className="mt-1 text-right text-[10px] text-muted-foreground">
                                    Max: {formatQuantityValue(item.quantity)}
                                  </p>
                                </td>
                              )}
                              {flowType === "despacho_bodega" && (
                                <td className="p-2">
                                  <Input
                                    value={
                                      dispatchQuantityByItemId[item.id] ??
                                      pendingDispatchQuantity.toFixed(2)
                                    }
                                    onChange={(event) =>
                                      setDispatchQuantityByItemId((current) => ({
                                        ...current,
                                        [item.id]: event.target.value,
                                      }))
                                    }
                                    type="number"
                                    min="0"
                                    step="any"
                                    className="ml-auto h-9 w-28 text-right"
                                    disabled={isProcessing}
                                  />
                                  <p className="mt-1 text-right text-[10px] text-muted-foreground">
                                    Pendiente: {pendingDispatchQuantity.toFixed(2)}
                                  </p>
                                </td>
                              )}
                              <td className="p-2 text-xs">{item.unit || "—"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {flowType === "compra_directa" && (
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="min-w-0 space-y-2">
                        <Label className="text-sm font-medium">Método de pago *</Label>
                        <Select
                          value={directPurchasePaymentMethodByFlowType[flowType] || ""}
                          onValueChange={(value) =>
                            setDirectPurchasePaymentMethodByFlowType((current) => ({
                              ...current,
                              [flowType]: value,
                            }))
                          }
                        >
                          <SelectTrigger className="w-full min-w-0">
                            <SelectValue placeholder="Seleccione" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="linea_credito">Línea de Crédito</SelectItem>
                            <SelectItem value="caja_chica">Caja Chica</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="min-w-0 space-y-2">
                        <Label className="text-sm font-medium">Proveedor *</Label>
                        <Select
                          value={directPurchaseSupplierIdByFlowType[flowType] || ""}
                          onValueChange={(value) =>
                            setDirectPurchaseSupplierIdByFlowType((current) => ({
                              ...current,
                              [flowType]: value,
                            }))
                          }
                        >
                          <SelectTrigger className="w-full min-w-0">
                            <SelectValue placeholder="Seleccione proveedor" />
                          </SelectTrigger>
                          <SelectContent className="max-h-[280px]">
                            {(suppliersList || []).map((supplier: any) => (
                              <SelectItem key={supplier.id} value={String(supplier.id)}>
                                {supplier.supplierCode} — {supplier.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2 md:col-span-2">
                        <Label className="text-sm font-medium">Notas</Label>
                        <Textarea
                          value={directPurchaseNotesByFlowType[flowType] || ""}
                          onChange={(event) =>
                            setDirectPurchaseNotesByFlowType((current) => ({
                              ...current,
                              [flowType]: event.target.value,
                            }))
                          }
                          placeholder="Observaciones para la compra directa"
                          rows={3}
                        />
                      </div>

                      <div className="rounded-lg border border-border/70 bg-muted/15 px-3 py-2 text-xs text-muted-foreground md:col-span-2">
                        Marca solo los detalles que quieres incluir en esta orden. También puedes bajar la cantidad para hacer compras parciales; el resto quedará pendiente en este mismo panel.
                      </div>
                    </div>
                  )}

                  {flowType === "despacho_bodega" && (
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">Notas del despacho</Label>
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
                  )}

                  {flowType === "traslado_proyecto" && (
                    <div className="space-y-3">
                      <div className="space-y-2">
                        <Label className="text-sm font-medium">Proyecto origen *</Label>
                        <Select
                          value={transferSourceProjectIdByFlowType[flowType] || ""}
                          onValueChange={(value) =>
                            setTransferSourceProjectIdByFlowType((current) => ({
                              ...current,
                              [flowType]: value,
                            }))
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Seleccione proyecto origen" />
                          </SelectTrigger>
                          <SelectContent>
                            {(projects || []).map((entry: any) => (
                              <SelectItem key={entry.id} value={String(entry.id)}>
                                {entry.code} — {entry.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="rounded-lg border border-border/70 bg-muted/15 p-3 text-xs text-muted-foreground">
                        El destino se tomará automáticamente desde la requisición indicada en la columna `Req.`.
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

                  {flowType === "solicitud_compra" && (
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
                    </div>
                  )}

                  <div className="flex justify-end border-t border-border/70 pt-3">
                    {flowType === "compra_directa" && (
                      <Button
                        onClick={() => void processDirectPurchaseFlow(flowType)}
                        disabled={isProcessing}
                      >
                        {isProcessing ? "Procesando..." : "Procesar compra directa"}
                      </Button>
                    )}

                    {flowType === "despacho_bodega" && (
                      <Button
                        onClick={() => void processWarehouseDispatchFlow(flowType)}
                        disabled={isProcessing}
                      >
                        {isProcessing ? "Procesando..." : "Procesar salida de bodega"}
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
                        disabled={isProcessing}
                      >
                        {isProcessing ? "Procesando..." : "Procesar solicitud de compra"}
                      </Button>
                    )}
                  </div>
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
                              <Badge variant="outline" className="text-xs capitalize shrink-0">
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
                                  Método:{" "}
                                  {row.flow.paymentMethod === "linea_credito"
                                    ? "Línea de Crédito"
                                    : "Caja Chica"}
                                </p>
                              )}
                              {row.flow.purchaseType && (
                                <p className="text-xs text-muted-foreground">
                                  Tipo:{" "}
                                  {row.flow.purchaseType === "local"
                                    ? "Compra Local"
                                    : "Compra Extranjera"}
                                </p>
                              )}
                              {row.flow.purchaseOrderNumber && (
                                <p className="text-xs text-muted-foreground">
                                  OC: {row.flow.purchaseOrderNumber}
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
