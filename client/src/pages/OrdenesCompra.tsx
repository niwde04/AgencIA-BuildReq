import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ShoppingCart } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const STATUS_LABELS: Record<string, string> = {
  pendiente: "Pendiente",
  en_proceso: "En proceso",
  completado: "Completado",
  cancelado: "Cancelado",
};

export default function OrdenesCompra() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const [convertDialogOpen, setConvertDialogOpen] = useState(false);
  const [selectedFlowId, setSelectedFlowId] = useState<number | null>(null);
  const [poNotes, setPoNotes] = useState("");

  const { data: flows, isLoading } = trpc.supplyFlows.list.useQuery({
    flowType: "solicitud_compra",
  });

  const convertMutation = trpc.supplyFlows.convertToPurchaseOrder.useMutation({
    onSuccess: () => {
      toast.success("Convertida a Orden de Compra exitosamente");
      utils.supplyFlows.list.invalidate();
      setConvertDialogOpen(false);
      setPoNotes("");
    },
    onError: (e) => toast.error(e.message),
  });

  const userRole = (user as any)?.buildreqRole || "";
  const canConvert =
    userRole === "administracion_central" || user?.role === "admin";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1>Órdenes de Compra</h1>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">
              Cargando solicitudes de compra...
            </div>
          ) : (flows || []).length === 0 ? (
            <div className="p-8 text-center">
              <ShoppingCart className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-muted-foreground">
                No hay solicitudes de compra
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left p-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">
                      No. OC
                    </th>
                    <th className="text-left p-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">
                      Solicitud
                    </th>
                    <th className="text-left p-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">
                      Proyecto
                    </th>
                    <th className="text-left p-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">
                      Tipo Compra
                    </th>
                    <th className="text-left p-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">
                      Doc. SAP
                    </th>
                    <th className="text-left p-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">
                      Estatus
                    </th>
                    <th className="text-left p-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">
                      Fecha
                    </th>
                    {canConvert && (
                      <th className="text-right p-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">
                        Acciones
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {(flows || []).map((row: any) => {
                    const f = row.flow;
                    const req = row.request;
                    const proj = row.project;
                    return (
                      <tr
                        key={f.id}
                        className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors"
                      >
                        <td className="p-3 font-mono text-xs font-medium">
                          {f.purchaseOrderNumber || (
                            <span className="text-muted-foreground italic">
                              Sin OC
                            </span>
                          )}
                        </td>
                        <td className="p-3 text-xs">
                          {req?.requestNumber || "—"}
                        </td>
                        <td className="p-3 text-xs">
                          {proj ? `${proj.code} — ${proj.name}` : "—"}
                        </td>
                        <td className="p-3 text-xs">
                          {f.purchaseType === "local"
                            ? "Compra Local"
                            : f.purchaseType === "extranjera"
                            ? "Compra Extranjera"
                            : "—"}
                        </td>
                        <td className="p-3 text-xs capitalize">
                          {f.sapDocumentType?.replace(/_/g, " ") || "—"}
                        </td>
                        <td className="p-3">
                          <Badge
                            variant="outline"
                            className="text-xs capitalize"
                          >
                            {STATUS_LABELS[f.status] || f.status}
                          </Badge>
                        </td>
                        <td className="p-3 text-xs text-muted-foreground">
                          {f.createdAt
                            ? new Date(f.createdAt).toLocaleDateString("es")
                            : "—"}
                        </td>
                        {canConvert && (
                          <td className="p-3 text-right">
                            {!f.purchaseOrderNumber && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="text-xs"
                                onClick={() => {
                                  setSelectedFlowId(f.id);
                                  setConvertDialogOpen(true);
                                }}
                              >
                                Convertir a OC
                              </Button>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Convert Dialog - auto-generates OC number */}
      <Dialog open={convertDialogOpen} onOpenChange={setConvertDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Convertir a Orden de Compra</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <p className="text-sm text-muted-foreground">
              Se generará automáticamente un número de Orden de Compra con correlativo.
              El tipo de compra se hereda del documento original.
            </p>
            <div className="space-y-2">
              <Label>Notas (opcional)</Label>
              <Textarea
                value={poNotes}
                onChange={(e) => setPoNotes(e.target.value)}
                placeholder="Observaciones..."
                rows={2}
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                onClick={() => setConvertDialogOpen(false)}
              >
                Cancelar
              </Button>
              <Button
                onClick={() => {
                  if (!selectedFlowId) return;
                  convertMutation.mutate({
                    flowId: selectedFlowId,
                    notes: poNotes || undefined,
                  });
                }}
                disabled={convertMutation.isPending}
              >
                {convertMutation.isPending ? "Generando OC..." : "Confirmar"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
