import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
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
import { useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";

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
  itemName: string;
  quantity: string;
  unit: string;
};

export default function NuevaSolicitud() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { data: projects } = trpc.projects.list.useQuery({ status: "activo" });

  const userRole = (user as any)?.buildreqRole || "";
  const isAdmin = user?.role === "admin";

  const [projectId, setProjectId] = useState<string>("");
  const [recipient, setRecipient] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<ItemRow[]>([
    { itemName: "", quantity: "", unit: "" },
  ]);

  const createMutation = trpc.materialRequests.create.useMutation({
    onSuccess: (data) => {
      toast.success(`Solicitud ${data.requestNumber} creada exitosamente`);
      setLocation("/solicitudes");
    },
    onError: (error) => {
      toast.error(`Error: ${error.message}`);
    },
  });

  const addItem = () => {
    setItems([...items, { itemName: "", quantity: "", unit: "" }]);
  };

  const removeItem = (index: number) => {
    if (items.length === 1) return;
    setItems(items.filter((_, i) => i !== index));
  };

  const updateItem = (index: number, field: keyof ItemRow, value: string) => {
    const updated = [...items];
    updated[index] = { ...updated[index], [field]: value };
    setItems(updated);
  };

  // Determine available recipients based on role
  const getAvailableRecipients = () => {
    const recipients = [
      { value: "bodega_central", label: "Bodega Central" },
      { value: "administrador_proyecto", label: "Administrador del Proyecto" },
    ];
    // Jefe de Bodega can also direct to Solicitud de Compra
    if (userRole === "jefe_bodega_central" || isAdmin) {
      recipients.push({ value: "solicitud_compra", label: "Solicitud de Compra" });
    }
    return recipients;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!projectId || !recipient) {
      toast.error("Complete todos los campos obligatorios");
      return;
    }

    const validItems = items.filter((item) => item.itemName && item.quantity && item.unit);
    if (validItems.length === 0) {
      toast.error("Debe agregar al menos un ítem con nombre, cantidad y unidad");
      return;
    }

    createMutation.mutate({
      projectId: parseInt(projectId),
      recipient: recipient as "bodega_central" | "administrador_proyecto" | "solicitud_compra",
      notes: notes || undefined,
      items: validItems.map((item) => ({
        itemName: item.itemName,
        quantity: item.quantity,
        unit: item.unit || undefined,
      })),
    });
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => setLocation("/solicitudes")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1>Nueva Solicitud de Materiales</h1>
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
                <Select value={projectId} onValueChange={setProjectId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccione un proyecto" />
                  </SelectTrigger>
                  <SelectContent>
                    {(projects || []).map((p: any) => (
                      <SelectItem key={p.id} value={String(p.id)}>
                        {p.code} \u2014 {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Dirigida a *</Label>
                <Select value={recipient} onValueChange={setRecipient}>
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccione destinatario" />
                  </SelectTrigger>
                  <SelectContent>
                    {getAvailableRecipients().map((r) => (
                      <SelectItem key={r.value} value={r.value}>
                        {r.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
              <div className="grid grid-cols-12 gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground px-1">
                <div className="col-span-5">Nombre del ítem</div>
                <div className="col-span-2">Cantidad</div>
                <div className="col-span-4">Unidad de medida</div>
                <div className="col-span-1" />
              </div>

              {items.map((item, index) => (
                <div key={index} className="grid grid-cols-12 gap-2 items-center">
                  <div className="col-span-5">
                    <Input
                      placeholder="Ej: Cemento Portland Tipo I"
                      value={item.itemName}
                      onChange={(e) => updateItem(index, "itemName", e.target.value)}
                    />
                  </div>
                  <div className="col-span-2">
                    <Input
                      type="number"
                      placeholder="0"
                      min="0.01"
                      step="any"
                      value={item.quantity}
                      onChange={(e) => updateItem(index, "quantity", e.target.value)}
                    />
                  </div>
                  <div className="col-span-4">
                    <Select
                      value={item.unit}
                      onValueChange={(val) => updateItem(index, "unit", val)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Seleccione unidad" />
                      </SelectTrigger>
                      <SelectContent>
                        {UNITS.map((u) => (
                          <SelectItem key={u.value} value={u.value}>
                            {u.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-1 flex justify-center">
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
          <Button type="button" variant="outline" onClick={() => setLocation("/solicitudes")}>
            Cancelar
          </Button>
          <Button type="submit" disabled={createMutation.isPending}>
            {createMutation.isPending ? "Creando..." : "Crear Solicitud"}
          </Button>
        </div>
      </form>
    </div>
  );
}
