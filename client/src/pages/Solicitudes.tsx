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
import { Plus, Search, Eye, Pencil } from "lucide-react";
import { useState } from "react";
import { useLocation } from "wouter";
import { Input } from "@/components/ui/input";
import {
  formatDateForDisplay,
  getDueDateStatus,
  getNeededByDate,
  PURCHASE_URGENCY_LABELS,
} from "@shared/material-requests";

const STATUS_LABELS: Record<string, string> = {
  borrador: "Borrador",
  pendiente_aprobar: "Pendiente de aprobar",
  en_espera: "En espera",
  en_proceso: "En proceso de atención",
  parcialmente_atendida: "Parcialmente atendida",
  flujo_completado: "Flujo completado",
  cerrada: "Cerrada",
  cerrada_incompleta: "Cerrada incompleta",
  anulada: "Anulada",
};

const STATUS_COLORS: Record<string, string> = {
  borrador: "border-slate-300 text-slate-700 bg-slate-50",
  pendiente_aprobar: "border-orange-300 text-orange-700 bg-orange-50",
  en_espera: "border-amber-300 text-amber-700 bg-amber-50",
  en_proceso: "border-blue-300 text-blue-700 bg-blue-50",
  parcialmente_atendida: "border-cyan-300 text-cyan-700 bg-cyan-50",
  flujo_completado: "border-emerald-300 text-emerald-700 bg-emerald-50",
  cerrada: "border-gray-300 text-gray-600 bg-gray-50",
  cerrada_incompleta: "border-yellow-300 text-yellow-700 bg-yellow-50",
  anulada: "border-rose-300 text-rose-700 bg-rose-50",
};

const RECIPIENT_LABELS: Record<string, string> = {
  bodega_central: "Bodega Central",
  bodega_proyecto: "Bodega del Proyecto",
  administrador_proyecto: "Administrador Proyecto",
  oficina_central: "Oficina Central",
  solicitud_compra: "Solicitud de Compra",
};

const URGENCY_COLORS: Record<string, string> = {
  urgente: "border-red-300 text-red-700 bg-red-50",
  no_urgente: "border-emerald-300 text-emerald-700 bg-emerald-50",
};

const DUE_STATUS_COLORS: Record<string, string> = {
  late: "text-red-600",
  today: "text-red-600",
  soon: "text-amber-600",
  ok: "text-muted-foreground",
};

const TARGET_PREFIX_PATTERN = /^(Subproyecto|Activo fijo):\s*/;

function getRequestTargetLabels(itemTargets: any[] = []) {
  return Array.from(
    new Set<string>(
      itemTargets
        .map((target: any) => target.label?.replace(TARGET_PREFIX_PATTERN, "").trim())
        .filter(Boolean)
    )
  );
}

function getRequestedByLabel(row: any) {
  const requestedBy = row.requestedBy;
  return (
    requestedBy?.name?.trim?.() ||
    requestedBy?.email?.trim?.() ||
    `Usuario #${row.request.requestedById}`
  );
}

function RequestTargetBadges({ labels }: { labels: string[] }) {
  if (labels.length === 0) {
    return <span className="text-xs text-muted-foreground">Sin subproyecto</span>;
  }

  const visibleLabels = labels.slice(0, 2);
  const hiddenCount = labels.length - visibleLabels.length;

  return (
    <div className="flex max-w-[280px] flex-wrap gap-1" title={labels.join("\n")}>
      {visibleLabels.map((label) => (
        <Badge
          key={label}
          variant="outline"
          className="max-w-full border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700"
        >
          <span className="truncate">{label}</span>
        </Badge>
      ))}
      {hiddenCount > 0 ? (
        <Badge
          variant="outline"
          className="border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-600"
        >
          +{hiddenCount} más
        </Badge>
      ) : null}
    </div>
  );
}

