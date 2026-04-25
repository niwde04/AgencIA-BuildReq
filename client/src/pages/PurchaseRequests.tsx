import { useAuth } from "@/_core/hooks/useAuth";
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  CalendarDays,
  Download,
  FileText,
  FileUp,
  FolderOpen,
  Save,
  ShoppingCart,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

const STATUS_LABELS: Record<string, string> = {
  pendiente: "Pendiente",
  en_revision: "En revisión",
  aprobada: "Aprobada",
  rechazada: "Rechazada",
  parcialmente_convertida: "Parcialmente convertida",
  convertida: "Convertida",
  anulada: "Anulada",
};

const UNIFIED_CONVERTIBLE_STATUSES = new Set([
  "pendiente",
  "en_revision",
  "aprobada",
]);

export default function PurchaseRequests() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [editNotes, setEditNotes] = useState("");
  const [editNeededBy, setEditNeededBy] = useState("");
  const [editPurchaseType, setEditPurchaseType] = useState<"local" | "extranjera">("local");
  const [selectedRequestIds, setSelectedRequestIds] = useState<number[]>([]);
  const [selectedItemIds, setSelectedItemIds] = useState<number[]>([]);
  const [rejectReason, setRejectReason] = useState("");
  const [emailDialog, setEmailDialog] = useState<{
    to: string;
    subject: string;
    content: string;
  } | null>(null);

  const {
    data: requests,
    isLoading,
    refetch: refetchPurchaseRequests,
  } = trpc.purchaseRequests.list.useQuery();
  const { data: detail } = trpc.purchaseRequests.getById.useQuery(
    { id: selectedId ?? 0 },
    { enabled: Boolean(selectedId) }
  );

  const canReject =
    user?.role === "admin" || (user as any)?.buildreqRole === "administrador_proyecto";
  const canConvert =
    user?.role === "admin" || (user as any)?.buildreqRole === "administracion_central";

  const updateMutation = trpc.purchaseRequests.update.useMutation({
    onSuccess: () => {
      toast.success("Solicitud de compra actualizada");
      void Promise.all([
        utils.purchaseRequests.list.invalidate(),
        selectedId ? utils.purchaseRequests.getById.invalidate({ id: selectedId }) : Promise.resolve(),
      ]);
    },
    onError: (error) => toast.error(error.message),
  });

  const rejectMutation = trpc.purchaseRequests.reject.useMutation({
    onSuccess: () => {
      toast.success("Solicitud de compra anulada");
      setRejectReason("");
      void Promise.all([
        utils.purchaseRequests.list.invalidate(),
        selectedId ? utils.purchaseRequests.getById.invalidate({ id: selectedId }) : Promise.resolve(),
      ]);
    },
    onError: (error) => toast.error(error.message),
  });

  const convertMutation = trpc.purchaseOrders.createFromPurchaseRequest.useMutation({
    onSuccess: (result) => {
      const purchaseOrderNumbers =
        "purchaseOrders" in result && Array.isArray(result.purchaseOrders)
          ? result.purchaseOrders.map((entry) => entry.purchaseOrderNumber)
          : result.purchaseOrderNumber
            ? [result.purchaseOrderNumber]
            : [];

      toast.success(
        purchaseOrderNumbers.length === 1
          ? `OC ${purchaseOrderNumbers[0]} generada`
          : `Se generaron ${purchaseOrderNumbers.length} órdenes de compra`
      );
      setSelectedItemIds([]);
      void Promise.all([
        utils.purchaseRequests.list.invalidate(),
        utils.purchaseOrders.list.invalidate(),
        selectedId ? utils.purchaseRequests.getById.invalidate({ id: selectedId }) : Promise.resolve(),
      ]);
    },
    onError: (error) => toast.error(error.message),
  });

  const unifiedConvertMutation =
    trpc.purchaseOrders.createUnifiedFromPurchaseRequests.useMutation({
      onSuccess: async (result) => {
        const convertedIds = new Set(result.purchaseRequestIds ?? []);
        utils.purchaseRequests.list.setData(undefined, (current: any) =>
          current?.map((row: any) =>
            convertedIds.has(row.purchaseRequest.id)
              ? {
                  ...row,
                  purchaseRequest: {
                    ...row.purchaseRequest,
                    status: "convertida",
                  },
                }
              : row
          )
        );
        toast.success(`OC unificada ${result.purchaseOrderNumber} generada`);
        setSelectedRequestIds([]);
        await Promise.all([
          utils.purchaseRequests.list.invalidate(),
          utils.purchaseOrders.list.invalidate(),
          refetchPurchaseRequests(),
        ]);
      },
      onError: (error) => toast.error(error.message),
    });

  const attachQuoteMutation = trpc.purchaseRequests.attachQuote.useMutation({
    onSuccess: () => {
      toast.success("Cotización aprobada adjuntada");
      void Promise.all([
        utils.purchaseRequests.list.invalidate(),
        selectedId ? utils.purchaseRequests.getById.invalidate({ id: selectedId }) : Promise.resolve(),
      ]);
    },
    onError: (error) => toast.error(error.message),
  });

  const uploadMutation = trpc.attachments.upload.useMutation({
    onSuccess: (result) => {
      if (!selectedId) return;
      attachQuoteMutation.mutate({
        id: selectedId,
        attachmentId: result.id,
      });
    },
    onError: (error) => toast.error(error.message),
  });

  const selectedItems = useMemo(() => {
    return detail?.items ?? [];
  }, [detail]);

  const itemIdsToConvert = useMemo(
    () =>
      selectedItemIds.length > 0
        ? selectedItemIds
        : selectedItems.map((item: any) => item.id),
    [selectedItemIds, selectedItems]
  );

  const convertibleRequestIds = useMemo(
    () =>
      (requests ?? [])
        .filter((row: any) =>
          UNIFIED_CONVERTIBLE_STATUSES.has(row.purchaseRequest.status)
        )
        .map((row: any) => row.purchaseRequest.id),
    [requests]
  );
  const allConvertibleSelected =
    convertibleRequestIds.length > 0 &&
    convertibleRequestIds.every((id: number) => selectedRequestIds.includes(id));
  const someConvertibleSelected =
    convertibleRequestIds.some((id: number) => selectedRequestIds.includes(id)) &&
    !allConvertibleSelected;

  useEffect(() => {
    setSelectedRequestIds((current) =>
      current.filter((id) => convertibleRequestIds.includes(id))
    );
  }, [convertibleRequestIds]);

  const projectLabel =
    detail?.projectSummary?.label ||
    (detail?.project
      ? `${detail.project.code} — ${detail.project.name}`
      : detail?.purchaseRequest
        ? `Proyecto ${detail.purchaseRequest.projectId}`
        : "Proyecto pendiente");
  const isMixedProjectRequest = Boolean(detail?.projectSummary?.isMixed);
  const isConvertedPurchaseRequest = detail?.purchaseRequest.status === "convertida";

  const purchaseTypeLabel =
    editPurchaseType === "local" ? "Compra Local" : "Compra Extranjera";

  const openRequest = (id: number) => {
    setSelectedId(id);
    const row = requests?.find((entry: any) => entry.purchaseRequest.id === id);
    setEditNotes(row?.purchaseRequest.notes || "");
    setEditNeededBy(
      row?.purchaseRequest.neededBy
        ? new Date(row.purchaseRequest.neededBy).toISOString().slice(0, 10)
        : ""
    );
    setEditPurchaseType((row?.purchaseRequest.purchaseType || "local") as "local" | "extranjera");
    setSelectedItemIds([]);
    setRejectReason("");
  };

  const toggleRequestSelection = (id: number, checked: boolean) => {
    setSelectedRequestIds((current) =>
      checked
        ? Array.from(new Set([...current, id]))
        : current.filter((entry) => entry !== id)
    );
  };

  const toggleAllConvertibleRequests = (checked: boolean) => {
    setSelectedRequestIds(checked ? convertibleRequestIds : []);
  };

  const handleQuoteUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !selectedId) return;

    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(",")[1];
      uploadMutation.mutate({
        entityType: "purchase_request",
        entityId: selectedId,
        fileName: file.name,
        fileData: base64,
        mimeType: file.type,
        fileSize: file.size,
        category: "documento_proveedor",
      });
    };
    reader.readAsDataURL(file);
    event.target.value = "";
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1>Solicitudes de Compra</h1>
        {canConvert && selectedRequestIds.length > 1 ? (
          <Button
            onClick={() =>
              unifiedConvertMutation.mutate({
                purchaseRequestIds: selectedRequestIds,
              })
            }
            disabled={unifiedConvertMutation.isPending}
          >
            <ShoppingCart className="mr-2 h-4 w-4" />
            {unifiedConvertMutation.isPending
              ? "Creando..."
              : `Crear orden de compra unificada (${selectedRequestIds.length})`}
          </Button>
        ) : null}
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">
              Cargando solicitudes de compra...
            </div>
          ) : !(requests || []).length ? (
            <div className="p-8 text-center text-muted-foreground">
              No hay solicitudes de compra registradas
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    {canConvert ? (
                      <th className="w-16 p-3 text-left">
                        <Checkbox
                          checked={
                            allConvertibleSelected
                              ? true
                              : someConvertibleSelected
                                ? "indeterminate"
                                : false
                          }
                          onCheckedChange={(checked) =>
                            toggleAllConvertibleRequests(checked === true)
                          }
                          aria-label="Seleccionar solicitudes convertibles"
                          disabled={convertibleRequestIds.length === 0}
                        />
                      </th>
                    ) : null}
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      No. Solicitud
                    </th>
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Proyecto
                    </th>
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Tipo de Compra
                    </th>
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Fecha creación
                    </th>
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Doc SAP
                    </th>
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Estatus
                    </th>
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Fecha necesaria
                    </th>
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Documento
                    </th>
                    <th className="p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Acciones
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {(requests || []).map((row: any) => {
                    const canSelectForUnified =
                      canConvert &&
                      UNIFIED_CONVERTIBLE_STATUSES.has(
                        row.purchaseRequest.status
                      );

                    return (
                    <tr key={row.purchaseRequest.id} className="border-b border-border last:border-0">
                      {canConvert ? (
                        <td className="p-3">
                          <Checkbox
                            checked={selectedRequestIds.includes(
                              row.purchaseRequest.id
                            )}
                            onCheckedChange={(checked) =>
                              toggleRequestSelection(
                                row.purchaseRequest.id,
                                checked === true
                              )
                            }
                            disabled={!canSelectForUnified}
                            aria-label={`Seleccionar ${row.purchaseRequest.requestNumber}`}
                          />
                        </td>
                      ) : null}
                      <td className="p-3 font-medium">{row.purchaseRequest.requestNumber}</td>
                      <td className="p-3 text-xs">
                        {row.projectSummary?.label ||
                          (row.project ? `${row.project.code} — ${row.project.name}` : "—")}
                      </td>
                      <td className="p-3 text-xs">
                        {row.purchaseRequest.purchaseType === "local"
                          ? "Compra Local"
                          : "Compra Extranjera"}
                      </td>
                      <td className="p-3 text-xs">
                        {row.purchaseRequest.createdAt
                          ? new Date(row.purchaseRequest.createdAt).toLocaleDateString("es-HN")
                          : "—"}
                      </td>
                      <td className="p-3 text-xs">{row.purchaseRequest.sapDocumentNumber || "—"}</td>
                      <td className="p-3">
                        <Badge variant="outline" className="text-xs">
                          {STATUS_LABELS[row.purchaseRequest.status] || row.purchaseRequest.status}
                        </Badge>
                      </td>
                      <td className="p-3 text-xs">
                        {row.purchaseRequest.neededBy
                          ? new Date(row.purchaseRequest.neededBy).toLocaleDateString("es-HN")
                          : "—"}
                      </td>
                      <td className="p-3 text-xs">
                        {row.purchaseRequest.printedDocumentContent ? "Listo" : "Pendiente"}
                      </td>
                      <td className="p-3 text-right">
                        <Button variant="outline" size="sm" onClick={() => openRequest(row.purchaseRequest.id)}>
                          Ver
                        </Button>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={Boolean(selectedId)}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null);
        }}
      >
        <DialogContent className="scrollbar-none max-h-[calc(100vh-0.75rem)] w-[calc(100vw-0.5rem)] max-w-[calc(100vw-0.5rem)] overflow-x-hidden overflow-y-auto rounded-2xl border border-border/70 p-4 shadow-2xl sm:max-h-[calc(100vh-1.5rem)] sm:w-[calc(100vw-2rem)] sm:max-w-[1460px] sm:p-6 lg:p-8">
          <DialogHeader className="border-b border-border/70 pb-4 pr-10">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="space-y-2">
                <DialogTitle className="text-[2rem] font-bold tracking-tight sm:text-[2.35rem]">
                  {detail?.purchaseRequest.requestNumber || "Solicitud de Compra"}
                </DialogTitle>
                <p className="text-sm text-muted-foreground">
                  {isConvertedPurchaseRequest
                    ? "Esta solicitud ya fue convertida a orden de compra y se muestra en modo solo lectura."
                    : "Revisa la solicitud, adjunta cotización y convierte los ítems seleccionados a orden de compra cuando ya esté lista."}
                </p>
              </div>
              {detail && (
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="rounded-full px-3 py-1 text-xs uppercase">
                    {STATUS_LABELS[detail.purchaseRequest.status] || detail.purchaseRequest.status}
                  </Badge>
                  <Badge variant="secondary" className="rounded-full px-3 py-1 text-xs">
                    {selectedItems.length} ítem(s)
                  </Badge>
                </div>
              )}
            </div>
          </DialogHeader>

          {detail && (
            <div className="space-y-6 pt-2">
              <div className="grid gap-4 xl:grid-cols-[1.35fr_1fr_1fr_1fr]">
                <div className="rounded-2xl border border-border/70 bg-card p-5">
                  <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                    <FolderOpen className="h-4 w-4" />
                    Proyecto
                  </div>
                  <p className="text-lg font-semibold leading-snug">{projectLabel}</p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Documento:{" "}
                    {detail.purchaseRequest.printedDocumentContent ? "Listo para descarga" : "Pendiente de generar"}
                  </p>
                </div>

                <div className="rounded-2xl border border-border/70 bg-card p-5">
                  <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                    <FileText className="h-4 w-4" />
                    Tipo de compra
                  </div>
                  <Select
                    value={editPurchaseType}
                    onValueChange={(value) =>
                      setEditPurchaseType(value as "local" | "extranjera")
                    }
                    disabled={isConvertedPurchaseRequest}
                  >
                    <SelectTrigger className="h-12 text-base">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="local">Compra Local</SelectItem>
                      <SelectItem value="extranjera">Compra Extranjera</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="mt-2 text-sm text-muted-foreground">{purchaseTypeLabel}</p>
                </div>

                <div className="rounded-2xl border border-border/70 bg-card p-5">
                  <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                    <CalendarDays className="h-4 w-4" />
                    Fecha necesaria
                  </div>
                  <Input
                    className="h-12 text-base"
                    type="date"
                    value={editNeededBy}
                    onChange={(event) => setEditNeededBy(event.target.value)}
                    disabled={isConvertedPurchaseRequest}
                  />
                  <p className="mt-2 text-sm text-muted-foreground">
                    Programa la fecha objetivo para gestionar esta compra.
                  </p>
                </div>

                <div className="rounded-2xl border border-border/70 bg-card p-5">
                  <div className="mb-3 text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                    Estatus
                  </div>
                  <div className="flex min-h-[3rem] items-center">
                    <Badge variant="outline" className="rounded-full px-3 py-1 text-sm">
                      {STATUS_LABELS[detail.purchaseRequest.status] || detail.purchaseRequest.status}
                    </Badge>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {detail.purchaseRequest.quoteAttachmentId
                      ? "Cotización adjunta y lista para revisión."
                      : "Todavía no tiene cotización aprobada adjunta."}
                  </p>
                </div>
              </div>

              <div className="rounded-2xl border border-border/70 bg-card p-5">
                <div className="space-y-2">
                  <Label className="text-sm font-semibold">Notas</Label>
                  <Textarea
                    value={editNotes}
                    onChange={(event) => setEditNotes(event.target.value)}
                    rows={4}
                    className="min-h-[140px] resize-y text-sm"
                    placeholder="Detalles, condiciones o instrucciones importantes para esta solicitud de compra"
                    disabled={isConvertedPurchaseRequest}
                  />
                </div>
              </div>

              <div className="rounded-2xl border border-border/70 bg-card">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 px-5 py-4">
                  <div>
                    <p className="text-base font-semibold">Ítems de la solicitud</p>
                    <p className="text-sm text-muted-foreground">
                      {isConvertedPurchaseRequest
                        ? "Los ítems ya fueron convertidos y esta solicitud quedó cerrada para edición."
                        : canConvert
                        ? "Marca los renglones que deseas convertir a la próxima orden de compra."
                        : "Detalle de ítems incluidos en la solicitud."}
                    </p>
                  </div>
                  {canConvert && !isConvertedPurchaseRequest && (
                    <Badge variant="secondary" className="rounded-full px-3 py-1 text-xs">
                      {selectedItemIds.length > 0
                        ? `${selectedItemIds.length} seleccionados`
                        : `Se convertirán los ${selectedItems.length}`}
                    </Badge>
                  )}
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full min-w-[1080px] text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/20">
                        {canConvert && !isConvertedPurchaseRequest && (
                          <th className="w-20 p-4 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            A OC
                          </th>
                        )}
                        <th className="w-44 p-4 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          Req.
                        </th>
                        <th className="w-56 p-4 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          Proyecto
                        </th>
                        <th className="p-4 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          Ítem
                        </th>
                        <th className="w-48 p-4 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          SAP
                        </th>
                        <th className="w-40 p-4 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          Cantidad
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedItems.map((item: any) => (
                        <tr key={item.id} className="border-b border-border/70 last:border-0">
                        {canConvert && !isConvertedPurchaseRequest && (
                          <td className="p-4 align-top">
                            <Checkbox
                                checked={selectedItemIds.includes(item.id)}
                                onCheckedChange={(checked) => {
                                  setSelectedItemIds((current) =>
                                    checked
                                      ? [...current, item.id]
                                      : current.filter((entry) => entry !== item.id)
                                  );
                                }}
                              />
                          </td>
                        )}
                        <td className="p-4 align-top text-xs">
                          {item.sourceRequest?.requestNumber || "—"}
                        </td>
                        <td className="p-4 align-top text-xs">
                          {item.sourceProject
                            ? `${item.sourceProject.code} — ${item.sourceProject.name}`
                            : isMixedProjectRequest
                              ? "Proyecto pendiente"
                              : projectLabel}
                        </td>
                        <td className="p-4 align-top">
                          <p className="font-medium">{item.itemName}</p>
                            {item.notes && (
                              <p className="mt-1 text-xs text-muted-foreground">{item.notes}</p>
                            )}
                          </td>
                          <td className="p-4 align-top text-xs font-mono">
                            {item.currentSapItemCode || item.originalSapItemCode || "—"}
                          </td>
                          <td className="p-4 text-right align-top font-medium">
                            {item.quantity} {item.unit || ""}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex flex-col gap-4 rounded-2xl border border-border/70 bg-card p-5 xl:flex-row xl:items-start xl:justify-between">
                <div className="flex flex-wrap gap-3">
                  <Button
                    variant="outline"
                    className="h-11 px-4"
                    onClick={() => {
                      const downloaded = downloadBase64Document({
                        base64: detail.purchaseRequest.printedDocumentContent,
                        fileName: detail.purchaseRequest.printedDocumentName,
                        mimeType: detail.purchaseRequest.printedDocumentMimeType,
                      });
                      if (!downloaded) toast.error("La SC no tiene documento generado");
                    }}
                  >
                    <Download className="mr-2 h-4 w-4" />
                    Descargar documento
                  </Button>

                  {!isConvertedPurchaseRequest && (
                    <>
                      <input
                        ref={fileInputRef}
                        type="file"
                        className="hidden"
                        onChange={handleQuoteUpload}
                      />
                      <Button
                        variant="outline"
                        className="h-11 px-4"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploadMutation.isPending || attachQuoteMutation.isPending}
                      >
                        <FileUp className="mr-2 h-4 w-4" />
                        Adjuntar cotización
                      </Button>
                    </>
                  )}
                </div>

                {!isConvertedPurchaseRequest && (
                  <div className="flex flex-wrap gap-3">
                    <Button
                      variant="outline"
                      className="h-11 px-4"
                      onClick={() =>
                        updateMutation.mutate({
                          id: detail.purchaseRequest.id,
                          purchaseType: editPurchaseType,
                          neededBy: editNeededBy || undefined,
                          notes: editNotes || undefined,
                        })
                      }
                      disabled={updateMutation.isPending}
                    >
                      <Save className="mr-2 h-4 w-4" />
                      Guardar cambios
                    </Button>

                    {canReject && (
                      <Button
                        variant="destructive"
                        className="h-11 px-4"
                        onClick={() => {
                          if (rejectReason.trim().length < 5) {
                            toast.error("Indica un motivo de al menos 5 caracteres");
                            return;
                          }
                          rejectMutation.mutate({
                            id: detail.purchaseRequest.id,
                            reason: rejectReason,
                          });
                        }}
                        disabled={rejectMutation.isPending}
                      >
                        <XCircle className="mr-2 h-4 w-4" />
                        Anular SC
                      </Button>
                    )}

                    {canConvert && (
                      <Button
                        className="h-11 px-5"
                        onClick={() =>
                          convertMutation.mutate({
                            purchaseRequestId: detail.purchaseRequest.id,
                            selectedItemIds: itemIdsToConvert,
                          })
                        }
                        disabled={convertMutation.isPending || itemIdsToConvert.length === 0}
                      >
                        <ShoppingCart className="mr-2 h-4 w-4" />
                        Convertir a OC
                      </Button>
                    )}
                  </div>
                )}
              </div>

              {canReject && !isConvertedPurchaseRequest && (
                <div className="rounded-2xl border border-border/70 bg-card p-5">
                  <div className="space-y-2">
                    <Label className="text-sm font-semibold">Motivo de anulación</Label>
                    <Textarea
                      value={rejectReason}
                      onChange={(event) => setRejectReason(event.target.value)}
                      placeholder="Explique por qué se anula la solicitud de compra"
                      rows={3}
                      className="min-h-[120px] resize-y text-sm"
                    />
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(emailDialog)} onOpenChange={() => setEmailDialog(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Correo preparado</DialogTitle>
          </DialogHeader>
          {emailDialog && (
            <div className="space-y-3">
              <div>
                <Label className="text-xs text-muted-foreground">Para</Label>
                <p className="text-sm font-medium">{emailDialog.to}</p>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Asunto</Label>
                <p className="text-sm font-medium">{emailDialog.subject}</p>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Contenido</Label>
                <div className="rounded-md bg-muted p-3 whitespace-pre-wrap text-sm">
                  {emailDialog.content}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
