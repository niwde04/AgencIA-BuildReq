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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { Check, ChevronsUpDown, Eye, Package, Plus, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { UNITS } from "@shared/units";

type OpeningBalanceItemRow = {
  sapItemCode: string;
  itemName: string;
  quantity: string;
  unit: string;
  notes: string;
};

const EMPTY_ROW: OpeningBalanceItemRow = {
  sapItemCode: "",
  itemName: "",
  quantity: "",
  unit: "",
  notes: "",
};

function formatProjectLabel(project: any | null | undefined) {
  if (!project) return "Seleccione proyecto";
  return `${project.code} - ${project.name}`;
}

function formatWarehouseLabel(warehouse: any | null | undefined) {
  if (!warehouse) return "Seleccione almacén";
  const localCode = warehouse.localCode || warehouse.code;
  if (localCode && warehouse.name) return `${localCode} - ${warehouse.name}`;
  return warehouse.displayName || warehouse.name || warehouse.code || "Seleccione almacén";
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
  disabled?: boolean;
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

  return (
    <Popover open={open && hasSearch} onOpenChange={setOpen}>
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
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selectedUnit = UNITS.find((unit) => unit.value === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="h-10 w-full justify-between px-3 font-normal"
        >
          <span className={`truncate ${value ? "" : "text-muted-foreground"}`}>
            {selectedUnit?.label || value || "Seleccione unidad"}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[260px] p-0">
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
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={`h-4 w-4 ${
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

export default function SaldosIniciales() {
  const utils = trpc.useUtils();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [resolvingSapIndex, setResolvingSapIndex] = useState<number | null>(null);
  const [warehouseComboboxOpen, setWarehouseComboboxOpen] = useState(false);
  const [warehouseId, setWarehouseId] = useState("");
  const [openingDate, setOpeningDate] = useState(
    new Date().toISOString().slice(0, 10)
  );
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<OpeningBalanceItemRow[]>([{ ...EMPTY_ROW }]);
  const [appendItems, setAppendItems] = useState<OpeningBalanceItemRow[]>([
    { ...EMPTY_ROW },
  ]);
  const [resolvingAppendSapIndex, setResolvingAppendSapIndex] = useState<
    number | null
  >(null);

  const { data: balances, isLoading } = trpc.openingBalances.list.useQuery();
  const { data: projects } = trpc.projects.list.useQuery({ status: "activo" });
  const { data: detail } = trpc.openingBalances.getById.useQuery(
    { id: selectedId ?? 0 },
    { enabled: Boolean(selectedId) }
  );

  const warehousesWithOpeningBalanceIds = useMemo(
    () =>
      new Set(
        (balances ?? []).map((entry: any) => entry.openingBalance.warehouseId)
      ),
    [balances]
  );

  const warehouseOptions = useMemo(() => {
    const byWarehouseId = new Map<number, any>();
    for (const project of projects ?? []) {
      for (const warehouse of project.warehouses ?? []) {
        if (!warehouse.isActive) continue;
        const warehouseKey = Number(warehouse.id);
        const option = {
          warehouse,
          project,
          hasOpeningBalance: warehousesWithOpeningBalanceIds.has(warehouseKey),
        };
        const current = byWarehouseId.get(warehouseKey);
        if (!current || (warehouse.isPrimary && !current.warehouse?.isPrimary)) {
          byWarehouseId.set(warehouseKey, option);
        }
      }
    }

    return Array.from(byWarehouseId.values()).sort((left, right) =>
      formatWarehouseLabel(left.warehouse).localeCompare(
        formatWarehouseLabel(right.warehouse),
        "es-HN"
      )
    );
  }, [projects, warehousesWithOpeningBalanceIds]);

  const selectableWarehousesCount = useMemo(
    () => warehouseOptions.filter((option: any) => !option.hasOpeningBalance).length,
    [warehouseOptions]
  );

  const registeredOpeningBalanceCount = useMemo(
    () =>
      (balances ?? [])
        .map((entry: any) => entry.openingBalance.warehouseId)
        .filter(Boolean).length,
    [balances]
  );

  const selectedWarehouseOption = useMemo(
    () =>
      warehouseOptions.find(
        (option: any) => String(option.warehouse.id) === warehouseId
      ) ?? null,
    [warehouseOptions, warehouseId]
  );
  const selectedWarehouse = selectedWarehouseOption?.warehouse ?? null;
  useEffect(() => {
    if (!warehouseId) return;
    const currentStillAvailable = warehouseOptions.some(
      (option: any) =>
        String(option.warehouse.id) === warehouseId && !option.hasOpeningBalance
    );
    if (!currentStillAvailable) {
      setWarehouseId("");
    }
  }, [warehouseOptions, warehouseId]);

  const createMutation = trpc.openingBalances.create.useMutation({
    onSuccess: (result) => {
      toast.success(`Saldo inicial ${result.balanceNumber} registrado`);
      setDialogOpen(false);
      resetForm();
      void Promise.all([
        utils.openingBalances.list.invalidate(),
        utils.inventory.list.invalidate(),
        utils.projects.list.invalidate(),
        utils.warehouses.list.invalidate(),
      ]);
    },
    onError: (error) => toast.error(error.message),
  });
  const lookupSapItemMutation = trpc.requestItems.lookupSapItem.useMutation({
    onError: (error) => toast.error(error.message),
  });
  const addItemsMutation = trpc.openingBalances.addItems.useMutation({
    onSuccess: (result) => {
      toast.success(`${result.addedItems} ítem(s) agregado(s) al saldo inicial`);
      setAppendItems([{ ...EMPTY_ROW }]);
      setResolvingAppendSapIndex(null);
      void Promise.all([
        utils.openingBalances.list.invalidate(),
        selectedId
          ? utils.openingBalances.getById.invalidate({ id: selectedId })
          : Promise.resolve(),
        utils.inventory.list.invalidate(),
      ]);
    },
    onError: (error) => toast.error(error.message),
  });

  const resetForm = () => {
    setWarehouseId("");
    setWarehouseComboboxOpen(false);
    setOpeningDate(new Date().toISOString().slice(0, 10));
    setNotes("");
    setItems([{ ...EMPTY_ROW }]);
    setResolvingSapIndex(null);
  };

  const updateItem = (
    index: number,
    field: keyof OpeningBalanceItemRow,
    value: string
  ) => {
    setItems((current) => {
      const next = [...current];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const addItem = () => setItems((current) => [...current, { ...EMPTY_ROW }]);

  const removeItem = (index: number) => {
    setItems((current) =>
      current.length === 1 ? current : current.filter((_, itemIndex) => itemIndex !== index)
    );
  };

  const updateAppendItem = (
    index: number,
    field: keyof OpeningBalanceItemRow,
    value: string
  ) => {
    setAppendItems((current) => {
      const next = [...current];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const addAppendItem = () =>
    setAppendItems((current) => [...current, { ...EMPTY_ROW }]);

  const removeAppendItem = (index: number) => {
    setAppendItems((current) =>
      current.length === 1
        ? current
        : current.filter((_, itemIndex) => itemIndex !== index)
    );
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
        return;
      }

      setItems((current) => {
        const next = [...current];
        const currentRow = next[index];
        if (!currentRow) return current;

        next[index] = {
          ...currentRow,
          sapItemCode: result.sapItemCode,
          itemName: currentRow.itemName.trim() || result.itemName || currentRow.itemName,
          unit: currentRow.unit.trim() || result.unit || currentRow.unit,
        };
        return next;
      });
    } finally {
      setResolvingSapIndex((current) => (current === index ? null : current));
    }
  };

  const resolveAppendSapItem = async (index: number) => {
    const row = appendItems[index];
    const normalizedSapItemCode = row?.sapItemCode.trim();
    if (!normalizedSapItemCode) return;

    setResolvingAppendSapIndex(index);
    try {
      const result = await lookupSapItemMutation.mutateAsync({
        sapItemCode: normalizedSapItemCode,
      });

      if (!result) {
        setAppendItems((current) => {
          const next = [...current];
          if (!next[index]) return current;
          next[index] = {
            ...next[index],
            sapItemCode: normalizedSapItemCode,
          };
          return next;
        });
        return;
      }

      setAppendItems((current) => {
        const next = [...current];
        const currentRow = next[index];
        if (!currentRow) return current;

        next[index] = {
          ...currentRow,
          sapItemCode: result.sapItemCode,
          itemName: currentRow.itemName.trim() || result.itemName || currentRow.itemName,
          unit: currentRow.unit.trim() || result.unit || currentRow.unit,
        };
        return next;
      });
    } finally {
      setResolvingAppendSapIndex((current) => (current === index ? null : current));
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="space-y-1">
          <h1>Saldos Iniciales</h1>
          <p className="text-sm text-muted-foreground">
            Registra la existencia con la que arranca cada almacén.
            Este documento suma al stock actual y queda como apertura formal.
          </p>
        </div>

        <Dialog
          open={dialogOpen}
          onOpenChange={(open) => {
            setDialogOpen(open);
            if (!open) resetForm();
          }}
        >
          <DialogTrigger asChild>
            <Button disabled={selectableWarehousesCount === 0}>
              <Plus className="mr-2 h-4 w-4" />
              Registrar saldo inicial
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[92vh] w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] overflow-y-auto rounded-2xl p-5 sm:w-[calc(100vw-3rem)] sm:max-w-6xl sm:p-8 xl:max-w-7xl">
            <DialogHeader className="border-b border-border/70 pb-5">
              <DialogTitle className="text-2xl font-bold tracking-tight sm:text-3xl">
                Registrar saldo inicial
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-5 pt-2">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label className="text-sm font-semibold">Almacén *</Label>
                  <Popover
                    open={warehouseComboboxOpen}
                    onOpenChange={setWarehouseComboboxOpen}
                  >
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        role="combobox"
                        aria-expanded={warehouseComboboxOpen}
                        className="h-12 w-full justify-between px-3 text-base font-normal"
                      >
                        <span
                          className={`truncate ${warehouseId ? "" : "text-muted-foreground"}`}
                        >
                          {formatWarehouseLabel(selectedWarehouse)}
                        </span>
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent
                      align="start"
                      className="w-[min(760px,calc(100vw-3rem))] p-0"
                    >
                      <Command>
                        <CommandInput placeholder="Buscar almacén por código o nombre..." />
                        <CommandList className="max-h-[360px]">
                          <CommandEmpty>No se encontraron almacenes.</CommandEmpty>
                          <CommandGroup>
                            {warehouseOptions.map((option: any) => {
                              const { warehouse, project, hasOpeningBalance } = option;
                              return (
                                <CommandItem
                                  key={warehouse.id}
                                  value={[
                                    warehouse.code,
                                    warehouse.localCode,
                                    warehouse.name,
                                    warehouse.displayName,
                                    project.code,
                                    project.name,
                                    hasOpeningBalance ? "saldo registrado" : "",
                                  ]
                                    .filter(Boolean)
                                    .join(" ")}
                                  disabled={hasOpeningBalance}
                                  onSelect={() => {
                                    setWarehouseId(String(warehouse.id));
                                    setWarehouseComboboxOpen(false);
                                  }}
                                >
                                  <Check
                                    className={`h-4 w-4 ${
                                      warehouseId === String(warehouse.id)
                                        ? "opacity-100"
                                        : "opacity-0"
                                    }`}
                                  />
                                  <span className="min-w-0">
                                    <span className="block truncate">
                                      {formatWarehouseLabel(warehouse)}
                                    </span>
                                    <span className="block truncate text-xs text-muted-foreground">
                                      {formatProjectLabel(project)}
                                      {hasOpeningBalance ? " · saldo registrado" : ""}
                                    </span>
                                  </span>
                                </CommandItem>
                              );
                            })}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                  <p className="text-xs text-muted-foreground">
                    Mostrando {warehouseOptions.length.toLocaleString("es-HN")}{" "}
                    almacenes activos
                    {registeredOpeningBalanceCount > 0
                      ? `; ${registeredOpeningBalanceCount.toLocaleString("es-HN")} ya tienen saldo inicial`
                      : ""}
                    .
                  </p>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm font-semibold">Fecha de apertura *</Label>
                  <Input
                    className="h-12 text-base"
                    type="date"
                    value={openingDate}
                    onChange={(event) => setOpeningDate(event.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-semibold">Notas</Label>
                <Textarea
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  rows={3}
                  placeholder="Referencia del conteo físico, fecha de corte o comentarios de apertura"
                />
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-semibold">Ítems del saldo inicial</Label>
                  <Button type="button" variant="outline" onClick={addItem}>
                    <Plus className="mr-2 h-4 w-4" />
                    Agregar línea
                  </Button>
                </div>

                <div className="space-y-3">
                  {items.map((item, index) => (
                    <div
                      key={index}
                      className="grid gap-3 rounded-xl border border-border/70 bg-muted/10 p-4 md:grid-cols-[1.2fr_2fr_0.8fr_0.8fr_auto]"
                    >
                      <div className="space-y-1">
                        <Label className="text-xs">Código SAP *</Label>
                        <SapItemSearchInput
                          value={item.sapItemCode}
                          resolving={resolvingSapIndex === index}
                          disabled={resolvingSapIndex === index}
                          onChange={(value) => updateItem(index, "sapItemCode", value)}
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
                        {resolvingSapIndex === index ? (
                          <p className="text-[11px] text-muted-foreground">
                            Buscando código en inventario y catálogo SAP...
                          </p>
                        ) : null}
                      </div>

                      <div className="space-y-1">
                        <Label className="text-xs">Descripción *</Label>
                        <Input
                          value={item.itemName}
                          onChange={(event) =>
                            updateItem(index, "itemName", event.target.value)
                          }
                          placeholder="Aceite HTF Universal"
                        />
                      </div>

                      <div className="space-y-1">
                        <Label className="text-xs">Cantidad *</Label>
                        <Input
                          type="number"
                          min="0.01"
                          step="any"
                          value={item.quantity}
                          onChange={(event) =>
                            updateItem(index, "quantity", event.target.value)
                          }
                          placeholder="0.00"
                        />
                      </div>

                      <div className="space-y-1">
                        <Label className="text-xs">Unidad</Label>
                        <UnitCombobox
                          value={item.unit}
                          onChange={(value) => updateItem(index, "unit", value)}
                        />
                      </div>

                      <div className="flex items-end">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => removeItem(index)}
                          disabled={items.length === 1}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>

                      <div className="space-y-1 md:col-span-5">
                        <Label className="text-xs">Notas de la línea</Label>
                        <Input
                          value={item.notes}
                          onChange={(event) =>
                            updateItem(index, "notes", event.target.value)
                          }
                          placeholder="Observación opcional"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {selectableWarehousesCount === 0 ? (
                <div className="rounded-lg border border-border bg-muted/20 p-3 text-sm text-muted-foreground">
                  Todos los almacenes activos ya tienen su saldo inicial registrado.
                </div>
              ) : null}

              <div className="flex flex-col-reverse gap-3 border-t border-border/70 pt-4 sm:flex-row sm:justify-end">
                <Button
                  variant="outline"
                  size="lg"
                  className="h-12 px-6 text-base"
                  onClick={() => setDialogOpen(false)}
                >
                  Cancelar
                </Button>
                <Button
                  size="lg"
                  className="h-12 px-7 text-base font-semibold"
                  disabled={createMutation.isPending}
                  onClick={() => {
                    if (!selectedWarehouseOption) {
                      toast.error("Seleccione un almacén");
                      return;
                    }

                    const validItems = items.filter(
                      (item) =>
                        item.sapItemCode.trim() &&
                        item.itemName.trim() &&
                        item.quantity.trim()
                    );

                    if (validItems.length === 0) {
                      toast.error("Agrega al menos un ítem válido");
                      return;
                    }

                    createMutation.mutate({
                      warehouseId: Number(selectedWarehouseOption.warehouse.id),
                      openingDate,
                      notes: notes || undefined,
                      items: validItems.map((item) => ({
                        sapItemCode: item.sapItemCode,
                        itemName: item.itemName,
                        quantity: item.quantity,
                        unit: item.unit || undefined,
                        notes: item.notes || undefined,
                      })),
                    });
                  }}
                >
                  {createMutation.isPending ? "Registrando..." : "Registrar saldo inicial"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">
              Cargando saldos iniciales...
            </div>
          ) : !(balances || []).length ? (
            <div className="p-8 text-center">
              <Package className="mx-auto mb-3 h-12 w-12 text-muted-foreground/30" />
              <p className="text-muted-foreground">
                No hay saldos iniciales registrados
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      No. saldo
                    </th>
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Proyecto
                    </th>
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Bodega
                    </th>
                    <th className="p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Ítems
                    </th>
                    <th className="p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Cantidad total
                    </th>
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Fecha apertura
                    </th>
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Registrado por
                    </th>
                    <th className="p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Acciones
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {(balances || []).map((row: any) => (
                    <tr
                      key={row.openingBalance.id}
                      className="border-b border-border last:border-0"
                    >
                      <td className="p-3 font-medium">
                        {row.openingBalance.balanceNumber}
                      </td>
                      <td className="p-3 text-xs">
                        {row.project
                          ? `${row.project.code} - ${row.project.name}`
                          : "—"}
                      </td>
                      <td className="p-3 text-xs">
                        {row.warehouse?.displayName || "—"}
                      </td>
                      <td className="p-3 text-right">
                        <Badge variant="outline">{row.itemCount}</Badge>
                      </td>
                      <td className="p-3 text-right font-medium">
                        {row.totalQuantity}
                      </td>
                      <td className="p-3 text-xs">
                        {row.openingBalance.openingDate
                          ? new Date(row.openingBalance.openingDate).toLocaleDateString("es-HN")
                          : "—"}
                      </td>
                      <td className="p-3 text-xs">
                        {row.createdBy?.name || row.createdBy?.email || "—"}
                      </td>
                      <td className="p-3 text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setSelectedId(row.openingBalance.id)}
                        >
                          <Eye className="mr-2 h-4 w-4" />
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

      <Dialog
        open={Boolean(selectedId)}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedId(null);
            setAppendItems([{ ...EMPTY_ROW }]);
            setResolvingAppendSapIndex(null);
          }
        }}
      >
        <DialogContent className="max-h-[92vh] w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] overflow-y-auto rounded-2xl p-5 sm:w-[calc(100vw-3rem)] sm:max-w-7xl sm:p-8">
          <DialogHeader>
            <DialogTitle>
              {detail?.openingBalance.balanceNumber || "Saldo inicial"}
            </DialogTitle>
          </DialogHeader>

          {detail ? (
            <div className="space-y-5">
              <div className="grid gap-4 md:grid-cols-3">
                <div>
                  <Label className="text-xs text-muted-foreground">Proyecto</Label>
                  <p className="mt-1 text-sm font-medium">
                    {detail.project
                      ? `${detail.project.code} - ${detail.project.name}`
                      : "—"}
                  </p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Bodega</Label>
                  <p className="mt-1 text-sm font-medium">
                    {detail.warehouse?.displayName || "—"}
                  </p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Fecha de apertura</Label>
                  <p className="mt-1 text-sm font-medium">
                    {detail.openingBalance.openingDate
                      ? new Date(detail.openingBalance.openingDate).toLocaleDateString("es-HN")
                      : "—"}
                  </p>
                </div>
              </div>

              <div>
                <Label className="text-xs text-muted-foreground">Notas</Label>
                <div className="mt-1 rounded-lg border border-border bg-muted/20 p-3 text-sm">
                  {detail.openingBalance.notes || "Sin observaciones"}
                </div>
              </div>

              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Código SAP
                      </th>
                      <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Ítem
                      </th>
                      <th className="p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Cantidad
                      </th>
                      <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Unidad
                      </th>
                      <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Notas
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {(detail.items || []).map((item: any) => (
                      <tr key={item.id} className="border-b border-border last:border-0">
                        <td className="p-3 font-mono text-xs">{item.sapItemCode}</td>
                        <td className="p-3">{item.itemName}</td>
                        <td className="p-3 text-right font-medium">{item.quantity}</td>
                        <td className="p-3 text-xs">{item.unit || "—"}</td>
                        <td className="p-3 text-xs">{item.notes || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="space-y-3 rounded-xl border border-dashed border-border p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <Label className="text-sm font-semibold">
                      Agregar más ítems
                    </Label>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Las cantidades nuevas se sumarán al inventario de esta bodega.
                    </p>
                  </div>
                  <Button type="button" variant="outline" onClick={addAppendItem}>
                    <Plus className="mr-2 h-4 w-4" />
                    Agregar línea
                  </Button>
                </div>

                <div className="space-y-3">
                  {appendItems.map((item, index) => (
                    <div
                      key={index}
                      className="grid gap-3 rounded-xl border border-border/70 bg-muted/20 p-3 md:grid-cols-[1.3fr_1.8fr_0.8fr_0.7fr_1.4fr_auto]"
                    >
                      <div className="space-y-1">
                        <Label className="text-xs">Código SAP *</Label>
                        <SapItemSearchInput
                          value={item.sapItemCode}
                          resolving={resolvingAppendSapIndex === index}
                          disabled={resolvingAppendSapIndex === index}
                          onChange={(value) =>
                            updateAppendItem(index, "sapItemCode", value)
                          }
                          onSelect={(sapItemCode, itemName) => {
                            setAppendItems((current) => {
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
                          onResolve={() => void resolveAppendSapItem(index)}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Descripción *</Label>
                        <Input
                          value={item.itemName}
                          onChange={(event) =>
                            updateAppendItem(index, "itemName", event.target.value)
                          }
                          placeholder="Descripción del artículo"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Cantidad *</Label>
                        <Input
                          type="number"
                          min="0.01"
                          step="0.01"
                          value={item.quantity}
                          onChange={(event) =>
                            updateAppendItem(index, "quantity", event.target.value)
                          }
                          placeholder="0.00"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Unidad</Label>
                        <UnitCombobox
                          value={item.unit}
                          onChange={(value) => updateAppendItem(index, "unit", value)}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Notas</Label>
                        <Input
                          value={item.notes}
                          onChange={(event) =>
                            updateAppendItem(index, "notes", event.target.value)
                          }
                          placeholder="Observación opcional"
                        />
                      </div>
                      <div className="flex items-end">
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          onClick={() => removeAppendItem(index)}
                          disabled={appendItems.length === 1}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex justify-end border-t border-border/70 pt-3">
                  <Button
                    disabled={addItemsMutation.isPending}
                    onClick={() => {
                      if (!detail) return;

                      const validItems = appendItems.filter(
                        (item) =>
                          item.sapItemCode.trim() &&
                          item.itemName.trim() &&
                          item.quantity.trim() &&
                          Number(item.quantity) > 0
                      );

                      if (validItems.length === 0) {
                        toast.error("Agrega al menos un ítem válido");
                        return;
                      }

                      addItemsMutation.mutate({
                        id: detail.openingBalance.id,
                        items: validItems.map((item) => ({
                          sapItemCode: item.sapItemCode,
                          itemName: item.itemName,
                          quantity: item.quantity,
                          unit: item.unit || undefined,
                          notes: item.notes || undefined,
                        })),
                      });
                    }}
                  >
                    {addItemsMutation.isPending ? "Agregando..." : "Agregar ítems"}
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
