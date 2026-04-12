import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
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
import { Plus, Search, Eye } from "lucide-react";
import { useState } from "react";
import { useLocation } from "wouter";
import { Input } from "@/components/ui/input";

const STATUS_LABELS: Record<string, string> = {
  en_espera: "En espera",
  en_proceso: "En proceso de atención",
  cerrada: "Cerrada",
};

const STATUS_COLORS: Record<string, string> = {
  en_espera: "border-amber-300 text-amber-700 bg-amber-50",
  en_proceso: "border-blue-300 text-blue-700 bg-blue-50",
  cerrada: "border-gray-300 text-gray-600 bg-gray-50",
};

const RECIPIENT_LABELS: Record<string, string> = {
  bodega_central: "Bodega Central",
  administrador_proyecto: "Administrador Proyecto",
  solicitud_compra: "Solicitud de Compra",
};

export default function Solicitudes() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  const { data: requests, isLoading } = trpc.materialRequests.list.useQuery(
    statusFilter !== "all" ? { status: statusFilter } : undefined
  );

  const filteredRequests = (requests || []).filter((r: any) => {
    if (!search) return true;
    const searchLower = search.toLowerCase();
    return (
      r.request.requestNumber.toLowerCase().includes(searchLower) ||
      r.project?.name?.toLowerCase().includes(searchLower) ||
      r.project?.code?.toLowerCase().includes(searchLower)
    );
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1>Solicitudes de Materiales</h1>
        <Button onClick={() => setLocation("/solicitudes/nueva")} size="sm">
          <Plus className="h-4 w-4 mr-2" />
          Nueva Solicitud
        </Button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por número o proyecto..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-52 h-9">
            <SelectValue placeholder="Filtrar por estatus" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los estatus</SelectItem>
            <SelectItem value="en_espera">En espera</SelectItem>
            <SelectItem value="en_proceso">En proceso de atención</SelectItem>
            <SelectItem value="cerrada">Cerrada</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">
              Cargando solicitudes...
            </div>
          ) : filteredRequests.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              No se encontraron solicitudes
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left p-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">
                      No. Solicitud
                    </th>
                    <th className="text-left p-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">
                      Proyecto
                    </th>
                    <th className="text-left p-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">
                      Dirigida a
                    </th>
                    <th className="text-left p-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">
                      Estatus
                    </th>
                    <th className="text-left p-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">
                      Fecha
                    </th>
                    <th className="text-right p-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">
                      Acciones
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRequests.map((r: any) => (
                    <tr
                      key={r.request.id}
                      className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors cursor-pointer"
                      onClick={() => setLocation(`/solicitudes/${r.request.id}`)}
                    >
                      <td className="p-3">
                        <span className="font-medium">{r.request.requestNumber}</span>
                      </td>
                      <td className="p-3">
                        <div>
                          <span className="font-medium text-xs">{r.project?.code}</span>
                          <p className="text-xs text-muted-foreground">{r.project?.name}</p>
                        </div>
                      </td>
                      <td className="p-3 text-xs">
                        {RECIPIENT_LABELS[r.request.recipient] || r.request.recipient}
                      </td>
                      <td className="p-3">
                        <Badge
                          variant="outline"
                          className={`text-xs ${STATUS_COLORS[r.request.status] || ""}`}
                        >
                          {STATUS_LABELS[r.request.status] || r.request.status}
                        </Badge>
                      </td>
                      <td className="p-3 text-xs text-muted-foreground">
                        {new Date(r.request.createdAt).toLocaleDateString("es")}
                      </td>
                      <td className="p-3 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            setLocation(`/solicitudes/${r.request.id}`);
                          }}
                        >
                          <Eye className="h-4 w-4" />
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
    </div>
  );
}
