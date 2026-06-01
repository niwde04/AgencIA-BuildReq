import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  ArrowLeft,
  CalendarClock,
  Check,
  ChevronsUpDown,
  Info,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useLocation, useParams } from "wouter";
import { toast } from "sonner";
import {
  calculateDefaultNeededBy,
  formatDateForDisplay,
  PURCHASE_POLICY_COPY,
  STANDARD_PURCHASE_LEAD_DAYS,
} from "@shared/material-requests";

/** Standard construction industry units of measure */
const UNITS = [
  { value: "und", label: "Unidades (und)" },
  { value: "m", label: "Metros (m)" },
  { value: "m2", label: "Metros cuadrados (m²)" },
  { value: "m3", label: "Metros cúbicos (m³)" },
  { value: "ml", label: "Metros lineales (ml)" },
  { value: "kg", label: "Kilogramos (kg)" },
  { value: "ton", label: "Toneladas (ton)" },
  { value: "lb", label: "Libras (lb)" },
  { value: "gal", label: "Galones (gal)" },
  { value: "lt", label: "Litros (lt)" },
  { value: "saco", label: "Sacos" },
  { value: "bolsa", label: "Bolsas" },
  { value: "rollo", label: "Rollos" },
  { value: "lamina", label: "Láminas" },
  { value: "varilla", label: "Varillas" },
  { value: "tubo", label: "Tubos" },
  { value: "pieza", label: "Piezas" },
  { value: "par", label: "Pares" },
  { value: "caja", label: "Cajas" },
  { value: "cubeta", label: "Cubetas" },
  { value: "quintal", label: "Quintales (qq)" },
  { value: "pie2", label: "Pies cuadrados (ft²)" },
  { value: "plg", label: "Pulgadas (plg)" },
  { value: "viaje", label: "Viajes" },
  { value: "global", label: "Global" },
];

type ItemRow = {
  id: string;
  itemName: string;
  quantity: string;
  unit: string;
  targetSelection: RequestTargetSelection | null;
};

type RequestTargetSelection =
  | {
      targetType: "subproyecto";
      subProjectId: number;
      projectId: number;
      label: string;
    }
  | {
      targetType: "activo_fijo";
      projectId: number;
      fixedAssetSapItemCode: string;
      fixedAssetName: string;
      label: string;
    };

const createItemRow = (overrides?: Partial<Omit<ItemRow, "id">>): ItemRow => ({
  id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
  itemName: "",
  quantity: "",
  unit: "",
  targetSelection: null,
  ...overrides,
});

function mapRequestItemTargetToSelection(
  item: any,
  projectId?: number | null
): RequestTargetSelection | null {
  if (item.targetType === "subproyecto" && item.subProjectId) {
    return {
      targetType: "subproyecto",
      subProjectId: item.subProjectId,
      projectId: projectId ?? item.target?.projectId ?? item.projectId ?? 0,
      label: item.target?.label ?? `Subproyecto #${item.subProjectId}`,
    };
  }

  if (item.targetType === "activo_fijo" && item.fixedAssetSapItemCode) {
    return {
      targetType: "activo_fijo",
      projectId: projectId ?? item.target?.projectId ?? item.projectId ?? 0,
      fixedAssetSapItemCode: item.fixedAssetSapItemCode,
      fixedAssetName: item.fixedAssetName ?? "",
      label: item.target?.label ?? `Activo fijo: ${item.fixedAssetSapItemCode}`,
    };
  }

  return null;
}

const mapRequestItemsToRows = (
  requestItems: any[],
  projectId?: number | null
): ItemRow[] =>
  requestItems.length > 0
    ? requestItems.map((item) => ({
        id: `existing-${item.id}`,
        itemName: item.itemName || "",
        quantity: String(item.quantity ?? ""),
        unit: item.unit || "",
        targetSelection: mapRequestItemTargetToSelection(item, projectId),
      }))
    : [createItemRow()];

