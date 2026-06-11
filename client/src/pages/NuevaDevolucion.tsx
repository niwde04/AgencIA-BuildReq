import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, Check, ChevronsUpDown, Plus, Search, Trash2 } from "lucide-react";
import { useMemo, useState, useEffect } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";

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

type ReturnItem = {
  warehouseId?: number;
  sapItemCode: string;
  itemName: string;
  quantity: string;
  unit: string;
  condition: string;
  notes: string;
};

const blankReturnItem = (): ReturnItem => ({
  warehouseId: undefined,
  sapItemCode: "",
  itemName: "",
  quantity: "",
  unit: "",
  condition: "",
  notes: "",
});

const REQUIRED_FIELD_ERROR_CLASS =
  "border-destructive ring-1 ring-destructive/40 focus-visible:ring-destructive";

function fieldErrorClass(hasError: boolean, className = "") {
  return [className, hasError ? REQUIRED_FIELD_ERROR_CLASS : ""]
    .filter(Boolean)
    .join(" ");
}

function formatReceiptSupplier(supplier?: any | null) {
  if (!supplier) return "";
  return [supplier.supplierCode, supplier.name].filter(Boolean).join(" — ");
}

function formatCompletedReceiptLabel(row?: any | null) {
  if (!row) return "Seleccione recepción completada";
  const receiptNumber = row.receipt?.receiptNumber ?? "Recepción";
  const orderNumber = row.purchaseOrder?.orderNumber;
  const supplierName = formatReceiptSupplier(row.supplier);
  const projectLabel = row.project
    ? `${row.project.code} ${row.project.name}`
    : "";

  return [receiptNumber, orderNumber, supplierName, projectLabel]
    .filter(Boolean)
    .join(" — ");
}

const projectCodeCollator = new Intl.Collator("es-HN", {
  numeric: true,
  sensitivity: "base",
});

function compareProjectsByCode(left: any, right: any) {
  const codeCompare = projectCodeCollator.compare(
    left.code ?? "",
    right.code ?? ""
  );
  if (codeCompare !== 0) return codeCompare;
  return projectCodeCollator.compare(left.name ?? "", right.name ?? "");
}

function formatProjectLabel(project?: any | null) {
  if (!project) return "Seleccione proyecto";
  return `${project.code} - ${project.name}`;
}

function formatWarehouseLabel(warehouse: any) {
  return (
    warehouse?.displayName ||
    [warehouse?.localCode || warehouse?.code, warehouse?.name]
      .filter(Boolean)
      .join(" - ") ||
    "Almacén"
  );
}

