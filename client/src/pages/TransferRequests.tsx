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
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/_core/hooks/useAuth";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Truck, Ban, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

const STATUS_LABELS: Record<string, string> = {
  pendiente: "Pendiente",
  aprobada: "Aprobada",
  rechazada: "Rechazada",
  convertida: "Convertida",
  anulada: "Anulada",
};

const STATUS_COLORS: Record<string, string> = {
  pendiente: "border-amber-300 bg-amber-50 text-amber-700",
  aprobada: "border-emerald-300 bg-emerald-50 text-emerald-700",
  rechazada: "border-rose-300 bg-rose-50 text-rose-700",
  convertida: "border-emerald-300 bg-emerald-50 text-emerald-700",
  anulada: "border-red-300 bg-red-50 text-red-700",
};

function getDestinationLabel(transferRequest: any) {
  return transferRequest.destinationType === "bodega_central"
    ? "Bodega Central"
    : `Proyecto ${transferRequest.destinationProjectId ?? ""}`.trim();
}

export default function TransferRequests() {
  const utils = trpc.useUtils();
  const { user } = useAuth();
  const allowManualTransferRequests = false;
  const canProcessTransferRequests =
    user?.role === "admin" || (user as any)?.buildreqRole === "jefe_bodega_central";
  const [dialogOpen, setDialogOpen] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [projectId, setProjectId] = useState("");
  const [destinationType, setDestinationType] = useState<"proyecto" | "bodega_central">(
    "proyecto"
  );
  const [destinationProjectId, setDestinationProjectId] = useState("");
  const [neededBy, setNeededBy] = useState("");
  const [notes, setNotes] = useState("");
  const [itemName, setItemName] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [confirmCancelId, setConfirmCancelId] = useState<number | null>(null);
  const [transferQuantityByItemId, setTransferQuantityByItemId] = useState<
    Record<number, string>
  >({});

  const { data: projects } = trpc.projects.list.useQuery({ status: "activo" });
  const { data: transferRequests, isLoading } = trpc.transferRequests.list.useQuery();
  const {
    data: detail,
    isLoading: detailLoading,
    error: detailError,
  } = trpc.transferRequests.getById.useQuery(
    { id: detailId ?? 0 },
    { enabled: Boolean(detailId) }
  );

  const createMutation = trpc.transferRequests.create.useMutation({
    onSuccess: () => {
      toast.success("Solicitud de traslado creada");
      setDialogOpen(false);
      setProjectId("");
      setDestinationProjectId("");
      setNeededBy("");
      setNotes("");
      setItemName("");
      setQuantity("");
      setUnit("");
      void utils.transferRequests.list.invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  const convertMutation = trpc.transferRequests.convertToTransfer.useMutation({
    onSuccess: (result) => {
      toast.success(`Traslado ${result.transferNumber} generado`);
      void Promise.all([
        utils.transferRequests.list.invalidate(),
        utils.transfers.list.invalidate(),
        detailId ? utils.transferRequests.getById.invalidate({ id: detailId }) : Promise.resolve(),
      ]);
    },
    onError: (error) => toast.error(error.message),
  });

  const cancelMutation = trpc.transferRequests.cancel.useMutation({
    onSuccess: () => {
      toast.success("Solicitud de traslado anulada");
      setConfirmCancelId(null);
      void Promise.all([
        utils.transferRequests.list.invalidate(),
        detailId ? utils.transferRequests.getById.invalidate({ id: detailId }) : Promise.resolve(),
      ]);
    },
    onError: (error) => toast.error(error.message),
  });

  useEffect(() => {
    if (!detail || detail.transferRequest.status !== "pendiente") {
      return;
    }

    const nextQuantities: Record<number, string> = {};
    for (const item of detail.items || []) {
      const requestedQuantity = Number(item.quantity ?? 0);
      const availableQuantity = Number(item.originStockQuantity ?? 0);
      const suggestedQuantity = Math.min(
        Math.max(requestedQuantity, 0),
        Math.max(availableQuantity, 0)
      );
      nextQuantities[item.id] = suggestedQuantity.toFixed(2);
    }
    setTransferQuantityByItemId(nextQuantities);
  }, [detail?.transferRequest.id, detail?.transferRequest.status]);

  const getTransferQuantity = (item: any) =>
    Number(
      transferQuantityByItemId[item.id] ??
        (detail?.transferRequest.status === "pendiente"
          ? Math.min(
              Number(item.quantity ?? 0),
              Number(item.originStockQuantity ?? 0)
            ).toFixed(2)
          : item.quantity ?? 0)
    );

  const filteredTransferRequests = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();

    return (transferRequests ?? []).filter((row: any) => {
      const transferRequest = row.transferRequest;
      const projectLabel = row.project
        ? `${row.project.code} ${row.project.name}`
        : "";
      const destinationLabel = getDestinationLabel(transferRequest);
      const matchesSearch =
        !normalizedSearch ||
        [
          transferRequest.requestNumber,
          row.materialRequest?.requestNumber,
          projectLabel,
          destinationLabel,
        ]
          .filter(Boolean)
          .some(value =>
            String(value).toLowerCase().includes(normalizedSearch)
          );
      const matchesStatus =
        statusFilter === "all" || transferRequest.status === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [searchTerm, statusFilter, transferRequests]);

  const handleConvertToTransfer = () => {
    if (!detail) return;

    const items = (detail.items || []).map((item: any) => {
      const requestedQuantity = Number(item.quantity ?? 0);
      const availableQuantity = Number(item.originStockQuantity ?? 0);
      const transferQuantity = getTransferQuantity(item);

      if (!Number.isFinite(transferQuantity) || transferQuantity < 0) {
        toast.error("Revise las cantidades a enviar");
        return null;
      }
      if (transferQuantity - requestedQuantity > 0.000001) {
        toast.error(`La cantidad a enviar de ${item.itemName} no puede exceder lo solicitado`);
        return null;
      }
      if (transferQuantity - availableQuantity > 0.000001) {
        toast.error(`No hay suficiente existencia para enviar ${item.itemName}`);
        return null;
      }

      return {
        transferRequestItemId: item.id,
        quantity: transferQuantity.toFixed(2),
      };
    });

    if (items.some((item) => item === null)) return;
    const validItems = items.filter((item): item is NonNullable<typeof item> =>
      Boolean(item)
    );

    if (!validItems.some((item) => Number(item.quantity) > 0)) {
      toast.error("Debe enviar al menos una cantidad mayor que cero");
      return;
    }

    convertMutation.mutate({
      id: detail.transferRequest.id,
      items: validItems,
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h1>Solicitudes de Traslado</h1>
          <p className="text-sm text-muted-foreground">
            Los traslados operativos se generan desde la requisición que necesita el material.
          </p>
        </div>
        {allowManualTransferRequests ? (
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                Nueva solicitud
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Nueva Solicitud de Traslado</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Proyecto origen</Label>
                    <Select value={projectId} onValueChange={setProjectId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Seleccione proyecto" />
                      </SelectTrigger>
                      <SelectContent>
                        {(projects || []).map((project: any) => (
                          <SelectItem key={project.id} value={String(project.id)}>
                            {project.code} — {project.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Destino</Label>
                    <Select
                      value={destinationType}
                      onValueChange={(value) =>
                        setDestinationType(value as "proyecto" | "bodega_central")
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="proyecto">Proyecto</SelectItem>
                        <SelectItem value="bodega_central">Bodega Central</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {destinationType === "proyecto" && (
                  <div className="space-y-2">
                    <Label>Proyecto destino</Label>
                    <Select value={destinationProjectId} onValueChange={setDestinationProjectId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Seleccione proyecto destino" />
                      </SelectTrigger>
                      <SelectContent>
                        {(projects || []).map((project: any) => (
                          <SelectItem key={project.id} value={String(project.id)}>
                            {project.code} — {project.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <div className="grid gap-3 md:grid-cols-3">
                  <div className="space-y-2 md:col-span-2">
                    <Label>Ítem</Label>
                    <Input value={itemName} onChange={(event) => setItemName(event.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Cantidad</Label>
                    <Input value={quantity} onChange={(event) => setQuantity(event.target.value)} />
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Unidad</Label>
                    <Input value={unit} onChange={(event) => setUnit(event.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Fecha necesaria</Label>
                    <Input type="date" value={neededBy} onChange={(event) => setNeededBy(event.target.value)} />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Notas</Label>
                  <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} />
                </div>

                <Button
                  className="w-full"
                  onClick={() => {
                    if (!projectId || !itemName || !quantity) {
                      toast.error("Proyecto, ítem y cantidad son obligatorios");
                      return;
                    }
                    createMutation.mutate({
                      projectId: Number(projectId),
                      destinationType,
                      destinationProjectId:
                        destinationType === "proyecto" && destinationProjectId
                          ? Number(destinationProjectId)
                          : undefined,
                      neededBy: neededBy || undefined,
                      notes: notes || undefined,
                      items: [
                        {
                          itemName,
                          quantity,
                          unit: unit || undefined,
                        },
                      ],
                    });
                  }}
                  disabled={createMutation.isPending}
                >
                  {createMutation.isPending ? "Creando..." : "Crear solicitud"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        ) : null}
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchTerm}
            onChange={event => setSearchTerm(event.target.value)}
            placeholder="Buscar por solicitud, requisición, proyecto o destino..."
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
              Cargando solicitudes de traslado...
            </div>
          ) : !(transferRequests || []).length ? (
            <div className="p-8 text-center text-muted-foreground">
              No hay solicitudes de traslado registradas
            </div>
          ) : !filteredTransferRequests.length ? (
            <div className="p-8 text-center text-muted-foreground">
              No hay solicitudes de traslado que coincidan con los filtros
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      No. Solicitud
                    </th>
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Proyecto
                    </th>
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Destino
                    </th>
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Estatus
                    </th>
                    <th className="p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Acciones
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTransferRequests.map((row: any) => (
                    <tr key={row.transferRequest.id} className="border-b border-border last:border-0">
                      <td className="p-3 font-medium">{row.transferRequest.requestNumber}</td>
                      <td className="p-3 text-xs">
                        {row.project ? `${row.project.code} — ${row.project.name}` : "—"}
                      </td>
                      <td className="p-3 text-xs">
                        {row.transferRequest.destinationType === "bodega_central"
                          ? "Bodega Central"
                          : `Proyecto ${row.transferRequest.destinationProjectId ?? ""}`}
                      </td>
                      <td className="p-3">
                        <Badge
                          variant="outline"
                          className={`text-xs ${
                            STATUS_COLORS[row.transferRequest.status] || ""
                          }`}
                        >
                          {STATUS_LABELS[row.transferRequest.status] || row.transferRequest.status}
                        </Badge>
                      </td>
                      <td className="p-3 text-right">
                        <Button variant="outline" size="sm" onClick={() => setDetailId(row.transferRequest.id)}>
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

      <Dialog open={Boolean(detailId)} onOpenChange={(open) => !open && setDetailId(null)}>
        <DialogContent className="scrollbar-none max-h-[calc(100vh-0.75rem)] w-[calc(100vw-0.5rem)] max-w-[calc(100vw-0.5rem)] overflow-x-hidden overflow-y-auto rounded-2xl p-4 sm:max-h-[calc(100vh-1.5rem)] sm:w-[calc(100vw-2rem)] sm:max-w-[1200px] sm:p-6 lg:p-7">
          <DialogHeader>
            <DialogTitle>{detail?.transferRequest.requestNumber || "Solicitud de Traslado"}</DialogTitle>
          </DialogHeader>
          {detailLoading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Cargando solicitud...
            </div>
          ) : detailError ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
              {detailError.message}
            </div>
          ) : detail ? (
            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-3">
                <div>
                  <Label className="text-xs text-muted-foreground">Proyecto origen</Label>
                  <p className="text-sm font-medium">
                    {detail.project ? `${detail.project.code} — ${detail.project.name}` : "—"}
                  </p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Destino</Label>
                  <p className="text-sm font-medium">
                    {detail.transferRequest.destinationType === "bodega_central"
                      ? "Bodega Central"
                      : `Proyecto ${detail.transferRequest.destinationProjectId ?? ""}`}
                  </p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Estatus</Label>
                  <div className="mt-1">
                    <Badge
                      variant="outline"
                      className={`text-xs ${
                        STATUS_COLORS[detail.transferRequest.status] || ""
                      }`}
                    >
                    {STATUS_LABELS[detail.transferRequest.status] || detail.transferRequest.status}
                    </Badge>
                  </div>
                </div>
              </div>

              <div className="rounded border border-border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="w-44 p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Código
                      </th>
                      <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Ítem
                      </th>
                      <th className="p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Cant. solicitada
                      </th>
                      {canProcessTransferRequests &&
                        detail.transferRequest.status === "pendiente" && (
                        <th className="w-36 p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          Enviar
                        </th>
                      )}
                      <th className="p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Exist. origen
                      </th>
                      <th className="p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Nueva existencia
                      </th>
                      {canProcessTransferRequests &&
                        detail.transferRequest.status === "pendiente" && (
                        <th className="p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          Saldo
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {(detail.items || []).map((item: any) => {
                      const requestedQuantity = Number(item.quantity ?? 0);
                      const originStockQuantity = Number(item.originStockQuantity ?? 0);
                      const transferQuantity =
                        detail.transferRequest.status === "pendiente"
                          ? getTransferQuantity(item)
                          : requestedQuantity;
                      const newStockQuantity =
                        detail.transferRequest.status === "pendiente"
                          ? originStockQuantity - transferQuantity
                          : Number(item.stockAfterTransfer ?? 0);
                      const pendingQuantity = Math.max(
                        requestedQuantity - transferQuantity,
                        0
                      );

                      return (
                        <tr key={item.id} className="border-b border-border last:border-0">
                          <td className="p-3 font-mono text-xs text-muted-foreground">
                            {item.sapItemCode || "-"}
                          </td>
                          <td className="p-3">{item.itemName}</td>
                          <td className="p-3 text-right">
                            {item.quantity} {item.unit || ""}
                          </td>
                          {canProcessTransferRequests &&
                            detail.transferRequest.status === "pendiente" && (
                            <td className="p-3">
                              <Input
                                value={
                                  transferQuantityByItemId[item.id] ??
                                  Math.min(
                                    requestedQuantity,
                                    originStockQuantity
                                  ).toFixed(2)
                                }
                                onChange={(event) =>
                                  setTransferQuantityByItemId((current) => ({
                                    ...current,
                                    [item.id]: event.target.value,
                                  }))
                                }
                                type="number"
                                min="0"
                                max={Math.min(requestedQuantity, originStockQuantity)}
                                step="any"
                                className="ml-auto h-9 w-28 text-right"
                                disabled={convertMutation.isPending}
                              />
                            </td>
                          )}
                          <td className="p-3 text-right">
                            {originStockQuantity.toFixed(2)} {item.unit || ""}
                          </td>
                          <td
                            className={`p-3 text-right font-medium ${
                              newStockQuantity < 0 ? "text-destructive" : ""
                            }`}
                          >
                            {newStockQuantity.toFixed(2)} {item.unit || ""}
                          </td>
                          {canProcessTransferRequests &&
                            detail.transferRequest.status === "pendiente" && (
                            <td className="p-3 text-right">
                              <p className="font-mono">
                                {pendingQuantity.toFixed(2)} {item.unit || ""}
                              </p>
                              {pendingQuantity > 0 && (
                                <p className="text-[10px] text-muted-foreground">
                                  Vuelve a flujo
                                </p>
                              )}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {canProcessTransferRequests ? (
                <div className="flex justify-end">
                <div className="flex flex-wrap justify-end gap-2">
                  {detail.transferRequest.status === "pendiente" ? (
                    <Button
                      variant="outline"
                      className="border-rose-200 text-rose-700 hover:bg-rose-50 hover:text-rose-800"
                      onClick={() => setConfirmCancelId(detail.transferRequest.id)}
                      disabled={cancelMutation.isPending || convertMutation.isPending}
                    >
                      <Ban className="mr-2 h-4 w-4" />
                      Cancelar solicitud
                    </Button>
                  ) : null}
                  <Button
                    onClick={handleConvertToTransfer}
                    disabled={convertMutation.isPending || detail.transferRequest.status !== "pendiente"}
                  >
                    <Truck className="mr-2 h-4 w-4" />
                    {convertMutation.isPending ? "Generando..." : "Convertir a traslado"}
                  </Button>
                </div>
              </div>
              ) : null}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(confirmCancelId)}
        onOpenChange={(open) => {
          if (!open && !cancelMutation.isPending) {
            setConfirmCancelId(null);
          }
        }}
      >
        <AlertDialogContent className="max-w-[560px] overflow-hidden rounded-2xl border-border/70 p-0 shadow-2xl">
          <div className="bg-gradient-to-br from-rose-50 via-white to-white p-6">
            <div className="flex items-start gap-4">
              <div className="mt-0.5 flex h-11 w-11 items-center justify-center rounded-full bg-rose-100 text-rose-700">
                <Ban className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <AlertDialogHeader className="gap-2 text-left">
                  <AlertDialogTitle className="text-xl font-semibold tracking-tight">
                    Cancelar solicitud de traslado
                  </AlertDialogTitle>
                  <AlertDialogDescription className="text-sm leading-6 text-muted-foreground">
                    Se anulará la solicitud{" "}
                    <span className="font-medium text-foreground">
                      {detail?.transferRequest.requestNumber ?? ""}
                    </span>
                    . El detalle no se borra, pero los ítems volverán a quedar habilitados en la requisición.
                  </AlertDialogDescription>
                </AlertDialogHeader>
              </div>
            </div>
          </div>
          <div className="bg-white px-6 pb-6">
            <AlertDialogFooter className="gap-3 sm:justify-end">
              <AlertDialogCancel
                className="mt-0"
                disabled={cancelMutation.isPending}
              >
                Volver
              </AlertDialogCancel>
              <AlertDialogAction
                className="bg-rose-600 text-white hover:bg-rose-700 focus-visible:ring-rose-500"
                onClick={(event) => {
                  event.preventDefault();
                  if (!confirmCancelId) return;
                  cancelMutation.mutate({ id: confirmCancelId });
                }}
                disabled={cancelMutation.isPending}
              >
                {cancelMutation.isPending ? "Cancelando..." : "Confirmar cancelación"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
