import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import {
  ArrowUpDown,
  ArrowRightLeft,
  BookOpen,
  Check,
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  ClipboardList,
  Search,
  Warehouse,
} from "lucide-react";
import { Fragment, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

type InventorySortField =
  | "sapItemCode"
  | "name"
  | "brand"
  | "partNumber"
  | "category"
  | "unit"
  | "currentStock"
  | "minimumStock"
  | "warehouseLocation"
  | "projectName";

type SortDirection = "asc" | "desc";
type BulkAssignmentMode = "selected" | "filtered";

const PAGE_SIZE = 25;

const columns: Array<{
  key: InventorySortField;
  label: string;
  align?: "left" | "right";
}> = [
  { key: "sapItemCode", label: "Código SAP" },
  { key: "name", label: "Nombre" },
  { key: "brand", label: "Marca" },
  { key: "partNumber", label: "No. parte" },
  { key: "category", label: "Categoría" },
  { key: "unit", label: "Unidad" },
  { key: "currentStock", label: "Stock", align: "right" },
  { key: "minimumStock", label: "Mínimo", align: "right" },
  { key: "projectName", label: "Proyecto" },
  { key: "warehouseLocation", label: "Almacén" },
];

function buildPageItems(currentPage: number, totalPages: number) {
  if (totalPages <= 1) return [1];
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  if (currentPage <= 3) {
    return [1, 2, 3, 4, "ellipsis", totalPages] as const;
  }

  if (currentPage >= totalPages - 2) {
    return [1, "ellipsis", totalPages - 3, totalPages - 2, totalPages - 1, totalPages] as const;
  }

  return [1, "ellipsis", currentPage - 1, currentPage, currentPage + 1, "ellipsis", totalPages] as const;
}

function formatDate(value: string | Date | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("es-HN");
}

function formatQuantity(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return "0.00";
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  return numeric.toLocaleString("es-HN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function parseQuantity(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return 0;
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function formatProject(project: any | null | undefined) {
  if (!project) return "Inventario Central";
  return `${project.code} - ${project.name}`;
}

function formatWarehouseOptionLabel(warehouse: any | null | undefined) {
  if (!warehouse) return "—";
  const localCode = warehouse.localCode || warehouse.code;
  if (localCode && warehouse.name) return `${localCode} - ${warehouse.name}`;
  return warehouse.displayName || warehouse.name || warehouse.code || "—";
}

function formatWarehouseProjectLabel(warehouse: any | null | undefined) {
  return warehouse?.displayName ?? "";
}

function formatStatus(status: string | null | undefined) {
  if (!status) return "—";
  return status.replace(/_/g, " ");
}

function formatMovementType(type: string) {
  const labels: Record<string, string> = {
    saldo_inicial: "Saldo inicial",
    recepcion_oc: "Recepción OC",
    recepcion_traslado: "Recepción traslado",
    despacho_bodega: "Despacho",
    salida_traslado: "Salida traslado",
  };
  return labels[type] ?? type.replace(/_/g, " ");
}

export default function Inventario() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [globalSearch, setGlobalSearch] = useState("");
  const [debouncedGlobalSearch, setDebouncedGlobalSearch] = useState("");
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState<InventorySortField>("name");
  const [sortDir, setSortDir] = useState<SortDirection>("asc");
  const [warehouseFilter, setWarehouseFilter] = useState("all");
  const [projectFilter, setProjectFilter] = useState("all");
  const [projectFilterOpen, setProjectFilterOpen] = useState(false);
  const [warehouseFilterOpen, setWarehouseFilterOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [assignmentDialogOpen, setAssignmentDialogOpen] = useState(false);
  const [bulkAssignmentDialogOpen, setBulkAssignmentDialogOpen] = useState(false);
  const [bulkAssignmentMode, setBulkAssignmentMode] =
    useState<BulkAssignmentMode>("selected");
  const [selectedItem, setSelectedItem] = useState<any | null>(null);
  const [trackingItem, setTrackingItem] = useState<any | null>(null);
  const [kardexItem, setKardexItem] = useState<any | null>(null);
  const [expandedInventoryKeys, setExpandedInventoryKeys] = useState<string[]>([]);
  const [assignmentProjectId, setAssignmentProjectId] = useState("none");
  const [bulkAssignmentProjectId, setBulkAssignmentProjectId] = useState("none");
  const [selectedItemIds, setSelectedItemIds] = useState<number[]>([]);

  const [sapItemCode, setSapItemCode] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [unit, setUnit] = useState("");
  const [category, setCategory] = useState("");
  const [currentStock, setCurrentStock] = useState("");
  const [minimumStock, setMinimumStock] = useState("");
  const [projectId, setProjectId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
    }, 250);

    return () => window.clearTimeout(timeoutId);
  }, [search]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedGlobalSearch(globalSearch.trim());
    }, 250);

    return () => window.clearTimeout(timeoutId);
  }, [globalSearch]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, warehouseFilter, projectFilter]);

  const userRole = (user as any)?.buildreqRole || "";
  const assignedProjectIds = useMemo(() => {
    const ids = (user as any)?.assignedProjectIds;
    if (Array.isArray(ids) && ids.length > 0) {
      return ids.map(Number).filter((id) => Number.isInteger(id) && id > 0);
    }
    return (user as any)?.assignedProjectId ? [(user as any).assignedProjectId] : [];
  }, [user]);
  const canManage =
    userRole === "jefe_bodega_central" || user?.role === "admin";
  const canAccessWarehouses =
    canManage ||
    userRole === "administracion_central" ||
    userRole === "administrador_proyecto" ||
    userRole === "bodeguero_proyecto";
  const canUseGlobalAvailability =
    canAccessWarehouses || user?.role === "admin";
  const allowInventoryReassignment = false;

  const { data: projects } = trpc.projects.list.useQuery();

  const { data: warehouses, isLoading: warehousesLoading } =
    trpc.warehouses.list.useQuery(undefined, {
      enabled: canAccessWarehouses,
    });
  const warehouseOptions = useMemo(() => {
    const allWarehouses = warehouses ?? [];
    if (projectFilter === "all") return allWarehouses;
    const selectedProject = (projects ?? []).find(
      (project: any) => String(project.id) === projectFilter
    );
    return selectedProject?.warehouse ? [selectedProject.warehouse] : [];
  }, [projectFilter, projects, warehouses]);
  const selectedFilterProject = useMemo(
    () =>
      projectFilter === "all"
        ? null
        : (projects ?? []).find(
            (project: any) => String(project.id) === projectFilter
          ) ?? null,
    [projectFilter, projects]
  );
  const selectedFilterWarehouse = useMemo(
    () =>
      warehouseFilter === "all"
        ? null
        : warehouseOptions.find(
            (warehouse: any) => String(warehouse.id) === warehouseFilter
          ) ?? null,
    [warehouseFilter, warehouseOptions]
  );
  const selectedProjectFilterLabel = selectedFilterProject
    ? `${selectedFilterProject.code} - ${selectedFilterProject.name}`
    : `Todos los proyectos (${(projects ?? []).length.toLocaleString("es-HN")})`;
  const allWarehouseFilterLabel = selectedFilterProject
    ? `Bodega asignada de ${selectedFilterProject.code}`
    : `Todos los almacenes (${warehouseOptions.length.toLocaleString("es-HN")})`;
  const selectedWarehouseFilterLabel = selectedFilterWarehouse
    ? formatWarehouseOptionLabel(selectedFilterWarehouse)
    : allWarehouseFilterLabel;
  const centralWarehouses = useMemo(
    () => warehouses ?? [],
    [warehouses]
  );
  const selectedCreateProject = useMemo(
    () =>
      (projects ?? []).find((project: any) => String(project.id) === projectId) ?? null,
    [projectId, projects]
  );
  const createProjectWarehouses = useMemo(
    () =>
      selectedCreateProject?.warehouse ? [selectedCreateProject.warehouse] : [],
    [selectedCreateProject]
  );
  const defaultCreateWarehouse = useMemo(
    () => createProjectWarehouses[0] ?? null,
    [createProjectWarehouses]
  );
  const selectedAssignmentProject = useMemo(
    () =>
      assignmentProjectId === "none"
        ? null
        : (projects ?? []).find(
            (project: any) => String(project.id) === assignmentProjectId
          ) ?? null,
    [assignmentProjectId, projects]
  );
  const selectedBulkProject = useMemo(
    () =>
      bulkAssignmentProjectId === "none"
        ? null
        : (projects ?? []).find(
            (project: any) => String(project.id) === bulkAssignmentProjectId
          ) ?? null,
    [bulkAssignmentProjectId, projects]
  );

  useEffect(() => {
    if (
      (userRole === "administrador_proyecto" ||
        userRole === "bodeguero_proyecto") &&
      assignedProjectIds.length === 1 &&
      projectFilter === "all"
    ) {
      setProjectFilter(String(assignedProjectIds[0]));
    }
  }, [assignedProjectIds, projectFilter, userRole]);

  useEffect(() => {
    if (!projectId) return;
    setWarehouseId(defaultCreateWarehouse ? String(defaultCreateWarehouse.id) : "");
  }, [defaultCreateWarehouse, projectId]);

  useEffect(() => {
    if (warehouseFilter === "all") return;
    const selectedWarehouseBelongsToProject = warehouseOptions.some(
      (warehouse: any) => String(warehouse.id) === warehouseFilter
    );
    if (!selectedWarehouseBelongsToProject) {
      setWarehouseFilter("all");
    }
  }, [warehouseFilter, warehouseOptions]);

  const queryInput = {
    search: debouncedSearch || undefined,
    projectId:
      projectFilter === "all" ? undefined : Number(projectFilter),
    warehouseId:
      warehouseFilter === "all" ? undefined : Number(warehouseFilter),
  };

  const listQueryInput = {
    ...queryInput,
    page,
    pageSize: PAGE_SIZE,
    sortBy,
    sortDir,
  };

  const {
    data,
    isLoading,
    isFetching,
    error,
    refetch,
  } = trpc.inventory.list.useQuery(listQueryInput, {
    placeholderData: (previousData) => previousData,
  });
  const globalAvailabilityQuery =
    trpc.inventory.globalAvailability.useQuery(
      {
        search: debouncedGlobalSearch,
        limit: 80,
      },
      {
        enabled:
          canUseGlobalAvailability && debouncedGlobalSearch.length >= 2,
      }
    );

  const trackingQuery = trpc.inventory.tracking.useQuery(
    {
      sapItemCode: trackingItem?.sapItemCode ?? "",
      projectId: trackingItem?.project?.id ?? undefined,
      warehouseId:
        trackingItem?.warehouse?.id ?? trackingItem?.warehouseId ?? undefined,
      warehouseLocation: trackingItem?.warehouseLocation ?? undefined,
    },
    {
      enabled: Boolean(trackingItem?.sapItemCode),
    }
  );

  const kardexQuery = trpc.inventory.kardex.useQuery(
    {
      sapItemCode: kardexItem?.sapItemCode ?? "",
      projectId: kardexItem?.project?.id ?? undefined,
      warehouseId: kardexItem?.warehouse?.id ?? kardexItem?.warehouseId ?? undefined,
      warehouseLocation: kardexItem?.warehouseLocation ?? undefined,
    },
    {
      enabled: Boolean(kardexItem?.sapItemCode),
    }
  );

  useEffect(() => {
    if (data?.page && data.page !== page) {
      setPage(data.page);
    }
  }, [data?.page, page]);

  const createMutation = trpc.inventory.create.useMutation({
    onSuccess: () => {
      toast.success("Ítem de inventario creado");
      void Promise.all([
        utils.inventory.list.invalidate(),
        utils.warehouses.list.invalidate(),
        utils.projects.list.invalidate(),
      ]);
      setDialogOpen(false);
      resetForm();
    },
    onError: (e) => toast.error(e.message),
  });

  const updateMutation = trpc.inventory.update.useMutation({
    onSuccess: () => {
      toast.success("Proyecto del inventario actualizado");
      void Promise.all([
        utils.inventory.list.invalidate(),
        utils.warehouses.list.invalidate(),
        utils.projects.list.invalidate(),
      ]);
      setAssignmentDialogOpen(false);
      setSelectedItem(null);
      setAssignmentProjectId("none");
    },
    onError: (e) => toast.error(e.message),
  });

  const bulkAssignMutation = trpc.inventory.bulkAssignProject.useMutation({
    onSuccess: (result: any) => {
      toast.success(
        `${result.updatedCount.toLocaleString("es-HN")} ítems actualizados`
      );
      void Promise.all([
        utils.inventory.list.invalidate(),
        utils.warehouses.list.invalidate(),
        utils.projects.list.invalidate(),
      ]);
      setBulkAssignmentDialogOpen(false);
      setBulkAssignmentProjectId("none");
      setSelectedItemIds([]);
    },
    onError: (e) => toast.error(e.message),
  });

  const bulkAssignFilteredMutation =
    trpc.inventory.bulkAssignProjectByFilters.useMutation({
      onSuccess: (result: any) => {
        toast.success(
          `${result.updatedCount.toLocaleString("es-HN")} ítems del resultado actual procesados`
        );
        void Promise.all([
          utils.inventory.list.invalidate(),
          utils.warehouses.list.invalidate(),
          utils.projects.list.invalidate(),
        ]);
        setBulkAssignmentDialogOpen(false);
        setBulkAssignmentProjectId("none");
        setSelectedItemIds([]);
      },
      onError: (e) => toast.error(e.message),
    });

  const resetForm = () => {
    setSapItemCode("");
    setName("");
    setDescription("");
    setUnit("");
    setCategory("");
    setCurrentStock("");
    setMinimumStock("");
    setProjectId("");
    setWarehouseId("");
  };

  const items = data?.items || [];
  const groupedItems = useMemo(() => {
    const groups = new Map<string, any>();

    for (const item of items as any[]) {
      const projectKey = item.project?.id ? `project:${item.project.id}` : "central";
      const itemKey = item.sapItemCode?.trim() || item.name?.trim().toLowerCase();
      const groupKey = `${projectKey}:${itemKey}`;
      const existing =
        groups.get(groupKey) ??
        {
          ...item,
          id: groupKey,
          sourceIds: [],
          warehouseBreakdown: [],
          currentStockTotal: 0,
          warehouse: null,
          warehouseId: undefined,
        };

      existing.sourceIds.push(item.id);
      existing.currentStockTotal += parseQuantity(item.currentStock);
      existing.warehouseBreakdown.push({
        id: item.id,
        warehouseId: item.warehouse?.id ?? item.warehouseId,
        warehouseLocation: item.warehouseLocation || item.warehouse?.displayName || "—",
        currentStock: item.currentStock,
        minimumStock: item.minimumStock,
      });
      groups.set(groupKey, existing);
    }

    return Array.from(groups.values()).map((item) => ({
      ...item,
      currentStock: item.currentStockTotal.toFixed(2),
      warehouseSummaryLabel:
        item.warehouseBreakdown.length === 1
          ? item.warehouseBreakdown[0].warehouseLocation
          : `${item.warehouseBreakdown.length} almacenes`,
      warehouseLocation:
        item.warehouseBreakdown.length === 1
          ? item.warehouseBreakdown[0].warehouseLocation
          : undefined,
    }));
  }, [items]);
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;
  const pageItems = useMemo(
    () => buildPageItems(data?.page ?? page, totalPages),
    [data?.page, page, totalPages]
  );

  const handleSort = (column: InventorySortField) => {
    setPage(1);
    if (sortBy === column) {
      setSortDir((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }

    setSortBy(column);
    setSortDir("asc");
  };

  const renderSortIcon = (column: InventorySortField) => {
    if (sortBy !== column) {
      return <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground/70" />;
    }

    return sortDir === "asc" ? (
      <ChevronUp className="h-3.5 w-3.5 text-primary" />
    ) : (
      <ChevronDown className="h-3.5 w-3.5 text-primary" />
    );
  };

  const rangeStart = total === 0 ? 0 : ((data?.page ?? page) - 1) * PAGE_SIZE + 1;
  const rangeEnd = total === 0 ? 0 : Math.min((data?.page ?? page) * PAGE_SIZE, total);
  const allPageItemIds = items.map((item: any) => item.id);
  const filteredItemCount = total;
  const allCurrentPageSelected =
    allPageItemIds.length > 0 &&
    allPageItemIds.every((id: number) => selectedItemIds.includes(id));
  const someCurrentPageSelected =
    allPageItemIds.some((id: number) => selectedItemIds.includes(id)) &&
    !allCurrentPageSelected;

  const openAssignmentDialog = (item: any) => {
    setSelectedItem(item);
    setAssignmentProjectId(item.project?.id ? String(item.project.id) : "none");
    setAssignmentDialogOpen(true);
  };

  const openBulkAssignmentDialog = (mode: BulkAssignmentMode) => {
    setBulkAssignmentMode(mode);
    setBulkAssignmentProjectId("none");
    setBulkAssignmentDialogOpen(true);
  };

  useEffect(() => {
    setSelectedItemIds((current) =>
      current.filter((id) => allPageItemIds.includes(id))
    );
  }, [data?.page, projectFilter, warehouseFilter, debouncedSearch, sortBy, sortDir]);

  useEffect(() => {
    const visibleKeys = new Set(groupedItems.map((item: any) => item.id));
    setExpandedInventoryKeys((current) =>
      current.every((key) => visibleKeys.has(key))
        ? current
        : current.filter((key) => visibleKeys.has(key))
    );
  }, [groupedItems]);

  const toggleInventoryBreakdown = (key: string) => {
    setExpandedInventoryKeys((current) =>
      current.includes(key)
        ? current.filter((entry) => entry !== key)
        : [...current, key]
    );
  };

  const toggleAllCurrentPage = (checked: boolean) => {
    if (checked) {
      setSelectedItemIds((current) => {
        const next = new Set(current);
        allPageItemIds.forEach((id: number) => next.add(id));
        return Array.from(next);
      });
      return;
    }

    setSelectedItemIds((current) =>
      current.filter((id) => !allPageItemIds.includes(id))
    );
  };

  const getProjectWarehouseLabel = (project: any | null) => {
    if (!project) return "Inventario central";
    return (
      project.warehouse?.displayName ??
      `${String(project.code).toUpperCase()} - ${String(project.name).toUpperCase()} - BODEGA`
    );
  };

  const trackingData = trackingQuery.data;
  const kardexData = kardexQuery.data;
  const trackingTotal =
    (trackingData?.materialRequests.length ?? 0) +
    (trackingData?.purchaseRequests.length ?? 0) +
    (trackingData?.purchaseOrders.length ?? 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h1>Inventario</h1>
          <p className="text-sm text-muted-foreground">
            {error
              ? "No fue posible cargar el inventario"
              : isFetching && !isLoading
                ? "Actualizando resultados..."
                : `${total.toLocaleString("es-HN")} registros encontrados`}
          </p>
        </div>
        {canManage && (
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogContent className="sm:max-w-4xl">
              <DialogHeader>
                <DialogTitle>Nuevo Ítem de Inventario</DialogTitle>
              </DialogHeader>
              <div className="space-y-3 pt-2">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Código SAP *</Label>
                    <Input
                      value={sapItemCode}
                      onChange={(e) => setSapItemCode(e.target.value)}
                      placeholder="MAT-001"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Nombre *</Label>
                    <Input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Cemento Portland"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Unidad</Label>
                    <Input
                      value={unit}
                      onChange={(e) => setUnit(e.target.value)}
                      placeholder="sacos"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Stock actual</Label>
                    <Input
                      value={currentStock}
                      onChange={(e) => setCurrentStock(e.target.value)}
                      placeholder="0"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Stock mínimo</Label>
                    <Input
                      value={minimumStock}
                      onChange={(e) => setMinimumStock(e.target.value)}
                      placeholder="0"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Categoría</Label>
                    <Input
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                      placeholder="Materiales"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Proyecto</Label>
                    <Select
                      value={projectId || "none"}
                      onValueChange={(value) =>
                        setProjectId(value === "none" ? "" : value)
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Inventario central" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">
                          Inventario central / sin proyecto
                        </SelectItem>
                        {(projects ?? []).map((project) => (
                          <SelectItem key={project.id} value={String(project.id)}>
                            {project.code} - {project.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {projectId ? (
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div className="space-y-1">
                      <Label className="text-xs">Almacén del proyecto</Label>
                      <Select
                        value={warehouseId || undefined}
                        onValueChange={setWarehouseId}
                      >
                        <SelectTrigger>
                          <SelectValue
                            placeholder={
                              warehousesLoading
                                ? "Cargando almacenes..."
                                : "Seleccione almacén del proyecto"
                            }
                          />
                        </SelectTrigger>
                        <SelectContent>
                          {createProjectWarehouses.map((warehouse: any) => (
                            <SelectItem
                              key={warehouse.id}
                              value={String(warehouse.id)}
                            >
                              {warehouse.displayName}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Proyecto seleccionado</Label>
                      <div className="rounded-md border px-3 py-2 text-xs text-muted-foreground">
                        {getProjectWarehouseLabel(selectedCreateProject)}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div className="space-y-1">
                      <Label className="text-xs">Almacén central</Label>
                      <Select
                        value={warehouseId || undefined}
                        onValueChange={setWarehouseId}
                      >
                        <SelectTrigger>
                          <SelectValue
                            placeholder={
                              warehousesLoading
                                ? "Cargando almacenes..."
                                : "Seleccione un almacén central"
                            }
                          />
                        </SelectTrigger>
                        <SelectContent>
                          {centralWarehouses.map((warehouse: any) => (
                            <SelectItem
                              key={warehouse.id}
                              value={String(warehouse.id)}
                            >
                              {warehouse.displayName}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Destino</Label>
                      <div className="rounded-md border px-3 py-2 text-xs text-muted-foreground">
                        Este registro quedará como inventario central hasta que
                        se asigne a un proyecto.
                      </div>
                    </div>
                  </div>
                )}
                <Button
                  onClick={() => {
                    if (!sapItemCode || !name) {
                      toast.error("Código SAP y nombre son obligatorios");
                      return;
                    }
                    createMutation.mutate({
                      sapItemCode,
                      name,
                      description: description || undefined,
                      unit: unit || undefined,
                      category: category || undefined,
                      currentStock: currentStock || undefined,
                      minimumStock: minimumStock || undefined,
                      projectId: projectId ? Number(projectId) : undefined,
                      warehouseId: warehouseId ? Number(warehouseId) : undefined,
                    });
                  }}
                  disabled={createMutation.isPending}
                  className="w-full"
                >
                  {createMutation.isPending ? "Creando..." : "Crear Ítem"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {allowInventoryReassignment ? (
        <>
          <Dialog
            open={assignmentDialogOpen}
            onOpenChange={(open) => {
              setAssignmentDialogOpen(open);
              if (!open) {
                setSelectedItem(null);
                setAssignmentProjectId("none");
              }
            }}
          >
            <DialogContent className="sm:max-w-2xl">
              <DialogHeader>
                <DialogTitle>Asignar Inventario a Proyecto</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-2">
                <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                  <p className="font-medium text-foreground">
                    {selectedItem?.sapItemCode} · {selectedItem?.name}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Almacén: {selectedItem?.warehouseLocation || "Sin almacén"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Proyecto actual:{" "}
                    {selectedItem?.project
                      ? `${selectedItem.project.code} - ${selectedItem.project.name}`
                      : "Inventario Central"}
                  </p>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Nuevo proyecto</Label>
                  <Select
                    value={assignmentProjectId}
                    onValueChange={setAssignmentProjectId}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Seleccione un proyecto" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Inventario central</SelectItem>
                      {(projects ?? []).map((project) => (
                        <SelectItem key={project.id} value={String(project.id)}>
                          {project.code} - {project.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
                  <p className="text-sm font-semibold text-foreground">
                    Bodega destino
                  </p>
                  <p className="mt-1 text-sm text-foreground">
                    {assignmentProjectId === "none"
                      ? "Inventario central"
                      : getProjectWarehouseLabel(selectedAssignmentProject)}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {assignmentProjectId === "none"
                      ? "Al quitar el proyecto, el registro vuelve a inventario central."
                      : "Al guardar, el ítem se moverá automáticamente a la bodega del proyecto seleccionado."}
                  </p>
                </div>

                <Button
                  className="w-full"
                  disabled={!selectedItem || updateMutation.isPending}
                  onClick={() => {
                    if (!selectedItem) return;
                    updateMutation.mutate({
                      id: selectedItem.id,
                      projectId:
                        assignmentProjectId === "none"
                          ? null
                          : Number(assignmentProjectId),
                    });
                  }}
                >
                  {updateMutation.isPending ? "Guardando..." : "Guardar asignación"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          <Dialog
            open={bulkAssignmentDialogOpen}
            onOpenChange={(open) => {
              setBulkAssignmentDialogOpen(open);
              if (!open) {
                setBulkAssignmentProjectId("none");
              }
            }}
          >
            <DialogContent className="sm:max-w-2xl">
              <DialogHeader>
                <DialogTitle>
                  {bulkAssignmentMode === "filtered"
                    ? "Asignar Todo el Resultado Filtrado"
                    : "Asignar Varios Ítems a Proyecto"}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-2">
                <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                  <p className="font-medium text-foreground">
                    {(bulkAssignmentMode === "filtered"
                      ? filteredItemCount
                      : selectedItemIds.length
                    ).toLocaleString("es-HN")}{" "}
                    ítems {bulkAssignmentMode === "filtered" ? "en el resultado actual" : "seleccionados"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {bulkAssignmentMode === "filtered"
                      ? "Esta acción moverá todos los registros que coincidan con los filtros actuales al proyecto elegido o los devolverá a inventario central."
                      : "Esta acción moverá todos los registros seleccionados al proyecto elegido o los devolverá a inventario central."}
                  </p>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Proyecto destino</Label>
                  <Select
                    value={bulkAssignmentProjectId}
                    onValueChange={setBulkAssignmentProjectId}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Seleccione un proyecto" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Inventario central</SelectItem>
                      {(projects ?? []).map((project) => (
                        <SelectItem key={project.id} value={String(project.id)}>
                          {project.code} - {project.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
                  <p className="text-sm font-semibold text-foreground">
                    Bodega destino
                  </p>
                  <p className="mt-1 text-sm text-foreground">
                    {bulkAssignmentProjectId === "none"
                      ? "Inventario central"
                      : getProjectWarehouseLabel(selectedBulkProject)}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {bulkAssignmentProjectId === "none"
                      ? "Los registros quedarán sin proyecto y sin bodega de proyecto asignada."
                      : "Todos los registros elegidos pasarán a la bodega operativa del proyecto seleccionado."}
                  </p>
                </div>

                <Button
                  className="w-full"
                  disabled={
                    (bulkAssignmentMode === "filtered"
                      ? filteredItemCount === 0
                      : selectedItemIds.length === 0) ||
                    bulkAssignMutation.isPending ||
                    bulkAssignFilteredMutation.isPending
                  }
                  onClick={() => {
                    if (bulkAssignmentMode === "filtered") {
                      bulkAssignFilteredMutation.mutate({
                        ...queryInput,
                        targetProjectId:
                          bulkAssignmentProjectId === "none"
                            ? null
                            : Number(bulkAssignmentProjectId),
                      });
                      return;
                    }

                    bulkAssignMutation.mutate({
                      ids: selectedItemIds,
                      projectId:
                        bulkAssignmentProjectId === "none"
                          ? null
                          : Number(bulkAssignmentProjectId),
                    });
                  }}
                >
                  {bulkAssignMutation.isPending || bulkAssignFilteredMutation.isPending
                    ? "Guardando..."
                    : bulkAssignmentMode === "filtered"
                      ? "Aplicar a todo lo filtrado"
                      : "Aplicar asignación masiva"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </>
      ) : null}

      <Dialog
        open={Boolean(trackingItem)}
        onOpenChange={(open) => {
          if (!open) setTrackingItem(null);
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-6xl">
          <DialogHeader>
            <DialogTitle>
              Seguimiento · {trackingItem?.sapItemCode}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            <div className="rounded-lg border bg-muted/30 p-3">
              <p className="font-medium text-foreground">
                {trackingItem?.name}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {formatProject(trackingItem?.project)} ·{" "}
                {trackingItem?.warehouseLocation || "Sin almacén"}
              </p>
            </div>

            {trackingQuery.isLoading ? (
              <div className="rounded-lg border p-6 text-center text-sm text-muted-foreground">
                Cargando seguimiento...
              </div>
            ) : trackingQuery.error ? (
              <div className="rounded-lg border border-destructive/30 p-6 text-center text-sm text-destructive">
                {trackingQuery.error.message}
              </div>
            ) : trackingTotal === 0 ? (
              <div className="rounded-lg border p-6 text-center text-sm text-muted-foreground">
                No hay solicitudes ni órdenes de compra en proceso para este ítem.
              </div>
            ) : (
              <div className="space-y-5">
                {[
                  {
                    title: "Requisiciones",
                    rows: trackingData?.materialRequests ?? [],
                  },
                  {
                    title: "Solicitudes de compra",
                    rows: trackingData?.purchaseRequests ?? [],
                  },
                  {
                    title: "Órdenes de compra",
                    rows: trackingData?.purchaseOrders ?? [],
                  },
                ].map((section) => (
                  <div key={section.title} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold">
                        {section.title}
                      </h3>
                      <span className="text-xs text-muted-foreground">
                        {section.rows.length.toLocaleString("es-HN")}
                      </span>
                    </div>
                    {section.rows.length === 0 ? (
                      <div className="rounded-lg border px-3 py-4 text-sm text-muted-foreground">
                        Sin registros en proceso.
                      </div>
                    ) : (
                      <div className="overflow-x-auto rounded-lg border">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b bg-muted/40">
                              <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                Documento
                              </th>
                              <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                Estado
                              </th>
                              <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                Proyecto
                              </th>
                              <th className="p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                Cantidad
                              </th>
                              <th className="p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                Pendiente
                              </th>
                              <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                Fecha necesaria
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {section.rows.map((row: any) => (
                              <tr
                                key={`${section.title}-${row.id}`}
                                className="border-b last:border-0"
                              >
                                <td className="p-3 font-mono text-xs">
                                  {row.documentNumber}
                                </td>
                                <td className="p-3">
                                  <span className="inline-flex rounded-md border px-2 py-1 text-xs capitalize">
                                    {formatStatus(row.status)}
                                  </span>
                                </td>
                                <td className="p-3 text-xs">
                                  {formatProject(row.project)}
                                </td>
                                <td className="p-3 text-right">
                                  {formatQuantity(row.quantity)}{" "}
                                  <span className="text-xs text-muted-foreground">
                                    {row.unit || ""}
                                  </span>
                                </td>
                                <td className="p-3 text-right font-medium">
                                  {formatQuantity(row.pendingQuantity)}
                                </td>
                                <td className="p-3 text-xs">
                                  {formatDate(row.neededBy)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(kardexItem)}
        onOpenChange={(open) => {
          if (!open) setKardexItem(null);
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-6xl">
          <DialogHeader>
            <DialogTitle>Kardex · {kardexItem?.sapItemCode}</DialogTitle>
          </DialogHeader>

          <div className="space-y-5 pt-2">
            <div className="rounded-lg border bg-muted/30 p-3">
              <p className="font-medium text-foreground">{kardexItem?.name}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {formatProject(kardexItem?.project)} ·{" "}
                {kardexItem?.warehouseLocation || "Sin almacén"}
              </p>
            </div>

            {kardexQuery.isLoading ? (
              <div className="rounded-lg border p-6 text-center text-sm text-muted-foreground">
                Cargando Kardex...
              </div>
            ) : kardexQuery.error ? (
              <div className="rounded-lg border border-destructive/30 p-6 text-center text-sm text-destructive">
                {kardexQuery.error.message}
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold">Existencias actuales</h3>
                  {(kardexData?.balances.length ?? 0) === 0 ? (
                    <div className="rounded-lg border px-3 py-4 text-sm text-muted-foreground">
                      Sin existencias actuales.
                    </div>
                  ) : (
                    <div className="overflow-x-auto rounded-lg border">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b bg-muted/40">
                            <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                              Proyecto
                            </th>
                            <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                              Almacén
                            </th>
                            <th className="p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                              Stock
                            </th>
                            <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                              Actualizado
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {(kardexData?.balances ?? []).map((balance: any) => (
                            <tr key={balance.id} className="border-b last:border-0">
                              <td className="p-3 text-xs">
                                {formatProject(balance.project)}
                              </td>
                              <td className="p-3 text-xs">
                                {balance.warehouseLocation || "—"}
                              </td>
                              <td className="p-3 text-right font-medium">
                                {formatQuantity(balance.currentStock)}{" "}
                                <span className="text-xs text-muted-foreground">
                                  {balance.unit || ""}
                                </span>
                              </td>
                              <td className="p-3 text-xs">
                                {formatDate(balance.updatedAt)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <h3 className="text-sm font-semibold">Movimientos</h3>
                  {(kardexData?.movements.length ?? 0) === 0 ? (
                    <div className="rounded-lg border px-3 py-4 text-sm text-muted-foreground">
                      Sin movimientos registrados.
                    </div>
                  ) : (
                    <div className="overflow-x-auto rounded-lg border">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b bg-muted/40">
                            <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                              Fecha
                            </th>
                            <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                              Tipo
                            </th>
                            <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                              Documento
                            </th>
                            <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                              Proyecto
                            </th>
                            <th className="p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                              Entrada
                            </th>
                            <th className="p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                              Salida
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {(kardexData?.movements ?? []).map((movement: any) => (
                            <tr
                              key={movement.id}
                              className="border-b last:border-0"
                            >
                              <td className="p-3 text-xs">
                                {formatDate(movement.date)}
                              </td>
                              <td className="p-3 text-xs">
                                {formatMovementType(movement.type)}
                              </td>
                              <td className="p-3">
                                <div className="font-mono text-xs">
                                  {movement.documentNumber}
                                </div>
                                {movement.sourceNumber ? (
                                  <div className="text-xs text-muted-foreground">
                                    Origen: {movement.sourceNumber}
                                  </div>
                                ) : null}
                              </td>
                              <td className="p-3 text-xs">
                                {formatProject(movement.project)}
                              </td>
                              <td className="p-3 text-right font-medium text-emerald-700">
                                {movement.direction === "entrada"
                                  ? formatQuantity(movement.quantity)
                                  : "—"}
                              </td>
                              <td className="p-3 text-right font-medium text-destructive">
                                {movement.direction === "salida"
                                  ? formatQuantity(movement.quantity)
                                  : "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <div className="grid gap-3 lg:grid-cols-[minmax(280px,1fr)_minmax(240px,384px)_minmax(240px,320px)] lg:items-end">
        <div className="relative min-w-0">
          <Label className="mb-1 block text-xs font-medium text-muted-foreground">
            Búsqueda
          </Label>
          <Search className="absolute left-3 top-[calc(50%+10px)] -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nombre, código, categoría, proyecto o almacén..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9"
          />
        </div>

        <div className="min-w-0">
          <Label className="mb-1 block text-xs font-medium text-muted-foreground">
            Proyecto ({(projects ?? []).length.toLocaleString("es-HN")})
          </Label>
          <Popover
            open={projectFilterOpen}
            onOpenChange={setProjectFilterOpen}
          >
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                role="combobox"
                aria-expanded={projectFilterOpen}
                className="h-9 w-full justify-between px-3 font-normal"
              >
                <span className="truncate">{selectedProjectFilterLabel}</span>
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="start"
              className="w-[var(--radix-popover-trigger-width)] p-0"
            >
              <Command>
                <CommandInput placeholder="Buscar proyecto..." />
                <CommandList>
                  <CommandEmpty>No se encontraron proyectos.</CommandEmpty>
                  <CommandGroup>
                    <CommandItem
                      value="todos los proyectos all"
                      onSelect={() => {
                        setProjectFilter("all");
                        setProjectFilterOpen(false);
                      }}
                    >
                      <Check
                        className={`h-4 w-4 ${
                          projectFilter === "all" ? "opacity-100" : "opacity-0"
                        }`}
                      />
                      <span className="truncate">
                        Todos los proyectos ({(projects ?? []).length.toLocaleString("es-HN")})
                      </span>
                    </CommandItem>
                    {(projects ?? []).map((project: any) => (
                      <CommandItem
                        key={project.id}
                        value={`${project.code} ${project.name} ${project.sapProjectCode ?? ""}`}
                        onSelect={() => {
                          setProjectFilter(String(project.id));
                          setProjectFilterOpen(false);
                        }}
                      >
                        <Check
                          className={`h-4 w-4 ${
                            projectFilter === String(project.id)
                              ? "opacity-100"
                              : "opacity-0"
                          }`}
                        />
                        <span className="truncate">
                          {project.code} - {project.name}
                        </span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>

        {canAccessWarehouses ? (
          <div className="min-w-0">
            <Label className="mb-1 block text-xs font-medium text-muted-foreground">
              Bodega / almacén ({warehouseOptions.length.toLocaleString("es-HN")})
            </Label>
            <Popover
              open={warehouseFilterOpen}
              onOpenChange={setWarehouseFilterOpen}
            >
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  role="combobox"
                  aria-expanded={warehouseFilterOpen}
                  className="h-9 w-full justify-between px-3 font-normal"
                >
                  <span className="truncate">{selectedWarehouseFilterLabel}</span>
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent
                align="start"
                className="w-[var(--radix-popover-trigger-width)] p-0"
              >
                <Command>
                  <CommandInput placeholder="Buscar almacén..." />
                  <CommandList>
                    <CommandEmpty>No se encontraron almacenes.</CommandEmpty>
                    <CommandGroup>
                        <CommandItem
                          value={`todos los almacenes all ${selectedFilterProject?.code ?? ""} ${selectedFilterProject?.name ?? ""}`}
                          onSelect={() => {
                            setWarehouseFilter("all");
                            setWarehouseFilterOpen(false);
                          }}
                        >
                        <Check
                          className={`h-4 w-4 ${
                            warehouseFilter === "all"
                              ? "opacity-100"
                              : "opacity-0"
                          }`}
                          />
                          <span className="truncate">
                            {allWarehouseFilterLabel}
                          </span>
                        </CommandItem>
                      {warehouseOptions.map((warehouse: any) => (
                        <CommandItem
                          key={warehouse.id}
                          value={[
                            warehouse.code,
                            warehouse.localCode,
                            warehouse.name,
                            warehouse.displayName,
                            warehouse.project?.code,
                            warehouse.project?.name,
                          ]
                            .filter(Boolean)
                            .join(" ")}
                          onSelect={() => {
                            setWarehouseFilter(String(warehouse.id));
                            setWarehouseFilterOpen(false);
                          }}
                        >
                          <Check
                            className={`h-4 w-4 ${
                              warehouseFilter === String(warehouse.id)
                                ? "opacity-100"
                              : "opacity-0"
                            }`}
                          />
                          <span className="min-w-0">
                            <span className="block truncate">
                              {formatWarehouseOptionLabel(warehouse)}
                            </span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {formatWarehouseProjectLabel(warehouse)}
                            </span>
                          </span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
        ) : null}
      </div>

      <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-muted-foreground">
        Los movimientos entre bodegas o proyectos se registran desde requisiciones, traslados y recepciones. Desde inventario solo consultas existencias y haces altas controladas.
      </div>

      {canUseGlobalAvailability ? (
        <Card>
          <CardContent className="space-y-3 p-4">
            <div className="grid gap-3 lg:grid-cols-[minmax(260px,420px)_1fr] lg:items-end">
              <div className="relative min-w-0">
                <Label className="mb-1 block text-xs font-medium text-muted-foreground">
                  Consulta global de existencias
                </Label>
                <Search className="absolute left-3 top-[calc(50%+10px)] h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Código, artículo, marca o número de parte"
                  value={globalSearch}
                  onChange={(event) => setGlobalSearch(event.target.value)}
                  className="h-9 pl-9"
                />
              </div>
              <p className="text-sm text-muted-foreground">
                {debouncedGlobalSearch.length >= 2
                  ? `${(globalAvailabilityQuery.data ?? []).length.toLocaleString("es-HN")} coincidencias`
                  : "Ingrese al menos 2 caracteres"}
              </p>
            </div>

            {debouncedGlobalSearch.length >= 2 ? (
              globalAvailabilityQuery.isLoading ? (
                <div className="rounded-md border p-4 text-sm text-muted-foreground">
                  Consultando existencias...
                </div>
              ) : (globalAvailabilityQuery.data ?? []).length === 0 ? (
                <div className="rounded-md border p-4 text-sm text-muted-foreground">
                  No hay existencias disponibles para esa búsqueda.
                </div>
              ) : (
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/30">
                        <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          Código
                        </th>
                        <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          Artículo
                        </th>
                        <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          Bodega
                        </th>
                        <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          Proyecto
                        </th>
                        <th className="p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          Stock
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {(globalAvailabilityQuery.data ?? []).map(
                        (row: any, index: number) => (
                          <tr
                            key={`${row.sapItemCode}-${row.warehouse?.id ?? "central"}-${row.project?.id ?? "sin-proyecto"}-${index}`}
                            className="border-b last:border-0"
                          >
                            <td className="p-3 font-mono text-xs">
                              {row.sapItemCode}
                            </td>
                            <td className="max-w-[420px] p-3">
                              <div className="font-medium">{row.itemName}</div>
                              {row.brand || row.partNumber ? (
                                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                                  {row.brand ? (
                                    <span>Marca: {row.brand}</span>
                                  ) : null}
                                  {row.partNumber ? (
                                    <span>No. parte: {row.partNumber}</span>
                                  ) : null}
                                </div>
                              ) : null}
                            </td>
                            <td className="p-3 text-xs">
                              {row.warehouse
                                ? formatWarehouseOptionLabel(row.warehouse)
                                : "Sin bodega"}
                            </td>
                            <td className="p-3 text-xs">
                              {row.project
                                ? `${row.project.code} - ${row.project.name}`
                                : "Inventario Central"}
                            </td>
                            <td className="p-3 text-right font-semibold">
                              {formatQuantity(row.quantity)} {row.unit || ""}
                            </td>
                          </tr>
                        )
                      )}
                    </tbody>
                  </table>
                </div>
              )
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {canManage && allowInventoryReassignment && selectedItemIds.length > 0 ? (
        <div className="flex flex-col gap-3 rounded-lg border bg-muted/30 px-4 py-3 md:flex-row md:items-center md:justify-between">
          <p className="text-sm text-muted-foreground">
            {selectedItemIds.length.toLocaleString("es-HN")} ítems seleccionados en esta vista
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => setSelectedItemIds([])}
            >
              Limpiar selección
            </Button>
            <Button onClick={() => openBulkAssignmentDialog("selected")}>
              <ArrowRightLeft className="h-4 w-4 mr-2" />
              Pasar seleccionados
            </Button>
          </div>
        </div>
      ) : null}

      {canManage && allowInventoryReassignment && filteredItemCount > 0 ? (
        <div className="flex flex-col gap-3 rounded-lg border border-dashed px-4 py-3 md:flex-row md:items-center md:justify-between">
          <p className="text-sm text-muted-foreground">
            {filteredItemCount.toLocaleString("es-HN")} ítems coinciden con los filtros actuales
          </p>
          <Button variant="outline" onClick={() => openBulkAssignmentDialog("filtered")}>
            <ArrowRightLeft className="h-4 w-4 mr-2" />
            Pasar todo lo filtrado
          </Button>
        </div>
      ) : null}

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">
              Cargando inventario...
            </div>
          ) : error ? (
            <div className="p-8 text-center">
              <Warehouse className="h-12 w-12 text-destructive/50 mx-auto mb-3" />
              <p className="font-medium text-foreground mb-1">
                No se pudo cargar el inventario
              </p>
              <p className="text-sm text-muted-foreground mb-4">
                {error.message || "Ocurrio un error consultando la base de datos."}
              </p>
              <Button variant="outline" onClick={() => void refetch()}>
                Reintentar
              </Button>
            </div>
          ) : groupedItems.length === 0 ? (
            <div className="p-8 text-center">
              <Warehouse className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-muted-foreground">
                {debouncedSearch
                  ? "No se encontraron ítems"
                  : projectFilter !== "all"
                    ? "No hay inventario asignado a este proyecto"
                    : "El inventario está vacío"}
              </p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1560px] text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      {canManage && allowInventoryReassignment ? (
                        <th className="p-3 text-left">
                          <Checkbox
                            checked={
                              allCurrentPageSelected
                                ? true
                                : someCurrentPageSelected
                                  ? "indeterminate"
                                  : false
                            }
                            onCheckedChange={(checked) =>
                              toggleAllCurrentPage(checked === true)
                            }
                            aria-label="Seleccionar todos los ítems visibles"
                          />
                        </th>
                      ) : null}
                      {columns.map((column) => (
                        <Fragment key={column.key}>
                          <th
                            className={`p-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground ${column.align === "right" ? "text-right" : "text-left"}`}
                          >
                            <button
                              type="button"
                              onClick={() => handleSort(column.key)}
                              className={`inline-flex items-center gap-1.5 transition-colors hover:text-foreground ${column.align === "right" ? "ml-auto" : ""}`}
                            >
                              <span>{column.label}</span>
                              {renderSortIcon(column.key)}
                            </button>
                          </th>
                          {column.key === "currentStock" ? (
                            <>
                              <th className="p-3 font-semibold text-xs uppercase tracking-wider text-right text-muted-foreground">
                                Total requeridas
                              </th>
                              <th className="p-3 font-semibold text-xs uppercase tracking-wider text-right text-muted-foreground">
                                Por recibirse
                              </th>
                            </>
                          ) : null}
                        </Fragment>
                      ))}
                      <th className="p-3 font-semibold text-xs uppercase tracking-wider text-right text-muted-foreground">
                        Consultas
                      </th>
                      {canManage && allowInventoryReassignment ? (
                        <th className="p-3 font-semibold text-xs uppercase tracking-wider text-left text-muted-foreground">
                          Acciones
                        </th>
                      ) : null}
                    </tr>
                  </thead>
                  <tbody>
                    {groupedItems.map((item: any) => {
                      const lowStock =
                        item.currentStock &&
                        item.minimumStock &&
                        parseFloat(item.currentStock) <=
                          parseFloat(item.minimumStock);
                      const isExpanded = expandedInventoryKeys.includes(item.id);
                      const hasBreakdown = item.warehouseBreakdown.length > 1;

                      return (
                        <Fragment key={item.id}>
                          <tr className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                            {canManage && allowInventoryReassignment ? (
                              <td className="p-3">
                                <Checkbox
                                  checked={item.sourceIds.every((id: number) =>
                                    selectedItemIds.includes(id)
                                  )}
                                  onCheckedChange={(checked) => {
                                    setSelectedItemIds((current) => {
                                      const next = new Set(current);
                                      item.sourceIds.forEach((id: number) =>
                                        checked ? next.add(id) : next.delete(id)
                                      );
                                      return Array.from(next);
                                    });
                                  }}
                                  aria-label={`Seleccionar ${item.sapItemCode}`}
                                />
                              </td>
                            ) : null}
                            <td className="p-3 font-mono text-xs">
                              {item.sapItemCode}
                            </td>
                            <td className="max-w-[360px] p-3">
                              <div className="font-medium">{item.name}</div>
                            </td>
                            <td className="p-3 text-xs">
                              {item.brand || "—"}
                            </td>
                            <td className="p-3 text-xs">
                              {item.partNumber || "—"}
                            </td>
                            <td className="p-3 text-xs">
                              {item.category || "—"}
                            </td>
                            <td className="p-3 text-xs">{item.unit || "—"}</td>
                            <td className="p-3 text-right">
                              <span
                                className={
                                  lowStock ? "text-destructive font-semibold" : ""
                                }
                              >
                                {formatQuantity(item.currentStock)}
                              </span>
                            </td>
                            <td className="p-3 text-right font-semibold">
                              {formatQuantity(item.totalRequiredQuantity)}
                            </td>
                            <td className="p-3 text-right font-semibold">
                              {formatQuantity(item.pendingReceiptQuantity)}
                            </td>
                            <td className="p-3 text-right text-muted-foreground">
                              {item.minimumStock || "—"}
                            </td>
                            <td className="p-3 text-xs">
                              {item.project
                                ? `${item.project.code} - ${item.project.name}`
                                : "Inventario Central"}
                            </td>
                            <td className="p-3 text-xs">
                              {hasBreakdown ? (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 px-2"
                                  onClick={() => toggleInventoryBreakdown(item.id)}
                                >
                                  {isExpanded ? (
                                    <ChevronUp className="mr-1 h-3.5 w-3.5" />
                                  ) : (
                                    <ChevronDown className="mr-1 h-3.5 w-3.5" />
                                  )}
                                  {item.warehouseSummaryLabel}
                                </Button>
                              ) : (
                                item.warehouseSummaryLabel || "—"
                              )}
                            </td>
                            <td className="p-3">
                              <div className="flex justify-end gap-2">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="h-8 px-2"
                                  title="Seguimiento"
                                  onClick={() => setTrackingItem(item)}
                                >
                                  <ClipboardList className="h-3.5 w-3.5" />
                                  <span className="ml-2 hidden xl:inline">
                                    Seguimiento
                                  </span>
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="h-8 px-2"
                                  title="Kardex"
                                  onClick={() => setKardexItem(item)}
                                >
                                  <BookOpen className="h-3.5 w-3.5" />
                                  <span className="ml-2 hidden xl:inline">
                                    Kardex
                                  </span>
                                </Button>
                              </div>
                            </td>
                            {canManage && allowInventoryReassignment ? (
                              <td className="p-3">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="h-8"
                                  onClick={() => openAssignmentDialog(item)}
                                >
                                  <ArrowRightLeft className="h-3.5 w-3.5 mr-2" />
                                  Pasar a proyecto
                                </Button>
                              </td>
                            ) : null}
                          </tr>
                          {hasBreakdown && isExpanded ? (
                            <tr className="border-b bg-muted/20">
                              <td
                                className="px-3 py-2"
                                colSpan={
                                  columns.length +
                                  3 +
                                  (canManage && allowInventoryReassignment ? 2 : 0)
                                }
                              >
                                <div className="ml-auto max-w-2xl overflow-x-auto rounded-md border bg-background">
                                  <table className="w-full text-xs">
                                    <thead>
                                      <tr className="border-b bg-muted/30">
                                        <th className="p-2 text-left font-semibold uppercase tracking-wider text-muted-foreground">
                                          Almacén
                                        </th>
                                        <th className="p-2 text-right font-semibold uppercase tracking-wider text-muted-foreground">
                                          Stock
                                        </th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {item.warehouseBreakdown.map(
                                        (warehouseRow: any) => (
                                          <tr
                                            key={warehouseRow.id}
                                            className="border-b last:border-0"
                                          >
                                            <td className="p-2">
                                              {warehouseRow.warehouseLocation}
                                            </td>
                                            <td className="p-2 text-right font-mono">
                                              {formatQuantity(
                                                warehouseRow.currentStock
                                              )}
                                            </td>
                                          </tr>
                                        )
                                      )}
                                    </tbody>
                                  </table>
                                </div>
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-col gap-4 border-t border-border px-4 py-4 md:flex-row md:items-center md:justify-between">
                <p className="text-sm text-muted-foreground">
                  Mostrando {rangeStart.toLocaleString("es-HN")} a {rangeEnd.toLocaleString("es-HN")} de {total.toLocaleString("es-HN")} registros
                </p>

                <Pagination className="mx-0 w-auto justify-end">
                  <PaginationContent>
                    <PaginationItem>
                      <PaginationPrevious
                        href="#"
                        onClick={(e) => {
                          e.preventDefault();
                          if ((data?.page ?? page) <= 1) return;
                          setPage((current) => current - 1);
                        }}
                        className={(data?.page ?? page) <= 1 ? "pointer-events-none opacity-50" : ""}
                      />
                    </PaginationItem>

                    {pageItems.map((pageItem, index) => (
                      <PaginationItem key={`${pageItem}-${index}`}>
                        {pageItem === "ellipsis" ? (
                          <PaginationEllipsis />
                        ) : (
                          <PaginationLink
                            href="#"
                            isActive={pageItem === (data?.page ?? page)}
                            onClick={(e) => {
                              e.preventDefault();
                              setPage(pageItem);
                            }}
                          >
                            {pageItem}
                          </PaginationLink>
                        )}
                      </PaginationItem>
                    ))}

                    <PaginationItem>
                      <PaginationNext
                        href="#"
                        onClick={(e) => {
                          e.preventDefault();
                          if ((data?.page ?? page) >= totalPages) return;
                          setPage((current) => current + 1);
                        }}
                        className={(data?.page ?? page) >= totalPages ? "pointer-events-none opacity-50" : ""}
                      />
                    </PaginationItem>
                  </PaginationContent>
                </Pagination>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