function SapItemSearchInput({
  value,
  disabled,
  resolving,
  onChange,
  onSelect,
  onResolve,
}: {
  value: string;
  disabled: boolean;
  resolving: boolean;
  onChange: (value: string) => void;
  onSelect: (sapItemCode: string, itemName: string) => void;
  onResolve: () => void;
}) {
  const [search, setSearch] = useState(value);
  const [open, setOpen] = useState(false);
  const trimmedSearch = search.trim();
  const { data: results, isFetching } = trpc.requestItems.searchSapCatalog.useQuery(
    { search: trimmedSearch },
    { enabled: trimmedSearch.length >= 2 }
  );

  useEffect(() => {
    setSearch(value);
  }, [value]);

  const hasSearch = trimmedSearch.length >= 2;
  const hasResults = Boolean(results?.length);
  const showPopover = open && hasSearch;

  return (
    <Popover open={showPopover} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => {
              const nextValue = event.target.value;
              setSearch(nextValue);
              onChange(nextValue);
              setOpen(nextValue.trim().length >= 2);
            }}
            onFocus={() => setOpen(trimmedSearch.length >= 2)}
            onBlur={() => {
              window.setTimeout(() => setOpen(false), 120);
              if (trimmedSearch && !hasResults && !isFetching) onResolve();
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onResolve();
                setOpen(false);
              }
            }}
            placeholder={resolving ? "Buscando..." : "Buscar código o descripción"}
            className="pl-9"
            disabled={disabled || resolving}
          />
        </div>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="max-h-[280px] w-[var(--radix-popover-trigger-width)] overflow-y-auto p-0"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        {isFetching ? (
          <div className="p-3 text-sm text-muted-foreground">Buscando...</div>
        ) : hasResults ? (
          <div className="py-1">
            {results?.map((item: any) => (
              <button
                key={item.id}
                type="button"
                className="flex w-full items-start gap-3 border-b border-border px-3 py-2 text-left transition-colors last:border-0 hover:bg-muted/60"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onSelect(item.itemCode, item.description);
                  setSearch(item.itemCode);
                  setOpen(false);
                }}
              >
                <span className="shrink-0 font-mono text-xs font-semibold text-primary">
                  {item.itemCode}
                </span>
                <span className="min-w-0 text-xs leading-snug text-foreground">
                  {item.description}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="p-3 text-sm text-muted-foreground">
            Sin resultados por código o descripción.
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function UnitCombobox({
  value,
  open,
  onOpenChange,
  onChange,
}: {
  value: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (value: string) => void;
}) {
  const selectedUnit = UNITS.find((unit) => unit.value === value);

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="h-10 w-full justify-between px-3 font-normal"
        >
          <span className="truncate">
            {selectedUnit?.label || value || "Seleccione unidad"}
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
                const selected = value === unit.value;

                return (
                  <CommandItem
                    key={unit.value}
                    value={`${unit.value} ${unit.label}`}
                    onSelect={() => {
                      onChange(unit.value);
                      onOpenChange(false);
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
}

export default function NuevaDevolucion() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { data: projects } = trpc.projects.list.useQuery({ status: "activo" });

  const userRole = (user as any)?.buildreqRole || "";
  const isAdmin = user?.role === "admin";
  const canCreate = userRole === "jefe_bodega_central" || isAdmin;

  useEffect(() => {
    if (user && !canCreate) {
      toast.error("Solo el Jefe de Bodega Central puede crear devoluciones");
      setLocation("/devoluciones");
    }
  }, [user, canCreate, setLocation]);

  const [returnType, setReturnType] = useState("");
  const [reasonCategory, setReasonCategory] = useState("");
  const [justification, setJustification] = useState("");
  const [receivedByName, setReceivedByName] = useState("");
  const [sourceProjectId, setSourceProjectId] = useState("");
  const [sourceWarehouseId, setSourceWarehouseId] = useState("");
  const [destinationProjectId, setDestinationProjectId] = useState("");
  const [destinationWarehouseId, setDestinationWarehouseId] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [sourceReceiptId, setSourceReceiptId] = useState("");
  const [sourceWarehousePopoverOpen, setSourceWarehousePopoverOpen] =
    useState(false);
  const [sourceWarehouseProjectPopoverOpen, setSourceWarehouseProjectPopoverOpen] =
    useState(false);
  const [destinationWarehousePopoverOpen, setDestinationWarehousePopoverOpen] =
    useState(false);
  const [destinationProjectPopoverOpen, setDestinationProjectPopoverOpen] =
    useState(false);
  const [receiptPopoverOpen, setReceiptPopoverOpen] = useState(false);
  const [resolvingSapIndex, setResolvingSapIndex] = useState<number | null>(null);
  const [unitPopoverOpen, setUnitPopoverOpen] = useState<number | null>(null);
  const [items, setItems] = useState<ReturnItem[]>([blankReturnItem()]);
  const [missingFields, setMissingFields] = useState<Record<string, string>>({});
  const sourceProjectNumericId = sourceProjectId ? Number(sourceProjectId) : 0;
  const destinationProjectNumericId = destinationProjectId
    ? Number(destinationProjectId)
    : 0;
  const { data: sourceProjectWarehouses } = trpc.warehouses.list.useQuery(
    { projectId: sourceProjectNumericId, isActive: true },
    { enabled: sourceProjectNumericId > 0 }
  );
  const { data: destinationProjectWarehouses } =
    trpc.warehouses.list.useQuery(
      { projectId: destinationProjectNumericId, isActive: true },
      {
        enabled:
          returnType === "devolucion_entre_proyectos" &&
          destinationProjectNumericId > 0,
      }
    );
  const { data: completedPurchaseReceipts } = trpc.receipts.list.useQuery(
    { sourceType: "purchase_order", status: "completa" },
    { enabled: returnType === "devolucion_proveedor" }
  );
  const completedSupplierReceipts = useMemo(
    () => (completedPurchaseReceipts || []).filter((row: any) => row.supplier),
    [completedPurchaseReceipts]
  );
  const projectOptions = useMemo(
    () => [...(projects || [])].sort(compareProjectsByCode),
    [projects]
  );
  const sourceWarehouseOptionsFromProjects = useMemo(() => {
    const byWarehouseId = new Map<number, any>();

    for (const project of projectOptions) {
      for (const warehouse of project.warehouses || []) {
        if (warehouse?.isActive === false) continue;

        const warehouseId = Number(warehouse.id);
        const current =
          byWarehouseId.get(warehouseId) ?? {
            warehouse,
            warehouseId,
            projects: [],
          };

        if (
          !current.projects.some(
            (assignedProject: any) => Number(assignedProject.id) === Number(project.id)
          )
        ) {
          current.projects.push(project);
        }

        byWarehouseId.set(warehouseId, current);
      }
    }

    return Array.from(byWarehouseId.values())
      .map((option: any) => ({
        ...option,
        projects: [...option.projects].sort(compareProjectsByCode),
        searchValue: [
          option.warehouse.code,
          option.warehouse.localCode,
          option.warehouse.name,
          option.warehouse.displayName,
        ]
          .filter(Boolean)
          .join(" "),
      }))
      .sort((left: any, right: any) => {
        const warehouseCompare = projectCodeCollator.compare(
          left.warehouse?.code ?? left.warehouse?.localCode ?? "",
          right.warehouse?.code ?? right.warehouse?.localCode ?? ""
        );
        if (warehouseCompare !== 0) return warehouseCompare;
        return projectCodeCollator.compare(
          left.warehouse?.name ?? "",
          right.warehouse?.name ?? ""
        );
      });
  }, [projectOptions]);
  const selectedSourceWarehouseOption = useMemo(
    () =>
      sourceWarehouseOptionsFromProjects.find(
        (option: any) => String(option.warehouseId) === sourceWarehouseId
      ),
    [sourceWarehouseOptionsFromProjects, sourceWarehouseId]
  );
  const selectedDestinationWarehouseOption = useMemo(
    () =>
      sourceWarehouseOptionsFromProjects.find(
        (option: any) => String(option.warehouseId) === destinationWarehouseId
      ),
    [sourceWarehouseOptionsFromProjects, destinationWarehouseId]
  );
  const sourceProjectOptionsForSelectedWarehouse = useMemo(
    () => selectedSourceWarehouseOption?.projects ?? [],
    [selectedSourceWarehouseOption]
  );
  const destinationProjectOptionsForSelectedWarehouse = useMemo(
    () => selectedDestinationWarehouseOption?.projects ?? [],
    [selectedDestinationWarehouseOption]
  );

  const selectedSourceProject = useMemo(
    () => (projects || []).find((project: any) => String(project.id) === sourceProjectId),
    [projects, sourceProjectId]
  );
  const selectedDestinationProject = useMemo(
    () =>
      (projects || []).find(
        (project: any) => String(project.id) === destinationProjectId
      ),
    [projects, destinationProjectId]
  );
  const selectedDestinationWarehouse = useMemo(
    () =>
      (destinationProjectWarehouses || []).find(
        (warehouse: any) => String(warehouse.id) === destinationWarehouseId
      ) ??
      selectedDestinationWarehouseOption?.warehouse ??
      null,
    [
      destinationProjectWarehouses,
      destinationWarehouseId,
      selectedDestinationWarehouseOption,
    ]
  );
  const selectedReceiptRow = useMemo(
    () =>
      completedSupplierReceipts.find(
        (row: any) => String(row.receipt.id) === sourceReceiptId
      ),
    [completedSupplierReceipts, sourceReceiptId]
  );
  const sourceWarehouseOptions = useMemo(
    () => {
      if (
        returnType !== "devolucion_proveedor" &&
        selectedSourceWarehouseOption?.warehouse
      ) {
        return [selectedSourceWarehouseOption.warehouse];
      }

      return sourceProjectWarehouses || [];
    },
    [returnType, selectedSourceWarehouseOption, sourceProjectWarehouses]
  );
  const defaultSourceWarehouse = useMemo(
    () => sourceWarehouseOptions[0],
    [sourceWarehouseOptions]
  );
  const selectedReceiptNumericId = sourceReceiptId ? Number(sourceReceiptId) : 0;
  const { data: selectedReceiptDetail } = trpc.receipts.getById.useQuery(
    { id: selectedReceiptNumericId },
    {
      enabled:
        returnType === "devolucion_proveedor" &&
        Number.isFinite(selectedReceiptNumericId) &&
        selectedReceiptNumericId > 0,
    }
  );
  const selectedPurchaseOrderId =
    selectedReceiptDetail?.receipt.sourceType === "purchase_order"
      ? selectedReceiptDetail.receipt.sourceId
      : 0;
  const { data: selectedReceiptPurchaseOrder } =
    trpc.purchaseOrders.getById.useQuery(
      { id: selectedPurchaseOrderId },
      {
        enabled:
          returnType === "devolucion_proveedor" &&
          selectedPurchaseOrderId > 0,
      }
    );

  useEffect(() => {
    if (returnType !== "devolucion_proveedor") {
      setSourceReceiptId("");
      setReceiptPopoverOpen(false);
      setSupplierName("");
      return;
    }

    setSourceWarehouseId("");
    setSourceProjectId("");
    setDestinationProjectId("");
    setDestinationWarehouseId("");
    setSourceWarehousePopoverOpen(false);
    setSourceWarehouseProjectPopoverOpen(false);
    setDestinationWarehousePopoverOpen(false);
    setDestinationProjectPopoverOpen(false);
    setItems([blankReturnItem()]);
  }, [returnType]);

  useEffect(() => {
    if (returnType !== "devolucion_entre_proyectos") {
      setDestinationProjectId("");
      setDestinationWarehouseId("");
      setDestinationWarehousePopoverOpen(false);
      setDestinationProjectPopoverOpen(false);
    }
  }, [returnType]);

  useEffect(() => {
    if (returnType !== "devolucion_entre_proyectos") return;
    if (!destinationWarehouseId) {
      setDestinationProjectId("");
      return;
    }

    const activeDestinationProjectIds = new Set(
      destinationProjectOptionsForSelectedWarehouse.map((project: any) =>
        String(project.id)
      )
    );
    if (
      destinationProjectId &&
      activeDestinationProjectIds.has(destinationProjectId)
    ) {
      return;
    }

    setDestinationProjectId(
      destinationProjectOptionsForSelectedWarehouse.length === 1
        ? String(destinationProjectOptionsForSelectedWarehouse[0].id)
        : ""
    );
  }, [
    returnType,
    destinationWarehouseId,
    destinationProjectId,
    destinationProjectOptionsForSelectedWarehouse,
  ]);

  useEffect(() => {
    if (returnType !== "devolucion_proveedor" || !selectedReceiptRow) return;
    setSourceProjectId(String(selectedReceiptRow.receipt.projectId));
    setSupplierName(formatReceiptSupplier(selectedReceiptRow.supplier));
  }, [returnType, selectedReceiptRow]);

  useEffect(() => {
    if (
      returnType === "devolucion_proveedor" ||
      sourceWarehouseOptions.length === 0
    ) {
      return;
    }

    const defaultWarehouseId = defaultSourceWarehouse?.id;
    const activeWarehouseIds = new Set(
      sourceWarehouseOptions.map((warehouse: any) => warehouse.id)
    );

    setItems((current) =>
      current.map((item) =>
        item.warehouseId && activeWarehouseIds.has(item.warehouseId)
          ? item
          : { ...item, warehouseId: defaultWarehouseId }
      )
    );
  }, [returnType, sourceWarehouseOptions, defaultSourceWarehouse?.id]);

  useEffect(() => {
    if (
      returnType !== "devolucion_proveedor" ||
      !sourceReceiptId ||
      !selectedReceiptDetail ||
      !selectedReceiptPurchaseOrder
    ) {
      return;
    }

    const purchaseOrderItemById = new Map(
      (selectedReceiptPurchaseOrder.items || []).map((item: any) => [
        item.id,
        item,
      ])
    );
    const hydratedItems = (selectedReceiptDetail.items || [])
      .filter((item: any) => Number(item.quantityReceived ?? 0) > 0)
      .map((item: any) => {
        const purchaseOrderItem = purchaseOrderItemById.get(item.sourceItemId);
        return {
          warehouseId: item.warehouseId ?? undefined,
          sapItemCode:
            purchaseOrderItem?.currentSapItemCode ||
            purchaseOrderItem?.originalSapItemCode ||
            "",
          itemName: item.itemName,
          quantity: String(item.quantityReceived ?? ""),
          unit: item.unit || purchaseOrderItem?.unit || "",
          condition: "nuevo",
          notes: `Recepción ${selectedReceiptDetail.receipt.receiptNumber}`,
        };
      });

    setItems(hydratedItems.length > 0 ? hydratedItems : [blankReturnItem()]);
  }, [
    returnType,
    sourceReceiptId,
    selectedReceiptDetail,
    selectedReceiptPurchaseOrder,
  ]);

  const getProjectWarehouseLabel = (project: any) => {
    if (!project) return "Seleccione un proyecto para identificar la bodega";
    return (
      project.warehouse?.displayName ??
      `Bodega del Proyecto — ${project.code} — ${project.name}`
    );
  };

  const getWarehouseOptionsForItem = (item: ReturnItem) => {
    if (
      item.warehouseId &&
      !sourceWarehouseOptions.some(
        (warehouse: any) => warehouse.id === item.warehouseId
      )
    ) {
      return [
        {
          id: item.warehouseId,
          displayName: "Almacén registrado en la recepción",
        },
        ...sourceWarehouseOptions,
      ];
    }

    return sourceWarehouseOptions;
  };

  const createMutation = trpc.reverseLogistics.create.useMutation({
    onSuccess: (data) => {
      toast.success(`Devolución ${data.returnNumber} creada exitosamente`);
      setLocation("/devoluciones");
    },
    onError: (error) => {
      toast.error(`Error: ${error.message}`);
    },
  });
  const lookupSapItemMutation = trpc.requestItems.lookupSapItem.useMutation({
    onError: (error) => toast.error(error.message),
  });

  const addItem = () => {
    setItems([
      ...items,
      {
        ...blankReturnItem(),
        warehouseId: selectedSourceWarehouseOption?.warehouseId,
      },
    ]);
  };

  const removeItem = (index: number) => {
    if (items.length === 1) return;
    setItems(items.filter((_, i) => i !== index));
    setMissingFields({});
  };

  const updateItem = (
    index: number,
    field: keyof ReturnItem,
    value: ReturnItem[keyof ReturnItem]
  ) => {
    const updated = [...items];
    updated[index] = { ...updated[index], [field]: value };
    setItems(updated);
    const shouldClear =
      (field === "itemName" && String(value).trim()) ||
      (field === "quantity" && String(value).trim()) ||
      (field === "condition" && String(value).trim()) ||
      (field === "warehouseId" && Boolean(value));
    if (shouldClear) {
      setMissingFields((current) => {
        const key = `item:${index}:${field}`;
        if (!(key in current)) return current;
        const { [key]: _removed, ...next } = current;
        return next;
      });
    }
  };

  const clearMissingField = (key: string) => {
    setMissingFields((current) => {
      if (!(key in current)) return current;
      const { [key]: _removed, ...next } = current;
      return next;
    });
  };

  const clearMissingFields = (keys: string[]) => {
    setMissingFields((current) => {
      let changed = false;
      const next = { ...current };
      keys.forEach((key) => {
        if (key in next) {
          delete next[key];
          changed = true;
        }
      });
      return changed ? next : current;
    });
  };

  const hasMissingField = (key: string) => key in missingFields;

  const getItemMissingLabels = (index: number) =>
    Object.entries(missingFields)
      .filter(([key]) => key.startsWith(`item:${index}:`))
      .map(([, label]) => label.replace(`Ítem ${index + 1}: `, ""));

  const resolveSapItem = async (index: number) => {
    const row = items[index];
    const normalizedSapItemCode = row?.sapItemCode.trim();
    if (!normalizedSapItemCode) return;

    setResolvingSapIndex(index);
    try {
      const result = await lookupSapItemMutation.mutateAsync({
        sapItemCode: normalizedSapItemCode,
      });

      if (!result) {
        setItems((current) => {
          const next = [...current];
          if (!next[index]) return current;
          next[index] = {
            ...next[index],
            sapItemCode: normalizedSapItemCode,
          };
          return next;
        });
        toast.error(
          `No se encontró una coincidencia única para ${normalizedSapItemCode}`
        );
        return;
      }

      setItems((current) => {
        const next = [...current];
        const currentRow = next[index];
        if (!currentRow) return current;

        next[index] = {
          ...currentRow,
          sapItemCode: result.sapItemCode,
          itemName: result.itemName || currentRow.itemName,
          unit: currentRow.unit.trim() || result.unit || currentRow.unit,
        };
        return next;
      });
    } finally {
      setResolvingSapIndex((current) => (current === index ? null : current));
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const normalizedReceivedByName = receivedByName.trim();

    const validItems = items.filter(
      (item) =>
        item.itemName.trim() && item.quantity.trim() && item.condition.trim()
    );
    const requiresWarehouse = [
      "devolucion_bodega_central",
      "devolucion_bodega_proyecto",
      "devolucion_entre_proyectos",
      "devolucion_proveedor",
    ].includes(returnType);
    const itemWithoutWarehouse = validItems.find((item) => !item.warehouseId);

    const missing: Record<string, string> = {};
    if (!returnType) missing.returnType = "Tipo de devolución";
    if (!reasonCategory) missing.reasonCategory = "Categoría del motivo";
    if (!normalizedReceivedByName) missing.receivedByName = "Recibido por";
    if (returnType === "devolucion_proveedor" && !sourceReceiptId) {
      missing.sourceReceiptId = "Recepción completada";
    }
    if (returnType === "devolucion_entre_proyectos") {
      if (!destinationWarehouseId) {
        missing.destinationWarehouseId = "Bodega destino";
      }
      if (!destinationProjectId) {
        missing.destinationProjectId = "Proyecto destino";
      }
    }
    if (returnType && returnType !== "devolucion_proveedor" && !sourceWarehouseId) {
      missing.sourceWarehouseId = "Bodega origen";
    }
    if (returnType && returnType !== "devolucion_proveedor" && !sourceProjectId) {
      missing.sourceProjectId = "Proyecto de la bodega";
    }
    if (justification.trim().length < 10) {
      missing.justification = "Justificación (mínimo 10 caracteres)";
    }

    if (validItems.length === 0) {
      items.forEach((item, index) => {
        if (!item.itemName.trim()) {
          missing[`item:${index}:itemName`] = `Ítem ${index + 1}: nombre`;
        }
        if (!item.quantity.trim()) {
          missing[`item:${index}:quantity`] = `Ítem ${index + 1}: cantidad`;
        }
        if (!item.condition.trim()) {
          missing[`item:${index}:condition`] = `Ítem ${index + 1}: condición`;
        }
        if (requiresWarehouse && !item.warehouseId) {
          missing[`item:${index}:warehouseId`] = `Ítem ${index + 1}: almacén`;
        }
      });
    }

    if (requiresWarehouse && itemWithoutWarehouse) {
      items.forEach((item, index) => {
        if (
          item.itemName.trim() &&
          item.quantity.trim() &&
          item.condition.trim() &&
          !item.warehouseId
        ) {
          missing[`item:${index}:warehouseId`] = `Ítem ${index + 1}: almacén`;
        }
      });
    }

    if (Object.keys(missing).length > 0) {
      setMissingFields(missing);
      const labels = Object.values(missing);
      toast.error(
        `Faltan: ${labels.slice(0, 4).join(", ")}${
          labels.length > 4 ? ` y ${labels.length - 4} más` : ""
        }`
      );
      window.requestAnimationFrame(() => {
        document
          .querySelector("[data-required-error='true']")
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
      return;
    }

    setMissingFields({});

    createMutation.mutate({
      returnType: returnType as any,
      reasonCategory: reasonCategory as any,
      justification,
      receivedByName: normalizedReceivedByName,
      sourceProjectId: parseInt(sourceProjectId),
      destinationProjectId: destinationProjectId
        ? parseInt(destinationProjectId)
        : undefined,
      destinationWarehouseId: destinationWarehouseId
        ? parseInt(destinationWarehouseId)
        : undefined,
      sourceReceiptId: sourceReceiptId ? parseInt(sourceReceiptId) : undefined,
      supplierName: supplierName || undefined,
      items: validItems.map((item) => ({
        warehouseId: item.warehouseId,
        sapItemCode: item.sapItemCode || undefined,
        itemName: item.itemName,
        quantity: item.quantity,
        unit: item.unit || undefined,
        condition: item.condition as any,
        notes: item.notes || undefined,
      })),
    });
  };

  return (
    <div className="w-full max-w-none space-y-6">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setLocation("/devoluciones")}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1>Nueva Devolución</h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {Object.keys(missingFields).length > 0 ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            <p className="font-semibold">Complete los campos marcados.</p>
            <p className="mt-1">
              Faltan: {Object.values(missingFields).join(", ")}.
            </p>
          </div>
        ) : null}

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Información de la Devolución
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div
                className="space-y-2"
                data-required-error={hasMissingField("returnType") || undefined}
              >
                <Label>Tipo de devolución *</Label>
                <Select
                  value={returnType}
                  onValueChange={(value) => {
                    setReturnType(value);
                    clearMissingFields(["returnType"]);
                  }}
                >
                  <SelectTrigger
                    className={fieldErrorClass(
                      hasMissingField("returnType"),
                      "w-full"
                    )}
                  >
                    <SelectValue placeholder="Seleccione tipo" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="devolucion_bodega_central">
                      Devolución a Bodega Central
                    </SelectItem>
                    <SelectItem value="devolucion_entre_proyectos">
                      Devolución entre Bodegas
                    </SelectItem>
                    <SelectItem value="devolucion_proveedor">
                      Devolución a Proveedor
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div
                className="space-y-2"
                data-required-error={hasMissingField("reasonCategory") || undefined}
              >
                <Label>Categoría del motivo *</Label>
                <Select
                  value={reasonCategory}
                  onValueChange={(value) => {
                    setReasonCategory(value);
                    clearMissingField("reasonCategory");
                  }}
                >
                  <SelectTrigger
                    className={fieldErrorClass(
                      hasMissingField("reasonCategory"),
                      "w-full"
                    )}
                  >
                    <SelectValue placeholder="Seleccione motivo" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="material_defectuoso">
                      Material defectuoso
                    </SelectItem>
                    <SelectItem value="excedente">Excedente</SelectItem>
                    <SelectItem value="error_pedido">
                      Error de pedido
                    </SelectItem>
                    <SelectItem value="cambio_especificacion">
                      Cambio de especificación
                    </SelectItem>
                    <SelectItem value="otro">Otro</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div
                className="space-y-2"
                data-required-error={hasMissingField("receivedByName") || undefined}
              >
                <Label>Recibido por *</Label>
                <Input
                  value={receivedByName}
                  onChange={(event) => {
                    setReceivedByName(event.target.value);
                    if (event.target.value.trim()) {
                      clearMissingField("receivedByName");
                    }
                  }}
                  placeholder="Nombre de quien recibe"
                  maxLength={255}
                  className={fieldErrorClass(hasMissingField("receivedByName"))}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div
                className="space-y-2"
                data-required-error={hasMissingField("sourceWarehouseId") || undefined}
              >
                <Label>Bodega origen *</Label>
                <Popover
                  open={sourceWarehousePopoverOpen}
                  onOpenChange={setSourceWarehousePopoverOpen}
                >
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      role="combobox"
                      aria-expanded={sourceWarehousePopoverOpen}
                      disabled={returnType === "devolucion_proveedor"}
                      className={fieldErrorClass(
                        hasMissingField("sourceWarehouseId"),
                        "h-10 w-full justify-between overflow-hidden px-3 font-normal"
                      )}
                    >
                      <span
                        className={`truncate ${
                          sourceWarehouseId ? "" : "text-muted-foreground"
                        }`}
                      >
                        {returnType === "devolucion_proveedor" && !sourceProjectId
                          ? "Seleccione una recepción"
                          : returnType === "devolucion_proveedor"
                            ? "Según recepción seleccionada"
                            : selectedSourceWarehouseOption
                              ? formatWarehouseLabel(
                                  selectedSourceWarehouseOption.warehouse
                                )
                              : "Seleccione bodega"}
                      </span>
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    align="start"
                    className="w-[var(--radix-popover-trigger-width)] p-0"
                  >
                    <Command>
                      <CommandInput placeholder="Buscar bodega por código o nombre..." />
                      <CommandList>
                        <CommandEmpty>No se encontraron bodegas.</CommandEmpty>
                        <CommandGroup>
                          {sourceWarehouseOptionsFromProjects.map((option: any) => (
                            <CommandItem
                              key={option.warehouseId}
                              value={option.searchValue}
                              onSelect={() => {
                                const nextProjectId =
                                  option.projects.length === 1
                                    ? String(option.projects[0].id)
                                    : "";
                                setSourceWarehouseId(String(option.warehouseId));
                                setSourceProjectId(nextProjectId);
                                clearMissingFields([
                                  "sourceWarehouseId",
                                  ...(nextProjectId ? ["sourceProjectId"] : []),
                                ]);
                                setSourceWarehousePopoverOpen(false);
                                setSourceWarehouseProjectPopoverOpen(false);
                                setItems((current) =>
                                  current.map((item) => ({
                                    ...item,
                                    warehouseId: option.warehouseId,
                                  }))
                                );
                              }}
                            >
                              <Check
                                className={`h-4 w-4 ${
                                  sourceWarehouseId === String(option.warehouseId)
                                    ? "opacity-100"
                                    : "opacity-0"
                                }`}
                              />
                              <div className="min-w-0">
                                <p className="truncate">
                                  {formatWarehouseLabel(option.warehouse)}
                                </p>
                                <p className="truncate text-xs text-muted-foreground">
                                  {option.projects.length === 1
                                    ? formatProjectLabel(option.projects[0])
                                    : `${option.projects.length} proyectos asignados`}
                                </p>
                              </div>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>

              {returnType !== "devolucion_proveedor" && (
                <div
                  className="space-y-2"
                  data-required-error={hasMissingField("sourceProjectId") || undefined}
                >
                  <Label>Proyecto de la bodega *</Label>
                  <Popover
                    open={sourceWarehouseProjectPopoverOpen}
                    onOpenChange={setSourceWarehouseProjectPopoverOpen}
                  >
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        role="combobox"
                        aria-expanded={sourceWarehouseProjectPopoverOpen}
                        disabled={!sourceWarehouseId}
                        className={fieldErrorClass(
                          hasMissingField("sourceProjectId"),
                          "h-10 w-full justify-between overflow-hidden px-3 font-normal"
                        )}
                      >
                        <span
                          className={`truncate ${
                            sourceProjectId ? "" : "text-muted-foreground"
                          }`}
                        >
                          {sourceProjectId
                            ? formatProjectLabel(selectedSourceProject)
                            : sourceWarehouseId
                              ? "Seleccione proyecto"
                              : "Seleccione bodega primero"}
                        </span>
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent
                      align="start"
                      className="w-[var(--radix-popover-trigger-width)] p-0"
                    >
                      <Command>
                        <CommandInput placeholder="Buscar proyecto por código o nombre..." />
                        <CommandList>
                          <CommandEmpty>No se encontraron proyectos.</CommandEmpty>
                          <CommandGroup>
                            {sourceProjectOptionsForSelectedWarehouse.map(
                              (project: any) => (
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
                                    setSourceProjectId(String(project.id));
                                    clearMissingField("sourceProjectId");
                                    setSourceWarehouseProjectPopoverOpen(false);
                                  }}
                                >
                                  <Check
                                    className={`h-4 w-4 ${
                                      sourceProjectId === String(project.id)
                                        ? "opacity-100"
                                        : "opacity-0"
                                    }`}
                                  />
                                  <span className="truncate">
                                    {formatProjectLabel(project)}
                                  </span>
                                </CommandItem>
                              )
                            )}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </div>
              )}

              {returnType === "devolucion_entre_proyectos" && (
                <div
                  className="space-y-2"
                  data-required-error={hasMissingField("destinationWarehouseId") || undefined}
                >
                  <Label>Bodega destino *</Label>
                  <Popover
                    open={destinationWarehousePopoverOpen}
                    onOpenChange={setDestinationWarehousePopoverOpen}
                  >
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        role="combobox"
                        aria-expanded={destinationWarehousePopoverOpen}
                        className={fieldErrorClass(
                          hasMissingField("destinationWarehouseId"),
                          "h-10 w-full justify-between overflow-hidden px-3 font-normal"
                        )}
                      >
                        <span
                          className={`truncate ${
                            destinationWarehouseId ? "" : "text-muted-foreground"
                          }`}
                        >
                          {selectedDestinationWarehouseOption
                            ? formatWarehouseLabel(
                                selectedDestinationWarehouseOption.warehouse
                              )
                            : "Seleccione bodega destino"}
                        </span>
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent
                      align="start"
                      className="w-[var(--radix-popover-trigger-width)] p-0"
                    >
                      <Command>
                        <CommandInput placeholder="Buscar bodega por código o nombre..." />
                        <CommandList>
                          <CommandEmpty>No se encontraron bodegas.</CommandEmpty>
                          <CommandGroup>
                            {sourceWarehouseOptionsFromProjects.map((option: any) => (
                              <CommandItem
                                key={option.warehouseId}
                                value={option.searchValue}
                                onSelect={() => {
                                  const nextProjectId =
                                    option.projects.length === 1
                                      ? String(option.projects[0].id)
                                      : "";
                                  setDestinationWarehouseId(
                                    String(option.warehouseId)
                                  );
                                  setDestinationProjectId(nextProjectId);
                                  clearMissingFields([
                                    "destinationWarehouseId",
                                    ...(nextProjectId
                                      ? ["destinationProjectId"]
                                      : []),
                                  ]);
                                  setDestinationWarehousePopoverOpen(false);
                                  setDestinationProjectPopoverOpen(false);
                                }}
                              >
                                <Check
                                  className={`h-4 w-4 ${
                                    destinationWarehouseId ===
                                    String(option.warehouseId)
                                      ? "opacity-100"
                                      : "opacity-0"
                                  }`}
                                />
                                <div className="min-w-0">
                                  <p className="truncate">
                                    {formatWarehouseLabel(option.warehouse)}
                                  </p>
                                  <p className="truncate text-xs text-muted-foreground">
                                    {option.projects.length === 1
                                      ? formatProjectLabel(option.projects[0])
                                      : `${option.projects.length} proyectos asignados`}
                                  </p>
                                </div>
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </div>
              )}

              {returnType === "devolucion_entre_proyectos" && (
                <div
                  className="space-y-2"
                  data-required-error={hasMissingField("destinationProjectId") || undefined}
                >
                  <Label>Proyecto destino *</Label>
                  <Popover
                    open={destinationProjectPopoverOpen}
                    onOpenChange={setDestinationProjectPopoverOpen}
                  >
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        role="combobox"
                        aria-expanded={destinationProjectPopoverOpen}
                        disabled={!destinationWarehouseId}
                        className={fieldErrorClass(
                          hasMissingField("destinationProjectId"),
                          "h-10 w-full justify-between overflow-hidden px-3 font-normal"
                        )}
                      >
                        <span
                          className={`truncate ${
                            destinationProjectId ? "" : "text-muted-foreground"
                          }`}
                        >
                          {destinationProjectId
                            ? formatProjectLabel(selectedDestinationProject)
                            : destinationWarehouseId
                              ? "Seleccione proyecto destino"
                              : "Seleccione bodega destino primero"}
                        </span>
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent
                      align="start"
                      className="w-[var(--radix-popover-trigger-width)] p-0"
                    >
                      <Command>
                        <CommandInput placeholder="Buscar proyecto por código o nombre..." />
                        <CommandList>
                          <CommandEmpty>No se encontraron proyectos.</CommandEmpty>
                          <CommandGroup>
                            {destinationProjectOptionsForSelectedWarehouse.map(
                              (project: any) => (
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
                                    setDestinationProjectId(String(project.id));
                                    clearMissingField("destinationProjectId");
                                    setDestinationProjectPopoverOpen(false);
                                  }}
                                >
                                  <Check
                                    className={`h-4 w-4 ${
                                      destinationProjectId === String(project.id)
                                        ? "opacity-100"
                                        : "opacity-0"
                                    }`}
                                  />
                                  <span className="truncate">
                                    {formatProjectLabel(project)}
                                  </span>
                                </CommandItem>
                              )
                            )}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </div>
              )}

              {returnType === "devolucion_proveedor" && (
                <div
                  className="space-y-2"
                  data-required-error={hasMissingField("sourceReceiptId") || undefined}
                >
                  <Label>Recepción completada *</Label>
                  <Popover
                    open={receiptPopoverOpen}
                    onOpenChange={setReceiptPopoverOpen}
                  >
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        role="combobox"
                        aria-expanded={receiptPopoverOpen}
                        className={fieldErrorClass(
                          hasMissingField("sourceReceiptId"),
                          "h-10 w-full justify-between overflow-hidden px-3 font-normal"
                        )}
                      >
                        <span className="truncate">
                          {formatCompletedReceiptLabel(selectedReceiptRow)}
                        </span>
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent
                      align="start"
                      className="w-[var(--radix-popover-trigger-width)] p-0"
                    >
                      <Command>
                        <CommandInput placeholder="Buscar por recepción, OC, proveedor o proyecto..." />
                        <CommandList>
                          <CommandEmpty>No se encontraron recepciones completadas con proveedor.</CommandEmpty>
                          <CommandGroup>
                            {completedSupplierReceipts.map((row: any) => {
                              const receiptId = String(row.receipt.id);
                              const selected = sourceReceiptId === receiptId;
                              const searchValue = [
                                row.receipt.receiptNumber,
                                row.purchaseOrder?.orderNumber,
                                row.supplier?.supplierCode,
                                row.supplier?.name,
                                row.project?.code,
                                row.project?.name,
                                row.receipt.invoiceNumber,
                              ]
                                .filter(Boolean)
                                .join(" ");

                              return (
                                <CommandItem
                                  key={row.receipt.id}
                                  value={searchValue}
                                  onSelect={() => {
                                    setSourceReceiptId(receiptId);
                                    setSourceProjectId(String(row.receipt.projectId));
                                    setSupplierName(formatReceiptSupplier(row.supplier));
                                    clearMissingFields([
                                      "sourceReceiptId",
                                      "sourceProjectId",
                                    ]);
                                    setItems([blankReturnItem()]);
                                    setReceiptPopoverOpen(false);
                                  }}
                                >
                                  <Check
                                    className={`h-4 w-4 ${
                                      selected ? "opacity-100" : "opacity-0"
                                    }`}
                                  />
                                  <span className="truncate">
                                    {formatCompletedReceiptLabel(row)}
                                  </span>
                                </CommandItem>
                              );
                            })}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                  {supplierName && (
                    <p className="text-xs text-muted-foreground">
                      Proveedor:{" "}
                      <span className="font-medium text-foreground">
                        {supplierName}
                      </span>
                    </p>
                  )}
                  {sourceReceiptId && (
                    <p className="text-xs text-muted-foreground">
                      Se generará una nota de crédito para la recepción seleccionada.
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2 rounded-lg border border-primary/20 bg-primary/5 p-4">
                <Label className="text-sm font-semibold text-foreground">
                  {returnType === "devolucion_bodega_proyecto"
                    ? "Proyecto que recibe la devolución"
                    : "Proyecto asociado"}
                </Label>
                <p className="text-sm font-medium text-foreground">
                  {selectedSourceProject
                    ? formatProjectLabel(selectedSourceProject)
                    : "Seleccione bodega origen"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {returnType === "devolucion_bodega_proyecto"
                    ? "Al crear esta devolución, el inventario se cargará a la bodega seleccionada."
                    : "La devolución saldrá desde la bodega seleccionada."}
                </p>
              </div>

              {returnType === "devolucion_entre_proyectos" && (
                <div className="space-y-2 rounded-lg border border-primary/20 bg-primary/5 p-4">
                  <Label className="text-sm font-semibold text-foreground">
                    Bodega del proyecto destino
                  </Label>
                  <p className="text-sm font-medium text-foreground">
                    {selectedDestinationWarehouse
                      ? formatWarehouseLabel(selectedDestinationWarehouse)
                      : selectedDestinationProject
                        ? "Seleccione bodega destino"
                        : getProjectWarehouseLabel(selectedDestinationProject)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    El material quedará asociado a esta bodega al recibirse.
                  </p>
                </div>
              )}
            </div>

            <div
              className="space-y-2"
              data-required-error={hasMissingField("justification") || undefined}
            >
              <Label>
                Justificación * <span className="text-xs text-muted-foreground">(mínimo 10 caracteres)</span>
              </Label>
              <Textarea
                value={justification}
                onChange={(e) => {
                  setJustification(e.target.value);
                  if (e.target.value.trim().length >= 10) {
                    clearMissingField("justification");
                  }
                }}
                placeholder="Explique detalladamente el motivo de la devolución..."
                rows={3}
                className={fieldErrorClass(hasMissingField("justification"))}
              />
              <p className="text-xs text-muted-foreground text-right">
                {justification.length} / 10 mín.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Ítems a Devolver
            </CardTitle>
            <Button type="button" variant="outline" size="sm" onClick={addItem}>
              <Plus className="h-4 w-4 mr-1" />
              Agregar ítem
            </Button>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {items.map((item, index) => (
                <div
                  key={index}
                  className={fieldErrorClass(
                    getItemMissingLabels(index).length > 0,
                    "p-3 border border-border rounded space-y-3"
                  )}
                  data-required-error={
                    getItemMissingLabels(index).length > 0 || undefined
                  }
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-muted-foreground uppercase">
                      Ítem {index + 1}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeItem(index)}
                      disabled={items.length === 1}
                      className="text-muted-foreground hover:text-destructive h-6"
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
                    <div className="space-y-1 md:col-span-3">
                      <Label className="text-xs font-medium text-muted-foreground">
                        Código SAP / descripción
                      </Label>
                      <SapItemSearchInput
                        value={item.sapItemCode}
                        resolving={resolvingSapIndex === index}
                        disabled={resolvingSapIndex === index}
                        onChange={(value) =>
                          updateItem(index, "sapItemCode", value)
                        }
                        onSelect={(sapItemCode, itemName) => {
                          setItems((current) => {
                            const next = [...current];
                            if (!next[index]) return current;
                            next[index] = {
                              ...next[index],
                              sapItemCode,
                              itemName,
                            };
                            return next;
                          });
                          clearMissingField(`item:${index}:itemName`);
                        }}
                        onResolve={() => void resolveSapItem(index)}
                      />
                    </div>
                    <div className="space-y-1 md:col-span-3">
                      <Label className="text-xs font-medium text-muted-foreground">
                        Nombre del ítem
                      </Label>
                      <Input
                        placeholder="Nombre del ítem"
                        value={item.itemName}
                        onChange={(e) =>
                          updateItem(index, "itemName", e.target.value)
                        }
                        className={fieldErrorClass(
                          hasMissingField(`item:${index}:itemName`)
                        )}
                      />
                    </div>
                    <div className="space-y-1 md:col-span-2">
                      <Label className="text-xs font-medium text-muted-foreground">
                        Almacén
                      </Label>
                      <Select
                        value={item.warehouseId ? String(item.warehouseId) : ""}
                        onValueChange={(value) =>
                          updateItem(index, "warehouseId", Number(value))
                        }
                        disabled={
                          returnType === "devolucion_proveedor" ||
                          Boolean(sourceWarehouseId) ||
                          sourceWarehouseOptions.length === 0
                        }
                      >
                        <SelectTrigger
                          className={fieldErrorClass(
                            hasMissingField(`item:${index}:warehouseId`),
                            "w-full min-w-0"
                          )}
                        >
                          <SelectValue
                            placeholder={
                              sourceProjectId
                                ? "Seleccione almacén"
                                : "Seleccione bodega"
                            }
                          />
                        </SelectTrigger>
                        <SelectContent>
                          {getWarehouseOptionsForItem(item).map((warehouse: any) => (
                            <SelectItem
                              key={warehouse.id}
                              value={String(warehouse.id)}
                            >
                              {formatWarehouseLabel(warehouse)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1 md:col-span-1">
                      <Label className="text-xs font-medium text-muted-foreground">
                        Cant.
                      </Label>
                      <Input
                        type="number"
                        placeholder="Cant."
                        value={item.quantity}
                        onChange={(e) =>
                          updateItem(index, "quantity", e.target.value)
                        }
                        className={fieldErrorClass(
                          hasMissingField(`item:${index}:quantity`)
                        )}
                      />
                    </div>
                    <div className="space-y-1 md:col-span-2">
                      <Label className="text-xs font-medium text-muted-foreground">
                        Unidad
                      </Label>
                      <UnitCombobox
                        value={item.unit}
                        open={unitPopoverOpen === index}
                        onOpenChange={(open) =>
                          setUnitPopoverOpen(open ? index : null)
                        }
                        onChange={(value) =>
                          updateItem(index, "unit", value)
                        }
                      />
                    </div>
                    <div className="space-y-1 md:col-span-2">
                      <Label className="text-xs font-medium text-muted-foreground">
                        Condición
                      </Label>
                      <Select
                        value={item.condition}
                        onValueChange={(val) =>
                          updateItem(index, "condition", val)
                        }
                      >
                        <SelectTrigger
                          className={fieldErrorClass(
                            hasMissingField(`item:${index}:condition`),
                            "w-full min-w-0"
                          )}
                        >
                          <SelectValue placeholder="Condición" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="nuevo">Nuevo</SelectItem>
                          <SelectItem value="usado_buen_estado">
                            Usado - Buen estado
                          </SelectItem>
                          <SelectItem value="defectuoso">
                            Defectuoso
                          </SelectItem>
                          <SelectItem value="danado">Dañado</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  {getItemMissingLabels(index).length > 0 ? (
                    <p className="text-xs font-medium text-destructive">
                      Falta: {getItemMissingLabels(index).join(", ")}.
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="flex items-center gap-3 justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={() => setLocation("/devoluciones")}
          >
            Cancelar
          </Button>
          <Button type="submit" disabled={createMutation.isPending}>
            {createMutation.isPending ? "Creando..." : "Crear Devolución"}
          </Button>
        </div>
      </form>
    </div>
  );
}
