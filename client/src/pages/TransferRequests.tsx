import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DocumentAttachmentsPanel } from "@/components/DocumentAttachmentsPanel";
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
  const allowManualTransferRequests = false;
  const buildreqRole = (user as any)?.buildreqRole;
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
  const { data: transferRequests, isLoading } = trpc.transferRequests.list.useQuery();
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
  const canEditDestinationWarehouse =
    canConvertTransferRequests &&
    detail?.transferRequest.status === "pendiente" &&
    detail?.transferRequest.destinationType === "proyecto" &&
    !detail?.transferRequest.reverseLogisticId &&
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

  const updateDestinationWarehouseMutation =
    trpc.transferRequests.updateDestinationWarehouse.useMutation({
      onSuccess: () => {
        toast.success("Bodega destino actualizada");
        void Promise.all([
          utils.transferRequests.list.invalidate(),
          detailId
            ? utils.transferRequests.getById.invalidate({ id: detailId })
            : Promise.resolve(),
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
    const requestId = detail?.transferRequest.id;
    if (!requestId) return;

    const destinationProjectId =
      detail.transferRequest.destinationProjectId ??
      detail.materialRequest?.projectId ??
      detail.project?.id ??
      null;
    const destinationWarehouseId =
      detail.destinationWarehouse?.id ??
      detail.transferRequest.destinationWarehouseId ??
      null;

    setDestinationProjectByRequestId((current) => {
      if (current[requestId] || !destinationProjectId) return current;
      return {
        ...current,
        [requestId]: String(destinationProjectId),
      };
    });
    setDestinationWarehouseByRequestId((current) => {
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
        nextSourceStorageLocations[item.id] =
          encodeSourceStorageLocationValue(item.sourceStorageLocation);
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
    const options =
      (originStockRowsByItemId.get(item.id) as any)?.warehouses ?? [];
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
      if (!current || getPreferenceScore(option) > getPreferenceScore(current)) {
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
        quantity:
          Number(existing.quantity ?? 0) + Number(option.quantity ?? 0),
      });
    }

    return Array.from(byWarehouse.values()).sort((left, right) =>
      getOriginWarehouseLabel(left).localeCompare(getOriginWarehouseLabel(right))
    );
  };

  const getSelectedSourceWarehouseId = (item: any) => {
    const explicitWarehouseId = Number(sourcePhysicalWarehouseByItemId[item.id]);
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
        return getSourceStorageLocationLabel(left.storageLocation).localeCompare(
          getSourceStorageLocationLabel(right.storageLocation)
        );
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
    const currentStorageLocationValue = getSelectedSourceStorageLocationValue(item);
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

    setSourceWarehouseByItemId((current) => ({
      ...current,
      [item.id]: value,
    }));
    if (selectedSource?.warehouseId) {
      setSourcePhysicalWarehouseByItemId((current) => ({
        ...current,
        [item.id]: String(selectedSource.warehouseId),
      }));
    }
    setSourceStorageLocationByItemId((current) => {
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
    setTransferQuantityByItemId((current) => ({
      ...current,
      [item.id]: suggestedQuantity.toFixed(2),
    }));
  };

  const clearSelectedSourceForItem = (item: any) => {
    setSourceWarehouseByItemId((current) => {
      const next = { ...current };
      delete next[item.id];
      return next;
    });
    setTransferQuantityByItemId((current) => ({
      ...current,
      [item.id]: "0.00",
    }));
    setSourceStorageLocationByItemId((current) => {
      const next = { ...current };
      delete next[item.id];
      return next;
    });
  };

  const handleSourceWarehouseChange = (item: any, value: string) => {
    const warehouseId = Number(value);
    setSourcePhysicalWarehouseByItemId((current) => ({
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

    setSourceStorageLocationByItemId((current) => ({
      ...current,
      [item.id]: value,
    }));
    setTransferQuantityByItemId((current) => ({
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

      const options = getSourceStorageLocationOptions(item, selectedSourceValue);
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
        const availableQuantity = Number(options[0].quantity ?? requestedQuantity);
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
      setTransferQuantityByItemId((current) => ({
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

    const assignedWarehouses = getDestinationProjectWarehouseOptions(projectId);
    const warehouseId = Number(assignedWarehouses[0]?.id);
    if (!Number.isInteger(warehouseId) || warehouseId <= 0) {
      toast.error("La bodega destino seleccionada no tiene almacén asignado");
      return;
    }

    setDestinationProjectByRequestId((current) => ({
      ...current,
      [requestId]: value,
    }));
    setDestinationWarehouseByRequestId((current) => ({
      ...current,
      [requestId]: String(warehouseId),
    }));
    updateDestinationWarehouseMutation.mutate({
      id: requestId,
      projectId,
      warehouseId,
    });
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

    setDestinationWarehouseByRequestId((current) => ({
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
      (entry: any) =>
        getTransferSourceOptionValue(entry) === selectedValue
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
            ? item.quantity ?? 0
            : 0
          : detail?.transferRequest.status === "pendiente"
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
        toast.error(`La cantidad a enviar de ${item.itemName} no puede exceder lo solicitado`);
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
        toast.error(`No hay suficiente existencia para enviar ${item.itemName}`);
        return null;
      }

      return {
        transferRequestItemId: item.id,
        quantity: transferQuantity.toFixed(2),
        sourceProjectId: selectedSource ? selectedSource.projectId : undefined,
        sourceWarehouseId: selectedSource?.warehouseId,
        sourceStorageLocation: selectedStorageLocationValue
          ? decodeSourceStorageLocationValue(selectedStorageLocationValue)
          : undefined,
      };
    });

    if (items.some((item: TransferConversionItem | null) => item === null)) {
      return;
    }
    const validItems = items.filter(
      (item: TransferConversionItem | null): item is TransferConversionItem =>
        Boolean(item)
    );

    if (
      !validItems.some((item: TransferConversionItem) => Number(item.quantity) > 0)
    ) {
      toast.error("Debe enviar al menos una cantidad mayor que cero");
      return;
    }
    const sourceOriginKeys = Array.from(
      new Set(
        validItems
          .filter((item: TransferConversionItem) => Number(item.quantity) > 0)
          .map((item: TransferConversionItem) =>
            typeof item.sourceProjectId === "number"
              ? `project:${item.sourceProjectId}`
              : CENTRAL_SOURCE_PROJECT_KEY
          )
      )
    );
    if (sourceOriginKeys.length > 1) {
      toast.error("Seleccione bodegas origen del mismo proyecto para convertir esta solicitud");
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
                        <SelectItem value="bodega_central">
                          Proyecto/bodega en recepción
                        </SelectItem>
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
        <DialogContent className="scrollbar-visible !h-[calc(100dvh-0.5rem)] !max-h-[calc(100dvh-0.5rem)] !w-[calc(100vw-0.5rem)] !max-w-[calc(100vw-0.5rem)] overflow-x-hidden overflow-y-auto rounded-2xl p-4 sm:!h-[calc(100dvh-1rem)] sm:!max-h-[calc(100dvh-1rem)] sm:!w-[calc(100vw-1rem)] sm:!max-w-[calc(100vw-1rem)] sm:p-6 lg:p-7 xl:!max-w-[1900px]">
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
                  <Label className="text-xs text-muted-foreground">Almacén origen</Label>
                  <p className="text-sm font-medium">
                    {getSourceWarehouseSummary(detail)}
                  </p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Almacén destino</Label>
                  <p className="text-sm font-medium">
                    {getDestinationWarehouseSummary(detail)}
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

              <div className="overflow-x-auto rounded border border-border">
                <table className="w-full min-w-[1880px] table-fixed text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="w-20 p-2 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Código
                      </th>
                      <th className="w-44 p-2 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Ítem
                      </th>
                      <th className="w-56 p-2 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Almacén origen
                      </th>
                      <th className="w-64 p-2 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Bodega origen
                      </th>
                      <th className="w-52 p-2 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Ubicación origen
                      </th>
                      <th className="w-56 p-2 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Almacén destino
                      </th>
                      <th className="w-64 p-2 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Bodega destino
                      </th>
                      <th className="w-24 p-2 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Cant. solicitada
                      </th>
                      {canConvertTransferRequests &&
                        detail.transferRequest.status === "pendiente" && (
                        <th className="w-28 p-2 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          Enviar
                        </th>
                      )}
                      <th className="w-24 p-2 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Exist. origen
                      </th>
                      <th className="w-28 p-2 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
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
                      const selectedSourceValue = getSelectedSourceValue(item);
                      const selectedSource = parseTransferSourceOptionValue(
                        selectedSourceValue
                      );
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
                        detail.transferRequest.destinationType === "bodega_central"
                          ? "Se define en recepción"
                          : getWarehouseLabel(detail.destinationWarehouse);
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
                        (detail.destinationWarehouse?.id
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
                            fallbackDestinationWarehouseOptions.length === 0 ||
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
                        <tr key={item.id} className="border-b border-border last:border-0">
                          <td className="p-2 font-mono text-[11px] text-muted-foreground">
                            {item.sapItemCode || "-"}
                          </td>
                          <td className="p-2 text-xs">{item.itemName}</td>
                          <td className="p-2">
                            {canConvertTransferRequests &&
                            detail.transferRequest.status === "pendiente" ? (
                              <Select
                                value={selectedSourceWarehouseValue}
                                onValueChange={(value) =>
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
                                    <SelectItem value="sin-existencia" disabled>
                                      {canViewOriginQuantities
                                        ? "Sin existencia disponible"
                                        : "Sin almacenes disponibles"}
                                    </SelectItem>
                                  ) : (
                                    originWarehouseOptions.map((warehouse: any) => (
                                      <SelectItem
                                        key={warehouse.warehouseId}
                                        value={String(warehouse.warehouseId)}
                                        className="text-xs"
                                      >
                                        <span className="flex w-full min-w-0 items-center justify-between gap-3 pr-4">
                                          <span className="truncate">
                                            {getOriginWarehouseLabel(warehouse)}
                                          </span>
                                          {canViewOriginQuantities ? (
                                            <QuantityPill
                                              value={warehouse.quantity}
                                              label="Disp."
                                            />
                                          ) : null}
                                        </span>
                                      </SelectItem>
                                    ))
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
                                onValueChange={(value) =>
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
                                    sourceProjectOptions.map((option: any) => {
                                      const optionValue =
                                        getTransferSourceOptionValue(option);
                                      return (
                                        <SelectItem
                                          key={optionValue}
                                          value={optionValue}
                                          className="text-xs"
                                        >
                                          <span className="flex w-full min-w-0 items-center justify-between gap-3 pr-4">
                                            <span className="truncate">
                                              {getOriginProjectLabel(option)}
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
                                    })
                                  )}
                                </SelectContent>
                              </Select>
                            ) : (
                              <p className="max-w-[260px] truncate text-xs font-medium">
                                {selectedSourceOption
                                  ? getOriginProjectLabel(selectedSourceOption)
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
                                onValueChange={(value) =>
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
                                  {sourceStorageLocationOptions.length === 0 ? (
                                    <SelectItem value="sin-ubicaciones" disabled>
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
                                onValueChange={handleDestinationWarehouseChange}
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
                                  {destinationWarehouseOptions.length === 0 ? (
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
                                onChange={(event) =>
                                  setTransferQuantityByItemId((current) => ({
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
                            detail.transferRequest.status === "pendiente" ? (
                              <span className="text-xs text-muted-foreground">
                                Cargando...
                              </span>
                            ) : (!selectedSource ||
                              !selectedSourceStorageLocationValue) &&
                              detail.transferRequest.status === "pendiente" ? (
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
                          <td
                            className="p-2 text-right font-medium"
                          >
                            {canViewOriginQuantities && newStockQuantity !== null ? (
                              <QuantityPill
                                value={newStockQuantity}
                                unit={item.unit}
                                tone={
                                  newStockQuantity < 0 ? "danger" : "available"
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
                                tone={pendingQuantity > 0 ? "warning" : "neutral"}
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
                <div className="flex justify-end">
                <div className="flex flex-wrap justify-end gap-2">
                  {canCancelTransferRequests &&
                  detail.transferRequest.status === "pendiente" ? (
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
                  {canConvertTransferRequests ? (
                    <Button
                      onClick={handleConvertToTransfer}
                      disabled={
                        convertMutation.isPending ||
                        originStockLoading ||
                        detail.transferRequest.status !== "pendiente"
                      }
                    >
                      <Truck className="mr-2 h-4 w-4" />
                      {convertMutation.isPending ? "Generando..." : "Convertir a traslado"}
                    </Button>
                  ) : null}
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
