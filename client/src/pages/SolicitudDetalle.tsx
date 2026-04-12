import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  ArrowLeft,
  Package,
  Truck,
  ArrowLeftRight,
  ShoppingCart,
  Upload,
  FileText,
  Trash2,
  Check,
  Search,
  Send,
  AlertCircle,
} from "lucide-react";
import { useState, useRef, useEffect, useMemo } from "react";
import { useLocation, useParams } from "wouter";
import { toast } from "sonner";

const STATUS_LABELS: Record<string, string> = {
  en_espera: "En espera",
  en_proceso: "En proceso de atención",
  cerrada: "Cerrada",
};

const STATUS_COLORS: Record<string, string> = {
  en_espera: "border-amber-300 text-amber-700 bg-amber-50",
  en_proceso: "border-blue-300 text-blue-700 bg-blue-50",
  cerrada: "border-gray-300 text-gray-600 bg-gray-50",
};

const RECIPIENT_LABELS: Record<string, string> = {
  bodega_central: "Bodega Central",
  administrador_proyecto: "Administrador del Proyecto",
  solicitud_compra: "Solicitud de Compra",
};

const FLOW_LABELS: Record<string, string> = {
  compra_directa: "Compra Directa del Proyecto",
  despacho_bodega: "Despacho desde Bodega Central",
  traslado_proyecto: "Traslado entre Proyectos",
  solicitud_compra: "Solicitud de Compra",
};

const SAP_DOC_LABELS: Record<string, string> = {
  compra_directa: "OC → Entrada de Mercancías",
  despacho_bodega: "Salida de Inventario",
  traslado_proyecto: "Solicitud de Transferencia",
  solicitud_compra: "Solicitud de Compra",
};

const FLOW_ICONS: Record<string, any> = {
  compra_directa: Package,
  despacho_bodega: Truck,
  traslado_proyecto: ArrowLeftRight,
  solicitud_compra: ShoppingCart,
};

const FLOW_COLORS: Record<string, string> = {
  compra_directa: "bg-blue-50 border-blue-200 text-blue-700",
  despacho_bodega: "bg-green-50 border-green-200 text-green-700",
  traslado_proyecto: "bg-amber-50 border-amber-200 text-amber-700",
  solicitud_compra: "bg-purple-50 border-purple-200 text-purple-700",
};

