import { trpc } from "@/lib/trpc";
import { DataPagination } from "@/components/DataPagination";
import { ProjectFilterSelect } from "@/components/ProjectFilterSelect";
import { UnitCombobox } from "@/components/UnitCombobox";
import { normalizeUnitValue, UNITS } from "@shared/units";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import {
  getTransferMovementKind,
  isSameTransferScope,
} from "@shared/internal-relocations";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DocumentAttachmentsPanel } from "@/components/DocumentAttachmentsPanel";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Plus, Truck, Ban, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

const PAGE_SIZE = 50;
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
    ? "Proyecto/bodega destino en recepción"
    : `Proyecto ${transferRequest.destinationProjectId ?? ""}`.trim();
}

function getWarehouseLabel(warehouse: any): string {
  if (!warehouse) return "—";
  return (
    warehouse.displayName ||
    [warehouse.code || warehouse.localCode, warehouse.name]
      .filter(Boolean)
      .join(" - ") ||
    `Bodega ${warehouse.id ?? ""}`.trim()
  );
}

const CENTRAL_SOURCE_PROJECT_KEY = "central";
const NO_SOURCE_STORAGE_LOCATION_VALUE = "__sin_ubicacion__";

const getTransferSourceOptionValue = (option: {
  projectId?: number | null;
  warehouseId: number;
}) =>
  `${
    typeof option.projectId === "number"
      ? option.projectId
      : CENTRAL_SOURCE_PROJECT_KEY
  }:${option.warehouseId}`;

const parseTransferSourceOptionValue = (value?: string | null) => {
  if (!value) return null;
  const [projectValue, warehouseValue] = value.split(":");
  const warehouseId = Number(warehouseValue);
  if (!Number.isInteger(warehouseId) || warehouseId <= 0) {
    return null;
  }

  if (projectValue === CENTRAL_SOURCE_PROJECT_KEY) {
    return { projectId: null, warehouseId };
  }

  const projectId = Number(projectValue);
  if (!Number.isInteger(projectId) || projectId <= 0) {
    return null;
  }

  return { projectId, warehouseId };
};

const formatQuantity = (value: unknown) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed.toFixed(2) : "0.00";
};

const encodeSourceStorageLocationValue = (value?: string | null) =>
  value?.trim() || NO_SOURCE_STORAGE_LOCATION_VALUE;

const decodeSourceStorageLocationValue = (value?: string | null) => {
  if (!value || value === NO_SOURCE_STORAGE_LOCATION_VALUE) return null;
  return value.trim() || null;
};

const getSourceStorageLocationLabel = (value?: string | null) =>
  value?.trim() || "Sin ubicación";

function QuantityPill({
  value,
  unit,
  label,
  tone,
}: {
  value: unknown;
  unit?: string | null;
  label?: string;
  tone?: "available" | "info" | "warning" | "danger" | "neutral";
}) {
  const numeric = Number(value ?? 0);
  const resolvedTone =
    tone ??
    (!Number.isFinite(numeric)
      ? "neutral"
      : numeric > 0
        ? "available"
        : "neutral");
  const toneClasses: Record<string, string> = {
    available: "border-emerald-200 bg-emerald-50 text-emerald-700",
    info: "border-sky-200 bg-sky-50 text-sky-700",
    warning: "border-amber-200 bg-amber-50 text-amber-700",
    danger: "border-rose-200 bg-rose-50 text-rose-700",
    neutral: "border-slate-200 bg-slate-50 text-slate-600",
  };

  return (
    <span
      className={`inline-flex items-center rounded-md border px-1.5 py-0.5 font-mono text-[11px] font-semibold ${toneClasses[resolvedTone]}`}
    >
      {label ? `${label} ` : ""}
      {formatQuantity(value)}
      {unit ? ` ${unit}` : ""}
    </span>
  );
}

function getProjectLabel(project: any): string {
  if (!project) return "—";
  return `${project.code} — ${project.name}`;
}

function getOriginWarehouseLabel(option: any): string {
  return (
    option?.displayName ||
    option?.warehouseDisplayName ||
    option?.warehouseName ||
    `Almacén #${option?.warehouseId ?? ""}`.trim()
  );
}

function getOriginProjectLabel(option: any): string {
  return (
    [option?.projectCode, option?.projectName].filter(Boolean).join(" — ") ||
    "Proyecto/bodega"
  );
}

function getRequestingProjectLabel(detail: any): string {
  if (detail?.transferRequest?.destinationType === "proyecto") {
    if (detail.destinationProject) {
      return getProjectLabel(detail.destinationProject);
    }
    if (detail.transferRequest.destinationProjectId) {
      return `Proyecto ${detail.transferRequest.destinationProjectId}`;
    }
  }

  if (detail?.materialRequest?.projectId) {
    return `Proyecto ${detail.materialRequest.projectId}`;
  }

  return getProjectLabel(detail?.project);
}

function getSourceWarehouseSummary(detail: any): string {
  const labels = Array.from(
    new Set<string>(
      (detail?.items || [])
        .map((item: any) => getWarehouseLabel(item.sourceWarehouse))
        .filter((label: string) => label && label !== "—")
    )
  );

  if (labels.length === 1) return labels[0];
  if (labels.length > 1) return "Ver origen por línea";
  return "Por definir";
}

function getDestinationWarehouseSummary(detail: any): string {
  if (detail?.transferRequest?.destinationType === "bodega_central") {
    return "Se define en recepción";
  }

  return getWarehouseLabel(detail?.destinationWarehouse);
}

