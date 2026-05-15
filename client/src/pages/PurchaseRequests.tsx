import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { downloadBase64Document } from "@/lib/document-download";
import {
  calculatePurchaseOrderLineAmounts,
  formatPurchaseOrderCurrency,
} from "@shared/purchase-orders";
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
  Eye,
  FileText,
  FileUp,
  FolderOpen,
  Save,
  Search,
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

const STATUS_COLORS: Record<string, string> = {
  pendiente: "border-amber-300 bg-amber-50 text-amber-700",
  en_revision: "border-blue-300 bg-blue-50 text-blue-700",
  aprobada: "border-emerald-300 bg-emerald-50 text-emerald-700",
  rechazada: "border-rose-300 bg-rose-50 text-rose-700",
  parcialmente_convertida: "border-cyan-300 bg-cyan-50 text-cyan-700",
  convertida: "border-emerald-300 bg-emerald-50 text-emerald-700",
  anulada: "border-red-300 bg-red-50 text-red-700",
};

const UNIFIED_CONVERTIBLE_STATUSES = new Set([
  "pendiente",
  "en_revision",
  "aprobada",
  "parcialmente_convertida",
]);
type PurchaseType = "local" | "extranjera" | "compra_directa";
const PURCHASE_TYPE_LABELS: Record<PurchaseType, string> = {
  local: "Compra Local",
  extranjera: "Compra Extranjera",
  compra_directa: "Compra Directa",
};
const getPurchaseTypeLabel = (value?: string | null) =>
  PURCHASE_TYPE_LABELS[value as PurchaseType] ?? "—";

type PurchaseRequestItemDraft = {
  quantity: string;
  unitPrice: string;
};

const getItemDraftFromDetail = (item: any): PurchaseRequestItemDraft => ({
  quantity: String(item.quantity ?? ""),
  unitPrice: String(item.unitPrice ?? "0.00"),
});

const isPositiveNumberString = (value: string) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue > 0;
};

const isNonNegativeNumberString = (value: string) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue >= 0;
};

