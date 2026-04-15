import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

const STATUS_LABELS: Record<string, string> = {
  pendiente: "Pendiente",
  confirmado: "Confirmado",
  en_transito: "En tránsito",
  parcialmente_recibido: "Parcialmente recibido",
  recibido: "Recibido",
  anulado: "Anulado",
};

export default function Transfers() {
  const { data: transfers, isLoading } = trpc.transfers.list.useQuery();

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