export default function TransferRequests() {
  const utils = trpc.useUtils();
  const { user } = useAuth();
  const buildreqRole = (user as any)?.buildreqRole;
  const allowManualTransferRequests =
    user?.role === "admin" ||
    buildreqRole === "jefe_bodega_central" ||
    buildreqRole === "administracion_central";
  const canConvertTransferRequests =
    user?.role === "admin" ||
    buildreqRole === "jefe_bodega_central" ||
    buildreqRole === "bodeguero_proyecto";
  const canViewOriginQuantities =
    user?.role === "admin" || buildreqRole !== "bodeguero_proyecto";
  const canCancelTransferRequests =
    user?.role === "admin" || buildreqRole === "jefe_bodega_central";
  const [dialogOpen, setDialogOpen] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [projectId, setProjectId] = useState("");
  const [creationWarehouseId, setCreationWarehouseId] = useState("");
  const [neededBy, setNeededBy] = useState("");
  const [notes, setNotes] = useState("");
  const [itemName, setItemName] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState("");
  const relocationUnitOptions = useMemo(
    () =>
      unit
        ? [
            {
              value: unit,
              label:
                UNITS.find(option => option.value === normalizeUnitValue(unit))
                  ?.label || unit,
            },
          ]
        : [],
    [unit]
  );
  const [sapItemCode, setSapItemCode] = useState("");
  const [articleSearch, setArticleSearch] = useState("");
  const debouncedArticleSearch = useDebouncedValue(articleSearch);
  const isArticleSearchCurrent =
    articleSearch.trim() === debouncedArticleSearch.trim();
  const [relocationReason, setRelocationReason] = useState("");
  const [relocationItems, setRelocationItems] = useState<
    Array<{
      itemName: string;
      sapItemCode: string;
      quantity: string;
      unit?: string;
    }>
  >([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [projectFilter, setProjectFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);
  const debouncedSearchTerm = useDebouncedValue(searchTerm);
  const [confirmCancelId, setConfirmCancelId] = useState<number | null>(null);
  const [transferQuantityByItemId, setTransferQuantityByItemId] = useState<
    Record<number, string>
  >({});
  const [sourceWarehouseByItemId, setSourceWarehouseByItemId] = useState<
    Record<number, string>
  >({});
  const [sourcePhysicalWarehouseByItemId, setSourcePhysicalWarehouseByItemId] =
    useState<Record<number, string>>({});
  const [sourceStorageLocationByItemId, setSourceStorageLocationByItemId] =
    useState<Record<number, string>>({});
  const [destinationProjectByRequestId, setDestinationProjectByRequestId] =
    useState<Record<number, string>>({});
  const [destinationWarehouseByRequestId, setDestinationWarehouseByRequestId] =
    useState<Record<number, string>>({});

  const { data: projects } = trpc.projects.list.useQuery({ status: "activo" });
  const articleSearchQuery = trpc.requestItems.searchSapCatalog.useQuery(
    { search: debouncedArticleSearch.trim() },
    {
      enabled:
        allowManualTransferRequests &&
        dialogOpen &&
        isArticleSearchCurrent &&
        debouncedArticleSearch.trim().length >= 2,
      staleTime: 30_000,
    }
  );
  const creationWarehousesQuery = trpc.warehouses.list.useQuery(
    { projectId: Number(projectId) || undefined, isActive: true },
    { enabled: allowManualTransferRequests && dialogOpen && Boolean(projectId) }
  );
  const {
    data: transferRequestsPage,
    isLoading,
    isPlaceholderData,
  } = trpc.transferRequests.listPage.useQuery(
    {
      projectId: projectFilter === "all" ? undefined : Number(projectFilter),
      search: debouncedSearchTerm.trim() || undefined,
      status: statusFilter === "all" ? undefined : statusFilter,
      page,
      pageSize: PAGE_SIZE,
    },
    { placeholderData: previousData => previousData }
  );
  const transferRequests = transferRequestsPage?.items ?? [];
  const {
    data: detail,
    isLoading: detailLoading,
    error: detailError,
  } = trpc.transferRequests.getById.useQuery(
    { id: detailId ?? 0 },
    { enabled: Boolean(detailId) }
  );
  const originStockItems = useMemo(
    () =>
      (detail?.items || []).map((item: any) => ({
        id: item.id,
        sapItemCode: item.sapItemCode || null,
        itemName: item.itemName || "",
      })),
    [detail?.items]
  );
  const { data: originStockRows, isFetching: originStockLoading } =
    trpc.inventory.visibleWarehouseStockForItems.useQuery(
      { items: originStockItems, includeQuantities: true },
      {
        enabled:
          canConvertTransferRequests &&
          detail?.transferRequest.status === "pendiente" &&
          originStockItems.length > 0,
      }
    );
  const currentDetailDestinationProjectId =
    detail?.transferRequest.destinationType === "proyecto" &&
    detail.transferRequest.destinationProjectId
      ? Number(detail.transferRequest.destinationProjectId)
      : undefined;
  const selectedDetailDestinationProjectId =
    detail?.transferRequest.id &&
    destinationProjectByRequestId[detail.transferRequest.id]
      ? Number(destinationProjectByRequestId[detail.transferRequest.id])
      : currentDetailDestinationProjectId;
  const selectedDetailDestinationWarehouseId = detail?.transferRequest.id
    ? Number(
        destinationWarehouseByRequestId[detail.transferRequest.id] ||
          detail.transferRequest.destinationWarehouseId ||
          0
      ) || undefined
    : undefined;
  const isIndependentRelocationRequest = Boolean(
    detail?.transferRequest.materialRequestId === null &&
      !detail.transferRequest.reverseLogisticId &&
      detail.transferRequest.destinationType === "proyecto" &&
      detail.transferRequest.destinationProjectId ===
        detail.transferRequest.projectId &&
      (detail.items ?? []).every(
        (item: any) =>
          !item.sourceWarehouseId ||
          isSameTransferScope(detail.transferRequest, item)
      )
  );
  const canEditDestinationWarehouse =
    canConvertTransferRequests &&
    detail?.transferRequest.status === "pendiente" &&
    detail?.transferRequest.destinationType === "proyecto" &&
    !detail?.transferRequest.reverseLogisticId &&
    !isIndependentRelocationRequest &&
    Boolean(selectedDetailDestinationProjectId);
  const {
    data: destinationWarehouses,
    isFetching: destinationWarehousesLoading,
  } = trpc.warehouses.list.useQuery(
    {
      projectId: selectedDetailDestinationProjectId,
      isActive: true,
    },
    {
      enabled:
        Boolean(detailId) &&
        Boolean(selectedDetailDestinationProjectId) &&
        canEditDestinationWarehouse,
    }
  );
  const originStockRowsByItemId = useMemo(
    () =>
      new Map(
        (originStockRows || []).map((entry: any) => [
          Number(entry.itemId),
          entry,
        ])
      ),
    [originStockRows]
  );

  const createMutation = trpc.transferRequests.create.useMutation({
    onSuccess: result => {
      toast.success("Solicitud de reubicación creada");
      setDialogOpen(false);
      setProjectId("");
      setCreationWarehouseId("");
      setNeededBy("");
      setNotes("");
      setItemName("");
      setQuantity("");
      setUnit("");
      setSapItemCode("");
      setArticleSearch("");
      setRelocationItems([]);
      setDetailId(result.id);
      void utils.transferRequests.invalidate();
    },
    onError: error => toast.error(error.message),
  });

  const convertMutation = trpc.transferRequests.convertToTransfer.useMutation({
    onSuccess: result => {
      toast.success(`Traslado ${result.transferNumber} generado`);
      void Promise.all([
        utils.transferRequests.invalidate(),
        utils.transfers.invalidate(),
        detailId
          ? utils.transferRequests.getById.invalidate({ id: detailId })
          : Promise.resolve(),
      ]);
    },
    onError: error => toast.error(error.message),
  });

  useEffect(() => {
    setRelocationReason(detail?.transferRequest.notes ?? "");
  }, [detail?.transferRequest.id]);

  const updateDestinationWarehouseMutation =
    trpc.transferRequests.updateDestinationWarehouse.useMutation({
      onSuccess: () => {
        toast.success("Bodega destino actualizada");
        void Promise.all([
          utils.transferRequests.invalidate(),
          detailId
            ? utils.transferRequests.getById.invalidate({ id: detailId })
            : Promise.resolve(),
        ]);
      },
      onError: error => toast.error(error.message),
    });

  const cancelMutation = trpc.transferRequests.cancel.useMutation({
    onSuccess: () => {
      toast.success("Solicitud de traslado anulada");
      setConfirmCancelId(null);
      void Promise.all([
        utils.transferRequests.invalidate(),
        detailId
          ? utils.transferRequests.getById.invalidate({ id: detailId })
          : Promise.resolve(),
      ]);
    },
    onError: error => toast.error(error.message),
  });

  useEffect(() => {
    const requestId = detail?.transferRequest.id;
    if (!requestId) return;

    const destinationProjectId =
      detail.transferRequest.destinationProjectId ??
      detail.materialRequest?.projectId ??
      detail.project?.id ??
      null;
    const destinationWarehouseId =
      detail.transferRequest.destinationWarehouseId ??
      (detail.transferRequest.reverseLogisticId
        ? detail.destinationWarehouse?.id
        : null) ??
      null;

    setDestinationProjectByRequestId(current => {
      if (current[requestId] || !destinationProjectId) return current;
      return {
        ...current,
        [requestId]: String(destinationProjectId),
      };
    });
    setDestinationWarehouseByRequestId(current => {
      if (current[requestId] || !destinationWarehouseId) return current;
      return {
        ...current,
        [requestId]: String(destinationWarehouseId),
      };
    });
  }, [
    detail?.transferRequest.id,
    detail?.transferRequest.destinationProjectId,
    detail?.transferRequest.destinationWarehouseId,
    detail?.destinationWarehouse?.id,
    detail?.materialRequest?.projectId,
    detail?.project?.id,
  ]);

  useEffect(() => {
    if (!detail || detail.transferRequest.status !== "pendiente") {
      return;
    }

    const nextQuantities: Record<number, string> = {};
    const nextSourceWarehouses: Record<number, string> = {};
    const nextSourcePhysicalWarehouses: Record<number, string> = {};
    const nextSourceStorageLocations: Record<number, string> = {};
    for (const item of detail.items || []) {
      const requestedQuantity = Number(item.quantity ?? 0);
      const availableQuantity = Number(item.originStockQuantity ?? 0);
      const suggestedQuantity = Math.min(
        Math.max(requestedQuantity, 0),
        Math.max(availableQuantity, 0)
      );
      nextQuantities[item.id] = canViewOriginQuantities
        ? suggestedQuantity.toFixed(2)
        : item.sourceWarehouseId
          ? requestedQuantity.toFixed(2)
          : "0.00";
      if (item.sourceWarehouseId) {
        const persistedSourceProjectId =
          item.sourceProjectId === null ||
          typeof item.sourceProjectId === "number"
            ? item.sourceProjectId
            : detail.transferRequest.projectId;
        nextSourceWarehouses[item.id] = getTransferSourceOptionValue({
          projectId: persistedSourceProjectId,
          warehouseId: Number(item.sourceWarehouseId),
        });
        nextSourcePhysicalWarehouses[item.id] = String(item.sourceWarehouseId);
        nextSourceStorageLocations[item.id] = encodeSourceStorageLocationValue(
          item.sourceStorageLocation
        );
      }
    }
    setTransferQuantityByItemId(nextQuantities);
    setSourceWarehouseByItemId(nextSourceWarehouses);
    setSourcePhysicalWarehouseByItemId(nextSourcePhysicalWarehouses);
    setSourceStorageLocationByItemId(nextSourceStorageLocations);
  }, [
    canViewOriginQuantities,
    detail?.transferRequest.id,
    detail?.transferRequest.status,
  ]);

  const getSelectedSourceValue = (item: any) =>
    sourceWarehouseByItemId[item.id] ||
    (item.sourceWarehouseId
      ? getTransferSourceOptionValue({
          projectId:
            item.sourceProjectId === null ||
            typeof item.sourceProjectId === "number"
              ? item.sourceProjectId
              : (detail?.transferRequest.projectId ?? 0),
          warehouseId: Number(item.sourceWarehouseId),
        })
      : "");

  const getOriginStockOptions = (item: any) => {
    const options = (
      (originStockRowsByItemId.get(item.id) as any)?.warehouses ?? []
    ).filter(
      (option: any) =>
        !isIndependentRelocationRequest ||
        (Number(option.projectId) === detail?.transferRequest.projectId &&
          Number(option.warehouseId) === selectedDetailDestinationWarehouseId)
    );
    if (canViewOriginQuantities) return options;

    const requestProjectId = Number(detail?.transferRequest.projectId ?? 0);
    const getPreferenceScore = (option: any) => {
      const optionProjectId = Number(option.projectId);
      if (
        Number.isInteger(optionProjectId) &&
        optionProjectId === requestProjectId
      ) {
        return 3;
      }
      if (option.projectId === null || option.projectId === undefined) {
        return 2;
      }
      return 1;
    };
    const warehouseOptions = new Map<number, any>();

    for (const option of options) {
      const warehouseId = Number(option.warehouseId);
      if (!Number.isInteger(warehouseId) || warehouseId <= 0) continue;

      const current = warehouseOptions.get(warehouseId);
      if (
        !current ||
        getPreferenceScore(option) > getPreferenceScore(current)
      ) {
        warehouseOptions.set(warehouseId, option);
      }
    }

    return Array.from(warehouseOptions.values()).sort((left, right) => {
      const leftLabel =
        left.displayName || left.warehouseName || left.warehouseCode || "";
      const rightLabel =
        right.displayName || right.warehouseName || right.warehouseCode || "";
      return leftLabel.localeCompare(rightLabel);
    });
  };

  const getOriginWarehouseOptions = (item: any) => {
    const options = getOriginStockOptions(item);
    const byWarehouse = new Map<number, any>();

    for (const option of options) {
      const warehouseId = Number(option.warehouseId);
      if (!Number.isInteger(warehouseId) || warehouseId <= 0) continue;

      const existing = byWarehouse.get(warehouseId);
      if (!existing) {
        byWarehouse.set(warehouseId, {
          ...option,
          quantity: Number(option.quantity ?? 0),
        });
        continue;
      }

      byWarehouse.set(warehouseId, {
        ...existing,
        quantity: Number(existing.quantity ?? 0) + Number(option.quantity ?? 0),
      });
    }

    return Array.from(byWarehouse.values()).sort((left, right) =>
      getOriginWarehouseLabel(left).localeCompare(
        getOriginWarehouseLabel(right)
      )
    );
  };

  const getSelectedSourceWarehouseId = (item: any) => {
    const explicitWarehouseId = Number(
      sourcePhysicalWarehouseByItemId[item.id]
    );
    if (Number.isInteger(explicitWarehouseId) && explicitWarehouseId > 0) {
      return explicitWarehouseId;
    }

    const selectedSource = parseTransferSourceOptionValue(
      getSelectedSourceValue(item)
    );
    if (selectedSource) return selectedSource.warehouseId;

    const itemWarehouseId = Number(item.sourceWarehouseId);
    return Number.isInteger(itemWarehouseId) && itemWarehouseId > 0
      ? itemWarehouseId
      : null;
  };

  const getOriginProjectOptions = (item: any, warehouseId?: number | null) => {
    if (!warehouseId) return [];
    return getOriginStockOptions(item)
      .filter((option: any) => Number(option.warehouseId) === warehouseId)
      .sort((left: any, right: any) =>
        getOriginProjectLabel(left).localeCompare(getOriginProjectLabel(right))
      );
  };

  const getSourceStorageLocationOptions = (
    item: any,
    sourceValue?: string | null
  ) => {
    if (!sourceValue) return [];
    const sourceOption = getOriginStockOptions(item).find(
      (option: any) => getTransferSourceOptionValue(option) === sourceValue
    );
    return [...(sourceOption?.storageLocations ?? [])]
      .filter((location: any) =>
        location.quantityHidden ? true : Number(location.quantity ?? 0) > 0
      )
      .sort((left: any, right: any) => {
        if (left.storageLocation && !right.storageLocation) return -1;
        if (!left.storageLocation && right.storageLocation) return 1;
        return getSourceStorageLocationLabel(
          left.storageLocation
        ).localeCompare(getSourceStorageLocationLabel(right.storageLocation));
      });
  };

  const getSelectedSourceStorageLocationValue = (item: any) => {
    const selectedValue = sourceStorageLocationByItemId[item.id];
    if (selectedValue) return selectedValue;
    if (item.sourceWarehouseId) {
      return encodeSourceStorageLocationValue(item.sourceStorageLocation);
    }
    return "";
  };

  const getSourceStorageLocationQuantity = (
    item: any,
    sourceValue?: string | null,
    storageLocationValue?: string | null
  ) => {
    if (!sourceValue || !storageLocationValue) return 0;
    const expectedValue = encodeSourceStorageLocationValue(
      decodeSourceStorageLocationValue(storageLocationValue)
    );
    const option = getSourceStorageLocationOptions(item, sourceValue).find(
      (location: any) =>
        encodeSourceStorageLocationValue(location.storageLocation) ===
        expectedValue
    );
    return Number(option?.quantity ?? 0);
  };

  const setSelectedSourceForItem = (item: any, value: string) => {
    const storageLocationOptions = getSourceStorageLocationOptions(item, value);
    const currentStorageLocationValue =
      getSelectedSourceStorageLocationValue(item);
    const currentStorageLocationOption = storageLocationOptions.find(
      (location: any) =>
        encodeSourceStorageLocationValue(location.storageLocation) ===
        currentStorageLocationValue
    );
    const selectedStorageLocationOption =
      currentStorageLocationOption ??
      (storageLocationOptions.length === 1 ? storageLocationOptions[0] : null);
    const selectedSource = parseTransferSourceOptionValue(value);
    const requestedQuantity = Number(item.quantity ?? 0);
    const selectedLocationQuantity = selectedStorageLocationOption
      ? Number(selectedStorageLocationOption.quantity ?? requestedQuantity)
      : 0;
    const suggestedQuantity = Math.min(
      requestedQuantity,
      canViewOriginQuantities ? selectedLocationQuantity : requestedQuantity
    );

    setSourceWarehouseByItemId(current => ({
      ...current,
      [item.id]: value,
    }));
    if (selectedSource?.warehouseId) {
      setSourcePhysicalWarehouseByItemId(current => ({
        ...current,
        [item.id]: String(selectedSource.warehouseId),
      }));
    }
    setSourceStorageLocationByItemId(current => {
      const next = { ...current };
      if (selectedStorageLocationOption) {
        next[item.id] = encodeSourceStorageLocationValue(
          selectedStorageLocationOption.storageLocation
        );
      } else {
        delete next[item.id];
      }
      return next;
    });
    setTransferQuantityByItemId(current => ({
      ...current,
      [item.id]: suggestedQuantity.toFixed(2),
    }));
  };

  const clearSelectedSourceForItem = (item: any) => {
    setSourceWarehouseByItemId(current => {
      const next = { ...current };
      delete next[item.id];
      return next;
    });
    setTransferQuantityByItemId(current => ({
      ...current,
      [item.id]: "0.00",
    }));
    setSourceStorageLocationByItemId(current => {
      const next = { ...current };
      delete next[item.id];
      return next;
    });
  };

  const handleSourceWarehouseChange = (item: any, value: string) => {
    const warehouseId = Number(value);
    setSourcePhysicalWarehouseByItemId(current => ({
      ...current,
      [item.id]: value,
    }));

    const currentSourceValue = getSelectedSourceValue(item);
    const currentSource = parseTransferSourceOptionValue(currentSourceValue);
    const projectOptions = getOriginProjectOptions(item, warehouseId);
    const currentSourceStillValid =
      currentSource?.warehouseId === warehouseId &&
      projectOptions.some(
        (option: any) =>
          getTransferSourceOptionValue(option) === currentSourceValue
      );

    if (currentSourceStillValid && currentSourceValue) {
      setSelectedSourceForItem(item, currentSourceValue);
      return;
    }

    if (projectOptions.length === 1) {
      setSelectedSourceForItem(
        item,
        getTransferSourceOptionValue(projectOptions[0])
      );
      return;
    }

    clearSelectedSourceForItem(item);
  };

  const handleSourceStorageLocationChange = (item: any, value: string) => {
    const selectedSourceValue = getSelectedSourceValue(item);
    const selectedQuantity = getSourceStorageLocationQuantity(
      item,
      selectedSourceValue,
      value
    );
    const requestedQuantity = Number(item.quantity ?? 0);
    const suggestedQuantity = Math.min(
      requestedQuantity,
      canViewOriginQuantities ? selectedQuantity : requestedQuantity
    );

    setSourceStorageLocationByItemId(current => ({
      ...current,
      [item.id]: value,
    }));
    setTransferQuantityByItemId(current => ({
      ...current,
      [item.id]: suggestedQuantity.toFixed(2),
    }));
  };

  useEffect(() => {
    if (!detail || detail.transferRequest.status !== "pendiente") return;

    const nextStorageLocations = { ...sourceStorageLocationByItemId };
    const nextQuantities: Record<number, string> = {};
    let changed = false;

    for (const item of detail.items || []) {
      const selectedSourceValue = getSelectedSourceValue(item);
      if (!selectedSourceValue) continue;

      const options = getSourceStorageLocationOptions(
        item,
        selectedSourceValue
      );
      const currentValue = sourceStorageLocationByItemId[item.id];
      const currentStillValid = options.some(
        (location: any) =>
          encodeSourceStorageLocationValue(location.storageLocation) ===
          currentValue
      );
      if (currentStillValid) continue;

      if (options.length === 1) {
        const selectedValue = encodeSourceStorageLocationValue(
          options[0].storageLocation
        );
        nextStorageLocations[item.id] = selectedValue;
        const requestedQuantity = Number(item.quantity ?? 0);
        const availableQuantity = Number(
          options[0].quantity ?? requestedQuantity
        );
        nextQuantities[item.id] = Math.min(
          requestedQuantity,
          canViewOriginQuantities ? availableQuantity : requestedQuantity
        ).toFixed(2);
        changed = true;
      } else if (currentValue) {
        delete nextStorageLocations[item.id];
        nextQuantities[item.id] = "0.00";
        changed = true;
      }
    }

    if (!changed) return;
    setSourceStorageLocationByItemId(nextStorageLocations);
    if (Object.keys(nextQuantities).length > 0) {
      setTransferQuantityByItemId(current => ({
        ...current,
        ...nextQuantities,
      }));
    }
  }, [
    canViewOriginQuantities,
    detail?.transferRequest.id,
    detail?.transferRequest.status,
    originStockRows,
    sourceStorageLocationByItemId,
    sourceWarehouseByItemId,
  ]);

  const getDestinationProjectWarehouseOptions = (projectId?: number | null) => {
    if (!projectId) return [];
    const project = (projects ?? []).find(
      (entry: any) => Number(entry.id) === Number(projectId)
    );
    const assignedWarehouses = project?.warehouses;
    if (Array.isArray(assignedWarehouses) && assignedWarehouses.length > 0) {
      return assignedWarehouses;
    }
    return project?.warehouse ? [project.warehouse] : [];
  };

  const handleDestinationProjectChange = (value: string) => {
    if (!detail) return;
    const requestId = detail.transferRequest.id;
    const projectId = Number(value);
    if (!Number.isInteger(projectId) || projectId <= 0) return;

    setDestinationProjectByRequestId(current => ({
      ...current,
      [requestId]: value,
    }));
    setDestinationWarehouseByRequestId(current => ({
      ...current,
      [requestId]: "",
    }));
  };

  const handleDestinationWarehouseChange = (value: string) => {
    if (!detail) return;
    const requestId = detail.transferRequest.id;
    const projectId = Number(
      destinationProjectByRequestId[requestId] ??
        detail.transferRequest.destinationProjectId
    );
    const warehouseId = Number(value);
    if (
      !Number.isInteger(projectId) ||
      projectId <= 0 ||
      !Number.isInteger(warehouseId) ||
      warehouseId <= 0
    ) {
      toast.error("Seleccione bodega destino y almacén destino");
      return;
    }

    setDestinationWarehouseByRequestId(current => ({
      ...current,
      [requestId]: value,
    }));
    updateDestinationWarehouseMutation.mutate({
      id: requestId,
      projectId,
      warehouseId,
    });
  };

  const getSelectedOriginStock = (item: any) => {
    if (!canViewOriginQuantities) return null;
    const selectedValue = getSelectedSourceValue(item);
    const selectedSource = parseTransferSourceOptionValue(selectedValue);
    if (!selectedSource) return null;
    const selectedStorageLocationValue =
      getSelectedSourceStorageLocationValue(item);
    if (!selectedStorageLocationValue) return null;

    const selectedLocationQuantity = getSourceStorageLocationQuantity(
      item,
      selectedValue,
      selectedStorageLocationValue
    );
    if (selectedLocationQuantity > 0) return selectedLocationQuantity;

    const stockOption = getOriginStockOptions(item).find(
      (entry: any) => getTransferSourceOptionValue(entry) === selectedValue
    );
    const persistedStorageLocationValue = item.sourceWarehouseId
      ? encodeSourceStorageLocationValue(item.sourceStorageLocation)
      : "";
    if (
      stockOption &&
      persistedStorageLocationValue === selectedStorageLocationValue
    ) {
      return Number(item.originStockQuantity ?? 0);
    }

    if (
      item.sourceWarehouseId &&
      Number(item.sourceWarehouseId) === selectedSource.warehouseId
    ) {
      return Number(item.originStockQuantity ?? 0);
    }

    return 0;
  };

  const getTransferQuantity = (item: any) =>
    Number(
      transferQuantityByItemId[item.id] ??
        (!canViewOriginQuantities
          ? getSelectedSourceValue(item)
            ? (item.quantity ?? 0)
            : 0
          : detail?.transferRequest.status === "pendiente"
            ? Math.min(
                Number(item.quantity ?? 0),
                Number(item.originStockQuantity ?? 0)
              ).toFixed(2)
            : (item.quantity ?? 0))
    );

  const preparedMovementRequest = detail
    ? {
        ...detail.transferRequest,
        destinationProjectId: selectedDetailDestinationProjectId,
        destinationWarehouseId: selectedDetailDestinationWarehouseId,
      }
    : null;
  const preparedMovementItems = (detail?.items ?? []).map((item: any) => {
    const source = parseTransferSourceOptionValue(getSelectedSourceValue(item));
    return {
      ...item,
      quantity: getTransferQuantity(item),
      sourceProjectId: source ? source.projectId : item.sourceProjectId,
      sourceWarehouseId: source?.warehouseId ?? item.sourceWarehouseId,
      sourceStorageLocation: decodeSourceStorageLocationValue(
        getSelectedSourceStorageLocationValue(item)
      ),
    };
  });
  const preparedMovementKind = preparedMovementRequest
    ? getTransferMovementKind(preparedMovementRequest, preparedMovementItems)
    : "transfer";

  const filteredTransferRequests = transferRequests;

  useEffect(
    () => setPage(1),
    [debouncedSearchTerm, projectFilter, statusFilter]
  );
  useEffect(() => {
    if (
      !isPlaceholderData &&
      transferRequestsPage?.page &&
      transferRequestsPage.page !== page
    ) {
      setPage(transferRequestsPage.page);
    }
  }, [isPlaceholderData, page, transferRequestsPage?.page]);

  const handleConvertToTransfer = () => {
    if (!detail) return;

    if (updateDestinationWarehouseMutation.isPending) {
      toast.error("Espere a que termine de guardarse el almacén destino");
      return;
    }

    const requestId = detail.transferRequest.id;
    const destinationProjectId = Number(
      destinationProjectByRequestId[requestId] ??
        detail.transferRequest.destinationProjectId
    );
    const destinationWarehouseId = Number(
      destinationWarehouseByRequestId[requestId] ??
        detail.transferRequest.destinationWarehouseId
    );
    if (
      detail.transferRequest.destinationType === "proyecto" &&
      (!Number.isInteger(destinationProjectId) ||
        destinationProjectId <= 0 ||
        !Number.isInteger(destinationWarehouseId) ||
        destinationWarehouseId <= 0)
    ) {
      toast.error(
        "Seleccione un proyecto y almacén destino antes de convertir la solicitud"
      );
      return;
    }

    type TransferConversionItem = {
      transferRequestItemId: number;
      quantity: string;
      sourceProjectId?: number | null;
      sourceWarehouseId?: number;
      sourceStorageLocation?: string | null;
    };

    const items = (detail.items || []).map(
      (item: any): TransferConversionItem | null => {
        const requestedQuantity = Number(item.quantity ?? 0);
        const selectedSource = parseTransferSourceOptionValue(
          getSelectedSourceValue(item)
        );
        const selectedStorageLocationValue =
          getSelectedSourceStorageLocationValue(item);
        const availableQuantity = getSelectedOriginStock(item) ?? 0;
        const transferQuantity = getTransferQuantity(item);

        if (!Number.isFinite(transferQuantity) || transferQuantity < 0) {
          toast.error("Revise las cantidades a enviar");
          return null;
        }
        if (transferQuantity - requestedQuantity > 0.000001) {
          toast.error(
            `La cantidad a enviar de ${item.itemName} no puede exceder lo solicitado`
          );
          return null;
        }
        if (transferQuantity > 0 && !selectedSource) {
          toast.error(`Seleccione bodega origen para ${item.itemName}`);
          return null;
        }
        if (transferQuantity > 0 && !selectedStorageLocationValue) {
          toast.error(`Seleccione ubicación origen para ${item.itemName}`);
          return null;
        }
        if (
          canViewOriginQuantities &&
          transferQuantity - availableQuantity > 0.000001
        ) {
          toast.error(
            `No hay suficiente existencia para enviar ${item.itemName}`
          );
          return null;
        }

        return {
          transferRequestItemId: item.id,
          quantity: transferQuantity.toFixed(2),
          sourceProjectId: selectedSource
            ? selectedSource.projectId
            : undefined,
          sourceWarehouseId: selectedSource?.warehouseId,
          sourceStorageLocation: selectedStorageLocationValue
            ? decodeSourceStorageLocationValue(selectedStorageLocationValue)
            : undefined,
        };
      }
    );

    if (items.some((item: TransferConversionItem | null) => item === null)) {
      return;
    }
    const validItems = items.filter(
      (item: TransferConversionItem | null): item is TransferConversionItem =>
        Boolean(item)
    );

    if (
      !validItems.some(
        (item: TransferConversionItem) => Number(item.quantity) > 0
      )
    ) {
      toast.error("Debe enviar al menos una cantidad mayor que cero");
      return;
    }

    if (preparedMovementKind === "mixed") {
      toast.error(
        "Separe las reubicaciones internas y los traslados entre bodegas en solicitudes distintas"
      );
      return;
    }
    if (
      preparedMovementKind === "internal" &&
      relocationReason.trim().length < 3
    ) {
      toast.error(
        "Ingrese un motivo de al menos 3 caracteres para la reubicación interna"
      );
      return;
    }

    if (detail.transferRequest.destinationType === "proyecto") {
      const requestedItemById = new Map(
        (detail.items || []).map((item: any) => [Number(item.id), item])
      );
      const conflictingItem = validItems.find(
        (item: TransferConversionItem) => {
          if (Number(item.quantity) <= 0) return false;
          const requestedItem: any = requestedItemById.get(
            item.transferRequestItemId
          );
          const sourceProjectId =
            item.sourceProjectId === undefined
              ? requestedItem?.sourceWarehouseId
                ? (requestedItem.sourceProjectId ?? null)
                : detail.transferRequest.projectId
              : item.sourceProjectId;
          const sourceWarehouseId =
            item.sourceWarehouseId ?? requestedItem?.sourceWarehouseId ?? null;
          return isSameTransferScope(
            {
              ...detail.transferRequest,
              destinationProjectId,
              destinationWarehouseId,
            },
            { sourceProjectId, sourceWarehouseId }
          );
        }
      );
      if (conflictingItem && preparedMovementKind !== "internal") {
        const requestedItem: any = requestedItemById.get(
          conflictingItem.transferRequestItemId
        );
        toast.error(
          `${requestedItem?.itemName ?? "El ítem"}: el proyecto y almacén destino no pueden ser los mismos del origen`
        );
        return;
      }
    }
    convertMutation.mutate({
      id: detail.transferRequest.id,
      items: validItems,
      ...(preparedMovementKind === "internal"
        ? { relocationReason: relocationReason.trim() }
        : {}),
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <h1>Solicitudes de Traslado</h1>
          <p className="text-sm text-muted-foreground">
            Los traslados de materiales se generan desde requisiciones. Las
            reubicaciones internas se solicitan directamente en esta pantalla.
          </p>
        </div>
        {allowManualTransferRequests ? (
          <Dialog
            open={dialogOpen}
            onOpenChange={open =>
              !createMutation.isPending && setDialogOpen(open)
            }
          >
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                Nueva reubicación
              </Button>
            </DialogTrigger>
            <DialogContent className="flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-3xl flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
              <DialogHeader className="shrink-0 border-b px-5 py-4 pr-12 text-left sm:px-6 sm:pr-12">
                <DialogTitle>Nueva reubicación interna</DialogTitle>
                <DialogDescription>
                  Los artículos conservan proyecto y bodega. Seleccionará la
                  ubicación de origen al confirmar y la nueva ubicación al
                  recibir.
                </DialogDescription>
              </DialogHeader>
              <div className="min-h-0 space-y-5 overflow-y-auto px-5 py-5 sm:px-6">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="min-w-0 space-y-2">
                    <Label htmlFor="relocation-project">Proyecto *</Label>
                    <Select
                      value={projectId}
                      onValueChange={value => {
                        setProjectId(value);
                        setCreationWarehouseId("");
                      }}
                      disabled={createMutation.isPending}
                    >
                      <SelectTrigger
                        id="relocation-project"
                        className="min-h-11 w-full min-w-0"
                      >
                        <SelectValue
                          className="min-w-0 truncate"
                          placeholder="Seleccione proyecto"
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {(projects || []).map((project: any) => (
                          <SelectItem
                            key={project.id}
                            value={String(project.id)}
                          >
                            {project.code} — {project.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="min-w-0 space-y-2">
                    <Label htmlFor="relocation-warehouse">Bodega *</Label>
                    <Select
                      value={creationWarehouseId}
                      onValueChange={setCreationWarehouseId}
                      disabled={
                        !projectId ||
                        creationWarehousesQuery.isFetching ||
                        createMutation.isPending
                      }
                    >
                      <SelectTrigger
                        id="relocation-warehouse"
                        className="min-h-11 w-full min-w-0"
                      >
                        <SelectValue
                          className="min-w-0 truncate"
                          placeholder={
                            creationWarehousesQuery.isFetching
                              ? "Consultando..."
                              : "Seleccione bodega"
                          }
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {(creationWarehousesQuery.data || []).map(
                          (warehouse: any) => (
                            <SelectItem
                              key={warehouse.id}
                              value={String(warehouse.id)}
                            >
                              {getWarehouseLabel(warehouse)}
                            </SelectItem>
                          )
                        )}
                      </SelectContent>
                    </Select>
                    {creationWarehousesQuery.error ? (
                      <p role="alert" className="text-xs text-destructive">
                        {creationWarehousesQuery.error.message}
                      </p>
                    ) : projectId &&
                      !creationWarehousesQuery.isFetching &&
                      !creationWarehousesQuery.data?.length ? (
                      <p className="text-xs text-muted-foreground">
                        El proyecto no tiene bodegas disponibles.
                      </p>
                    ) : null}
                  </div>
                </div>
                <section
                  aria-labelledby="relocation-articles-heading"
                  className="space-y-4 border-t pt-5"
                >
                  <h3
                    id="relocation-articles-heading"
                    className="text-sm font-semibold"
                  >
                    Artículos a reubicar
                  </h3>
                  <div className="space-y-2">
                    <Label htmlFor="relocation-article-search">
                      Buscar artículo por código o descripción
                    </Label>
                    <Input
                      id="relocation-article-search"
                      className="h-11"
                      value={articleSearch}
                      onChange={event => {
                        setArticleSearch(event.target.value);
                        setSapItemCode("");
                        setItemName("");
                        setUnit("");
                      }}
                      placeholder="Escriba al menos 2 caracteres"
                      disabled={createMutation.isPending}
                      autoComplete="off"
                      aria-describedby="relocation-article-help"
                    />
                    <p
                      id="relocation-article-help"
                      className="text-xs text-muted-foreground"
                    >
                      Pulse «Seleccionar» en el artículo que desea agregar.
                    </p>
                    {articleSearch.trim().length >= 2 && !sapItemCode ? (
                      !isArticleSearchCurrent ||
                      articleSearchQuery.isFetching ? (
                        <p
                          role="status"
                          className="text-xs text-muted-foreground"
                        >
                          Consultando artículos...
                        </p>
                      ) : articleSearchQuery.error ? (
                        <p role="alert" className="text-xs text-destructive">
                          {articleSearchQuery.error.message}
                        </p>
                      ) : (
                        <div className="max-h-52 overflow-y-auto rounded-md border">
                          {(articleSearchQuery.data || [])
                            .filter(
                              (article: any) =>
                                Number(article.tipoArticulo ?? 1) === 1
                            )
                            .map((article: any) => (
                              <button
                                type="button"
                                key={article.id}
                                className="flex min-h-11 w-full items-center justify-between gap-3 border-b px-3 py-2 text-left text-sm last:border-0 hover:bg-accent focus-visible:bg-accent"
                                aria-label={`Seleccionar ${article.itemCode} ${article.description}`}
                                disabled={createMutation.isPending}
                                onClick={() => {
                                  if (
                                    !isArticleSearchCurrent ||
                                    articleSearchQuery.isFetching ||
                                    createMutation.isPending
                                  ) {
                                    return;
                                  }
                                  setSapItemCode(article.itemCode);
                                  setItemName(article.description);
                                  setUnit(article.unit?.trim() || "");
                                }}
                              >
                                <span className="flex min-w-0 flex-col gap-0.5">
                                  <span className="font-mono text-xs font-semibold">
                                    {article.itemCode}
                                  </span>
                                  <span className="break-words">
                                    {article.description}
                                  </span>
                                  {article.partNumber ? (
                                    <span className="break-words text-xs text-muted-foreground">
                                      Referencia: {article.partNumber}
                                    </span>
                                  ) : null}
                                  <span className="text-xs text-muted-foreground">
                                    Unidad:{" "}
                                    {article.unit?.trim() ||
                                      "Sin unidad en catálogo"}
                                  </span>
                                </span>
                                <span className="shrink-0 rounded-md border bg-background px-2 py-1 text-xs font-medium text-primary">
                                  Seleccionar
                                </span>
                              </button>
                            ))}
                          {!(articleSearchQuery.data || []).some(
                            (article: any) =>
                              Number(article.tipoArticulo ?? 1) === 1
                          ) ? (
                            <p className="p-3 text-sm text-muted-foreground">
                              No hay artículos de inventario que coincidan.
                            </p>
                          ) : null}
                        </div>
                      )
                    ) : null}
                    {sapItemCode ? (
                      <div
                        role="status"
                        className="space-y-1 rounded-md border bg-muted/20 p-3 text-sm"
                      >
                        <p className="text-xs font-semibold text-muted-foreground">
                          Artículo seleccionado
                        </p>
                        <p className="break-words">
                          <span className="font-mono font-semibold">
                            {sapItemCode}
                          </span>{" "}
                          · {itemName}
                        </p>
                      </div>
                    ) : null}
                  </div>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-[minmax(0,1fr)_12rem_auto] sm:items-end">
                    <div className="min-w-0 space-y-2">
                      <Label htmlFor="relocation-quantity">Cantidad *</Label>
                      <Input
                        id="relocation-quantity"
                        className="h-11"
                        inputMode="decimal"
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={quantity}
                        onChange={event => setQuantity(event.target.value)}
                        disabled={createMutation.isPending}
                      />
                    </div>
                    <div className="min-w-0 space-y-2">
                      <Label htmlFor="relocation-unit">Unidad</Label>
                      <UnitCombobox
                        id="relocation-unit"
                        className="min-h-11 min-w-0"
                        contentClassName="min-w-48 max-w-[calc(100vw-2rem)]"
                        value={unit}
                        onChange={setUnit}
                        options={relocationUnitOptions}
                        disabled={
                          !sapItemCode || !unit || createMutation.isPending
                        }
                        placeholder={
                          sapItemCode
                            ? "Sin unidad en catálogo"
                            : "Seleccione artículo"
                        }
                        aria-describedby="relocation-unit-help"
                      />
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      className="col-span-2 min-h-11 w-full sm:col-span-1 sm:w-auto"
                      disabled={!sapItemCode || createMutation.isPending}
                      onClick={() => {
                        if (
                          !sapItemCode ||
                          !itemName ||
                          !/^\d+(?:\.\d{1,2})?$/.test(quantity.trim()) ||
                          Number(quantity) <= 0
                        ) {
                          toast.error(
                            "Seleccione un artículo y una cantidad positiva con hasta 2 decimales"
                          );
                          return;
                        }
                        setRelocationItems(current => [
                          ...current,
                          {
                            itemName,
                            sapItemCode,
                            quantity: Number(quantity).toFixed(2),
                            unit: unit || undefined,
                          },
                        ]);
                        setItemName("");
                        setSapItemCode("");
                        setArticleSearch("");
                        setUnit("");
                        setQuantity("");
                      }}
                    >
                      <Plus className="mr-1.5 h-4 w-4" />
                      Agregar artículo
                    </Button>
                  </div>
                  <p
                    id="relocation-unit-help"
                    className="text-xs text-muted-foreground"
                  >
                    {sapItemCode && !unit
                      ? "Este artículo no tiene unidad registrada en el catálogo."
                      : sapItemCode
                        ? "Se conserva la unidad del artículo durante la reubicación."
                        : "Seleccione un artículo para cargar su unidad."}
                  </p>
                  <div className="space-y-2 rounded-md border bg-muted/10 p-4">
                    <p className="text-xs font-semibold text-muted-foreground">
                      Artículos incluidos ({relocationItems.length})
                    </p>
                    {relocationItems.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        Agregue uno o varios artículos a la solicitud.
                      </p>
                    ) : (
                      relocationItems.map((item, index) => (
                        <div
                          key={index}
                          className="flex items-start justify-between gap-3 border-b py-2 last:border-0"
                        >
                          <div className="min-w-0 text-sm">
                            <p className="break-words">
                              <span className="font-mono font-semibold">
                                {item.sapItemCode}
                              </span>{" "}
                              · {item.itemName}
                            </p>
                            <p className="font-mono text-xs text-muted-foreground">
                              {item.quantity} {item.unit || ""}
                            </p>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={"Quitar " + item.itemName}
                            disabled={createMutation.isPending}
                            onClick={() =>
                              setRelocationItems(current =>
                                current.filter(
                                  (_, itemIndex) => itemIndex !== index
                                )
                              )
                            }
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ))
                    )}
                  </div>
                </section>
                <div className="grid gap-4 border-t pt-5 md:grid-cols-[minmax(0,1fr)_14rem]">
                  <div className="min-w-0 space-y-2">
                    <Label htmlFor="relocation-reason">
                      Motivo de la reubicación *
                    </Label>
                    <Textarea
                      id="relocation-reason"
                      value={notes}
                      onChange={event => setNotes(event.target.value)}
                      rows={3}
                      maxLength={2000}
                      placeholder="Ej.: regularización de ubicación o cambio de estante"
                      disabled={createMutation.isPending}
                    />
                  </div>
                  <div className="min-w-0 space-y-2">
                    <Label htmlFor="relocation-needed-by">
                      Fecha necesaria (opcional)
                    </Label>
                    <Input
                      id="relocation-needed-by"
                      className="h-11"
                      type="date"
                      value={neededBy}
                      onChange={event => setNeededBy(event.target.value)}
                      disabled={createMutation.isPending}
                    />
                  </div>
                </div>
              </div>
              <div className="shrink-0 border-t px-5 py-4 sm:flex sm:justify-end sm:px-6">
                <Button
                  className="min-h-11 w-full sm:w-auto"
                  disabled={
                    createMutation.isPending ||
                    !projectId ||
                    !creationWarehouseId ||
                    relocationItems.length === 0 ||
                    notes.trim().length < 3
                  }
                  onClick={() => {
                    if (
                      !projectId ||
                      !creationWarehouseId ||
                      !relocationItems.length ||
                      notes.trim().length < 3
                    ) {
                      toast.error(
                        "Seleccione proyecto, bodega, artículos y motivo de la reubicación"
                      );
                      return;
                    }
                    createMutation.mutate({
                      projectId: Number(projectId),
                      destinationType: "proyecto",
                      destinationProjectId: Number(projectId),
                      destinationWarehouseId: Number(creationWarehouseId),
                      neededBy: neededBy || undefined,
                      notes: notes.trim(),
                      items: relocationItems,
                    });
                  }}
                >
                  {createMutation.isPending
                    ? "Creando..."
                    : "Crear solicitud de reubicación"}
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
        <ProjectFilterSelect
          value={projectFilter}
          onValueChange={setProjectFilter}
        />
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
                    <tr
                      key={row.transferRequest.id}
                      className="border-b border-border last:border-0"
                    >
                      <td className="p-3 font-medium">
                        {row.transferRequest.requestNumber}
                      </td>
                      <td className="p-3 text-xs">
                        {row.project
                          ? `${row.project.code} — ${row.project.name}`
                          : "—"}
                      </td>
                      <td className="p-3 text-xs">
                        {row.transferRequest.destinationType ===
                        "bodega_central"
                          ? "Proyecto/bodega en recepción"
                          : `Proyecto ${row.transferRequest.destinationProjectId ?? ""}`}
                      </td>
                      <td className="p-3">
                        <Badge
                          variant="outline"
                          className={`text-xs ${
                            STATUS_COLORS[row.transferRequest.status] || ""
                          }`}
                        >
                          {STATUS_LABELS[row.transferRequest.status] ||
                            row.transferRequest.status}
                        </Badge>
                      </td>
                      <td className="p-3 text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setDetailId(row.transferRequest.id)}
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
          {transferRequestsPage ? (
            <DataPagination
              page={transferRequestsPage.page}
              pageSize={transferRequestsPage.pageSize}
              total={transferRequestsPage.total}
              totalPages={transferRequestsPage.totalPages}
              onPageChange={setPage}
            />
          ) : null}
        </CardContent>
      </Card>

      <Dialog
        open={Boolean(detailId)}
        onOpenChange={open => !open && setDetailId(null)}
      >
        <DialogContent className="scrollbar-visible !flex !h-[calc(100dvh-2rem)] !max-h-[calc(100dvh-2rem)] !w-[calc(100vw-2rem)] !max-w-[1760px] flex-col gap-0 overflow-hidden rounded-2xl p-0">
          <div className="shrink-0 border-b border-border px-4 py-3 sm:px-6">
            <DialogHeader>
              <DialogTitle>
                {detail?.transferRequest.requestNumber ||
                  "Solicitud de Traslado"}
              </DialogTitle>
            </DialogHeader>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
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
                <div className="grid gap-4 md:grid-cols-4">
                  <div>
                    <Label className="text-xs text-muted-foreground">
                      Proyecto que solicita
                    </Label>
                    <p className="text-sm font-medium">
                      {getRequestingProjectLabel(detail)}
                    </p>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">
                      Almacén origen
                    </Label>
                    <p className="text-sm font-medium">
                      {getSourceWarehouseSummary(detail)}
                    </p>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">
                      Almacén destino
                    </Label>
                    <p className="text-sm font-medium">
                      {getDestinationWarehouseSummary(detail)}
                    </p>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">
                      Estatus
                    </Label>
                    <div className="mt-1">
                      <Badge
                        variant="outline"
                        className={`text-xs ${
                          STATUS_COLORS[detail.transferRequest.status] || ""
                        }`}
                      >
                        {STATUS_LABELS[detail.transferRequest.status] ||
                          detail.transferRequest.status}
                      </Badge>
                    </div>
                  </div>
                </div>

                {isIndependentRelocationRequest ||
                preparedMovementKind === "internal" ? (
                  <div className="space-y-2 rounded-lg border border-primary/20 bg-primary/5 p-3">
                    <Badge variant="outline">Reubicación interna</Badge>
                    <p className="text-sm text-muted-foreground">
                      Se conserva proyecto y bodega. El saldo cambia al
                      registrar la recepción en una ubicación diferente.
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Esta reubicación no cambia la ubicación de otros traslados
                      o salidas pendientes. Revise esos documentos antes de
                      mover el saldo.
                    </p>
                    {detail.transferRequest.status === "pendiente" ? (
                      <div className="space-y-1.5">
                        <Label htmlFor="transfer-relocation-reason">
                          Motivo de la reubicación *
                        </Label>
                        <Textarea
                          id="transfer-relocation-reason"
                          value={relocationReason}
                          onChange={event =>
                            setRelocationReason(event.target.value)
                          }
                          maxLength={2000}
                          rows={2}
                          disabled={
                            !canConvertTransferRequests ||
                            convertMutation.isPending
                          }
                        />
                      </div>
                    ) : (
                      <p className="whitespace-pre-wrap text-sm">
                        {detail.transferRequest.notes}
                      </p>
                    )}
                  </div>
                ) : preparedMovementKind === "mixed" ? (
                  <p
                    role="alert"
                    className="rounded-md border border-destructive/30 p-3 text-sm text-destructive"
                  >
                    Separe las reubicaciones internas y los traslados entre
                    bodegas en solicitudes distintas.
                  </p>
                ) : null}

                <div className="max-w-full overflow-x-auto rounded border border-border">
                  <table className="w-full min-w-[1640px] table-fixed text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/30">
                        <th className="w-[70px] p-2 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          Código
                        </th>
                        <th className="w-[150px] p-2 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          Ítem
                        </th>
                        <th className="w-[190px] p-2 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          Almacén origen
                        </th>
                        <th className="w-[210px] p-2 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          Bodega origen
                        </th>
                        <th className="w-40 p-2 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          Ubicación origen
                        </th>
                        <th className="w-[190px] p-2 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          Almacén destino
                        </th>
                        <th className="w-[210px] p-2 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          Bodega destino
                        </th>
                        <th className="w-[90px] p-2 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          Cant. solicitada
                        </th>
                        {canConvertTransferRequests &&
                          detail.transferRequest.status === "pendiente" && (
                            <th className="w-[100px] p-2 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                              Enviar
                            </th>
                          )}
                        <th className="w-[90px] p-2 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          Exist. origen
                        </th>
                        <th className="w-[100px] p-2 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          Saldo al recibir
                        </th>
                        {canConvertTransferRequests &&
                          detail.transferRequest.status === "pendiente" && (
                            <th className="w-20 p-2 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                              Saldo
                            </th>
                          )}
                      </tr>
                    </thead>
                    <tbody>
                      {(detail.items || []).map((item: any) => {
                        const requestedQuantity = Number(item.quantity ?? 0);
                        const originOptions = getOriginStockOptions(item);
                        const originWarehouseOptions =
                          getOriginWarehouseOptions(item);
                        const selectedSourceValue =
                          getSelectedSourceValue(item);
                        const selectedSource =
                          parseTransferSourceOptionValue(selectedSourceValue);
                        const selectedSourceOption = originOptions.find(
                          (option: any) =>
                            getTransferSourceOptionValue(option) ===
                            selectedSourceValue
                        );
                        const selectedSourceWarehouseId =
                          getSelectedSourceWarehouseId(item);
                        const selectedSourceWarehouseValue =
                          selectedSourceWarehouseId
                            ? String(selectedSourceWarehouseId)
                            : undefined;
                        const sourceProjectOptions = getOriginProjectOptions(
                          item,
                          selectedSourceWarehouseId
                        );
                        const sourceStorageLocationOptions =
                          getSourceStorageLocationOptions(
                            item,
                            selectedSourceValue
                          );
                        const selectedSourceStorageLocationValue =
                          getSelectedSourceStorageLocationValue(item);
                        const originStockQuantity = canViewOriginQuantities
                          ? detail.transferRequest.status === "pendiente"
                            ? (getSelectedOriginStock(item) ?? 0)
                            : Number(item.originStockQuantity ?? 0)
                          : 0;

                        const transferQuantity =
                          detail.transferRequest.status === "pendiente"
                            ? getTransferQuantity(item)
                            : requestedQuantity;
                        const newStockQuantity = canViewOriginQuantities
                          ? detail.transferRequest.status === "pendiente"
                            ? originStockQuantity - transferQuantity
                            : Number(item.stockAfterTransfer ?? 0)
                          : null;
                        const pendingQuantity = Math.max(
                          requestedQuantity - transferQuantity,
                          0
                        );
                        const destinationWarehouseLabel =
                          detail.transferRequest.destinationType ===
                          "bodega_central"
                            ? "Se define en recepción"
                            : detail.transferRequest.destinationWarehouseId
                              ? getWarehouseLabel(detail.destinationWarehouse)
                              : "Seleccione almacén destino";
                        const destinationProjectOptions = projects ?? [];
                        const destinationProjectValue =
                          detail.transferRequest.destinationType === "proyecto"
                            ? (destinationProjectByRequestId[
                                detail.transferRequest.id
                              ] ??
                              String(
                                detail.transferRequest.destinationProjectId ??
                                  detail.materialRequest?.projectId ??
                                  detail.project?.id ??
                                  "destino"
                              ))
                            : "recepcion";
                        const selectedDestinationProject =
                          destinationProjectOptions.find(
                            (project: any) =>
                              String(project.id) === destinationProjectValue
                          ) ?? null;
                        const destinationProjectLabel =
                          detail.transferRequest.destinationType ===
                          "bodega_central"
                            ? "Se define en recepción"
                            : selectedDestinationProject
                              ? getProjectLabel(selectedDestinationProject)
                              : getRequestingProjectLabel(detail);
                        const destinationWarehouseValue =
                          destinationWarehouseByRequestId[
                            detail.transferRequest.id
                          ] ??
                          (detail.transferRequest.destinationWarehouseId
                            ? String(
                                detail.transferRequest.destinationWarehouseId
                              )
                            : detail.transferRequest.reverseLogisticId &&
                                detail.destinationWarehouse?.id
                              ? String(detail.destinationWarehouse.id)
                              : undefined);
                        const fallbackDestinationWarehouseOptions =
                          getDestinationProjectWarehouseOptions(
                            Number(destinationProjectValue)
                          );
                        const destinationWarehouseOptions =
                          destinationWarehouses &&
                          destinationWarehouses.some(
                            (warehouse: any) =>
                              fallbackDestinationWarehouseOptions.length ===
                                0 ||
                              fallbackDestinationWarehouseOptions.some(
                                (fallback: any) =>
                                  Number(fallback.id) === Number(warehouse.id)
                              )
                          )
                            ? destinationWarehouses
                            : fallbackDestinationWarehouseOptions;
                        const selectedDestinationIsAvailable =
                          destinationWarehouseValue &&
                          destinationWarehouseOptions.some(
                            (warehouse: any) =>
                              String(warehouse.id) === destinationWarehouseValue
                          );

                        return (
                          <tr
                            key={item.id}
                            className="border-b border-border last:border-0"
                          >
                            <td className="p-2 font-mono text-[11px] text-muted-foreground">
                              {item.sapItemCode || "-"}
                            </td>
                            <td className="p-2 text-xs">{item.itemName}</td>
                            <td className="p-2">
                              {canConvertTransferRequests &&
                              detail.transferRequest.status === "pendiente" ? (
                                <Select
                                  value={selectedSourceWarehouseValue}
                                  onValueChange={value =>
                                    handleSourceWarehouseChange(item, value)
                                  }
                                  disabled={
                                    convertMutation.isPending ||
                                    originStockLoading ||
                                    originWarehouseOptions.length === 0
                                  }
                                >
                                  <SelectTrigger className="h-9 w-full min-w-0 overflow-hidden px-2 text-xs">
                                    <SelectValue
                                      placeholder={
                                        originStockLoading
                                          ? "Cargando..."
                                          : "Seleccione almacén"
                                      }
                                    />
                                  </SelectTrigger>
                                  <SelectContent className="min-w-[var(--radix-select-trigger-width)]">
                                    {originWarehouseOptions.length === 0 ? (
                                      <SelectItem
                                        value="sin-existencia"
                                        disabled
                                      >
                                        {canViewOriginQuantities
                                          ? "Sin existencia disponible"
                                          : "Sin almacenes disponibles"}
                                      </SelectItem>
                                    ) : (
                                      originWarehouseOptions.map(
                                        (warehouse: any) => (
                                          <SelectItem
                                            key={warehouse.warehouseId}
                                            value={String(
                                              warehouse.warehouseId
                                            )}
                                            className="text-xs"
                                          >
                                            <span className="flex w-full min-w-0 items-center justify-between gap-3 pr-4">
                                              <span className="truncate">
                                                {getOriginWarehouseLabel(
                                                  warehouse
                                                )}
                                              </span>
                                              {canViewOriginQuantities ? (
                                                <QuantityPill
                                                  value={warehouse.quantity}
                                                  label="Disp."
                                                />
                                              ) : null}
                                            </span>
                                          </SelectItem>
                                        )
                                      )
                                    )}
                                  </SelectContent>
                                </Select>
                              ) : (
                                <p className="max-w-[220px] truncate text-xs font-medium">
                                  {getWarehouseLabel(item.sourceWarehouse)}
                                </p>
                              )}
                              {canConvertTransferRequests &&
                              detail.transferRequest.status === "pendiente" &&
                              !selectedSource &&
                              originOptions.length > 0 ? (
                                <p className="mt-1 text-[10px] text-muted-foreground">
                                  Requerida para convertir
                                </p>
                              ) : null}
                            </td>
                            <td className="p-2">
                              {canConvertTransferRequests &&
                              detail.transferRequest.status === "pendiente" ? (
                                <Select
                                  value={selectedSourceValue || undefined}
                                  onValueChange={value =>
                                    setSelectedSourceForItem(item, value)
                                  }
                                  disabled={
                                    convertMutation.isPending ||
                                    originStockLoading ||
                                    !selectedSourceWarehouseId ||
                                    sourceProjectOptions.length === 0
                                  }
                                >
                                  <SelectTrigger className="h-9 w-full min-w-0 overflow-hidden px-2 text-xs">
                                    <SelectValue
                                      placeholder={
                                        selectedSourceWarehouseId
                                          ? "Seleccione bodega origen"
                                          : "Seleccione almacén primero"
                                      }
                                    />
                                  </SelectTrigger>
                                  <SelectContent className="min-w-[var(--radix-select-trigger-width)]">
                                    {sourceProjectOptions.length === 0 ? (
                                      <SelectItem value="sin-bodegas" disabled>
                                        Sin bodegas para este almacén
                                      </SelectItem>
                                    ) : (
                                      sourceProjectOptions.map(
                                        (option: any) => {
                                          const optionValue =
                                            getTransferSourceOptionValue(
                                              option
                                            );
                                          return (
                                            <SelectItem
                                              key={optionValue}
                                              value={optionValue}
                                              className="text-xs"
                                            >
                                              <span className="flex w-full min-w-0 items-center justify-between gap-3 pr-4">
                                                <span className="truncate">
                                                  {getOriginProjectLabel(
                                                    option
                                                  )}
                                                </span>
                                                {canViewOriginQuantities ? (
                                                  <QuantityPill
                                                    value={option.quantity}
                                                    label="Disp."
                                                  />
                                                ) : null}
                                              </span>
                                            </SelectItem>
                                          );
                                        }
                                      )
                                    )}
                                  </SelectContent>
                                </Select>
                              ) : (
                                <p className="max-w-[260px] truncate text-xs font-medium">
                                  {selectedSourceOption
                                    ? getOriginProjectLabel(
                                        selectedSourceOption
                                      )
                                    : getProjectLabel(detail.project)}
                                </p>
                              )}
                            </td>
                            <td className="p-2">
                              {canConvertTransferRequests &&
                              detail.transferRequest.status === "pendiente" ? (
                                <Select
                                  value={
                                    selectedSourceStorageLocationValue ||
                                    undefined
                                  }
                                  onValueChange={value =>
                                    handleSourceStorageLocationChange(
                                      item,
                                      value
                                    )
                                  }
                                  disabled={
                                    convertMutation.isPending ||
                                    originStockLoading ||
                                    !selectedSource ||
                                    sourceStorageLocationOptions.length === 0
                                  }
                                >
                                  <SelectTrigger className="h-9 w-full min-w-0 overflow-hidden px-2 text-xs">
                                    <SelectValue
                                      placeholder={
                                        selectedSource
                                          ? "Seleccione ubicación"
                                          : "Seleccione bodega"
                                      }
                                    />
                                  </SelectTrigger>
                                  <SelectContent className="min-w-[var(--radix-select-trigger-width)]">
                                    {sourceStorageLocationOptions.length ===
                                    0 ? (
                                      <SelectItem
                                        value="sin-ubicaciones"
                                        disabled
                                      >
                                        Sin ubicaciones con stock
                                      </SelectItem>
                                    ) : (
                                      sourceStorageLocationOptions.map(
                                        (location: any) => {
                                          const locationValue =
                                            encodeSourceStorageLocationValue(
                                              location.storageLocation
                                            );
                                          return (
                                            <SelectItem
                                              key={locationValue}
                                              value={locationValue}
                                              className="text-xs"
                                            >
                                              <span className="flex w-full min-w-0 items-center justify-between gap-3 pr-4">
                                                <span className="truncate">
                                                  {getSourceStorageLocationLabel(
                                                    location.storageLocation
                                                  )}
                                                </span>
                                                {canViewOriginQuantities ? (
                                                  <QuantityPill
                                                    value={location.quantity}
                                                    label="Disp."
                                                  />
                                                ) : null}
                                              </span>
                                            </SelectItem>
                                          );
                                        }
                                      )
                                    )}
                                  </SelectContent>
                                </Select>
                              ) : (
                                <p className="max-w-[180px] truncate text-xs font-medium">
                                  {getSourceStorageLocationLabel(
                                    item.sourceStorageLocation
                                  )}
                                </p>
                              )}
                            </td>
                            <td className="p-2">
                              {canEditDestinationWarehouse ? (
                                <Select
                                  value={
                                    selectedDestinationIsAvailable
                                      ? destinationWarehouseValue
                                      : undefined
                                  }
                                  onValueChange={
                                    handleDestinationWarehouseChange
                                  }
                                  disabled={
                                    destinationWarehousesLoading ||
                                    updateDestinationWarehouseMutation.isPending ||
                                    destinationWarehouseOptions.length === 0
                                  }
                                >
                                  <SelectTrigger className="h-9 w-full min-w-0 overflow-hidden px-2 text-xs">
                                    <SelectValue
                                      placeholder={
                                        destinationWarehousesLoading
                                          ? "Cargando..."
                                          : destinationWarehouseLabel
                                      }
                                    />
                                  </SelectTrigger>
                                  <SelectContent className="min-w-[var(--radix-select-trigger-width)]">
                                    {destinationWarehouseOptions.length ===
                                    0 ? (
                                      <SelectItem value="sin-bodegas" disabled>
                                        Sin bodegas asignadas
                                      </SelectItem>
                                    ) : (
                                      destinationWarehouseOptions.map(
                                        (warehouse: any) => (
                                          <SelectItem
                                            key={warehouse.id}
                                            value={String(warehouse.id)}
                                            className="text-xs"
                                          >
                                            {getWarehouseLabel(warehouse)}
                                          </SelectItem>
                                        )
                                      )
                                    )}
                                  </SelectContent>
                                </Select>
                              ) : (
                                <p className="max-w-[220px] truncate text-xs font-medium">
                                  {destinationWarehouseLabel}
                                </p>
                              )}
                            </td>
                            <td className="p-2">
                              {detail.transferRequest.destinationType ===
                              "proyecto" ? (
                                <Select
                                  value={destinationProjectValue}
                                  onValueChange={handleDestinationProjectChange}
                                  disabled={
                                    !canEditDestinationWarehouse ||
                                    updateDestinationWarehouseMutation.isPending
                                  }
                                >
                                  <SelectTrigger className="h-9 w-full min-w-0 overflow-hidden px-2 text-xs">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent className="min-w-[var(--radix-select-trigger-width)]">
                                    {destinationProjectOptions.map(
                                      (project: any) => (
                                        <SelectItem
                                          key={project.id}
                                          value={String(project.id)}
                                          className="text-xs"
                                        >
                                          {getProjectLabel(project)}
                                        </SelectItem>
                                      )
                                    )}
                                  </SelectContent>
                                </Select>
                              ) : (
                                <p className="max-w-[260px] truncate text-xs font-medium">
                                  {destinationProjectLabel}
                                </p>
                              )}
                            </td>
                            <td className="p-2 text-right">
                              <QuantityPill
                                value={requestedQuantity}
                                unit={item.unit}
                                tone="info"
                              />
                            </td>
                            {canConvertTransferRequests &&
                              detail.transferRequest.status === "pendiente" && (
                                <td className="p-2">
                                  <Input
                                    value={
                                      transferQuantityByItemId[item.id] ??
                                      (canViewOriginQuantities
                                        ? Math.min(
                                            requestedQuantity,
                                            originStockQuantity
                                          ).toFixed(2)
                                        : selectedSource
                                          ? requestedQuantity.toFixed(2)
                                          : "0.00")
                                    }
                                    onChange={event =>
                                      setTransferQuantityByItemId(current => ({
                                        ...current,
                                        [item.id]: event.target.value,
                                      }))
                                    }
                                    type="number"
                                    min="0"
                                    max={Math.min(
                                      requestedQuantity,
                                      canViewOriginQuantities
                                        ? originStockQuantity
                                        : requestedQuantity
                                    )}
                                    step="any"
                                    className="ml-auto h-9 w-28 border-sky-200 bg-sky-50 text-right font-mono font-semibold text-sky-700 focus-visible:ring-sky-200"
                                    disabled={
                                      convertMutation.isPending ||
                                      !selectedSource ||
                                      !selectedSourceStorageLocationValue ||
                                      originStockLoading
                                    }
                                  />
                                  {!selectedSource ||
                                  !selectedSourceStorageLocationValue ? (
                                    <p className="mt-1 text-right text-[10px] text-muted-foreground">
                                      Seleccione origen y ubicación
                                    </p>
                                  ) : null}
                                </td>
                              )}
                            <td className="p-2 text-right">
                              {!canViewOriginQuantities ? (
                                selectedSource ? (
                                  <span className="text-xs text-muted-foreground">
                                    Oculto
                                  </span>
                                ) : (
                                  <span className="text-xs text-muted-foreground">
                                    Por definir
                                  </span>
                                )
                              ) : originStockLoading &&
                                detail.transferRequest.status ===
                                  "pendiente" ? (
                                <span className="text-xs text-muted-foreground">
                                  Cargando...
                                </span>
                              ) : (!selectedSource ||
                                  !selectedSourceStorageLocationValue) &&
                                detail.transferRequest.status ===
                                  "pendiente" ? (
                                <span className="text-xs text-muted-foreground">
                                  Por definir
                                </span>
                              ) : (
                                <QuantityPill
                                  value={originStockQuantity}
                                  unit={item.unit}
                                  label="Disp."
                                />
                              )}
                            </td>
                            <td className="p-2 text-right font-medium">
                              {canViewOriginQuantities &&
                              newStockQuantity !== null ? (
                                <QuantityPill
                                  value={newStockQuantity}
                                  unit={item.unit}
                                  tone={
                                    newStockQuantity < 0
                                      ? "danger"
                                      : "available"
                                  }
                                />
                              ) : (
                                <span className="text-xs text-muted-foreground">
                                  Oculto
                                </span>
                              )}
                            </td>
                            {canConvertTransferRequests &&
                              detail.transferRequest.status === "pendiente" && (
                                <td className="p-2 text-right">
                                  <QuantityPill
                                    value={pendingQuantity}
                                    unit={item.unit}
                                    tone={
                                      pendingQuantity > 0
                                        ? "warning"
                                        : "neutral"
                                    }
                                  />
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

                <DocumentAttachmentsPanel
                  entityType="transfer_request"
                  entityId={detail.transferRequest.id}
                  title="Archivos adjuntos"
                  canManage
                  canDelete={false}
                />

                {canConvertTransferRequests || canCancelTransferRequests ? (
                  <div className="sticky bottom-0 z-10 -mx-4 border-t border-border bg-background/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
                    <div className="flex flex-wrap justify-end gap-2">
                      {canCancelTransferRequests &&
                      detail.transferRequest.status === "pendiente" ? (
                        <Button
                          variant="outline"
                          className="border-rose-200 text-rose-700 hover:bg-rose-50 hover:text-rose-800"
                          onClick={() =>
                            setConfirmCancelId(detail.transferRequest.id)
                          }
                          disabled={
                            cancelMutation.isPending ||
                            convertMutation.isPending
                          }
                        >
                          <Ban className="mr-2 h-4 w-4" />
                          Cancelar solicitud
                        </Button>
                      ) : null}
                      {canConvertTransferRequests ? (
                        <Button
                          onClick={handleConvertToTransfer}
                          disabled={
                            convertMutation.isPending ||
                            updateDestinationWarehouseMutation.isPending ||
                            originStockLoading ||
                            detail.transferRequest.status !== "pendiente"
                          }
                        >
                          <Truck className="mr-2 h-4 w-4" />
                          {convertMutation.isPending
                            ? "Generando..."
                            : preparedMovementKind === "internal"
                              ? "Confirmar reubicación"
                              : "Convertir a traslado"}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(confirmCancelId)}
        onOpenChange={open => {
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
                    . El detalle no se borra, pero los ítems volverán a quedar
                    habilitados en la requisición.
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
                onClick={event => {
                  event.preventDefault();
                  if (!confirmCancelId) return;
                  cancelMutation.mutate({ id: confirmCancelId });
                }}
                disabled={cancelMutation.isPending}
              >
                {cancelMutation.isPending
                  ? "Cancelando..."
                  : "Confirmar cancelación"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