const formatQuantity = (value: string | number | null | undefined) =>
  Number(value ?? 0).toLocaleString("es-HN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const getConvertedQuantity = (item: any) => Number(item.convertedQuantity ?? 0);

const getPendingConversionQuantity = (item: any, quantityOverride?: string) =>
  Math.max(
    Number(quantityOverride ?? item.quantity ?? 0) - getConvertedQuantity(item),
    0
  );

export default function PurchaseRequests() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [editNotes, setEditNotes] = useState("");
  const [editNeededBy, setEditNeededBy] = useState("");
  const [editPurchaseType, setEditPurchaseType] = useState<PurchaseType>("local");
  const [editItems, setEditItems] = useState<Record<number, PurchaseRequestItemDraft>>({});
  const [convertQuantities, setConvertQuantities] = useState<Record<number, string>>({});
  const [selectedRequestIds, setSelectedRequestIds] = useState<number[]>([]);
  const [selectedItemIds, setSelectedItemIds] = useState<number[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [purchaseTypeFilter, setPurchaseTypeFilter] = useState<PurchaseType | "all">("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
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
  const buildreqRole = (user as any)?.buildreqRole;
  const isProjectAdmin = buildreqRole === "administrador_proyecto";
  const canConvert =
    user?.role === "admin" ||
    buildreqRole === "administracion_central" ||
    isProjectAdmin;

  const filteredRequests = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();

    return (requests ?? []).filter((row: any) => {
      const purchaseRequest = row.purchaseRequest;
      const matchesType =
        purchaseTypeFilter === "all" ||
        purchaseRequest.purchaseType === purchaseTypeFilter;
      const matchesStatus =
        statusFilter === "all" || purchaseRequest.status === statusFilter;
      const projectLabel =
        row.projectSummary?.label ||
        (row.project ? `${row.project.code} ${row.project.name}` : "");
      const matchesSearch =
        !normalizedSearch ||
        [
          purchaseRequest.requestNumber,
          purchaseRequest.sapDocumentNumber,
          projectLabel,
        ]
          .filter(Boolean)
          .some((value) =>
            String(value).toLowerCase().includes(normalizedSearch)
          );

      return matchesType && matchesStatus && matchesSearch;
    });
  }, [purchaseTypeFilter, requests, searchTerm, statusFilter]);

  const canProjectAdminConvertPurchaseRequest = (
    purchaseRequest: { purchaseType?: string | null; status?: string | null }
  ) =>
    !isProjectAdmin || purchaseRequest.purchaseType === "compra_directa";

  const canConvertPurchaseRequestRow = (row: any) =>
    canConvert &&
    UNIFIED_CONVERTIBLE_STATUSES.has(row.purchaseRequest.status) &&
    canProjectAdminConvertPurchaseRequest(row.purchaseRequest);

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

  useEffect(() => {
    if (!detail) {
      setEditItems({});
      setConvertQuantities({});
      return;
    }

    setEditItems(
      Object.fromEntries(
        (detail.items ?? []).map((item: any) => [
          item.id,
          getItemDraftFromDetail(item),
        ])
      )
    );
    setConvertQuantities(
      Object.fromEntries(
        (detail.items ?? []).map((item: any) => [
          item.id,
          String(item.pendingConversionQuantity ?? getPendingConversionQuantity(item).toFixed(2)),
        ])
      )
    );
  }, [detail]);

  const getItemDraft = (item: any) =>
    editItems[item.id] ?? getItemDraftFromDetail(item);

  const updateItemDraft = (
    item: any,
    field: keyof PurchaseRequestItemDraft,
    value: string
  ) => {
    setEditItems((current) => ({
      ...current,
      [item.id]: {
        ...getItemDraftFromDetail(item),
        ...current[item.id],
        [field]: value,
      },
    }));
  };

  const getConvertQuantityDraft = (item: any) =>
    convertQuantities[item.id] ??
    String(item.pendingConversionQuantity ?? getPendingConversionQuantity(item).toFixed(2));

  const updateConvertQuantityDraft = (item: any, value: string) => {
    setConvertQuantities((current) => ({
      ...current,
      [item.id]: value,
    }));
  };

  const buildItemUpdatePayload = () => {
    const invalidQuantityItem = selectedItems.find(
      (item: any) => !isPositiveNumberString(getItemDraft(item).quantity)
    );
    if (invalidQuantityItem) {
      toast.error(`Ingrese una cantidad mayor que cero para ${invalidQuantityItem.itemName}`);
      return null;
    }

    const invalidPriceItem = selectedItems.find(
      (item: any) =>
        !isNonNegativeNumberString(getItemDraft(item).unitPrice || "0")
    );
    if (invalidPriceItem) {
      toast.error(`Ingrese un precio válido para ${invalidPriceItem.itemName}`);
      return null;
    }

    const itemBelowConverted = selectedItems.find(
      (item: any) =>
        Number(getItemDraft(item).quantity || 0) < getConvertedQuantity(item)
    );
    if (itemBelowConverted) {
      toast.error(
        `La cantidad de ${itemBelowConverted.itemName} no puede ser menor a lo ya convertido`
      );
      return null;
    }

    return selectedItems.map((item: any) => {
      const draft = getItemDraft(item);
      return {
        id: item.id,
        quantity: draft.quantity,
        unitPrice: draft.unitPrice || "0",
      };
    });
  };

  const buildConversionPayload = () => {
    const selectedIds =
      selectedItemIds.length > 0 ? selectedItemIds : convertibleItemIds;
    const itemsToConvert = selectedItems
      .filter((item: any) => selectedIds.includes(item.id))
      .map((item: any) => {
        const draft = getItemDraft(item);
        const pendingQuantity = getPendingConversionQuantity(item, draft.quantity);
        const quantity = Number(getConvertQuantityDraft(item) || 0);
        return {
          item,
          pendingQuantity,
          quantity,
        };
      });

    const invalidItem = itemsToConvert.find(
      ({ quantity }) => !Number.isFinite(quantity) || quantity <= 0
    );
    if (invalidItem) {
      toast.error(`Ingrese una cantidad a convertir para ${invalidItem.item.itemName}`);
      return null;
    }

    const excessItem = itemsToConvert.find(
      ({ quantity, pendingQuantity }) => quantity > pendingQuantity
    );
    if (excessItem) {
      toast.error(
        `La cantidad a convertir de ${excessItem.item.itemName} excede el pendiente`
      );
      return null;
    }

    return itemsToConvert.map(({ item, quantity }) => ({
      purchaseRequestItemId: item.id,
      quantity: quantity.toFixed(2),
    }));
  };

  const convertibleItemIds = useMemo(() => {
    if (!canConvert) return [];
    if (
      isProjectAdmin &&
      detail?.purchaseRequest.purchaseType !== "compra_directa"
    ) {
      return [];
    }
    const assignedProjectId = (user as any)?.assignedProjectId;

    return selectedItems
      .filter((item: any) => {
        if (getPendingConversionQuantity(item) <= 0) return false;
        if (!isProjectAdmin) return true;
        const itemProjectId =
          item.sourceProject?.id ?? detail?.purchaseRequest.projectId;
        return assignedProjectId === itemProjectId;
      })
      .map((item: any) => item.id);
  }, [
    canConvert,
    detail?.purchaseRequest.projectId,
    detail?.purchaseRequest.purchaseType,
    isProjectAdmin,
    selectedItems,
    user,
  ]);

  const convertibleItemIdSet = useMemo(
    () => new Set(convertibleItemIds),
    [convertibleItemIds]
  );

  const conversionEstimatedTotal = useMemo(
    () =>
      selectedItems.reduce((sum: number, item: any) => {
        const draft = editItems[item.id] ?? getItemDraftFromDetail(item);
        const selectedForConversion =
          selectedItemIds.length > 0
            ? selectedItemIds.includes(item.id)
            : convertibleItemIdSet.has(item.id);
        if (!selectedForConversion) return sum;
        return (
          sum +
          calculatePurchaseOrderLineAmounts({
            quantity: getConvertQuantityDraft(item),
            unitPrice: draft.unitPrice || "0",
            taxCode: "exe",
          }).total
        );
      }, 0),
    [
      convertibleItemIdSet,
      convertQuantities,
      editItems,
      selectedItemIds,
      selectedItems,
    ]
  );

  const itemIdsToConvert = useMemo(
    () =>
      selectedItemIds.length > 0
        ? selectedItemIds.filter((id) => convertibleItemIdSet.has(id))
        : convertibleItemIds,
    [convertibleItemIdSet, convertibleItemIds, selectedItemIds]
  );

  const convertibleRequestIds = useMemo(
    () =>
      filteredRequests
        .filter((row: any) => canConvertPurchaseRequestRow(row))
        .map((row: any) => row.purchaseRequest.id),
    [filteredRequests, canConvert, isProjectAdmin]
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

  useEffect(() => {
    setSelectedItemIds((current) =>
      current.filter((id) => convertibleItemIdSet.has(id))
    );
  }, [convertibleItemIdSet]);

  const projectLabel =
    detail?.projectSummary?.label ||
    (detail?.project
      ? `${detail.project.code} — ${detail.project.name}`
      : detail?.purchaseRequest
        ? `Proyecto ${detail.purchaseRequest.projectId}`
        : "Proyecto pendiente");
  const isMixedProjectRequest = Boolean(detail?.projectSummary?.isMixed);
  const isConvertedPurchaseRequest = detail?.purchaseRequest.status === "convertida";
  const isProjectAdminReadOnlyRequest =
    isProjectAdmin &&
    Boolean(detail) &&
    detail?.purchaseRequest.purchaseType !== "compra_directa";
  const canEditSelectedPurchaseRequest =
    !isConvertedPurchaseRequest && !isProjectAdminReadOnlyRequest;
  const canConvertSelectedPurchaseRequest =
    canConvert && canEditSelectedPurchaseRequest;

  const purchaseTypeLabel = getPurchaseTypeLabel(editPurchaseType);

  const openRequest = (id: number) => {
    setSelectedId(id);
    const row = requests?.find((entry: any) => entry.purchaseRequest.id === id);
    setEditNotes(row?.purchaseRequest.notes || "");
    setEditNeededBy(
      row?.purchaseRequest.neededBy
        ? new Date(row.purchaseRequest.neededBy).toISOString().slice(0, 10)
        : ""
    );
    setEditPurchaseType((row?.purchaseRequest.purchaseType || "local") as PurchaseType);
    setEditItems({});
    setConvertQuantities({});
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

  const handleSaveChanges = () => {
    if (!detail) return;
    const items = buildItemUpdatePayload();
    if (!items) return;

    updateMutation.mutate({
      id: detail.purchaseRequest.id,
      purchaseType: editPurchaseType,
      neededBy: editNeededBy || undefined,
      notes: editNotes || undefined,
      items,
    });
  };

  const handleConvertToPurchaseOrder = async () => {
    if (!detail) return;
    const items = buildItemUpdatePayload();
    if (!items) return;
    const itemsToConvert = buildConversionPayload();
    if (!itemsToConvert || itemsToConvert.length === 0) return;

    try {
      await updateMutation.mutateAsync({
        id: detail.purchaseRequest.id,
        purchaseType: editPurchaseType,
        neededBy: editNeededBy || undefined,
        notes: editNotes || undefined,
        items,
      });
      convertMutation.mutate({
        purchaseRequestId: detail.purchaseRequest.id,
        selectedItemIds: itemsToConvert.map(
          (item) => item.purchaseRequestItemId
        ),
        itemsToConvert,
      });
    } catch {
      // updateMutation displays the validation or server error toast.
    }
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

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Buscar por número de SC, proyecto o documento..."
            className="h-10 pl-9"
          />
        </div>
        <Select
          value={purchaseTypeFilter}
          onValueChange={(value) =>
            setPurchaseTypeFilter(value as PurchaseType | "all")
          }
        >
          <SelectTrigger className="h-10 w-full lg:w-64">
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
              Cargando solicitudes de compra...
            </div>
          ) : !(requests || []).length ? (
            <div className="p-8 text-center text-muted-foreground">
              No hay solicitudes de compra registradas
            </div>
          ) : !filteredRequests.length ? (
            <div className="p-8 text-center text-muted-foreground">
              No hay solicitudes de compra que coincidan con los filtros
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
                  {filteredRequests.map((row: any) => {
                    const canSelectForUnified = canConvertPurchaseRequestRow(row);

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
                        {getPurchaseTypeLabel(row.purchaseRequest.purchaseType)}
                      </td>
                      <td className="p-3 text-xs">
                        {row.purchaseRequest.createdAt
                          ? new Date(row.purchaseRequest.createdAt).toLocaleDateString("es-HN")
                          : "—"}
                      </td>
                      <td className="p-3 text-xs">{row.purchaseRequest.sapDocumentNumber || "—"}</td>
                      <td className="p-3">
                        <Badge
                          variant="outline"
                          className={`text-xs ${
                            STATUS_COLORS[row.purchaseRequest.status] || ""
                          }`}
                        >
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
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openRequest(row.purchaseRequest.id)}
                        >
                          <Eye className="mr-2 h-4 w-4" />
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
        <DialogContent className="flex h-[calc(100dvh-0.75rem)] w-[calc(100vw-0.75rem)] max-w-[calc(100vw-0.75rem)] flex-col overflow-hidden rounded-2xl border border-border/70 p-0 shadow-2xl sm:h-[calc(100dvh-1.5rem)] sm:w-[calc(100vw-2rem)] sm:max-w-[1500px]">
          <DialogHeader className="shrink-0 border-b border-border/70 px-4 py-4 pr-12 sm:px-6 lg:px-8">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="space-y-2">
                <DialogTitle className="text-3xl font-bold tracking-tight sm:text-[2.15rem]">
                  {detail?.purchaseRequest.requestNumber || "Solicitud de Compra"}
                </DialogTitle>
                <p className="text-sm text-muted-foreground">
                  {isConvertedPurchaseRequest
                    ? "Esta solicitud ya fue convertida a orden de compra y se muestra en modo solo lectura."
                    : isProjectAdminReadOnlyRequest
                    ? "Esta solicitud es informativa para el Administrador del Proyecto. Solo las compras directas pueden convertirse a OC desde este rol."
                    : "Revisa la solicitud, adjunta cotización y convierte los ítems seleccionados a orden de compra cuando ya esté lista."}
                </p>
              </div>
              {detail && (
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant="outline"
                    className={`rounded-full px-3 py-1 text-xs uppercase ${
                      STATUS_COLORS[detail.purchaseRequest.status] || ""
                    }`}
                  >
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
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overflow-x-hidden px-4 py-4 sm:px-6 lg:px-8">
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
                      setEditPurchaseType(value as PurchaseType)
                    }
                    disabled={!canEditSelectedPurchaseRequest}
                  >
                    <SelectTrigger className="h-12 text-base">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="local">Compra Local</SelectItem>
                      <SelectItem value="extranjera">Compra Extranjera</SelectItem>
                      <SelectItem value="compra_directa">Compra Directa</SelectItem>
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
                    disabled={!canEditSelectedPurchaseRequest}
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
                    <Badge
                      variant="outline"
                      className={`rounded-full px-3 py-1 text-sm ${
                        STATUS_COLORS[detail.purchaseRequest.status] || ""
                      }`}
                    >
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
                    disabled={!canEditSelectedPurchaseRequest}
                  />
                </div>
              </div>

              {isProjectAdminReadOnlyRequest && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  Solo consulta: las solicitudes de Compra Local o Compra Extranjera continúan con Administración Central.
                </div>
              )}

              <div className="min-w-0 rounded-2xl border border-border/70 bg-card">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 px-5 py-4">
                  <div>
                    <p className="text-base font-semibold">Ítems de la solicitud</p>
                    <p className="text-sm text-muted-foreground">
                      {isConvertedPurchaseRequest
                        ? "Los ítems ya fueron convertidos y esta solicitud quedó cerrada para edición."
                        : canConvertSelectedPurchaseRequest
                        ? "Marca los renglones que deseas convertir a la próxima orden de compra."
                        : "Detalle de ítems incluidos en la solicitud."}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="rounded-full px-3 py-1 text-xs">
                      Total a convertir {formatPurchaseOrderCurrency(conversionEstimatedTotal)}
                    </Badge>
                    {canConvertSelectedPurchaseRequest && (
                      <Badge variant="secondary" className="rounded-full px-3 py-1 text-xs">
                        {selectedItemIds.length > 0
                          ? `${selectedItemIds.length} seleccionados`
                          : `Se convertirán ${convertibleItemIds.length}`}
                      </Badge>
                    )}
                  </div>
                </div>

                <div className="max-w-full overflow-x-auto">
                  <table className="w-full min-w-[1420px] text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/20">
                        {canConvertSelectedPurchaseRequest && (
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
                          Cantidad solicitada
                        </th>
                        <th className="w-36 p-4 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          Convertido
                        </th>
                        <th className="w-36 p-4 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          Pendiente
                        </th>
                        <th className="w-40 p-4 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          A convertir
                        </th>
                        <th className="w-40 p-4 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          Precio unit.
                        </th>
                        <th className="w-40 p-4 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          Total a convertir
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedItems.map((item: any) => {
                        const draft = getItemDraft(item);
                        const convertedQuantity = getConvertedQuantity(item);
                        const pendingQuantity = getPendingConversionQuantity(
                          item,
                          draft.quantity
                        );
                        const convertQuantity = getConvertQuantityDraft(item);
                        const lineTotal = calculatePurchaseOrderLineAmounts({
                          quantity: convertQuantity || "0",
                          unitPrice: draft.unitPrice || "0",
                          taxCode: "exe",
                        }).total;
                        const canConvertItem =
                          canConvertSelectedPurchaseRequest &&
                          convertibleItemIdSet.has(item.id) &&
                          pendingQuantity > 0;

                        return (
                          <tr key={item.id} className="border-b border-border/70 last:border-0">
                          {canConvertSelectedPurchaseRequest && (
                            <td className="p-4 align-top">
                              <Checkbox
                                  checked={selectedItemIds.includes(item.id)}
                                  disabled={!canConvertItem}
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
                            <td className="p-4 align-top">
                              <div className="flex items-center justify-end gap-2">
                                <Input
                                  className="h-9 w-28 text-right"
                                  type="number"
                                  min="0.01"
                                  step="0.01"
                                  value={draft.quantity}
                                  onChange={(event) =>
                                    updateItemDraft(item, "quantity", event.target.value)
                                  }
                                  disabled={!canEditSelectedPurchaseRequest}
                                />
                                <span className="min-w-10 text-left text-xs text-muted-foreground">
                                  {item.unit || ""}
                                </span>
                              </div>
                            </td>
                            <td className="p-4 text-right align-top font-medium">
                              {formatQuantity(convertedQuantity)} {item.unit || ""}
                            </td>
                            <td className="p-4 text-right align-top font-medium">
                              {formatQuantity(pendingQuantity)} {item.unit || ""}
                            </td>
                            <td className="p-4 align-top">
                              <div className="flex items-center justify-end gap-2">
                                <Input
                                  className="h-9 w-28 text-right"
                                  type="number"
                                  min="0.01"
                                  max={pendingQuantity || undefined}
                                  step="0.01"
                                  value={convertQuantity}
                                  onChange={(event) =>
                                    updateConvertQuantityDraft(item, event.target.value)
                                  }
                                  disabled={!canConvertItem}
                                />
                                <span className="min-w-10 text-left text-xs text-muted-foreground">
                                  {item.unit || ""}
                                </span>
                              </div>
                            </td>
                            <td className="p-4 align-top">
                              <Input
                                className="ml-auto h-9 w-32 text-right"
                                type="number"
                                min="0"
                                step="0.01"
                                value={draft.unitPrice}
                                onChange={(event) =>
                                  updateItemDraft(item, "unitPrice", event.target.value)
                                }
                                disabled={!canEditSelectedPurchaseRequest}
                              />
                            </td>
                            <td className="p-4 text-right align-top font-medium">
                              {formatPurchaseOrderCurrency(lineTotal)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="sticky bottom-0 z-10 flex flex-col gap-4 rounded-2xl border border-border/70 bg-card/95 p-4 shadow-sm backdrop-blur xl:flex-row xl:items-start xl:justify-between">
                <div className="flex min-w-0 flex-wrap gap-3">
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

                  {canEditSelectedPurchaseRequest && (
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

                {canEditSelectedPurchaseRequest && (
                  <div className="flex w-full min-w-0 flex-wrap justify-end gap-3 xl:w-auto">
                    <Button
                      variant="outline"
                      className="h-11 px-4"
                      onClick={handleSaveChanges}
                      disabled={updateMutation.isPending}
                    >
                      <Save className="mr-2 h-4 w-4" />
                      Guardar cambios
                    </Button>

                    {canReject && canEditSelectedPurchaseRequest && (
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

                    {canConvertSelectedPurchaseRequest && (
                      <Button
                        className="h-11 px-5"
                        onClick={handleConvertToPurchaseOrder}
                        disabled={
                          updateMutation.isPending ||
                          convertMutation.isPending ||
                          itemIdsToConvert.length === 0
                        }
                      >
                        <ShoppingCart className="mr-2 h-4 w-4" />
                        Convertir a OC
                      </Button>
                    )}
                  </div>
                )}
              </div>

              {canReject && canEditSelectedPurchaseRequest && (
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
