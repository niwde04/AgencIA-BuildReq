import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { useMemo, useState, useEffect } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";

type ReturnItem = {
  sapItemCode: string;
  itemName: string;
  quantity: string;
  unit: string;
  condition: string;
  notes: string;
};

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
  const [resolvingSapIndex, setResolvingSapIndex] = useState<number | null>(null);
  const [items, setItems] = useState<ReturnItem[]>([
    { sapItemCode: "", itemName: "", quantity: "", unit: "", condition: "", notes: "" },
  ]);

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

  const getProjectWarehouseLabel = (project: any) => {
    if (!project) return "Seleccione un proyecto para identificar la bodega";
    return (
      project.warehouse?.displayName ??
      `Bodega del Proyecto — ${project.code} — ${project.name}`
    );
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
      { sapItemCode: "", itemName: "", quantity: "", unit: "", condition: "", notes: "" },
    ]);
  };

  const removeItem = (index: number) => {
    if (items.length === 1) return;
    setItems(items.filter((_, i) => i !== index));
  };

  const updateItem = (
    index: number,
    field: keyof ReturnItem,
    value: string
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
        toast.error(`No se encontró el código SAP ${normalizedSapItemCode}`);
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

    if (!returnType || !reasonCategory || !sourceProjectId) {
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

    createMutation.mutate({
      returnType: returnType as any,
      reasonCategory: reasonCategory as any,
      justification,
      sourceProjectId: parseInt(sourceProjectId),
      destinationProjectId: destinationProjectId
        ? parseInt(destinationProjectId)
        : undefined,
      supplierName: supplierName || undefined,
      items: validItems.map((item) => ({
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
                <Select
                  value={sourceProjectId}
                  onValueChange={setSourceProjectId}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Seleccione proyecto" />
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

              {returnType === "devolucion_entre_proyectos" && (
                <div className="space-y-2">
                  <Label>Proyecto destino *</Label>
                  <Select
                    value={destinationProjectId}
                    onValueChange={setDestinationProjectId}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Seleccione proyecto" />
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
              )}

              {returnType === "devolucion_proveedor" && (
                <div className="space-y-2">
                  <Label>Nombre del proveedor *</Label>
                  <Input
                    value={supplierName}
                    onChange={(e) => setSupplierName(e.target.value)}
                    placeholder="Nombre del proveedor"
                  />
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
                  <div className="grid grid-cols-12 gap-2">
                    <div className="col-span-2">
                      <Input
                        placeholder={
                          resolvingSapIndex === index ? "Buscando..." : "Código SAP"
                        }
                        value={item.sapItemCode}
                        onChange={(e) =>
                          updateItem(index, "sapItemCode", e.target.value)
                        }
                        onBlur={() => void resolveSapItem(index)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            void resolveSapItem(index);
                          }
                        }}
                        disabled={resolvingSapIndex === index}
                      />
                    </div>
                    <div className="col-span-4">
                      <Input
                        placeholder="Nombre del ítem"
                        value={item.itemName}
                        onChange={(e) =>
                          updateItem(index, "itemName", e.target.value)
                        }
                      />
                    </div>
                    <div className="col-span-2">
                      <Input
                        type="number"
                        placeholder="Cant."
                        value={item.quantity}
                        onChange={(e) =>
                          updateItem(index, "quantity", e.target.value)
                        }
                      />
                    </div>
                    <div className="col-span-2">
                      <Input
                        placeholder="Unidad"
                        value={item.unit}
                        onChange={(e) =>
                          updateItem(index, "unit", e.target.value)
                        }
                      />
                    </div>
                    <div className="col-span-2">
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