export default function Solicitudes() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const userRole = (user as any)?.buildreqRole || "";
  const isSuperintendent = userRole === "superintendente";
  const canCreateRequest = !isSuperintendent;

  const { data: requests, isLoading, error } = trpc.materialRequests.list.useQuery(
    statusFilter !== "all" ? { status: statusFilter } : undefined
  );

  const filteredRequests = (requests || []).filter((r: any) => {
    if (!search) return true;
    const searchLower = search.toLowerCase();
    return (
      r.request.requestNumber.toLowerCase().includes(searchLower) ||
      r.project?.name?.toLowerCase().includes(searchLower) ||
      r.project?.code?.toLowerCase().includes(searchLower) ||
      r.requestedBy?.name?.toLowerCase().includes(searchLower) ||
      r.requestedBy?.email?.toLowerCase().includes(searchLower) ||
      (r.itemTargets ?? []).some((target: any) =>
        target.label?.toLowerCase().includes(searchLower)
      )
    );
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1>Requisiciones de Materiales</h1>
        {canCreateRequest ? (
          <Button onClick={() => setLocation("/solicitudes/nueva")} size="sm">
            <Plus className="h-4 w-4 mr-2" />
            Nueva Requisición
          </Button>
        ) : null}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por número, proyecto o solicitante..."
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
                    <SelectItem value="borrador">Borrador</SelectItem>
                    <SelectItem value="pendiente_aprobar">Pendiente de aprobar</SelectItem>
                    <SelectItem value="en_espera">En espera</SelectItem>
                    <SelectItem value="en_proceso">En proceso de atención</SelectItem>
                    <SelectItem value="parcialmente_atendida">Parcialmente atendida</SelectItem>
                    <SelectItem value="flujo_completado">Flujo completado</SelectItem>
                    <SelectItem value="cerrada">Cerrada</SelectItem>
                    <SelectItem value="cerrada_incompleta">Cerrada incompleta</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">
              Cargando requisiciones...
            </div>
          ) : error ? (
            <div className="p-8 text-center text-destructive">
              No se pudieron cargar las requisiciones: {error.message}
            </div>
          ) : filteredRequests.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              No se encontraron requisiciones
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1300px] text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left p-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">
                      No. Requisición
                    </th>
                    <th className="text-left p-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">
                      Proyecto
                    </th>
                    <th className="text-left p-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">
                      Destino
                    </th>
                    <th className="text-left p-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">
                      Solicitado por
                    </th>
                    <th className="text-left p-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">
                      Dirigida a
                    </th>
                    <th className="text-left p-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">
                      Urgencia
                    </th>
                    <th className="text-left p-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">
                      Fecha necesaria
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
                  {filteredRequests.map((r: any) => {
                    const neededByDate = getNeededByDate(
                      r.request.purchaseUrgency,
                      r.request.neededBy,
                      r.request.createdAt
                    );
                    const dueStatus = getDueDateStatus(neededByDate);
                    const targetLabels = getRequestTargetLabels(r.itemTargets ?? []);
                    const requestedByLabel = getRequestedByLabel(r);
                    const targetPath =
                      r.request.status === "borrador" && !isSuperintendent
                        ? `/solicitudes/${r.request.id}/editar`
                        : `/solicitudes/${r.request.id}`;
                    const actionIcon =
                      r.request.status === "borrador" && !isSuperintendent ? (
                        <Pencil className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      );

                    return (
                      <tr
                        key={r.request.id}
                        className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors cursor-pointer"
                        onClick={() => setLocation(targetPath)}
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
                        <td className="p-3">
                          <RequestTargetBadges labels={targetLabels} />
                        </td>
                        <td className="p-3">
                          <div>
                            <span className="font-medium text-xs">{requestedByLabel}</span>
                            {r.requestedBy?.email &&
                            r.requestedBy.email !== requestedByLabel ? (
                              <p className="text-xs text-muted-foreground">
                                {r.requestedBy.email}
                              </p>
                            ) : null}
                          </div>
                        </td>
                        <td className="p-3 text-xs">
                          {RECIPIENT_LABELS[r.request.recipient] || r.request.recipient}
                        </td>
                        <td className="p-3">
                          <Badge
                            variant="outline"
                            className={`text-xs ${URGENCY_COLORS[r.request.purchaseUrgency] || ""}`}
                          >
                            {PURCHASE_URGENCY_LABELS[
                              r.request.purchaseUrgency as "urgente" | "no_urgente"
                            ] || "No urgente"}
                          </Badge>
                        </td>
                        <td className="p-3 text-xs">
                          <p className="font-medium">
                            {formatDateForDisplay(neededByDate)}
                          </p>
                          {dueStatus && (
                            <p className={DUE_STATUS_COLORS[dueStatus.tone] || "text-muted-foreground"}>
                              {dueStatus.label}
                            </p>
                          )}
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
                              setLocation(targetPath);
                            }}
                          >
                            {actionIcon}
                          </Button>
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
