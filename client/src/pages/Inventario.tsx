import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Plus, Search, Warehouse } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export default function Inventario() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);

  // Form state
  const [sapItemCode, setSapItemCode] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [unit, setUnit] = useState("");
  const [category, setCategory] = useState("");
  const [currentStock, setCurrentStock] = useState("");
  const [minimumStock, setMinimumStock] = useState("");
  const [warehouseLocation, setWarehouseLocation] = useState("");

  const { data: items, isLoading } = trpc.inventory.list.useQuery();

  const createMutation = trpc.inventory.create.useMutation({
    onSuccess: () => {
      toast.success("Ítem de inventario creado");
      utils.inventory.list.invalidate();
      setDialogOpen(false);
      resetForm();
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
    setWarehouseLocation("");
  };

  const filteredItems = (items || []).filter((item: any) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      item.name.toLowerCase().includes(s) ||
      item.sapItemCode.toLowerCase().includes(s) ||
      (item.category || "").toLowerCase().includes(s)
    );
  });

  const userRole = (user as any)?.buildreqRole || "";
  const canManage =
    userRole === "jefe_bodega_central" || user?.role === "admin";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1>Inventario</h1>
        {canManage && (
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="h-4 w-4 mr-2" />
                Nuevo Ítem
              </Button>
            </DialogTrigger>
            <DialogContent>
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
                    <Label className="text-xs">Ubicación</Label>
                    <Input
                      value={warehouseLocation}
                      onChange={(e) => setWarehouseLocation(e.target.value)}
                      placeholder="Estante A-1"
                    />
                  </div>
                </div>
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
                      warehouseLocation: warehouseLocation || undefined,
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

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Buscar por nombre, código o categoría..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9 h-9"
        />
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">
              Cargando inventario...
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="p-8 text-center">
              <Warehouse className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-muted-foreground">
                {search ? "No se encontraron ítems" : "El inventario está vacío"}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left p-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">
                      Código SAP
                    </th>
                    <th className="text-left p-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">
                      Nombre
                    </th>
                    <th className="text-left p-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">
                      Categoría
                    </th>
                    <th className="text-left p-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">
                      Unidad
                    </th>
                    <th className="text-right p-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">
                      Stock
                    </th>
                    <th className="text-right p-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">
                      Mínimo
                    </th>
                    <th className="text-left p-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">
                      Ubicación
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredItems.map((item: any) => {
                    const lowStock =
                      item.currentStock &&
                      item.minimumStock &&
                      parseFloat(item.currentStock) <=
                        parseFloat(item.minimumStock);
                    return (
                      <tr
                        key={item.id}
                        className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors"
                      >
                        <td className="p-3 font-mono text-xs">
                          {item.sapItemCode}
                        </td>
                        <td className="p-3 font-medium">{item.name}</td>
                        <td className="p-3 text-xs">
                          {item.category || "—"}
                        </td>
                        <td className="p-3 text-xs">{item.unit || "—"}</td>
                        <td className="p-3 text-right">
                          <span
                            className={
                              lowStock
                                ? "text-destructive font-semibold"
                                : ""
                            }
                          >
                            {item.currentStock || "0"}
                          </span>
                        </td>
                        <td className="p-3 text-right text-muted-foreground">
                          {item.minimumStock || "—"}
                        </td>
                        <td className="p-3 text-xs">
                          {item.warehouseLocation || "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
