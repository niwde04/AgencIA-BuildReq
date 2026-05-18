import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Eye, Printer, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

const STATUS_LABELS: Record<string, string> = {
  pendiente: "Pendiente",
  confirmado: "Confirmado",
  en_transito: "En tránsito",
  parcialmente_recibido: "Parcialmente recibido",
  recibido: "Recibido",
  cerrado_incompleto: "Cerrado incompleto",
  anulado: "Anulado",
};

const STATUS_COLORS: Record<string, string> = {
  pendiente: "border-amber-300 bg-amber-50 text-amber-700",
  confirmado: "border-blue-300 bg-blue-50 text-blue-700",
  en_transito: "border-blue-300 bg-blue-50 text-blue-700",
  parcialmente_recibido: "border-cyan-300 bg-cyan-50 text-cyan-700",
  recibido: "border-emerald-300 bg-emerald-50 text-emerald-700",
  cerrado_incompleto: "border-yellow-300 bg-yellow-50 text-yellow-700",
  anulado: "border-rose-300 bg-rose-50 text-rose-700",
};

function formatDateLabel(value: Date | string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("es-HN");
}

function formatPrintDate(value: Date | string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("es-HN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatPrintNumber(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return "0";
  return parsed.toLocaleString("es-HN", {
    minimumFractionDigits: Number.isInteger(parsed) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getDestinationLabel(row: any) {
  if (row.transferRequest?.destinationType === "bodega_central") {
    return "Bodega Central";
  }
  return row.destinationProject
    ? `${row.destinationProject.code} — ${row.destinationProject.name}`
    : row.transferRequest?.destinationProjectId
      ? `Proyecto ${row.transferRequest.destinationProjectId}`
      : "";
}

export default function Transfers() {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const { data: transfers, isLoading } = trpc.transfers.list.useQuery();
  const { data: detail } = trpc.transfers.getById.useQuery(
    { id: selectedId ?? 0 },
    { enabled: Boolean(selectedId) }
  );

  const filteredTransfers = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();

    return (transfers ?? []).filter((row: any) => {
      const projectLabel = row.project
        ? `${row.project.code} ${row.project.name}`
        : "";
      const destinationLabel = getDestinationLabel(row);
      const matchesSearch =
        !normalizedSearch ||
        [
          row.transfer.transferNumber,
          row.transferRequest?.requestNumber,
          row.transfer.remissionGuideNumber,
          row.transfer.sapCorrelative,
          projectLabel,
          destinationLabel,
        ]
          .filter(Boolean)
          .some(value =>
            String(value).toLowerCase().includes(normalizedSearch)
          );
      const matchesStatus =
        statusFilter === "all" || row.transfer.status === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [searchTerm, statusFilter, transfers]);

  const handlePrintTransferExit = () => {
    if (!detail) return;

    const transfer = detail.transfer;
    const transferRequest = detail.transferRequest;
    const originProjectLabel = detail.project
      ? `${detail.project.code} ${detail.project.name}`
      : transferRequest?.projectId
        ? `Proyecto ${transferRequest.projectId}`
        : "-";
    const originWarehouseLabel =
      detail.originWarehouse?.displayName ||
      detail.project?.name ||
      originProjectLabel;
    const destinationLabel = getDestinationLabel(detail) || "-";
    const destinationWarehouseLabel =
      transferRequest?.destinationType === "bodega_central"
        ? "Bodega Central"
        : detail.destinationWarehouse?.displayName ||
          detail.destinationProject?.name ||
          destinationLabel;
    const requestedByLabel =
      detail.createdBy?.name ||
      (transferRequest?.createdById
        ? `Usuario #${transferRequest.createdById}`
        : "-");
    const documentNumber =
      detail.remissionGuide?.guideNumber ||
      transfer.remissionGuideNumber ||
      transfer.sapCorrelative ||
      transfer.transferNumber;
    const referenceLabel =
      transferRequest?.notes?.trim() ||
      transferRequest?.requestNumber ||
      transfer.transferNumber;
    const totalQuantity = (detail.items || []).reduce(
      (sum: number, item: any) => {
        const quantity = Number(item.quantity ?? 0);
        return sum + (Number.isFinite(quantity) ? quantity : 0);
      },
      0
    );
    const itemRows = (detail.items || [])
      .map(
        (item: any) => `
          <tr>
            <td>${escapeHtml(item.sapItemCode || "-")}</td>
            <td>${escapeHtml(item.itemName || "-")}</td>
            <td class="numeric">${escapeHtml(formatPrintNumber(item.quantity))}</td>
            <td class="center">${escapeHtml(item.unit || "-")}</td>
            <td>${escapeHtml(referenceLabel)}</td>
            <td class="numeric">${escapeHtml(formatPrintNumber(item.quantity))}</td>
          </tr>
        `
      )
      .join("");

    const printWindow = window.open("", "_blank", "width=1100,height=780");
    if (!printWindow) {
      toast.error("No se pudo abrir la ventana de impresión");
      return;
    }

    printWindow.document.write(`
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>${escapeHtml(transfer.transferNumber)}</title>
          <style>
            @page { size: A4 landscape; margin: 9mm; }
            * { box-sizing: border-box; }
            body {
              background: #fff;
              color: #000;
              font-family: Arial, Helvetica, sans-serif;
              font-size: 10px;
              margin: 0;
            }
            .sheet {
              margin: 0 auto;
              max-width: 279mm;
              padding: 4mm 4mm 8mm;
            }
            .header {
              align-items: start;
              display: grid;
              gap: 18px;
              grid-template-columns: 112px 1fr 120px;
            }
            .logo {
              border: 1px solid #333;
              border-radius: 3px;
              height: 52px;
              padding-top: 4px;
              text-align: center;
              width: 70px;
            }
            .logo-small {
              font-size: 5px;
              font-weight: 800;
              letter-spacing: 0.02em;
              line-height: 1;
            }
            .logo-main {
              font-size: 28px;
              font-weight: 900;
              letter-spacing: 0.01em;
              line-height: 1;
            }
            .logo-foot {
              font-size: 7px;
              font-weight: 800;
              line-height: 1;
            }
            .title {
              color: #06344f;
              font-size: 13px;
              font-weight: 800;
              line-height: 1.5;
              text-align: center;
              text-transform: uppercase;
            }
            .company {
              color: #000;
              font-size: 15px;
              margin-bottom: 2px;
            }
            .document-number {
              border: 5px double #222;
              color: #d00000;
              font-size: 14px;
              font-weight: 900;
              margin-top: 0;
              padding: 4px 8px;
              text-align: center;
            }
            .meta {
              display: grid;
              gap: 34px;
              grid-template-columns: 1fr 1fr;
              margin-top: 8mm;
            }
            .meta-column {
              display: grid;
              gap: 5px;
            }
            .field {
              display: grid;
              gap: 8px;
              grid-template-columns: 120px 1fr;
              min-height: 14px;
            }
            .label {
              font-weight: 800;
            }
            .value {
              font-weight: 700;
            }
            table {
              border-collapse: collapse;
              margin-top: 5mm;
              width: 100%;
            }
            th {
              border-bottom: 2px solid #2c85a5;
              border-top: 2px solid #2c85a5;
              font-size: 9px;
              font-weight: 800;
              padding: 4px 5px;
              text-align: left;
            }
            td {
              border-bottom: 1px solid #78bed9;
              padding: 5px;
              vertical-align: top;
            }
            .center { text-align: center; }
            .numeric {
              font-variant-numeric: tabular-nums;
              text-align: right;
            }
            .total-row td {
              border-bottom: 2px solid #2c85a5;
              font-weight: 800;
            }
            .signatures {
              display: grid;
              gap: 58px;
              grid-template-columns: repeat(3, 180px);
              justify-content: center;
              margin-top: 14mm;
            }
            .signature-line {
              border-top: 2px solid #111;
              font-size: 13px;
              font-weight: 700;
              padding-top: 4px;
              text-align: center;
            }
            @media print {
              .sheet { max-width: none; padding: 0; }
            }
          </style>
        </head>
        <body>
          <main class="sheet">
            <section class="header">
              <div class="logo">
                <div class="logo-small">HIDALGO e HIDALGO S.A.</div>
                <div class="logo-main">HeH</div>
                <div class="logo-foot">CONSTRUCTORES</div>
              </div>
              <div class="title">
                <div class="company">HIDALGO E HIDALGO HONDURAS S.A. DE C.V.</div>
                <div>${escapeHtml(originWarehouseLabel)}</div>
                <div>EGRESO POR TRANSFERENCIA</div>
              </div>
              <div class="document-number">${escapeHtml(documentNumber)}</div>
            </section>

            <section class="meta">
              <div class="meta-column">
                <div class="field">
                  <div class="label">Fecha:</div>
                  <div class="value">${escapeHtml(formatPrintDate(transfer.confirmedAt || transfer.createdAt))}</div>
                </div>
                <div class="field">
                  <div class="label">Solicitado por:</div>
                  <div class="value">${escapeHtml(requestedByLabel)}</div>
                </div>
                <div class="field">
                  <div class="label">Tipo Egreso:</div>
                  <div class="value">EGRESO POR TRANSFERENCIA</div>
                </div>
                <div class="field">
                  <div class="label">De Bodega:</div>
                  <div class="value">${escapeHtml(originWarehouseLabel)}</div>
                </div>
              </div>
              <div class="meta-column">
                <div class="field">
                  <div class="label">Job:</div>
                  <div class="value">${escapeHtml(originProjectLabel)}</div>
                </div>
                <div class="field">
                  <div class="label">Destino:</div>
                  <div class="value">${escapeHtml(destinationLabel)}</div>
                </div>
                <div class="field">
                  <div class="label">Referencia:</div>
                  <div class="value">${escapeHtml(referenceLabel)}</div>
                </div>
                <div class="field">
                  <div class="label">A Bodega:</div>
                  <div class="value">${escapeHtml(destinationWarehouseLabel)}</div>
                </div>
              </div>
            </section>

            <table>
              <thead>
                <tr>
                  <th style="width: 20%;">Código/No. Serie</th>
                  <th>Identificador</th>
                  <th style="width: 10%;" class="numeric">Cantidad</th>
                  <th style="width: 10%;" class="center">U Medida</th>
                  <th style="width: 20%;">Referencia</th>
                  <th style="width: 10%;" class="numeric">Total</th>
                </tr>
              </thead>
              <tbody>
                ${itemRows || `<tr><td colspan="6">Sin ítems</td></tr>`}
                <tr class="total-row">
                  <td colspan="5">Total general</td>
                  <td class="numeric">${escapeHtml(formatPrintNumber(totalQuantity))}</td>
                </tr>
              </tbody>
            </table>

            <section class="signatures">
              <div class="signature-line">Elaborado por:</div>
              <div class="signature-line">Entregado a:</div>
              <div class="signature-line">Autorizado por:</div>
            </section>
          </main>
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1>Traslados</h1>
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchTerm}
            onChange={event => setSearchTerm(event.target.value)}
            placeholder="Buscar por traslado, solicitud, proyecto, guía o SAP..."
            className="h-10 pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-10 w-full lg:w-56">
            <SelectValue placeholder="Estado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los estados</SelectItem>
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
          ) : !filteredTransfers.length ? (
            <div className="p-8 text-center text-muted-foreground">
              No hay traslados que coincidan con los filtros
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
                  {filteredTransfers.map((row: any) => (
                    <tr key={row.transfer.id} className="border-b border-border last:border-0">
                      <td className="p-3 font-medium">{row.transfer.transferNumber}</td>
                      <td className="p-3 text-xs">{row.transferRequest?.requestNumber || "—"}</td>
                      <td className="p-3 text-xs">
                        {row.project ? `${row.project.code} — ${row.project.name}` : "—"}
                      </td>
                      <td className="p-3 text-xs">{row.transfer.remissionGuideNumber || "—"}</td>
                      <td className="p-3 text-xs font-mono">{row.transfer.sapCorrelative || "—"}</td>
                      <td className="p-3">
                        <Badge
                          variant="outline"
                          className={`text-xs ${
                            STATUS_COLORS[row.transfer.status] || ""
                          }`}
                        >
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
                  <Badge
                    variant="outline"
                    className={`mt-2 text-xs ${
                      STATUS_COLORS[detail.transfer.status] || ""
                    }`}
                  >
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

              <div className="flex flex-wrap justify-end gap-3 border-t border-border/70 pt-1">
                <Button
                  variant="outline"
                  size="lg"
                  className="h-10 min-w-[210px] px-5 text-sm font-semibold sm:h-11 sm:text-base"
                  onClick={handlePrintTransferExit}
                  disabled={(detail.items || []).length === 0}
                >
                  <Printer className="mr-2 h-4 w-4" />
                  Imprimir egreso
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
