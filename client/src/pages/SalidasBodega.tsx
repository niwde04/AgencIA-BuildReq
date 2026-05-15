import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/_core/hooks/useAuth";
import { downloadBase64Document } from "@/lib/document-download";
import { trpc } from "@/lib/trpc";
import { Download, Eye, PackageMinus, Plus, RotateCcw, Search, Send, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

const STATUS_LABELS: Record<string, string> = {
  borrador: "Borrador",
  emitida: "Emitida",
  anulada: "Anulada",
};

const STATUS_COLORS: Record<string, string> = {
  borrador: "border-slate-300 bg-slate-50 text-slate-700",
  emitida: "border-blue-300 bg-blue-50 text-blue-700",
  anulada: "border-rose-300 bg-rose-50 text-rose-700",
};

const RETURN_REASON_LABELS: Record<string, string> = {
  material_defectuoso: "Material defectuoso",
  excedente: "Excedente",
  error_pedido: "Error de pedido",
  cambio_especificacion: "Cambio de especificación",
  otro: "Otro",
};

const RETURN_CONDITION_LABELS: Record<string, string> = {
  nuevo: "Nuevo",
  usado_buen_estado: "Usado - Buen estado",
  defectuoso: "Defectuoso",
  danado: "Dañado",
};

function formatDate(value: string | Date | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("es-HN");
}

function formatQuantity(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return "0.00";
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numberValue)) return String(value);
  return numberValue.toLocaleString("es-HN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function parseQuantity(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return 0;
  const numberValue = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function getPhysicalDispatchedQuantity(item: any) {
  return Math.max(
    parseQuantity(item.physicalDispatchedQuantity ?? item.dispatchedQuantity),
    0
  );
}

function getDeliveryPendingQuantity(item: any) {
  const requestedQuantity = Math.max(parseQuantity(item.quantity), 0);
  const alreadyDispatched = getPhysicalDispatchedQuantity(item);
  const receivedQuantity = Math.min(
    Math.max(parseQuantity(item.deliveredQuantity), 0),
    requestedQuantity
  );
  const dispatchableQuantity =
    item.assignedFlow === "despacho_bodega" ? requestedQuantity : receivedQuantity;

  return Math.max(dispatchableQuantity - alreadyDispatched, 0);
}

function getSuggestedDeliveryQuantity(item: any) {
  return Math.min(
    getDeliveryPendingQuantity(item),
    Math.max(parseQuantity(item.projectStock), 0)
  );
}

export default function SalidasBodega() {
  const utils = trpc.useUtils();
  const { user } = useAuth();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [returnPanelOpen, setReturnPanelOpen] = useState(false);
  const [returnReasonCategory, setReturnReasonCategory] = useState("error_pedido");
  const [returnJustification, setReturnJustification] = useState("");
  const [returnQuantityByItemId, setReturnQuantityByItemId] = useState<
    Record<number, string>
  >({});
  const [returnConditionByItemId, setReturnConditionByItemId] = useState<
    Record<number, string>
  >({});
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [deliveryDialogOpen, setDeliveryDialogOpen] = useState(false);
  const [deliveryRequestId, setDeliveryRequestId] = useState("");
  const [deliveryNotes, setDeliveryNotes] = useState("");
  const [deliveryQuantityByItemId, setDeliveryQuantityByItemId] = useState<
    Record<number, string>
  >({});

  const { data: exits, isLoading } = trpc.warehouseExits.list.useQuery();
  const canCreateReturns =
    user?.role === "admin" || (user as any)?.buildreqRole === "jefe_bodega_central";
  const { data: materialRequests } = trpc.materialRequests.list.useQuery({
    requestType: "bienes",
  });
  const { data: deliveryRequestDetail } =
    trpc.materialRequests.getById.useQuery(
      { id: Number(deliveryRequestId || 0) },
      { enabled: deliveryDialogOpen && Boolean(deliveryRequestId) }
    );
  const { data: detail, refetch: refetchDetail } =
    trpc.warehouseExits.getById.useQuery(
      { id: selectedId ?? 0 },
      { enabled: Boolean(selectedId) }
    );
  const emitMutation = trpc.warehouseExits.emit.useMutation({
    onSuccess: (result) => {
      toast.success(`Salida ${result.exitNumber} emitida`);
      void Promise.all([
        utils.warehouseExits.list.invalidate(),
        selectedId
          ? utils.warehouseExits.getById.invalidate({ id: selectedId })
          : Promise.resolve(),
        utils.supplyFlows.pendingQueue.invalidate(),
        utils.supplyFlows.list.invalidate(),
        utils.inventory.list.invalidate(),
      ]);
    },
    onError: (error) => toast.error(error.message),
  });
  const createDeliveryMutation = trpc.requestItems.recordWarehouseExitBatch.useMutation({
    onSuccess: (result) => {
      const requestIdToInvalidate = Number(deliveryRequestId || 0);
      toast.success(`Salida ${result.exitNumber} creada en borrador`);
      setDeliveryDialogOpen(false);
      setDeliveryRequestId("");
      setDeliveryNotes("");
      setDeliveryQuantityByItemId({});
      setSelectedId(result.id);
      void Promise.all([
        utils.warehouseExits.list.invalidate(),
        utils.materialRequests.list.invalidate(),
        requestIdToInvalidate
          ? utils.materialRequests.getById.invalidate({ id: requestIdToInvalidate })
          : Promise.resolve(),
        utils.supplyFlows.pendingQueue.invalidate(),
        utils.supplyFlows.list.invalidate(),
      ]);
    },
    onError: (error) => toast.error(error.message),
  });
  const cancelMutation = trpc.warehouseExits.cancelDraft.useMutation({
    onSuccess: () => {
      toast.success("Borrador de salida anulado");
      void Promise.all([
        utils.warehouseExits.list.invalidate(),
        selectedId
          ? utils.warehouseExits.getById.invalidate({ id: selectedId })
          : Promise.resolve(),
        utils.supplyFlows.pendingQueue.invalidate(),
        utils.supplyFlows.list.invalidate(),
      ]);
    },
    onError: (error) => toast.error(error.message),
  });
  const createReturnMutation = trpc.reverseLogistics.create.useMutation({
    onSuccess: (result: any) => {
      toast.success(`Devolución ${result.returnNumber} registrada`);
      setReturnPanelOpen(false);
      setReturnJustification("");
      setReturnQuantityByItemId({});
      setReturnConditionByItemId({});
      void Promise.all([
        utils.reverseLogistics.list.invalidate(),
        utils.warehouseExits.list.invalidate(),
        selectedId
          ? utils.warehouseExits.getById.invalidate({ id: selectedId })
          : Promise.resolve(),
        utils.inventory.list.invalidate(),
        utils.supplyFlows.pendingQueue.invalidate(),
        utils.supplyFlows.list.invalidate(),
        utils.materialRequests.list.invalidate(),
      ]);
    },
    onError: (error) => toast.error(error.message),
  });

  const resetReturnPanel = () => {
    setReturnPanelOpen(false);
    setReturnReasonCategory("error_pedido");
    setReturnJustification("");
    setReturnQuantityByItemId({});
    setReturnConditionByItemId({});
  };

  useEffect(() => {
    if (!deliveryRequestDetail) {
      setDeliveryQuantityByItemId({});
      return;
    }

    const nextQuantities: Record<number, string> = {};
    for (const item of deliveryRequestDetail.items || []) {
      const suggestedQuantity = getSuggestedDeliveryQuantity(item);
      if (suggestedQuantity > 0) {
        nextQuantities[item.id] = suggestedQuantity.toFixed(2);
      }
    }
    setDeliveryQuantityByItemId(nextQuantities);
  }, [deliveryRequestDetail?.request.id]);

  const eligibleMaterialRequests = useMemo(
    () =>
      (materialRequests ?? []).filter((row: any) => {
        return (
          row.request.requestType === "bienes" &&
          ["flujo_completado", "parcialmente_atendida"].includes(row.request.status)
        );
      }),
    [materialRequests]
  );

  const deliveryItems = useMemo(
    () =>
      (deliveryRequestDetail?.items ?? []).filter(
        (item: any) => getDeliveryPendingQuantity(item) > 0
      ),
    [deliveryRequestDetail?.items]
  );

  const filteredExits = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();

    return (exits ?? []).filter((row: any) => {
      const warehouseExit = row.warehouseExit;
      const projectLabel = row.project
        ? `${row.project.code} ${row.project.name}`
        : "";
      const matchesSearch =
        !normalizedSearch ||
        [
          warehouseExit.exitNumber,
          row.warehouse?.displayName,
          projectLabel,
          STATUS_LABELS[warehouseExit.status],
        ]
          .filter(Boolean)
          .some(value =>
            String(value).toLowerCase().includes(normalizedSearch)
          );
      const matchesStatus =
        statusFilter === "all" || warehouseExit.status === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [exits, searchTerm, statusFilter]);

  const submitDelivery = () => {
    if (!deliveryRequestDetail) {
      toast.error("Seleccione una requisición");
      return;
    }

    const selectedItems = deliveryItems
      .map((item: any) => {
        const quantity = Number(deliveryQuantityByItemId[item.id] ?? 0);
        const availableQuantity = parseQuantity(item.projectStock);
        const pendingQuantity = getDeliveryPendingQuantity(item);

        return { item, quantity, pendingQuantity, availableQuantity };
      })
      .filter(({ quantity }) => quantity > 0);

    if (selectedItems.length === 0) {
      toast.error("Ingrese al menos una cantidad a entregar");
      return;
    }

    const invalidItem = selectedItems.find(
      ({ quantity, pendingQuantity, availableQuantity }) =>
        !Number.isFinite(quantity) ||
        quantity <= 0 ||
        quantity - pendingQuantity > 0.000001 ||
        quantity - availableQuantity > 0.000001
    );
    if (invalidItem) {
      toast.error(
        `${invalidItem.item.itemName}: revise la cantidad, el pendiente y la existencia disponible`
      );
      return;
    }

    createDeliveryMutation.mutate({
      requestId: deliveryRequestDetail.request.id,
      note: deliveryNotes.trim() || undefined,
      items: selectedItems.map(({ item, quantity }) => ({
        requestItemId: item.id,
        dispatchedQuantity: quantity.toFixed(2),
      })),
    });
  };

  const openReturnPanel = () => {
    if (!detail) return;
    const defaultConditions = Object.fromEntries(
      detail.items.map((item: any) => [item.id, "usado_buen_estado"])
    );
    setReturnReasonCategory("error_pedido");
    setReturnJustification("");
    setReturnQuantityByItemId({});
    setReturnConditionByItemId(defaultConditions);
    setReturnPanelOpen(true);
  };

  const submitReturn = () => {
    if (!detail) return;
    if (returnJustification.trim().length < 10) {
      toast.error("La justificación debe tener al menos 10 caracteres");
      return;
    }

    const selectedItems = detail.items
      .map((item: any) => {
        const quantity = Number(returnQuantityByItemId[item.id] ?? 0);
        const maxQuantity = Number(item.returnableQuantity ?? 0);
        return { item, quantity, maxQuantity };
      })
      .filter(({ quantity }) => quantity > 0);

    if (selectedItems.length === 0) {
      toast.error("Ingrese al menos una cantidad a devolver");
      return;
    }

    const invalidItem = selectedItems.find(
      ({ quantity, maxQuantity }) =>
        !Number.isFinite(quantity) || quantity <= 0 || quantity - maxQuantity > 0.000001
    );
    if (invalidItem) {
      toast.error(
        `${invalidItem.item.itemName}: la cantidad excede lo disponible para devolver`
      );
      return;
    }

    createReturnMutation.mutate({
      returnType: "devolucion_bodega_proyecto",
      reasonCategory: returnReasonCategory as any,
      justification: returnJustification.trim(),
      sourceProjectId: detail.warehouseExit.projectId,
      sourceWarehouseExitId: detail.warehouseExit.id,
      originalRequestId: detail.warehouseExit.materialRequestId ?? undefined,
      items: selectedItems.map(({ item, quantity }) => ({
        sourceWarehouseExitItemId: item.id,
        itemName: item.itemName,
        sapItemCode: item.sapItemCode,
        quantity: quantity.toFixed(2),
        unit: item.unit || undefined,
        condition: (returnConditionByItemId[item.id] || "usado_buen_estado") as any,
      })),
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="space-y-1">
          <h1>Salidas de Inventario</h1>
          <p className="text-sm text-muted-foreground">
            Consulta, emite o anula las transacciones generadas desde Flujos de
            Abastecimiento.
          </p>
        </div>
        <Button onClick={() => setDeliveryDialogOpen(true)} size="sm">
          <Plus className="mr-2 h-4 w-4" />
          Nueva entrega
        </Button>
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchTerm}
            onChange={event => setSearchTerm(event.target.value)}
            placeholder="Buscar por salida, proyecto o bodega..."
            className="h-10 pl-9"
          />
        </div>
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
              Cargando salidas de inventario...
            </div>
          ) : !(exits ?? []).length ? (
            <div className="flex flex-col items-center gap-3 p-10 text-center text-muted-foreground">
              <PackageMinus className="h-9 w-9" />
              <p>No hay salidas de inventario generadas desde Flujos.</p>
            </div>
          ) : !filteredExits.length ? (
            <div className="p-8 text-center text-muted-foreground">
              No hay salidas de inventario que coincidan con los filtros
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      No. salida
                    </th>
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Proyecto
                    </th>
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Bodega
                    </th>
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Fecha
                    </th>
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Estado
                    </th>
                    <th className="p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Líneas
                    </th>
                    <th className="p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Cantidad
                    </th>
                    <th className="p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Acciones
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredExits.map((row: any) => (
                    <tr
                      key={row.warehouseExit.id}
                      className="border-b border-border last:border-0"
                    >
                      <td className="p-3 font-mono text-xs font-medium">
                        {row.warehouseExit.exitNumber}
                      </td>
                      <td className="p-3 text-xs">
                        {row.project
                          ? `${row.project.code} - ${row.project.name}`
                          : "-"}
                      </td>
                      <td className="p-3 text-xs">
                        {row.warehouse?.displayName || "-"}
                      </td>
                      <td className="p-3 text-xs">
                        {formatDate(row.warehouseExit.exitDate)}
                      </td>
                      <td className="p-3">
                        <Badge
                          variant="outline"
                          className={`text-xs ${
                            STATUS_COLORS[row.warehouseExit.status] || ""
                          }`}
                        >
                          {STATUS_LABELS[row.warehouseExit.status] ||
                            row.warehouseExit.status}
                        </Badge>
                      </td>
                      <td className="p-3 text-right">{row.itemCount}</td>
                      <td className="p-3 text-right font-medium">
                        {formatQuantity(row.totalQuantity)}
                      </td>
                      <td className="p-3 text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setSelectedId(row.warehouseExit.id)}
                        >
                          <Eye className="mr-2 h-4 w-4" />
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
        onOpenChange={(open) => {
          if (!open) {
            setSelectedId(null);
            resetReturnPanel();
          }
        }}
      >
        <DialogContent className="max-h-[92vh] w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] overflow-y-auto rounded-2xl p-5 sm:w-[calc(100vw-3rem)] sm:max-w-6xl sm:p-8">
          <DialogHeader className="border-b border-border/70 pb-5">
            <DialogTitle className="flex flex-wrap items-center gap-3 text-2xl font-bold tracking-tight sm:text-3xl">
              {detail?.warehouseExit.exitNumber || "Salida de Inventario"}
              {detail?.warehouseExit.status ? (
                <Badge
                  variant="outline"
                  className={`text-xs ${
                    STATUS_COLORS[detail.warehouseExit.status] || ""
                  }`}
                >
                  {STATUS_LABELS[detail.warehouseExit.status] ||
                    detail.warehouseExit.status}
                </Badge>
              ) : null}
            </DialogTitle>
          </DialogHeader>

          {detail ? (
            <div className="space-y-5 pt-2">
              <div className="grid gap-3 md:grid-cols-4">
                <div className="rounded-xl border bg-muted/20 p-4">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                    Proyecto
                  </Label>
                  <p className="mt-2 font-semibold">
                    {detail.project
                      ? `${detail.project.code} - ${detail.project.name}`
                      : "-"}
                  </p>
                </div>
                <div className="rounded-xl border bg-muted/20 p-4">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                    Bodega
                  </Label>
                  <p className="mt-2 font-semibold">
                    {detail.warehouse?.displayName || "-"}
                  </p>
                </div>
                <div className="rounded-xl border bg-muted/20 p-4">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                    Fecha salida
                  </Label>
                  <p className="mt-2 font-semibold">
                    {formatDate(detail.warehouseExit.exitDate)}
                  </p>
                </div>
                <div className="rounded-xl border bg-muted/20 p-4">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                    Registrada por
                  </Label>
                  <p className="mt-2 font-semibold">
                    {detail.createdBy?.name || "-"}
                  </p>
                </div>
              </div>

              {detail.warehouseExit.notes ? (
                <div className="rounded-xl border bg-muted/20 p-4 text-sm">
                  {detail.warehouseExit.notes}
                </div>
              ) : null}

              <div className="overflow-x-auto rounded-xl border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Código SAP
                      </th>
                      <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Ítem
                      </th>
                      <th className="p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Cantidad
                      </th>
                      <th className="p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Devuelto
                      </th>
                      <th className="p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Por devolver
                      </th>
                      <th className="p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Disponible bodega
                      </th>
                      <th className="p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Nueva existencia
                      </th>
                      <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Notas
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.items.map((item: any) => (
                      <tr key={item.id} className="border-b last:border-0">
                        <td className="p-3 font-mono text-xs">{item.sapItemCode}</td>
                        <td className="p-3 font-medium">{item.itemName}</td>
                        <td className="p-3 text-right">
                          {formatQuantity(item.quantity)}{" "}
                          <span className="text-xs text-muted-foreground">
                            {item.unit || ""}
                          </span>
                        </td>
                        <td className="p-3 text-right">
                          {formatQuantity(item.returnedQuantity)}{" "}
                          <span className="text-xs text-muted-foreground">
                            {item.unit || ""}
                          </span>
                        </td>
                        <td className="p-3 text-right font-medium">
                          {formatQuantity(item.returnableQuantity)}{" "}
                          <span className="text-xs text-muted-foreground">
                            {item.unit || ""}
                          </span>
                        </td>
                        <td className="p-3 text-right font-medium">
                          {formatQuantity(item.availableQuantity)}{" "}
                          <span className="text-xs text-muted-foreground">
                            {item.unit || ""}
                          </span>
                        </td>
                        <td
                          className={`p-3 text-right font-semibold ${
                            Number(item.stockAfterExit) < 0 ? "text-destructive" : ""
                          }`}
                        >
                          {formatQuantity(item.stockAfterExit)}{" "}
                          <span className="text-xs text-muted-foreground">
                            {item.unit || ""}
                          </span>
                        </td>
                        <td className="p-3 text-xs text-muted-foreground">
                          {item.notes || "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {canCreateReturns && returnPanelOpen ? (
                <div className="space-y-4 rounded-xl border border-primary/20 bg-primary/5 p-4">
                  <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                    <div>
                      <p className="font-semibold">Registrar devolución a bodega de proyecto</p>
                      <p className="text-xs text-muted-foreground">
                        Excedente solo devuelve stock. Los demás motivos reabren el
                        pendiente en Flujos por la cantidad devuelta.
                      </p>
                    </div>
                    <Badge variant="outline" className="w-fit text-xs">
                      {detail.warehouse?.displayName || "Bodega del proyecto"}
                    </Badge>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Motivo *</Label>
                      <Select
                        value={returnReasonCategory}
                        onValueChange={setReturnReasonCategory}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Seleccione motivo" />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(RETURN_REASON_LABELS).map(([value, label]) => (
                            <SelectItem key={value} value={value}>
                              {label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label>Justificación *</Label>
                      <Textarea
                        value={returnJustification}
                        onChange={(event) => setReturnJustification(event.target.value)}
                        placeholder="Explique por qué se devuelve el material"
                        rows={2}
                      />
                    </div>
                  </div>

                  <div className="overflow-x-auto rounded-lg border bg-background">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/30">
                          <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            Ítem
                          </th>
                          <th className="p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            Máx.
                          </th>
                          <th className="p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            Devolver
                          </th>
                          <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            Condición
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.items.map((item: any) => {
                          const maxQuantity = Number(item.returnableQuantity ?? 0);
                          return (
                            <tr key={item.id} className="border-b last:border-0">
                              <td className="p-3">
                                <p className="font-medium">{item.itemName}</p>
                                <p className="font-mono text-[11px] text-muted-foreground">
                                  {item.sapItemCode}
                                </p>
                              </td>
                              <td className="p-3 text-right font-mono text-xs">
                                {formatQuantity(item.returnableQuantity)} {item.unit || ""}
                              </td>
                              <td className="p-3">
                                <Input
                                  className="ml-auto w-28 text-right"
                                  type="number"
                                  min="0"
                                  max={maxQuantity}
                                  step="any"
                                  placeholder="0.00"
                                  value={returnQuantityByItemId[item.id] ?? ""}
                                  onChange={(event) =>
                                    setReturnQuantityByItemId((current) => ({
                                      ...current,
                                      [item.id]: event.target.value,
                                    }))
                                  }
                                  disabled={maxQuantity <= 0 || createReturnMutation.isPending}
                                />
                              </td>
                              <td className="p-3">
                                <Select
                                  value={
                                    returnConditionByItemId[item.id] ||
                                    "usado_buen_estado"
                                  }
                                  onValueChange={(value) =>
                                    setReturnConditionByItemId((current) => ({
                                      ...current,
                                      [item.id]: value,
                                    }))
                                  }
                                  disabled={maxQuantity <= 0 || createReturnMutation.isPending}
                                >
                                  <SelectTrigger className="w-full min-w-40">
                                    <SelectValue placeholder="Condición" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {Object.entries(RETURN_CONDITION_LABELS).map(
                                      ([value, label]) => (
                                        <SelectItem key={value} value={value}>
                                          {label}
                                        </SelectItem>
                                      )
                                    )}
                                  </SelectContent>
                                </Select>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex justify-end gap-3">
                    <Button
                      variant="outline"
                      onClick={resetReturnPanel}
                      disabled={createReturnMutation.isPending}
                    >
                      Cancelar devolución
                    </Button>
                    <Button
                      onClick={submitReturn}
                      disabled={createReturnMutation.isPending}
                    >
                      {createReturnMutation.isPending
                        ? "Registrando..."
                        : "Crear devolución"}
                    </Button>
                  </div>
                </div>
              ) : null}

              <div className="flex flex-wrap justify-end gap-3 border-t pt-4">
                {canCreateReturns && detail.warehouseExit.status === "emitida" ? (
                  <Button
                    variant="outline"
                    onClick={openReturnPanel}
                    disabled={
                      returnPanelOpen ||
                      !detail.items.some(
                        (item: any) => Number(item.returnableQuantity ?? 0) > 0
                      )
                    }
                  >
                    <RotateCcw className="mr-2 h-4 w-4" />
                    Registrar devolución
                  </Button>
                ) : null}

                {detail.warehouseExit.status === "borrador" ? (
                  <>
                    <Button
                      variant="outline"
                      onClick={() =>
                        cancelMutation.mutate({ id: detail.warehouseExit.id })
                      }
                      disabled={cancelMutation.isPending || emitMutation.isPending}
                    >
                      <XCircle className="mr-2 h-4 w-4" />
                      {cancelMutation.isPending ? "Anulando..." : "Anular borrador"}
                    </Button>
                    <Button
                      onClick={() => emitMutation.mutate({ id: detail.warehouseExit.id })}
                      disabled={emitMutation.isPending || cancelMutation.isPending}
                    >
                      <Send className="mr-2 h-4 w-4" />
                      {emitMutation.isPending ? "Emitiendo..." : "Emitir salida"}
                    </Button>
                  </>
                ) : null}
                <Button
                  variant="outline"
                  onClick={async () => {
                    const latest = await refetchDetail();
                    const documentDetail = latest.data ?? detail;
                    const downloaded = downloadBase64Document({
                      base64: documentDetail?.warehouseExit.printedDocumentContent,
                      fileName: documentDetail?.warehouseExit.printedDocumentName,
                      mimeType: documentDetail?.warehouseExit.printedDocumentMimeType,
                    });
                    if (!downloaded) toast.error("La salida no tiene PDF generado");
                  }}
                  disabled={detail.warehouseExit.status !== "emitida"}
                >
                  <Download className="mr-2 h-4 w-4" />
                  Descargar PDF
                </Button>
              </div>
            </div>
          ) : (
            <div className="py-10 text-center text-sm text-muted-foreground">
              Cargando salida de bodega...
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={deliveryDialogOpen}
        onOpenChange={(open) => {
          setDeliveryDialogOpen(open);
          if (!open) {
            setDeliveryRequestId("");
            setDeliveryNotes("");
            setDeliveryQuantityByItemId({});
          }
        }}
      >
        <DialogContent className="max-h-[92vh] w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] overflow-y-auto rounded-2xl p-5 sm:w-[calc(100vw-3rem)] sm:max-w-6xl sm:p-8">
          <DialogHeader className="border-b border-border/70 pb-5">
            <DialogTitle className="text-2xl font-bold tracking-tight sm:text-3xl">
              Nueva entrega de requisición
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-5 pt-2">
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(260px,360px)]">
              <div className="space-y-2">
                <Label>Requisición *</Label>
                <Select value={deliveryRequestId} onValueChange={setDeliveryRequestId}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Seleccione requisición" />
                  </SelectTrigger>
                  <SelectContent>
                    {eligibleMaterialRequests.map((row: any) => (
                      <SelectItem key={row.request.id} value={String(row.request.id)}>
                        {row.request.requestNumber} - {row.project?.code} {row.project?.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="rounded-xl border bg-muted/20 p-4 text-sm">
                <p className="font-semibold">
                  {deliveryRequestDetail?.project
                    ? `${deliveryRequestDetail.project.code} - ${deliveryRequestDetail.project.name}`
                    : "Proyecto pendiente"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Se muestran requisiciones con flujo completado o parcialmente atendidas. La salida solo incluye renglones ya recibidos o disponibles en bodega.
                </p>
              </div>
            </div>

            {deliveryRequestDetail ? (
              <>
                {deliveryItems.length > 0 ? (
                  <div className="overflow-x-auto rounded-xl border">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/30">
                          <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            Código SAP
                          </th>
                          <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            Ítem
                          </th>
                          <th className="p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            Solicitado
                          </th>
                          <th className="p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            Ya entregado
                          </th>
                          <th className="p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            Disponible
                          </th>
                          <th className="w-36 p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            Entregar
                          </th>
                          <th className="p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            Saldo
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {deliveryItems.map((item: any) => {
                          const requestedQuantity = parseQuantity(item.quantity);
                          const alreadyDispatched = getPhysicalDispatchedQuantity(item);
                          const availableQuantity = parseQuantity(item.projectStock);
                          const pendingQuantity = getDeliveryPendingQuantity(item);
                          const quantity = Number(deliveryQuantityByItemId[item.id] ?? 0);
                          const balanceQuantity = Math.max(pendingQuantity - quantity, 0);
                          const canDeliver =
                            pendingQuantity > 0 &&
                            availableQuantity > 0 &&
                            Boolean(item.sapItemCode);

                          return (
                            <tr key={item.id} className="border-b last:border-0">
                              <td className="p-3 font-mono text-xs">
                                {item.sapItemCode || "-"}
                              </td>
                              <td className="p-3">
                                <p className="font-medium">
                                  {item.sapItemDescription || item.itemName}
                                </p>
                                {!item.sapItemCode ? (
                                  <p className="text-[11px] text-destructive">
                                    Pendiente de código SAP
                                  </p>
                                ) : null}
                              </td>
                              <td className="p-3 text-right">
                                {formatQuantity(requestedQuantity)} {item.unit || ""}
                              </td>
                              <td className="p-3 text-right">
                                {formatQuantity(alreadyDispatched)} {item.unit || ""}
                              </td>
                              <td className="p-3 text-right font-medium">
                                {formatQuantity(availableQuantity)} {item.unit || ""}
                              </td>
                              <td className="p-3">
                                <Input
                                  className="ml-auto w-28 text-right"
                                  type="number"
                                  min="0"
                                  max={Math.min(pendingQuantity, availableQuantity)}
                                  step="any"
                                  value={deliveryQuantityByItemId[item.id] ?? ""}
                                  onChange={(event) =>
                                    setDeliveryQuantityByItemId((current) => ({
                                      ...current,
                                      [item.id]: event.target.value,
                                    }))
                                  }
                                  disabled={!canDeliver || createDeliveryMutation.isPending}
                                  placeholder="0.00"
                                />
                              </td>
                              <td className="p-3 text-right">
                                <p className="font-mono">
                                  {formatQuantity(balanceQuantity)} {item.unit || ""}
                                </p>
                                {balanceQuantity > 0 ? (
                                  <p className="text-[10px] text-muted-foreground">
                                    Pendiente
                                  </p>
                                ) : null}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="rounded-xl border bg-muted/20 p-8 text-center text-sm text-muted-foreground">
                    Esta requisición no tiene renglones recibidos disponibles para salida.
                  </div>
                )}

                <div className="space-y-2">
                  <Label>Notas</Label>
                  <Textarea
                    value={deliveryNotes}
                    onChange={(event) => setDeliveryNotes(event.target.value)}
                    placeholder="Observaciones para la entrega"
                    rows={3}
                  />
                </div>
              </>
            ) : (
              <div className="rounded-xl border bg-muted/20 p-8 text-center text-sm text-muted-foreground">
                Seleccione una requisición para cargar los ítems disponibles.
              </div>
            )}

            <div className="flex justify-end gap-3 border-t pt-4">
              <Button
                variant="outline"
                onClick={() => setDeliveryDialogOpen(false)}
                disabled={createDeliveryMutation.isPending}
              >
                Cancelar
              </Button>
              <Button
                onClick={submitDelivery}
                disabled={
                  !deliveryRequestDetail ||
                  deliveryItems.length === 0 ||
                  createDeliveryMutation.isPending
                }
              >
                {createDeliveryMutation.isPending
                  ? "Creando..."
                  : "Crear salida en borrador"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
