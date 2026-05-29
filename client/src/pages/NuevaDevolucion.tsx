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
  const [sourceProjectId, setSourceProjectId] = useState("");
  const [destinationProjectId, setDestinationProjectId] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [sourceReceiptId, setSourceReceiptId] = useState("");
  const [sourceProjectPopoverOpen, setSourceProjectPopoverOpen] = useState(false);
  const [destinationProjectPopoverOpen, setDestinationProjectPopoverOpen] =
    useState(false);
  const [receiptPopoverOpen, setReceiptPopoverOpen] = useState(false);
  const [resolvingSapIndex, setResolvingSapIndex] = useState<number | null>(null);
  const [unitPopoverOpen, setUnitPopoverOpen] = useState<number | null>(null);
  const [items, setItems] = useState<ReturnItem[]>([blankReturnItem()]);
  const sourceProjectNumericId = sourceProjectId ? Number(sourceProjectId) : 0;
  const { data: sourceProjectWarehouses } = trpc.warehouses.list.useQuery(
    { projectId: sourceProjectNumericId, isActive: true },
    { enabled: sourceProjectNumericId > 0 }
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
  const selectedReceiptRow = useMemo(
    () =>
      completedSupplierReceipts.find(
        (row: any) => String(row.receipt.id) === sourceReceiptId
      ),
    [completedSupplierReceipts, sourceReceiptId]
  );
  const sourceWarehouseOptions = useMemo(
    () => sourceProjectWarehouses || [],
    [sourceProjectWarehouses]
  );
  const defaultSourceWarehouse = useMemo(
    () =>
      sourceWarehouseOptions.find((warehouse: any) => warehouse.isDefault) ||
      sourceWarehouseOptions[0],
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
    }
  }, [returnType]);

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

  const formatWarehouseLabel = (warehouse: any) =>
    warehouse?.displayName ||
    [warehouse?.localCode || warehouse?.code, warehouse?.name]
      .filter(Boolean)
      .join(" - ") ||
    "Almacén";

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
    setItems([...items, blankReturnItem()]);
  };

  const removeItem = (index: number) => {
    if (items.length === 1) return;
    setItems(items.filter((_, i) => i !== index));
  };

  const updateItem = (
    index: number,
    field: keyof ReturnItem,
    value: ReturnItem[keyof ReturnItem]
  ) => {
    const updated = [...items];
    updated[index] = { ...updated[index], [field]: value };
    setItems(updated);
  };

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

    if (!returnType || !reasonCategory) {
      toast.error("Complete todos los campos obligatorios");
      return;
    }

    if (returnType === "devolucion_proveedor" && !sourceReceiptId) {
      toast.error("Seleccione una recepción completada para generar la nota de crédito");
      return;
    }

    if (!sourceProjectId) {
      toast.error("Complete todos los campos obligatorios");
      return;
    }

    if (justification.length < 10) {
      toast.error(
        "La justificación debe tener al menos 10 caracteres"
      );
      return;
    }

    const validItems = items.filter(
      (item) => item.itemName && item.quantity && item.condition
    );
    if (validItems.length === 0) {
      toast.error(
        "Debe agregar al menos un ítem con nombre, cantidad y condición"
      );
      return;
    }

    const requiresWarehouse = [
      "devolucion_bodega_central",
      "devolucion_bodega_proyecto",
      "devolucion_entre_proyectos",
      "devolucion_proveedor",
    ].includes(returnType);
    const itemWithoutWarehouse = validItems.find((item) => !item.warehouseId);
    if (requiresWarehouse && itemWithoutWarehouse) {
      toast.error(`Seleccione almacén para ${itemWithoutWarehouse.itemName}`);
      return;
    }

    createMutation.mutate({
      returnType: returnType as any,
      reasonCategory: reasonCategory as any,
      justification,
      sourceProjectId: parseInt(sourceProjectId),
      destinationProjectId: destinationProjectId
        ? parseInt(destinationProjectId)
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
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Información de la Devolución
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Tipo de devolución *</Label>
                <Select value={returnType} onValueChange={setReturnType}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Seleccione tipo" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="devolucion_bodega_central">
                      Devolución a Bodega Central
                    </SelectItem>
                    <SelectItem value="devolucion_entre_proyectos">
                      Devolución entre Proyectos
                    </SelectItem>
                    <SelectItem value="devolucion_proveedor">
                      Devolución a Proveedor
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Categoría del motivo *</Label>
                <Select
                  value={reasonCategory}
                  onValueChange={setReasonCategory}
                >
                  <SelectTrigger className="w-full">
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
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>
                  {returnType === "devolucion_bodega_proyecto"
                    ? "Proyecto que recibe la devolución *"
                    : "Proyecto origen *"}
                </Label>
                <Popover
                  open={sourceProjectPopoverOpen}
                  onOpenChange={setSourceProjectPopoverOpen}
                >
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      role="combobox"
                      aria-expanded={sourceProjectPopoverOpen}
                      disabled={returnType === "devolucion_proveedor"}
                      className="h-10 w-full justify-between overflow-hidden px-3 font-normal"
                    >
                      <span
                        className={`truncate ${
                          sourceProjectId ? "" : "text-muted-foreground"
                        }`}
                      >
                        {returnType === "devolucion_proveedor" && !sourceProjectId
                          ? "Seleccione una recepción"
                          : formatProjectLabel(selectedSourceProject)}
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
                          {projectOptions.map((project: any) => (
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
                                setSourceProjectPopoverOpen(false);
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
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>

              {returnType === "devolucion_entre_proyectos" && (
                <div className="space-y-2">
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
                        className="h-10 w-full justify-between overflow-hidden px-3 font-normal"
                      >
                        <span
                          className={`truncate ${
                            destinationProjectId ? "" : "text-muted-foreground"
                          }`}
                        >
                          {formatProjectLabel(selectedDestinationProject)}
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
                            {projectOptions.map((project: any) => (
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
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </div>
              )}

              {returnType === "devolucion_proveedor" && (
                <div className="space-y-2">
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
                        className="h-10 w-full justify-between overflow-hidden px-3 font-normal"
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
                    ? "Bodega que recibe la devolución"
                    : "Bodega del proyecto origen"}
                </Label>
                <p className="text-sm font-medium text-foreground">
                  {getProjectWarehouseLabel(selectedSourceProject)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {returnType === "devolucion_bodega_proyecto"
                    ? "Al crear esta devolución, el inventario se cargará a esta bodega."
                    : "La devolución saldrá desde esta bodega operativa."}
                </p>
              </div>

              {returnType === "devolucion_entre_proyectos" && (
                <div className="space-y-2 rounded-lg border border-primary/20 bg-primary/5 p-4">
                  <Label className="text-sm font-semibold text-foreground">
                    Bodega del proyecto destino
                  </Label>
                  <p className="text-sm font-medium text-foreground">
                    {getProjectWarehouseLabel(selectedDestinationProject)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    El material quedará asociado a esta bodega al recibirse.
                  </p>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label>
                Justificación * <span className="text-xs text-muted-foreground">(mínimo 10 caracteres)</span>
              </Label>
              <Textarea
                value={justification}
                onChange={(e) => setJustification(e.target.value)}
                placeholder="Explique detalladamente el motivo de la devolución..."
                rows={3}
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
                  className="p-3 border border-border rounded space-y-3"
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
                          sourceWarehouseOptions.length === 0
                        }
                      >
                        <SelectTrigger className="w-full min-w-0">
                          <SelectValue
                            placeholder={
                              sourceProjectId
                                ? "Seleccione almacén"
                                : "Seleccione proyecto"
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
                        <SelectTrigger className="w-full min-w-0">
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
