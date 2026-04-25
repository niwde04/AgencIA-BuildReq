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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Eye, Package, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

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

export default function SaldosIniciales() {
  const utils = trpc.useUtils();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [resolvingSapIndex, setResolvingSapIndex] = useState<number | null>(null);
  const [projectId, setProjectId] = useState("");
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
  const { data: projects } = trpc.projects.list.useQuery();
  const { data: detail } = trpc.openingBalances.getById.useQuery(
    { id: selectedId ?? 0 },
    { enabled: Boolean(selectedId) }
  );

  const projectsWithOpeningBalanceIds = useMemo(
    () =>
      new Set(
        (balances ?? []).map((entry: any) => entry.openingBalance.projectId)
      ),
    [balances]
  );

  const availableProjects = useMemo(() => {
    return (projects ?? []).filter(
      (project: any) => project.warehouse && project.status === "activo"
    );
  }, [projects]);

  const selectableProjectsCount = useMemo(
    () =>
      availableProjects.filter(
        (project: any) => !projectsWithOpeningBalanceIds.has(project.id)
      ).length,
    [availableProjects, projectsWithOpeningBalanceIds]
  );

  const registeredOpeningBalanceCount = useMemo(
    () =>
      (balances ?? [])
        .map((entry: any) => entry.openingBalance.projectId)
        .filter(Boolean).length,
    [balances]
  );

  const selectedProject = useMemo(
    () =>
      (projects ?? []).find((project: any) => String(project.id) === projectId) ?? null,
    [projectId, projects]
  );

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
    setProjectId("");
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
            Registra la existencia con la que arranca cada bodega de proyecto.
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
            <Button disabled={selectableProjectsCount === 0}>
              <Plus className="mr-2 h-4 w-4" />
              Registrar saldo inicial
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[92vh] w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] overflow-y-auto rounded-2xl p-5 sm:w-[calc(100vw-3rem)] sm:max-w-5xl sm:p-8">
            <DialogHeader className="border-b border-border/70 pb-5">
              <DialogTitle className="text-2xl font-bold tracking-tight sm:text-3xl">
                Registrar saldo inicial
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-5 pt-2">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label className="text-sm font-semibold">Proyecto *</Label>
                  <Select value={projectId} onValueChange={setProjectId}>
                    <SelectTrigger className="h-12 text-base">
                      <SelectValue placeholder="Seleccione proyecto" />
                    </SelectTrigger>
                    <SelectContent className="max-h-[360px]">
                      {availableProjects.map((project: any) => {
                        const hasOpeningBalance = projectsWithOpeningBalanceIds.has(
                          project.id
                        );
                        return (
                          <SelectItem
                            key={project.id}
                            value={String(project.id)}
                            disabled={hasOpeningBalance}
                          >
                            {project.code} - {project.name}
                            {hasOpeningBalance ? " (saldo registrado)" : ""}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Mostrando {availableProjects.length.toLocaleString("es-HN")}{" "}
                    proyectos activos con bodega
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

              <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
                <p className="text-sm font-semibold text-foreground">
                  Bodega que recibirá el saldo
                </p>
                <p className="mt-1 text-sm text-foreground">
                  {selectedProject?.warehouse?.displayName ??
                    "Seleccione un proyecto para identificar la bodega"}
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  Esta carga inicial sumará a cualquier existencia que ya tenga
                  la bodega del proyecto.
                </p>
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
                        <Input
                          value={item.sapItemCode}
                          onChange={(event) =>
                            updateItem(index, "sapItemCode", event.target.value)
                          }
                          onBlur={() => {
                            void resolveSapItem(index);
                          }}
                          placeholder="01010200001"
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
                        <Input
                          value={item.unit}
                          onChange={(event) =>
                            updateItem(index, "unit", event.target.value)
                          }
                          placeholder="und"
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

              {selectableProjectsCount === 0 ? (
                <div className="rounded-lg border border-border bg-muted/20 p-3 text-sm text-muted-foreground">
                  Todas las bodegas activas ya tienen su saldo inicial registrado.
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
                    if (!projectId) {
                      toast.error("Seleccione un proyecto");
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
                      projectId: Number(projectId),
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
                      className="grid gap-3 rounded-xl border border-border/70 bg-muted/20 p-3 md:grid-cols-[150px_1fr_130px_100px_1fr_auto]"
                    >
                      <div className="space-y-1">
                        <Label className="text-xs">Código SAP *</Label>
                        <Input
                          value={item.sapItemCode}
                          onChange={(event) =>
                            updateAppendItem(index, "sapItemCode", event.target.value)
                          }
                          onBlur={() => void resolveAppendSapItem(index)}
                          placeholder="05050200059"
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
                        <Input
                          value={item.unit}
                          onChange={(event) =>
                            updateAppendItem(index, "unit", event.target.value)
                          }
                          placeholder="und"
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
                      <div className="flex items-end gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => void resolveAppendSapItem(index)}
                          disabled={resolvingAppendSapIndex === index}
                        >
                          {resolvingAppendSapIndex === index ? "Buscando..." : "SAP"}
                        </Button>
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
