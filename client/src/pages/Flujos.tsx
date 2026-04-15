import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Package, Truck, ArrowLeftRight, ShoppingCart } from "lucide-react";
import { useState, useMemo } from "react";
import { useAuth } from "@/_core/hooks/useAuth";

const FLOW_LABELS: Record<string, string> = {
  compra_directa: "Compra Directa",
  despacho_bodega: "Salida de Bodega (legado)",
  traslado_proyecto: "Traslado Proyecto",
  solicitud_compra: "Solicitud Compra",
};

const FLOW_ICONS: Record<string, any> = {
  compra_directa: Package,
  despacho_bodega: Truck,
  traslado_proyecto: ArrowLeftRight,
  solicitud_compra: ShoppingCart,
};

const STATUS_LABELS: Record<string, string> = {
  pendiente: "Pendiente",
  en_proceso: "En proceso",
  completado: "Completado",
  cancelado: "Cancelado",
};

export default function Flujos() {
  const { user } = useAuth();
  const [flowFilter, setFlowFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const userRole = (user as any)?.buildreqRole || "";
  const isAdmin = user?.role === "admin";

  // Filter available flow types by role
  const allowedFlowTypes = useMemo(() => {
    if (isAdmin || userRole === "jefe_bodega_central") {
      return ["compra_directa", "traslado_proyecto", "solicitud_compra"];
    }
    if (userRole === "administracion_central") {
      return ["compra_directa", "solicitud_compra"];
    }
    if (userRole === "administrador_proyecto") {
      return ["solicitud_compra"];
    }
    return ["compra_directa", "traslado_proyecto", "solicitud_compra"];
  }, [userRole, isAdmin]);

  const { data: flows, isLoading } = trpc.supplyFlows.list.useQuery(
    {
      ...(flowFilter !== "all" ? { flowType: flowFilter } : {}),
      ...(statusFilter !== "all" ? { status: statusFilter } : {}),
    }
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1>Flujos de Abastecimiento</h1>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <Select value={flowFilter} onValueChange={setFlowFilter}>
          <SelectTrigger className="w-48 h-9">
            <SelectValue placeholder="Tipo de flujo" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los flujos</SelectItem>
            {allowedFlowTypes.includes("compra_directa") && (
              <SelectItem value="compra_directa">Compra Directa</SelectItem>
            )}
            {allowedFlowTypes.includes("traslado_proyecto") && (
              <SelectItem value="traslado_proyecto">Traslado Proyecto</SelectItem>
            )}
            {allowedFlowTypes.includes("solicitud_compra") && (
              <SelectItem value="solicitud_compra">Solicitud Compra</SelectItem>
            )}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-44 h-9">
            <SelectValue placeholder="Estatus" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los estatus</SelectItem>
            <SelectItem value="pendiente">Pendiente</SelectItem>
            <SelectItem value="en_proceso">En proceso</SelectItem>
            <SelectItem value="completado">Completado</SelectItem>
            <SelectItem value="cancelado">Cancelado</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Flow Cards */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <div className="h-16 animate-pulse bg-muted rounded" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (flows || []).length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            No se encontraron flujos de abastecimiento
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {(flows || []).map((row: any) => {
            const f = row.flow;
            const req = row.request;
            const proj = row.project;
            const FlowIcon = FLOW_ICONS[f.flowType] || Package;
            return (
              <Card key={f.id} className="hover:border-primary/20 transition-colors">
                <CardContent className="p-4">
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 bg-primary/10 rounded flex items-center justify-center shrink-0">
                      <FlowIcon className="h-5 w-5 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-medium text-sm">
                          {FLOW_LABELS[f.flowType]}
                        </p>
                        <Badge variant="outline" className="text-xs capitalize shrink-0">
                          {STATUS_LABELS[f.status] || f.status}
                        </Badge>
                      </div>
                      <div className="mt-1 space-y-0.5">
                        {req?.requestNumber && (
                          <p className="text-xs text-muted-foreground">
                            Requisición: {req.requestNumber}
                          </p>
                        )}
                        {proj?.name && (
                          <p className="text-xs text-muted-foreground">
                            Proyecto: {proj.code} — {proj.name}
                          </p>
                        )}
                        {f.paymentMethod && (
                          <p className="text-xs text-muted-foreground">
                            Método: {f.paymentMethod === "linea_credito" ? "Línea de Crédito" : "Caja Chica"}
                          </p>
                        )}
                        {f.purchaseType && (
                          <p className="text-xs text-muted-foreground">
                            Tipo: {f.purchaseType === "local" ? "Local" : "Extranjera"}
                          </p>
                        )}
                        {f.purchaseOrderNumber && (
                          <p className="text-xs text-muted-foreground">
                            OC: {f.purchaseOrderNumber}
                          </p>
                        )}
                        {f.sapDocumentType && (
                          <p className="text-xs text-muted-foreground">
                            Doc. SAP: {f.sapDocumentType.replace(/_/g, " ")}
                          </p>
                        )}
                        {f.notes && (
                          <p className="text-xs text-muted-foreground mt-1">
                            {f.notes}
                          </p>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-2">
                        {f.createdAt
                          ? new Date(f.createdAt).toLocaleString("es")
                          : "—"}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
