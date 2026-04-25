import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { downloadBase64Document } from "@/lib/document-download";
import { trpc } from "@/lib/trpc";
import { Download, Eye, PackageMinus, Send, XCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const STATUS_LABELS: Record<string, string> = {
  borrador: "Borrador",
  emitida: "Emitida",
  anulada: "Anulada",
};

function formatDate(value: string | Date | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("es-HN");
}

function formatQuantity(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return "0.00";
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numberValue)) return String(value);
  return numberValue.toLocaleString("es-HN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export default function SalidasBodega() {
  const utils = trpc.useUtils();
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const { data: exits, isLoading } = trpc.warehouseExits.list.useQuery();
  const { data: detail, refetch: refetchDetail } =
    trpc.warehouseExits.getById.useQuery(
      { id: selectedId ?? 0 },
      { enabled: Boolean(selectedId) }
    );
  const emitMutation = trpc.warehouseExits.emit.useMutation({
    onSuccess: (result) => {
      toast.success(`Salida ${result.exitNumber} emitida`);
      void Promise.all([
        utils.warehouseExits.list.invalidate(),
        selectedId
          ? utils.warehouseExits.getById.invalidate({ id: selectedId })
          : Promise.resolve(),
        utils.supplyFlows.pendingQueue.invalidate(),
        utils.supplyFlows.list.invalidate(),
        utils.inventory.list.invalidate(),
      ]);
    },
    onError: (error) => toast.error(error.message),
  });
  const cancelMutation = trpc.warehouseExits.cancelDraft.useMutation({
    onSuccess: () => {
      toast.success("Borrador de salida anulado");
      void Promise.all([
        utils.warehouseExits.list.invalidate(),
        selectedId
          ? utils.warehouseExits.getById.invalidate({ id: selectedId })
          : Promise.resolve(),
        utils.supplyFlows.pendingQueue.invalidate(),
        utils.supplyFlows.list.invalidate(),
      ]);
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="space-y-1">
          <h1>Salidas de Bodega</h1>
          <p className="text-sm text-muted-foreground">
            Consulta, emite o anula las transacciones generadas desde Flujos de
            Abastecimiento.
          </p>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">
              Cargando salidas de bodega...
            </div>
          ) : !(exits ?? []).length ? (
            <div className="flex flex-col items-center gap-3 p-10 text-center text-muted-foreground">
              <PackageMinus className="h-9 w-9" />
              <p>No hay salidas de bodega generadas desde Flujos.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      No. salida
                    </th>
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Proyecto
                    </th>
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Bodega
                    </th>
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Fecha
                    </th>
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Estado
                    </th>
                    <th className="p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Líneas
                    </th>
                    <th className="p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Cantidad
                    </th>
                    <th className="p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Acciones
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {(exits ?? []).map((row: any) => (
                    <tr
                      key={row.warehouseExit.id}
                      className="border-b border-border last:border-0"
                    >
                      <td className="p-3 font-mono text-xs font-medium">
                        {row.warehouseExit.exitNumber}
                      </td>
                      <td className="p-3 text-xs">
                        {row.project
                          ? `${row.project.code} - ${row.project.name}`
                          : "-"}
                      </td>
                      <td className="p-3 text-xs">
                        {row.warehouse?.displayName || "-"}
                      </td>
                      <td className="p-3 text-xs">
                        {formatDate(row.warehouseExit.exitDate)}
                      </td>
                      <td className="p-3">
                        <Badge variant="outline" className="text-xs">
                          {STATUS_LABELS[row.warehouseExit.status] ||
                            row.warehouseExit.status}
                        </Badge>
                      </td>
                      <td className="p-3 text-right">{row.itemCount}</td>
                      <td className="p-3 text-right font-medium">
                        {formatQuantity(row.totalQuantity)}
                      </td>
                      <td className="p-3 text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setSelectedId(row.warehouseExit.id)}
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

      <Dialog
        open={Boolean(selectedId)}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null);
        }}
      >
        <DialogContent className="max-h-[92vh] w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] overflow-y-auto rounded-2xl p-5 sm:w-[calc(100vw-3rem)] sm:max-w-6xl sm:p-8">
          <DialogHeader className="border-b border-border/70 pb-5">
            <DialogTitle className="flex flex-wrap items-center gap-3 text-2xl font-bold tracking-tight sm:text-3xl">
              {detail?.warehouseExit.exitNumber || "Salida de Bodega"}
              {detail?.warehouseExit.status ? (
                <Badge variant="outline" className="text-xs">
                  {STATUS_LABELS[detail.warehouseExit.status] ||
                    detail.warehouseExit.status}
                </Badge>
              ) : null}
            </DialogTitle>
          </DialogHeader>

          {detail ? (
            <div className="space-y-5 pt-2">
              <div className="grid gap-3 md:grid-cols-4">
                <div className="rounded-xl border bg-muted/20 p-4">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                    Proyecto
                  </Label>
                  <p className="mt-2 font-semibold">
                    {detail.project
                      ? `${detail.project.code} - ${detail.project.name}`
                      : "-"}
                  </p>
                </div>
                <div className="rounded-xl border bg-muted/20 p-4">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                    Bodega
                  </Label>
                  <p className="mt-2 font-semibold">
                    {detail.warehouse?.displayName || "-"}
                  </p>
                </div>
                <div className="rounded-xl border bg-muted/20 p-4">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                    Fecha salida
                  </Label>
                  <p className="mt-2 font-semibold">
                    {formatDate(detail.warehouseExit.exitDate)}
                  </p>
                </div>
                <div className="rounded-xl border bg-muted/20 p-4">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                    Registrada por
                  </Label>
                  <p className="mt-2 font-semibold">
                    {detail.createdBy?.name || "-"}
                  </p>
                </div>
              </div>

              {detail.warehouseExit.notes ? (
                <div className="rounded-xl border bg-muted/20 p-4 text-sm">
                  {detail.warehouseExit.notes}
                </div>
              ) : null}

              <div className="overflow-x-auto rounded-xl border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Código SAP
                      </th>
                      <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Ítem
                      </th>
                      <th className="p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Cantidad
                      </th>
                      <th className="p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Disponible bodega
                      </th>
                      <th className="p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Nueva cantidad
                      </th>
                      <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Notas
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.items.map((item: any) => (
                      <tr key={item.id} className="border-b last:border-0">
                        <td className="p-3 font-mono text-xs">{item.sapItemCode}</td>
                        <td className="p-3 font-medium">{item.itemName}</td>
                        <td className="p-3 text-right">
                          {formatQuantity(item.quantity)}{" "}
                          <span className="text-xs text-muted-foreground">
                            {item.unit || ""}
                          </span>
                        </td>
                        <td className="p-3 text-right font-medium">
                          {formatQuantity(item.availableQuantity)}{" "}
                          <span className="text-xs text-muted-foreground">
                            {item.unit || ""}
                          </span>
                        </td>
                        <td
                          className={`p-3 text-right font-semibold ${
                            Number(item.stockAfterExit) < 0 ? "text-destructive" : ""
                          }`}
                        >
                          {formatQuantity(item.stockAfterExit)}{" "}
                          <span className="text-xs text-muted-foreground">
                            {item.unit || ""}
                          </span>
                        </td>
                        <td className="p-3 text-xs text-muted-foreground">
                          {item.notes || "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-wrap justify-end gap-3 border-t pt-4">
                {detail.warehouseExit.status === "borrador" ? (
                  <>
                    <Button
                      variant="outline"
                      onClick={() =>
                        cancelMutation.mutate({ id: detail.warehouseExit.id })
                      }
                      disabled={cancelMutation.isPending || emitMutation.isPending}
                    >
                      <XCircle className="mr-2 h-4 w-4" />
                      {cancelMutation.isPending ? "Anulando..." : "Anular borrador"}
                    </Button>
                    <Button
                      onClick={() => emitMutation.mutate({ id: detail.warehouseExit.id })}
                      disabled={emitMutation.isPending || cancelMutation.isPending}
                    >
                      <Send className="mr-2 h-4 w-4" />
                      {emitMutation.isPending ? "Emitiendo..." : "Emitir salida"}
                    </Button>
                  </>
                ) : null}
                <Button
                  variant="outline"
                  onClick={async () => {
                    const latest = await refetchDetail();
                    const documentDetail = latest.data ?? detail;
                    const downloaded = downloadBase64Document({
                      base64: documentDetail?.warehouseExit.printedDocumentContent,
                      fileName: documentDetail?.warehouseExit.printedDocumentName,
                      mimeType: documentDetail?.warehouseExit.printedDocumentMimeType,
                    });
                    if (!downloaded) toast.error("La salida no tiene PDF generado");
                  }}
                  disabled={detail.warehouseExit.status !== "emitida"}
                >
                  <Download className="mr-2 h-4 w-4" />
                  Descargar PDF
                </Button>
              </div>
            </div>
          ) : (
            <div className="py-10 text-center text-sm text-muted-foreground">
              Cargando salida de bodega...
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