/** SAP Catalog Search Textbox - uses Popover portal to escape overflow clipping */
function SapSearchBox({
  itemId,
  currentCode,
  currentDescription,
  onSelect,
  disabled,
}: {
  itemId: number;
  currentCode: string | null;
  currentDescription: string | null;
  onSelect: (code: string, desc: string) => void;
  disabled: boolean;
}) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);

  const { data: results } = trpc.requestItems.searchSapCatalog.useQuery(
    { search },
    { enabled: search.length >= 2 }
  );

  if (currentCode) {
    return (
      <div className="flex items-center gap-1">
        <span className="font-mono text-xs font-bold text-primary">{currentCode}</span>
        {currentDescription && (
          <span className="text-xs text-muted-foreground truncate max-w-[150px]">
            {currentDescription}
          </span>
        )}
      </div>
    );
  }

  if (disabled) {
    return <span className="text-xs text-muted-foreground italic">Sin traducir</span>;
  }

  const hasResults = results && results.length > 0;
  const noResults = results && results.length === 0 && search.length >= 2;

  return (
    <Popover open={open && (!!hasResults || !!noResults)} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              if (e.target.value.length >= 2) {
                setOpen(true);
              } else {
                setOpen(false);
              }
            }}
            onFocus={() => {
              if (search.length >= 2) setOpen(true);
            }}
            placeholder="Buscar código SAP..."
            className="h-7 text-xs pl-7 pr-2"
          />
        </div>
      </PopoverTrigger>
      <PopoverContent
        className="p-0 w-[320px] max-h-[240px] overflow-y-auto"
        align="start"
        sideOffset={4}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {hasResults && results.map((item: any) => (
          <button
            key={item.id}
            onClick={() => {
              onSelect(item.itemCode, item.description);
              setSearch("");
              setOpen(false);
            }}
            className="w-full text-left px-3 py-2 hover:bg-muted/50 transition-colors border-b border-border last:border-0 flex items-center gap-2"
          >
            <span className="font-mono text-xs font-bold text-primary shrink-0">
              {item.itemCode}
            </span>
            <span className="text-xs text-foreground truncate">
              {item.description}
            </span>
          </button>
        ))}
        {noResults && (
          <div className="p-3">
            <p className="text-xs text-muted-foreground text-center">Sin resultados</p>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

export default function SolicitudDetalle() {
  const params = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const utils = trpc.useUtils();

  const requestId = parseInt(params.id || "0");

  const { data, isLoading } = trpc.materialRequests.getById.useQuery(
    { id: requestId },
    { enabled: requestId > 0 }
  );

  const { data: flowData } = trpc.supplyFlows.getByRequestId.useQuery(
    { requestId },
    { enabled: requestId > 0 }
  );

  const { data: availableFlows } = trpc.supplyFlows.availableFlows.useQuery();

  const { data: attachments } = trpc.attachments.getByEntity.useQuery(
    { entityType: "material_request", entityId: requestId },
    { enabled: requestId > 0 }
  );

  const { data: projects } = trpc.projects.list.useQuery({ status: "activo" });

  // Fetch suppliers for Direct Purchase flow
  const { data: suppliersList } = trpc.requestItems.listSuppliers.useQuery();

  const translateMutation = trpc.requestItems.translateToSap.useMutation({
    onSuccess: () => {
      toast.success("Código SAP asignado");
      invalidateAll();
    },
    onError: (e) => toast.error(e.message),
  });

  const sendToSapMutation = trpc.materialRequests.sendToSap.useMutation({
    onSuccess: (result) => {
      toast.success(`Enviado a SAP: ${result.itemsProcessed} ítems procesados`);
      invalidateAll();
    },
    onError: (e) => toast.error(e.message),
  });

  // Flow mutations
  const directPurchaseMutation = trpc.supplyFlows.createDirectPurchase.useMutation({
    onSuccess: () => {
      toast.success("Compra directa registrada");
      invalidateAll();
    },
    onError: (e) => toast.error(e.message),
  });

  const warehouseDispatchMutation = trpc.supplyFlows.createWarehouseDispatch.useMutation({
    onSuccess: () => {
      toast.success("Despacho de bodega registrado");
      invalidateAll();
    },
    onError: (e) => toast.error(e.message),
  });

  const projectTransferMutation = trpc.supplyFlows.createProjectTransfer.useMutation({
    onSuccess: () => {
      toast.success("Traslado entre proyectos registrado");
      invalidateAll();
    },
    onError: (e) => toast.error(e.message),
  });

  const purchaseRequestMutation = trpc.supplyFlows.createPurchaseRequest.useMutation({
    onSuccess: () => {
      toast.success("Solicitud de compra generada");
      invalidateAll();
    },
    onError: (e) => toast.error(e.message),
  });

  const uploadMutation = trpc.attachments.upload.useMutation({
    onSuccess: () => {
      toast.success("Archivo adjunto subido");
      utils.attachments.getByEntity.invalidate({
        entityType: "material_request",
        entityId: requestId,
      });
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteAttachmentMutation = trpc.attachments.delete.useMutation({
    onSuccess: () => {
      toast.success("Archivo eliminado");
      utils.attachments.getByEntity.invalidate({
        entityType: "material_request",
        entityId: requestId,
      });
    },
  });

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Per-item flow dialog state
  const [flowDialogOpen, setFlowDialogOpen] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState<number>(0);
  const [selectedItemName, setSelectedItemName] = useState("");
  const [selectedFlow, setSelectedFlow] = useState<string>("");
  const [paymentMethod, setPaymentMethod] = useState<string>("");
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>("");
  const [sourceWarehouse, setSourceWarehouse] = useState("");
  const [sourceProjectId, setSourceProjectId] = useState("");
  const [destProjectId, setDestProjectId] = useState("");
  const [purchaseType, setPurchaseType] = useState<string>("");
  const [flowNotes, setFlowNotes] = useState("");

  const userRole = (user as any)?.buildreqRole || "";
  const isAdmin = user?.role === "admin";
  const canManage =
    userRole === "jefe_bodega_central" ||
    userRole === "administracion_central" ||
    isAdmin;

  const invalidateAll = () => {
    utils.materialRequests.getById.invalidate({ id: requestId });
    utils.supplyFlows.getByRequestId.invalidate({ requestId });
  };

  const handleSapSelect = (itemId: number, code: string, desc: string) => {
    translateMutation.mutate({
      id: itemId,
      sapItemCode: code,
      sapItemDescription: desc,
    });
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      toast.error("El archivo no puede superar 10MB");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(",")[1];
      uploadMutation.mutate({
        entityType: "material_request",
        entityId: requestId,
        fileName: file.name,
        fileData: base64,
        mimeType: file.type,
        fileSize: file.size,
      });
    };
    reader.readAsDataURL(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const openFlowDialog = (itemId: number, itemName: string) => {
    setSelectedItemId(itemId);
    setSelectedItemName(itemName);
    setSelectedFlow("");
    resetFlowForm();
    setFlowDialogOpen(true);
  };

  const handleAssignFlow = () => {
    if (!selectedFlow || !selectedItemId) return;

    switch (selectedFlow) {
      case "compra_directa":
        if (!paymentMethod) {
          toast.error("Seleccione método de pago");
          return;
        }
        if (!selectedSupplierId) {
          toast.error("Seleccione un proveedor");
          return;
        }
        directPurchaseMutation.mutate({
          requestId,
          requestItemId: selectedItemId,
          paymentMethod: paymentMethod as "linea_credito" | "caja_chica",
          supplierId: parseInt(selectedSupplierId),
          notes: flowNotes || undefined,
        });
        break;
      case "despacho_bodega":
        if (!sourceWarehouse) {
          toast.error("Indique la bodega de origen");
          return;
        }
        warehouseDispatchMutation.mutate({
          requestId,
          requestItemId: selectedItemId,
          sourceWarehouse,
          notes: flowNotes || undefined,
        });
        break;
      case "traslado_proyecto":
        if (!sourceProjectId || !destProjectId) {
          toast.error("Seleccione proyecto origen y destino");
          return;
        }
        projectTransferMutation.mutate({
          requestId,
          requestItemId: selectedItemId,
          sourceProjectId: parseInt(sourceProjectId),
          destinationProjectId: parseInt(destProjectId),
          notes: flowNotes || undefined,
        });
        break;
      case "solicitud_compra":
        if (!purchaseType) {
          toast.error("Seleccione tipo de compra");
          return;
        }
        purchaseRequestMutation.mutate({
          requestId,
          requestItemId: selectedItemId,
          purchaseType: purchaseType as "local" | "extranjera",
          notes: flowNotes || undefined,
        });
        break;
    }
    setFlowDialogOpen(false);
    resetFlowForm();
  };

  const resetFlowForm = () => {
    setPaymentMethod("");
    setSelectedSupplierId("");
    setSourceWarehouse("");
    setSourceProjectId("");
    setDestProjectId("");
    setPurchaseType("");
    setFlowNotes("");
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => setLocation("/solicitudes")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="h-6 w-40 animate-pulse bg-muted rounded" />
        </div>
        <div className="h-64 animate-pulse bg-muted rounded" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => setLocation("/solicitudes")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1>Solicitud no encontrada</h1>
        </div>
      </div>
    );
  }

  const { request, project, items, requestedBy } = data;

  // Check if all items have flow + SAP code for "Send to SAP" button
  const allItemsReady =
    items &&
    items.length > 0 &&
    items.every((item: any) => item.assignedFlow && item.sapItemCode);

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => setLocation("/solicitudes")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-xl font-bold tracking-tight">{request.requestNumber}</h1>
            <p className="text-sm text-muted-foreground">
              {project?.name} ({project?.code})
            </p>
          </div>
        </div>
        <Badge variant="outline" className={`text-sm px-3 py-1 ${STATUS_COLORS[request.status] || ""}`}>
          {STATUS_LABELS[request.status]}
        </Badge>
      </div>

      {/* Info Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4 space-y-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Solicitado por
              </p>
              <p className="text-sm font-medium mt-1">{requestedBy?.name || "—"}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Dirigida a
              </p>
              <p className="text-sm font-medium mt-1">{RECIPIENT_LABELS[request.recipient]}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 space-y-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Fecha de creación
              </p>
              <p className="text-sm mt-1">{new Date(request.createdAt).toLocaleString("es")}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Estatus
              </p>
              <p className="text-sm font-medium mt-1">{STATUS_LABELS[request.status]}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                El estatus cambia automáticamente al asignar flujos
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 space-y-3">
            {request.notes && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Notas
                </p>
                <p className="text-sm mt-1">{request.notes}</p>
              </div>
            )}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Progreso de ítems
              </p>
              <div className="flex items-center gap-2 mt-1">
                <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full transition-all"
                    style={{
                      width: `${items && items.length > 0 ? (items.filter((i: any) => i.assignedFlow).length / items.length) * 100 : 0}%`,
                    }}
                  />
                </div>
                <span className="text-xs text-muted-foreground">
                  {items?.filter((i: any) => i.assignedFlow).length || 0}/{items?.length || 0}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Items Table - Inline columns for flow and SAP */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Ítems Solicitados — Asignación de Flujo por Ítem
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left p-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">
                    Ítem Solicitado
                  </th>
                  <th className="text-center p-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground w-16">
                    Cant.
                  </th>
                  <th className="text-left p-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground w-20">
                    Unidad
                  </th>
                  <th className="text-left p-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground min-w-[220px]">
                    Traducir a SAP
                  </th>
                  <th className="text-left p-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground min-w-[180px]">
                    Asignar Flujo
                  </th>
                  <th className="text-left p-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">
                    Doc. SAP
                  </th>
                </tr>
              </thead>
              <tbody>
                {(items || []).map((item: any) => (
                  <tr
                    key={item.id}
                    className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors"
                  >
                    <td className="p-3">
                      <p className="font-medium">{item.itemName}</p>
                      {item.notes && (
                        <p className="text-xs text-muted-foreground mt-0.5">{item.notes}</p>
                      )}
                    </td>
                    <td className="p-3 text-center font-mono">{item.quantity}</td>
                    <td className="p-3 text-xs">{item.unit || "—"}</td>
                    <td className="p-3">
                      <SapSearchBox
                        itemId={item.id}
                        currentCode={item.sapItemCode}
                        currentDescription={item.sapItemDescription}
                        onSelect={(code, desc) => handleSapSelect(item.id, code, desc)}
                        disabled={!canManage || request.status === "cerrada"}
                      />
                    </td>
                    <td className="p-3">
                      {item.assignedFlow ? (
                        <Badge
                          variant="outline"
                          className={`text-xs ${FLOW_COLORS[item.assignedFlow] || ""}`}
                        >
                          <Check className="h-3 w-3 mr-1" />
                          {FLOW_LABELS[item.assignedFlow]}
                        </Badge>
                      ) : canManage && request.status !== "cerrada" ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-xs h-7 w-full"
                          onClick={() => openFlowDialog(item.id, item.itemName)}
                        >
                          Asignar Flujo
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground italic">Sin asignar</span>
                      )}
                    </td>
                    <td className="p-3">
                      {item.assignedFlow ? (
                        <span className="text-xs text-muted-foreground">
                          {SAP_DOC_LABELS[item.assignedFlow]}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Status bar below table - ONLY "Enviar a SAP" button here */}
          {canManage && request.status !== "cerrada" && (
            <div className="border-t border-border p-3 bg-muted/10 flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {!allItemsReady && (
                  <>
                    <AlertCircle className="h-4 w-4" />
                    <span>
                      Asigne flujo y código SAP a todos los ítems para habilitar el envío a SAP
                    </span>
                  </>
                )}
                {allItemsReady && (
                  <>
                    <Check className="h-4 w-4 text-green-600" />
                    <span className="text-green-700 font-medium">
                      Todos los ítems listos. Puede enviar a SAP.
                    </span>
                  </>
                )}
              </div>
              {allItemsReady && (
                <Button
                  onClick={() => sendToSapMutation.mutate({ requestId })}
                  disabled={sendToSapMutation.isPending}
                  size="sm"
                  className="gap-2"
                >
                  <Send className="h-4 w-4" />
                  {sendToSapMutation.isPending ? "Enviando..." : "Enviar todo a SAP"}
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Per-Item Flow Assignment Dialog */}
      <Dialog open={flowDialogOpen} onOpenChange={setFlowDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Asignar Flujo de Abastecimiento</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <p className="text-sm text-muted-foreground">
              Ítem: <strong>{selectedItemName}</strong>
            </p>

            {/* Flow type selection - filtered by role */}
            <div className="space-y-2">
              <Label>Tipo de flujo *</Label>
              <div className="grid grid-cols-2 gap-2">
                {(availableFlows || []).map((flowKey: string) => {
                  const FlowIcon = FLOW_ICONS[flowKey] || Package;
                  const isSelected = selectedFlow === flowKey;
                  return (
                    <button
                      key={flowKey}
                      onClick={() => {
                        setSelectedFlow(flowKey);
                        resetFlowForm();
                      }}
                      className={`flex flex-col gap-1 p-3 border rounded text-left transition-all text-sm ${
                        isSelected
                          ? "border-primary bg-primary/5 ring-1 ring-primary"
                          : "border-border hover:border-primary/40 hover:bg-muted/30"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <FlowIcon
                          className={`h-4 w-4 shrink-0 ${isSelected ? "text-primary" : "text-muted-foreground"}`}
                        />
                        <span className={`text-xs ${isSelected ? "font-medium" : ""}`}>
                          {FLOW_LABELS[flowKey]}
                        </span>
                      </div>
                      <span className="text-[10px] text-muted-foreground ml-6">
                        SAP: {SAP_DOC_LABELS[flowKey]}
                      </span>
                    </button>
                  );
                })}
              </div>
              {(availableFlows || []).length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-2">
                  Su rol no tiene permisos para asignar flujos.
                </p>
              )}
            </div>

            {/* Flow-specific fields */}
            {selectedFlow === "compra_directa" && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Método de pago *</Label>
                    <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                      <SelectTrigger>
                        <SelectValue placeholder="Seleccione" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="linea_credito">Línea de Crédito</SelectItem>
                        <SelectItem value="caja_chica">Caja Chica</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Proveedor *</Label>
                    <Select value={selectedSupplierId} onValueChange={setSelectedSupplierId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Seleccione proveedor" />
                      </SelectTrigger>
                      <SelectContent className="max-h-[200px]">
                        {(suppliersList || []).map((s: any) => (
                          <SelectItem key={s.id} value={String(s.id)}>
                            {s.supplierCode} — {s.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Genera: Orden de Compra → Entrada de Mercancías (al recibir producto)
                </p>
              </div>
            )}

            {selectedFlow === "despacho_bodega" && (
              <div className="space-y-2">
                <Label>Bodega de origen *</Label>
                <Input
                  value={sourceWarehouse}
                  onChange={(e) => setSourceWarehouse(e.target.value)}
                  placeholder="Ej: Bodega Central"
                />
                <p className="text-xs text-muted-foreground">
                  Genera: Salida de Inventario en SAP
                </p>
              </div>
            )}

            {selectedFlow === "traslado_proyecto" && (
              <>
                <div className="space-y-2">
                  <Label>Proyecto origen *</Label>
                  <Select value={sourceProjectId} onValueChange={setSourceProjectId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Seleccione" />
                    </SelectTrigger>
                    <SelectContent>
                      {(projects || []).map((p: any) => (
                        <SelectItem key={p.id} value={String(p.id)}>
                          {p.code} — {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Proyecto destino *</Label>
                  <Select value={destProjectId} onValueChange={setDestProjectId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Seleccione" />
                    </SelectTrigger>
                    <SelectContent>
                      {(projects || []).map((p: any) => (
                        <SelectItem key={p.id} value={String(p.id)}>
                          {p.code} — {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <p className="text-xs text-muted-foreground">
                  Genera: Solicitud de Transferencia en SAP
                </p>
              </>
            )}

            {selectedFlow === "solicitud_compra" && (
              <div className="space-y-2">
                <Label>Tipo de compra *</Label>
                <Select value={purchaseType} onValueChange={setPurchaseType}>
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccione" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="local">Compra Local</SelectItem>
                    <SelectItem value="extranjera">Compra Extranjera</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Genera: Solicitud de Compra en SAP → Admin. Central convierte a OC
                </p>
              </div>
            )}

            {selectedFlow && (
              <div className="space-y-2">
                <Label>Notas</Label>
                <Textarea
                  value={flowNotes}
                  onChange={(e) => setFlowNotes(e.target.value)}
                  placeholder="Observaciones adicionales..."
                  rows={2}
                />
              </div>
            )}

            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                onClick={() => {
                  setFlowDialogOpen(false);
                  resetFlowForm();
                }}
              >
                Cancelar
              </Button>
              <Button
                onClick={handleAssignFlow}
                disabled={
                  !selectedFlow ||
                  directPurchaseMutation.isPending ||
                  warehouseDispatchMutation.isPending ||
                  projectTransferMutation.isPending ||
                  purchaseRequestMutation.isPending
                }
              >
                Confirmar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Flow Records */}
      {flowData && flowData.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Registro de Flujos Asignados
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {flowData.map((flow: any) => {
                const FlowIcon = FLOW_ICONS[flow.flowType] || Package;
                const relatedItem = (items || []).find((i: any) => i.id === flow.requestItemId);
                return (
                  <div
                    key={flow.id}
                    className={`flex items-start gap-3 p-3 border rounded ${FLOW_COLORS[flow.flowType] || "border-border"}`}
                  >
                    <FlowIcon className="h-5 w-5 mt-0.5 shrink-0" />
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium">{FLOW_LABELS[flow.flowType]}</p>
                        {relatedItem && (
                          <span className="text-xs bg-white/50 px-2 py-0.5 rounded">
                            {relatedItem.itemName}
                          </span>
                        )}
                        <span className="text-xs opacity-60">
                          → SAP: {SAP_DOC_LABELS[flow.flowType]}
                        </span>
                      </div>
                      {flow.paymentMethod && (
                        <p className="text-xs opacity-80">
                          Método: {flow.paymentMethod === "linea_credito" ? "Línea de Crédito" : "Caja Chica"}
                        </p>
                      )}
                      {flow.purchaseType && (
                        <p className="text-xs opacity-80">
                          Tipo: {flow.purchaseType === "local" ? "Compra Local" : "Compra Extranjera"}
                        </p>
                      )}
                      {flow.purchaseOrderNumber && (
                        <p className="text-xs opacity-80">OC: {flow.purchaseOrderNumber}</p>
                      )}
                      {flow.notes && <p className="text-xs opacity-70">{flow.notes}</p>}
                      <Badge variant="outline" className="text-xs capitalize mt-1">
                        {flow.status}
                      </Badge>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Attachments */}
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Archivos Adjuntos
          </CardTitle>
          <div>
            <input type="file" ref={fileInputRef} onChange={handleFileUpload} className="hidden" />
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadMutation.isPending}
            >
              <Upload className="h-4 w-4 mr-1" />
              {uploadMutation.isPending ? "Subiendo..." : "Adjuntar"}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {(attachments || []).length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              Sin archivos adjuntos
            </p>
          ) : (
            <div className="space-y-2">
              {(attachments || []).map((att: any) => (
                <div
                  key={att.id}
                  className="flex items-center justify-between p-2 border border-border rounded"
                >
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <a
                        href={att.fileUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm font-medium hover:text-primary"
                      >
                        {att.fileName}
                      </a>
                      <p className="text-xs text-muted-foreground">
                        {(att.fileSize / 1024).toFixed(0)} KB
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => deleteAttachmentMutation.mutate({ id: att.id })}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
