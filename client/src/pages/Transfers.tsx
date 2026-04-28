import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Eye } from "lucide-react";
import { useState } from "react";

const STATUS_LABELS: Record<string, string> = {
  pendiente: "Pendiente",
  confirmado: "Confirmado",
  en_transito: "En tránsito",
  parcialmente_recibido: "Parcialmente recibido",
  recibido: "Recibido",
  cerrado_incompleto: "Cerrado incompleto",
  anulado: "Anulado",
};

function formatDateLabel(value: Date | string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("es-HN");
}

export default function Transfers() {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const { data: transfers, isLoading } = trpc.transfers.list.useQuery();
  const { data: detail } = trpc.transfers.getById.useQuery(
    { id: selectedId ?? 0 },
    { enabled: Boolean(selectedId) }
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1>Traslados</h1>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">
              Cargando traslados...
            </div>
          ) : !(transfers || []).length ? (
            <div className="p-8 text-center text-muted-foreground">
              No hay traslados registrados
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      No. Traslado
                    </th>
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Solicitud
                    </th>
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Proyecto
                    </th>
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Guía de Remisión
                    </th>
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Correlativo SAP
                    </th>
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Estatus
                    </th>
                    <th className="p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Acciones
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {(transfers || []).map((row: any) => (
                    <tr key={row.transfer.id} className="border-b border-border last:border-0">
                      <td className="p-3 font-medium">{row.transfer.transferNumber}</td>
                      <td className="p-3 text-xs">{row.transferRequest?.requestNumber || "—"}</td>
                      <td className="p-3 text-xs">
                        {row.project ? `${row.project.code} — ${row.project.name}` : "—"}
                      </td>
                      <td className="p-3 text-xs">{row.transfer.remissionGuideNumber || "—"}</td>
                      <td className="p-3 text-xs font-mono">{row.transfer.sapCorrelative || "—"}</td>
                      <td className="p-3">
                        <Badge variant="outline" className="text-xs">
                          {STATUS_LABELS[row.transfer.status] || row.transfer.status}
                        </Badge>
                      </td>
                      <td className="p-3 text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setSelectedId(row.transfer.id)}
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

      <Dialog open={Boolean(selectedId)} onOpenChange={(open) => !open && setSelectedId(null)}>
        <DialogContent className="scrollbar-none max-h-[calc(100vh-0.75rem)] w-[calc(100vw-0.5rem)] max-w-[calc(100vw-0.5rem)] overflow-x-hidden overflow-y-auto rounded-2xl p-4 sm:max-h-[calc(100vh-1.5rem)] sm:w-[calc(100vw-2rem)] sm:max-w-[1200px] sm:p-6 lg:p-7">
          <DialogHeader>
            <DialogTitle>{detail?.transfer.transferNumber || "Traslado"}</DialogTitle>
          </DialogHeader>

          {detail ? (
            <div className="space-y-5">
              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-lg border border-border p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Solicitud
                  </p>
                  <p className="mt-2 text-sm font-medium">
                    {detail.transferRequest?.requestNumber || "-"}
                  </p>
                </div>
                <div className="rounded-lg border border-border p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Proyecto origen
                  </p>
                  <p className="mt-2 text-sm font-medium">
                    {detail.project ? `${detail.project.code} — ${detail.project.name}` : "-"}
                  </p>
                </div>
                <div className="rounded-lg border border-border p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Destino
                  </p>
                  <p className="mt-2 text-sm font-medium">
                    {detail.transferRequest?.destinationType === "bodega_central"
                      ? "Bodega Central"
                      : `Proyecto ${detail.transferRequest?.destinationProjectId ?? "-"}`}
                  </p>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-4">
                <div className="rounded-lg border border-border p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Guía de remisión
                  </p>
                  <p className="mt-2 text-sm font-medium">
                    {detail.remissionGuide?.guideNumber ||
                      detail.transfer.remissionGuideNumber ||
                      "-"}
                  </p>
                </div>
                <div className="rounded-lg border border-border p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Correlativo SAP
                  </p>
                  <p className="mt-2 font-mono text-sm">
                    {detail.remissionGuide?.sapCorrelative ||
                      detail.transfer.sapCorrelative ||
                      "-"}
                  </p>
                </div>
                <div className="rounded-lg border border-border p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Fecha
                  </p>
                  <p className="mt-2 text-sm font-medium">
                    {formatDateLabel(detail.transfer.createdAt)}
                  </p>
                </div>
                <div className="rounded-lg border border-border p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Estatus
                  </p>
                  <Badge variant="outline" className="mt-2 text-xs">
                    {STATUS_LABELS[detail.transfer.status] || detail.transfer.status}
                  </Badge>
                </div>
              </div>

              <div className="overflow-hidden rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="w-44 p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Código
                      </th>
                      <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Ítem
                      </th>
                      <th className="p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Cantidad
                      </th>
                      <th className="p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Recibido
                      </th>
                      <th className="p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Devuelto origen
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {(detail.items || []).map((item: any) => (
                      <tr key={item.id} className="border-b border-border last:border-0">
                        <td className="p-3 font-mono text-xs text-muted-foreground">
                          {item.sapItemCode || "-"}
                        </td>
                        <td className="p-3">{item.itemName}</td>
                        <td className="p-3 text-right">
                          {item.quantity} {item.unit || ""}
                        </td>
                        <td className="p-3 text-right">
                          {item.receivedQuantity || "0.00"} {item.unit || ""}
                        </td>
                        <td className="p-3 text-right">
                          <div>
                            {item.returnedToOriginQuantity || "0.00"}{" "}
                            {item.unit || ""}
                          </div>
                          {item.receiptCloseReason || item.receiptCloseNote ? (
                            <div className="mt-1 text-xs text-muted-foreground">
                              {[item.receiptCloseReason, item.receiptCloseNote]
                                .filter(Boolean)
                                .join(" — ")}
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