const formatDateForInput = (value: string | Date | null | undefined) => {
  if (!value) return "";
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const projectCodeCollator = new Intl.Collator("es-HN", {
  numeric: true,
  sensitivity: "base",
});

function formatProjectLabel(project: any | null | undefined) {
  if (!project) return "Seleccione un proyecto";
  return `${project.code} - ${project.name}`;
}

function compareProjectsByCode(a: any, b: any) {
  const codeCompare = projectCodeCollator.compare(a.code ?? "", b.code ?? "");
  if (codeCompare !== 0) return codeCompare;
  return projectCodeCollator.compare(a.name ?? "", b.name ?? "");
}

function buildSubprojectTargetSelection(subproject: any): RequestTargetSelection {
  return {
    targetType: "subproyecto",
    subProjectId: subproject.id,
    projectId: subproject.projectId,
    label: `Subproyecto: ${subproject.code} - ${subproject.name}`,
  };
}

function buildFixedAssetTargetSelection(asset: any): RequestTargetSelection {
  return {
    targetType: "activo_fijo",
    projectId: asset.projectId,
    fixedAssetSapItemCode: asset.itemCode,
    fixedAssetName: asset.description,
    label: `Activo fijo: ${asset.itemCode} - ${asset.description}`,
  };
}

export default function NuevaSolicitud() {
  const [, setLocation] = useLocation();
  const params = useParams<{ id?: string }>();
  const utils = trpc.useUtils();
  const { user } = useAuth();
  const editingRequestId = params.id ? Number(params.id) : 0;
  const isEditMode = Number.isFinite(editingRequestId) && editingRequestId > 0;
  const { data: projects } = trpc.projects.list.useQuery({ status: "activo" });
  const {
    data: existingRequest,
    isLoading: isLoadingRequest,
    error: existingRequestError,
  } = trpc.materialRequests.getById.useQuery(
    { id: editingRequestId },
    { enabled: isEditMode }
  );
  const defaultNeededBy = useMemo(() => calculateDefaultNeededBy(), []);
  const userRole = (user as any)?.buildreqRole || "";
  const assignedProjectIds = useMemo(() => {
    const ids = (user as any)?.assignedProjectIds;
    if (Array.isArray(ids) && ids.length > 0) {
      return ids.map(Number).filter((id) => Number.isInteger(id) && id > 0);
    }
    return (user as any)?.assignedProjectId ? [(user as any).assignedProjectId] : [];
  }, [user]);
  const isProjectScopedUser =
    userRole === "ingeniero_residente" ||
    userRole === "administrador_proyecto" ||
    userRole === "bodeguero_proyecto";

  const [projectId, setProjectId] = useState<string>("");
  const [requestType, setRequestType] = useState<"bienes" | "servicios">("bienes");
  const [purchaseUrgency, setPurchaseUrgency] = useState<"urgente" | "no_urgente">(
    "no_urgente"
  );
  const [neededBy, setNeededBy] = useState("");
  const [targetPopoverOpen, setTargetPopoverOpen] = useState<string | null>(null);
  const [unitPopoverOpen, setUnitPopoverOpen] = useState<string | null>(null);
  const [projectPopoverOpen, setProjectPopoverOpen] = useState(false);
  const [targetSearch, setTargetSearch] = useState("");
  const [debouncedTargetSearch, setDebouncedTargetSearch] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<ItemRow[]>([createItemRow()]);
  const [loadedRequestSnapshot, setLoadedRequestSnapshot] = useState<string | null>(null);
  const availableProjects = useMemo(() => {
    const projectList = [...(projects ?? [])].sort(compareProjectsByCode);
    const hasAllProjectAccess =
      userRole === "administrador_proyecto" && assignedProjectIds.length === 0;
    if (!isProjectScopedUser || hasAllProjectAccess) {
      return projectList;
    }

    return projectList.filter((project: any) =>
      assignedProjectIds.includes(project.id)
    );
  }, [assignedProjectIds, isProjectScopedUser, projects, userRole]);
  const effectiveProjectId =
    isProjectScopedUser && availableProjects.length === 1
      ? String(availableProjects[0].id)
      : projectId;
  const selectedProject = useMemo(
    () =>
      (projects || []).find((project: any) => String(project.id) === effectiveProjectId) ?? null,
    [effectiveProjectId, projects]
  );
  const selectedProjectLabel = formatProjectLabel(selectedProject);
  const effectiveProjectIdNumber = effectiveProjectId
    ? Number(effectiveProjectId)
    : 0;
  const { data: targetOptions, isLoading: isLoadingTargetOptions } =
    trpc.materialRequests.targetOptions.useQuery(
      {
        projectId: effectiveProjectIdNumber,
        search: debouncedTargetSearch || undefined,
      },
      { enabled: effectiveProjectIdNumber > 0 }
    );
  const requestSnapshotKey = existingRequest
    ? `${existingRequest.request.id}:${new Date(existingRequest.request.updatedAt).toISOString()}:${existingRequest.items.length}`
    : null;

  useEffect(() => {
    if (!isProjectScopedUser) return;

    if (availableProjects.length === 1) {
      const nextProjectId = String(availableProjects[0].id);
      if (projectId !== nextProjectId) {
        setProjectId(nextProjectId);
      }
      return;
    }

    if (projectId) {
      setProjectId("");
    }
  }, [availableProjects, isProjectScopedUser, projectId]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedTargetSearch(targetSearch.trim());
    }, 250);

    return () => window.clearTimeout(timeoutId);
  }, [targetSearch]);

  useEffect(() => {
    if (!effectiveProjectIdNumber) {
      setItems((current) =>
        current.map((item) =>
          item.targetSelection ? { ...item, targetSelection: null } : item
        )
      );
      return;
    }

    setItems((current) =>
      current.map((item) =>
        item.targetSelection &&
        item.targetSelection.projectId !== effectiveProjectIdNumber
          ? { ...item, targetSelection: null }
          : item
      )
    );
  }, [effectiveProjectIdNumber]);

  useEffect(() => {
    if (!existingRequest || !requestSnapshotKey || loadedRequestSnapshot === requestSnapshotKey) {
      return;
    }

    setProjectId(String(existingRequest.request.projectId));
    setRequestType(existingRequest.request.requestType as "bienes" | "servicios");
    setPurchaseUrgency(
      existingRequest.request.purchaseUrgency as "urgente" | "no_urgente"
    );
    setNeededBy(
      formatDateForInput(existingRequest.request.neededBy)
    );
    setNotes(existingRequest.request.notes || "");
    setItems(
      mapRequestItemsToRows(
        existingRequest.items,
        existingRequest.request.projectId
      )
    );
    setLoadedRequestSnapshot(requestSnapshotKey);
  }, [existingRequest, loadedRequestSnapshot, requestSnapshotKey]);

  const createMutation = trpc.materialRequests.create.useMutation({
    onError: (error) => {
      toast.error(`Error: ${error.message}`);
    },
  });
  const updateMutation = trpc.materialRequests.update.useMutation({
    onError: (error) => {
      toast.error(`Error: ${error.message}`);
    },
  });

  const addItem = () => {
    setItems([...items, createItemRow()]);
  };

  const removeItem = (index: number) => {
    if (items.length === 1) return;
    setItems(items.filter((_, i) => i !== index));
  };

  const updateItem = (
    index: number,
    field: "itemName" | "quantity" | "unit",
    value: string
  ) => {
    const updated = [...items];
    updated[index] = { ...updated[index], [field]: value };
    setItems(updated);
  };

  const updateItemTarget = (
    index: number,
    targetSelection: RequestTargetSelection | null
  ) => {
    const updated = [...items];
    updated[index] = { ...updated[index], targetSelection };
    setItems(updated);
  };

  const validItems = items.filter(
    (item) => item.itemName.trim() && item.quantity.trim() && item.unit.trim()
  );
  const hasIncompleteItems = items.some((item) => {
    const hasAnyValue = Boolean(
      item.itemName.trim() ||
        item.quantity.trim() ||
        item.unit.trim() ||
        item.targetSelection
    );
    const isComplete = Boolean(
      item.itemName.trim() && item.quantity.trim() && item.unit.trim()
    );
    return hasAnyValue && !isComplete;
  });

  const isEditableExistingRequest = useMemo(() => {
    if (!existingRequest) return true;
    if (existingRequest.request.status === "borrador") return true;
    if (existingRequest.request.status !== "en_espera") return false;

    return existingRequest.items.every((item: any) => {
      const hasMovement =
        Number(item.deliveredQuantity ?? 0) > 0 || Number(item.dispatchedQuantity ?? 0) > 0;
      return !item.assignedFlow && !item.sapItemCode && !hasMovement;
    });
  }, [existingRequest]);

  const persistRequest = (saveMode: "draft" | "submit") => {
    if (!effectiveProjectId) {
      toast.error("Seleccione un proyecto antes de continuar");
      return;
    }

    if (hasIncompleteItems) {
      toast.error("Complete o elimine los ítems incompletos antes de guardar");
      return;
    }

    if (saveMode === "submit" && purchaseUrgency === "urgente" && !neededBy) {
      toast.error("Seleccione la fecha necesaria para la compra urgente");
      return;
    }

    if (saveMode === "submit" && validItems.length === 0) {
      toast.error("Debe agregar al menos un ítem con nombre, cantidad y unidad");
      return;
    }

    const payload = {
      saveMode,
      projectId: parseInt(effectiveProjectId),
      requestType,
      purchaseUrgency,
      neededBy: purchaseUrgency === "urgente" ? neededBy : undefined,
      notes: notes || undefined,
      items: items.map((item) => ({
        itemName: item.itemName,
        quantity: item.quantity,
        unit: item.unit || undefined,
        targetType: item.targetSelection?.targetType ?? null,
        subProjectId:
          item.targetSelection?.targetType === "subproyecto"
            ? item.targetSelection.subProjectId
            : null,
        fixedAssetSapItemCode:
          item.targetSelection?.targetType === "activo_fijo"
            ? item.targetSelection.fixedAssetSapItemCode
            : null,
        fixedAssetName:
          item.targetSelection?.targetType === "activo_fijo"
            ? item.targetSelection.fixedAssetName
            : null,
      })),
    };

    const onSuccess = (data: { id: number; requestNumber: string }) => {
      setLoadedRequestSnapshot(null);
      void utils.materialRequests.list.invalidate();
      void utils.materialRequests.getById.invalidate({ id: data.id });

      if (saveMode === "draft") {
        toast.success(`Borrador ${data.requestNumber} guardado`);
        setLocation(`/solicitudes/${data.id}/editar`);
        return;
      }

      toast.success(
        isEditMode && existingRequest?.request.status !== "borrador"
          ? `Requisición ${data.requestNumber} actualizada`
          : `Requisición ${data.requestNumber} creada exitosamente`
      );
      setLocation(`/solicitudes/${data.id}`);
    };

    if (isEditMode) {
      updateMutation.mutate(
        {
          id: editingRequestId,
          ...payload,
        },
        { onSuccess }
      );
      return;
    }

    createMutation.mutate(payload, { onSuccess });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    persistRequest("submit");
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;
  const primaryActionLabel =
    isEditMode && existingRequest?.request.status !== "borrador"
      ? "Guardar cambios"
      : "Crear Requisición";
  const renderItemTargetCombobox = (item: ItemRow, index: number) => {
    const open = targetPopoverOpen === item.id;

    return (
      <div className="flex gap-2">
        <Popover
          open={open}
          onOpenChange={(nextOpen) => {
            setTargetPopoverOpen(nextOpen ? item.id : null);
            setTargetSearch("");
          }}
        >
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              role="combobox"
              aria-expanded={open}
              disabled={!effectiveProjectId}
              className="min-w-0 flex-1 justify-between font-normal"
            >
              <span className="truncate">
                {item.targetSelection?.label ?? "Subproyecto o activo fijo"}
              </span>
              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            className="w-[min(520px,calc(100vw-2rem))] p-0"
            align="start"
          >
            <Command shouldFilter={false}>
              <CommandInput
                placeholder="Buscar subproyecto o activo fijo..."
                value={targetSearch}
                onValueChange={setTargetSearch}
              />
              <CommandList>
                {isLoadingTargetOptions ? (
                  <div className="p-3 text-sm text-muted-foreground">
                    Buscando opciones...
                  </div>
                ) : (
                  <>
                    <CommandEmpty>No se encontraron opciones.</CommandEmpty>
                    {(targetOptions?.subprojects ?? []).length > 0 ? (
                      <CommandGroup heading="Subproyectos">
                        {(targetOptions?.subprojects ?? []).map((subproject: any) => {
                          const selected =
                            item.targetSelection?.targetType === "subproyecto" &&
                            item.targetSelection.subProjectId === subproject.id;

                          return (
                            <CommandItem
                              key={`subproject-${subproject.id}`}
                              value={`subproject-${subproject.id}-${subproject.code}-${subproject.name}`}
                              onSelect={() => {
                                updateItemTarget(
                                  index,
                                  buildSubprojectTargetSelection(subproject)
                                );
                                setTargetPopoverOpen(null);
                                setTargetSearch("");
                              }}
                            >
                              <Check
                                className={`mr-2 h-4 w-4 ${
                                  selected ? "opacity-100" : "opacity-0"
                                }`}
                              />
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium">
                                  {subproject.code} - {subproject.name}
                                </p>
                                {subproject.description ? (
                                  <p className="truncate text-xs text-muted-foreground">
                                    {subproject.description}
                                  </p>
                                ) : null}
                              </div>
                            </CommandItem>
                          );
                        })}
                      </CommandGroup>
                    ) : null}

                    {(targetOptions?.fixedAssets ?? []).length > 0 ? (
                      <CommandGroup heading="Activos fijos">
                        {(targetOptions?.fixedAssets ?? []).map((asset: any) => {
                          const selected =
                            item.targetSelection?.targetType === "activo_fijo" &&
                            item.targetSelection.fixedAssetSapItemCode === asset.itemCode;

                          return (
                            <CommandItem
                              key={`asset-${asset.itemCode}`}
                              value={`asset-${asset.itemCode}-${asset.description}`}
                              onSelect={() => {
                                updateItemTarget(
                                  index,
                                  buildFixedAssetTargetSelection(asset)
                                );
                                setTargetPopoverOpen(null);
                                setTargetSearch("");
                              }}
                            >
                              <Check
                                className={`mr-2 h-4 w-4 ${
                                  selected ? "opacity-100" : "opacity-0"
                                }`}
                              />
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium">
                                  {asset.itemCode} - {asset.description}
                                </p>
                                {asset.itemGroup ? (
                                  <p className="truncate text-xs text-muted-foreground">
                                    {asset.itemGroup}
                                  </p>
                                ) : null}
                              </div>
                            </CommandItem>
                          );
                        })}
                      </CommandGroup>
                    ) : null}
                  </>
                )}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        {item.targetSelection ? (
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => updateItemTarget(index, null)}
            aria-label="Limpiar destino del ítem"
          >
            <X className="h-4 w-4" />
          </Button>
        ) : null}
      </div>
    );
  };

  const renderItemUnitCombobox = (item: ItemRow, index: number) => {
    const open = unitPopoverOpen === item.id;
    const selectedUnit = UNITS.find((unit) => unit.value === item.unit);

    return (
      <Popover
        open={open}
        onOpenChange={(nextOpen) => setUnitPopoverOpen(nextOpen ? item.id : null)}
      >
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="h-10 w-full justify-between px-3 font-normal"
          >
            <span className="truncate">
              {selectedUnit?.label || item.unit || "Seleccione unidad"}
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[240px] p-0" align="start">
          <Command>
            <CommandInput placeholder="Buscar unidad..." />
            <CommandList>
              <CommandEmpty>No se encontraron unidades.</CommandEmpty>
              <CommandGroup>
                {UNITS.map((unit) => {
                  const selected = item.unit === unit.value;

                  return (
                    <CommandItem
                      key={unit.value}
                      value={`${unit.value} ${unit.label}`}
                      onSelect={() => {
                        updateItem(index, "unit", unit.value);
                        setUnitPopoverOpen(null);
                      }}
                    >
                      <Check
                        className={`mr-2 h-4 w-4 ${
                          selected ? "opacity-100" : "opacity-0"
                        }`}
                      />
                      <span>{unit.label}</span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    );
  };

  if (isEditMode && isLoadingRequest) {
    return (
      <div className="w-full max-w-none space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => setLocation("/solicitudes")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1>Cargando requisición...</h1>
        </div>
      </div>
    );
  }

  if (isEditMode && existingRequestError) {
    return (
      <div className="w-full max-w-none space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => setLocation("/solicitudes")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1>No se pudo abrir la requisición</h1>
        </div>
        <Alert variant="destructive">
          <Info className="h-4 w-4" />
          <AlertTitle>Error al cargar</AlertTitle>
          <AlertDescription>{existingRequestError.message}</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (isEditMode && existingRequest && !isEditableExistingRequest) {
    return (
      <div className="w-full max-w-none space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => setLocation(`/solicitudes/${editingRequestId}`)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1>Requisición no editable</h1>
        </div>
        <Alert>
          <Info className="h-4 w-4" />
          <AlertTitle>Esta requisición ya no se puede editar</AlertTitle>
          <AlertDescription>
            Ya fue enviada al flujo operativo o alguien empezó a procesarla. Desde aquí solo puedes verla en detalle.
          </AlertDescription>
        </Alert>
        <div className="flex justify-end">
          <Button onClick={() => setLocation(`/solicitudes/${editingRequestId}`)}>
            Ver detalle
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-none space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => setLocation("/solicitudes")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1>
          {isEditMode
            ? existingRequest?.request.status === "borrador"
              ? "Continuar Borrador de Requisición"
              : "Editar Requisición de Materiales"
            : "Nueva Requisición de Materiales"}
        </h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Información General
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Proyecto *</Label>
                <Popover
                  open={projectPopoverOpen}
                  onOpenChange={setProjectPopoverOpen}
                >
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      role="combobox"
                      aria-expanded={projectPopoverOpen}
                      disabled={isProjectScopedUser && availableProjects.length === 1}
                      className="w-full justify-between font-normal md:w-[360px]"
                    >
                      <span
                        className={`truncate ${
                          effectiveProjectId ? "" : "text-muted-foreground"
                        }`}
                      >
                        {selectedProjectLabel}
                      </span>
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    className="w-[min(600px,calc(100vw-2rem))] p-0"
                    align="start"
                  >
                    <Command>
                      <CommandInput placeholder="Buscar proyecto por código o nombre..." />
                      <CommandList className="max-h-[360px]">
                        <CommandEmpty>No se encontraron proyectos.</CommandEmpty>
                        <CommandGroup>
                          {availableProjects.map((project: any) => (
                            <CommandItem
                              key={project.id}
                              value={[
                                project.code,
                                project.name,
                                project.sapProjectCode,
                              ]
                                .filter(Boolean)
                                .join(" ")}
                              onSelect={() => {
                                setProjectId(String(project.id));
                                setProjectPopoverOpen(false);
                              }}
                            >
                              <Check
                                className={`h-4 w-4 ${
                                  effectiveProjectId === String(project.id)
                                    ? "opacity-100"
                                    : "opacity-0"
                                }`}
                              />
                              <span className="truncate">
                                {formatProjectLabel(project)}
                              </span>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
                {isProjectScopedUser && availableProjects.length === 1 ? (
                  <p className="text-xs text-muted-foreground">
                    Proyecto asignado automáticamente según su rol.
                  </p>
                ) : null}
              </div>
            </div>

            {requestType === "bienes" && (
              <div className="space-y-2 rounded-lg border border-primary/20 bg-primary/5 p-4">
                <Label className="text-sm font-semibold text-foreground">
                  Bodega del proyecto
                </Label>
                <p className="text-sm font-medium text-foreground">
                  {selectedProject
                    ? selectedProject.warehouse?.displayName ??
                      `Bodega del Proyecto — ${selectedProject.code} — ${selectedProject.name}`
                    : "Seleccione un proyecto para identificar la bodega operativa"}
                </p>
                <p className="text-xs text-muted-foreground">
                  La requisición se trabajará primero desde la bodega del proyecto
                  seleccionado cuando aplique a materiales.
                </p>
              </div>
            )}

            <Alert className="border-border bg-muted/20">
              <Info className="h-4 w-4" />
              <AlertTitle>Clasificación automática</AlertTitle>
              <AlertDescription>
                El tipo se tomará del artículo SAP cuando Bodega traduzca los ítems.
              </AlertDescription>
            </Alert>

            <div className="space-y-3 rounded-lg border border-border p-4">
              <div className="space-y-1">
                <Label>Control de compras urgentes *</Label>
                <p className="text-sm text-muted-foreground">
                  Clasifica la requisición según la fecha en que el proyecto necesita el
                  material.
                </p>
              </div>

              <RadioGroup
                value={purchaseUrgency}
                onValueChange={(value) =>
                  setPurchaseUrgency(value as "urgente" | "no_urgente")
                }
                className="grid grid-cols-1 md:grid-cols-2 gap-3"
              >
                <label
                  htmlFor="urgente"
                  className={`flex items-start gap-3 rounded-lg border p-4 cursor-pointer transition-colors ${
                    purchaseUrgency === "urgente"
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/40"
                  }`}
                >
                  <RadioGroupItem value="urgente" id="urgente" className="mt-0.5" />
                  <div>
                    <p className="font-medium">Urgente</p>
                    <p className="text-sm text-muted-foreground">
                      Cuando la fecha necesaria es menor al plazo estándar de{" "}
                      {STANDARD_PURCHASE_LEAD_DAYS} días calendario.
                    </p>
                  </div>
                </label>

                <label
                  htmlFor="no-urgente"
                  className={`flex items-start gap-3 rounded-lg border p-4 cursor-pointer transition-colors ${
                    purchaseUrgency === "no_urgente"
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/40"
                  }`}
                >
                  <RadioGroupItem value="no_urgente" id="no-urgente" className="mt-0.5" />
                  <div>
                    <p className="font-medium">No urgente</p>
                    <p className="text-sm text-muted-foreground">
                      La fecha necesaria se asigna automáticamente con la política estándar.
                    </p>
                  </div>
                </label>
              </RadioGroup>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Fecha necesaria *</Label>
                  {purchaseUrgency === "urgente" ? (
                    <>
                      <Input
                        type="date"
                        value={neededBy}
                        onChange={(e) => setNeededBy(e.target.value)}
                      />
                      <p className="text-xs text-muted-foreground">
                        Para clasificarla como urgente, la fecha debe ser menor al plazo
                        estándar de {STANDARD_PURCHASE_LEAD_DAYS} días calendario.
                      </p>
                    </>
                  ) : (
                    <div className="rounded-md border border-dashed border-border bg-muted/30 px-3 py-3">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <CalendarClock className="h-4 w-4 text-primary" />
                        {formatDateForDisplay(defaultNeededBy)}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Fecha asignada automáticamente por política de compras no urgentes.
                      </p>
                    </div>
                  )}
                </div>

                <Alert className="border-primary/20 bg-primary/5">
                  <Info className="h-4 w-4" />
                  <AlertTitle>Política visible para el pedido</AlertTitle>
                  <AlertDescription>
                    <p className="whitespace-pre-line">{PURCHASE_POLICY_COPY}</p>
                  </AlertDescription>
                </Alert>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Notas adicionales</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Observaciones o instrucciones especiales..."
                rows={2}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Ítems Solicitados
            </CardTitle>
            <Button type="button" variant="outline" size="sm" onClick={addItem}>
              <Plus className="h-4 w-4 mr-1" />
              Agregar ítem
            </Button>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {/* Header */}
              <div className="hidden md:grid grid-cols-12 gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground px-1">
                <div className="col-span-4">Nombre del ítem</div>
                <div className="col-span-3">Subproyecto / activo fijo</div>
                <div className="col-span-2">Cantidad</div>
                <div className="col-span-2">Unidad</div>
                <div className="col-span-1" />
              </div>

              {items.map((item, index) => (
                <div key={item.id} className="grid grid-cols-12 gap-2 items-center">
                  <div className="col-span-12 md:col-span-4">
                    <Input
                      placeholder="Ej: Cemento Portland Tipo I"
                      value={item.itemName}
                      onChange={(e) => updateItem(index, "itemName", e.target.value)}
                    />
                  </div>
                  <div className="col-span-12 md:col-span-3">
                    {renderItemTargetCombobox(item, index)}
                  </div>
                  <div className="col-span-5 md:col-span-2">
                    <Input
                      type="number"
                      placeholder="0"
                      min="0.01"
                      step="any"
                      value={item.quantity}
                      onChange={(e) => updateItem(index, "quantity", e.target.value)}
                    />
                  </div>
                  <div className="col-span-5 md:col-span-2">
                    {renderItemUnitCombobox(item, index)}
                  </div>
                  <div className="col-span-2 md:col-span-1 flex justify-center">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeItem(index)}
                      disabled={items.length === 1}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="flex items-center gap-3 justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              setLocation(isEditMode ? `/solicitudes/${editingRequestId}` : "/solicitudes")
            }
          >
            Cancelar
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={isSaving}
            onClick={() => persistRequest("draft")}
          >
            {isSaving ? "Guardando..." : "Guardar borrador"}
          </Button>
          <Button type="submit" disabled={isSaving}>
            {isSaving
              ? "Guardando..."
              : primaryActionLabel}
          </Button>
        </div>
      </form>
    </div>
  );
}
