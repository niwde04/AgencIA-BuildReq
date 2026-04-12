import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, RotateCcw, Eye } from "lucide-react";
import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";

const RETURN_TYPE_LABELS: Record<string, string> = {
  devolucion_bodega_central: "Devolución a Bodega Central",
  devolucion_entre_proyectos: "Devolución entre Proyectos",
  devolucion_proveedor: "Devolución a Proveedor",
};

const STATUS_LABELS: Record<string, string> = {
  pendiente: "Pendiente",
  aprobada: "Aprobada",
  en_transito: "En tránsito",
  recibida: "Recibida",
  rechazada: "Rechazada",
};

const REASON_LABELS: Record<string, string> = {
  material_defectuoso: "Material defectuoso",
  excedente: "Excedente",
  error_pedido: "Error de pedido",
  cambio_especificacion: "Cambio de especificación",
  otro: "Otro",
};

export default function Devoluciones() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const userRole = (user as any)?.buildreqRole || "";
  const isAdmin = user?.role === "admin";
  const canCreateReturn = userRole === "jefe_bodega_central" || isAdmin;

  const { data: returns, isLoading } = trpc.reverseLogistics.list.useQuery(
    {
      ...(typeFilter !== "all" ? { returnType: typeFilter } : {}),
      ...(statusFilter !== "all" ? { status: statusFilter } : {}),
    }
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1>Logística Inversa</h1>
        {canCreateReturn && (
          <Button onClick={() => setLocation("/devoluciones/nueva")} size="sm">
            <Plus className="h-4 w-4 mr-2" />
            Nueva Devolución
          </Button>
        )}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-52 h-9">
            <SelectValue placeholder="Tipo de devolución" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los tipos</SelectItem>
            <SelectItem value="devolucion_bodega_central">A Bodega Central</SelectItem>
            <SelectItem value="devolucion_entre_proyectos">Entre Proyectos</SelectItem>
            <SelectItem value="devolucion_proveedor">A Proveedor</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-44 h-9">
            <SelectValue placeholder="Estatus" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los estatus</SelectItem>
            <SelectItem value="pendiente">Pendiente</SelectItem>
            <SelectItem value="aprobada">Aprobada</SelectItem>
            <SelectItem value="en_transito">En tránsito</SelectItem>
            <SelectItem value="recibida">Recibida</SelectItem>
            <SelectItem value="rechazada">Rechazada</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">
              Cargando devoluciones...
            </div>
          ) : (returns || []).length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              No se encontraron devoluciones
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left p-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">
                      No. Devolución
                    </th>
                    <th className="text-left p-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">
                      Tipo
                    </th>
                    <th className="text-left p-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">
                      Motivo
                    </th>
                    <th className="text-left p-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">
                      Estatus
                    </th>
                    <th className="text-left p-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">
                      Fecha
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {(returns || []).map((r: any) => (
                    <tr
                      key={r.return.id}
                      className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors"
                    >
                      <td className="p-3 font-medium">
                        {r.return.returnNumber}
                      </td>
                      <td className="p-3 text-xs">
                        {RETURN_TYPE_LABELS[r.return.returnType]}
                      </td>
                      <td className="p-3 text-xs">
                        {REASON_LABELS[r.return.reasonCategory]}
                      </td>
                      <td className="p-3">
                        <Badge variant="outline" className="text-xs capitalize">
                          {STATUS_LABELS[r.return.status]}
                        </Badge>
                      </td>
                      <td className="p-3 text-xs text-muted-foreground">
                        {new Date(r.return.createdAt).toLocaleDateString("es")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
