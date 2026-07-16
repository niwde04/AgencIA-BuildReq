import { trpc } from "@/lib/trpc";
import { DataPagination } from "@/components/DataPagination";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { useEffect, useMemo, useState } from "react";

const PAGE_SIZE = 50;
import { toast } from "sonner";
import { getPrintLogoMarkup, printWindowWhenReady } from "@/lib/print-logo";
import { getReadablePrintStyles } from "@/lib/readable-print-styles";
import { getDefaultTransferPreparedByName } from "@/lib/transfer-print";

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

function getWarehouseLabel(warehouse: any) {
  if (!warehouse) return "-";
  return (
    warehouse.displayName ||
    [warehouse.code || warehouse.localCode, warehouse.name]
      .filter(Boolean)
      .join(" - ") ||
    `Bodega ${warehouse.id ?? ""}`.trim()
  );
}

function getTransferSourceWarehouseSummary(detail: any) {
  const labels = Array.from(
    new Set<string>(
      (detail?.items || [])
        .map((item: any) => getWarehouseLabel(item.sourceWarehouse))
        .filter((label: string) => label && label !== "-")
    )
  );

  if (labels.length === 1) return labels[0];
  if (labels.length > 1) return "Varios almacenes";
  return getWarehouseLabel(detail?.originWarehouse);
}

function getTransferItemTargetLabel(item: any) {
  return item?.targetLabel || item?.target?.label || "-";
}

export default function Transfers() {
  const utils = trpc.useUtils();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);
  const debouncedSearchTerm = useDebouncedValue(searchTerm);
  const [preparedByName, setPreparedByName] = useState("");
  const [deliveredToName, setDeliveredToName] = useState("");
  const {
    data: transfersPage,
    isLoading,
    isPlaceholderData,
  } = trpc.transfers.listPage.useQuery(
    {
      search: debouncedSearchTerm.trim() || undefined,
      status: statusFilter === "all" ? undefined : statusFilter,
      page,
      pageSize: PAGE_SIZE,
    },
    { placeholderData: previousData => previousData }
  );
  const transfers = transfersPage?.items ?? [];
  const { data: detail } = trpc.transfers.getById.useQuery(
    { id: selectedId ?? 0 },
    { enabled: Boolean(selectedId) }
  );
  const updatePrintFieldsMutation = trpc.transfers.updatePrintFields.useMutation({
    onSuccess: (transfer) => {
      if (!transfer) return;
      utils.transfers.getById.setData({ id: transfer.id }, (current: any) =>
        current
          ? {
              ...current,
              transfer: {
                ...current.transfer,
                preparedByName: transfer.preparedByName,
                deliveredToName: transfer.deliveredToName,
              },
            }
          : current
      );
      void utils.transfers.invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  useEffect(() => {
    if (!detail?.transfer?.id) return;
    setPreparedByName(getDefaultTransferPreparedByName(detail));
    setDeliveredToName(detail.transfer.deliveredToName || "");
  }, [
    detail?.transfer?.id,
    detail?.transfer?.preparedByName,
    detail?.transfer?.deliveredToName,
    detail?.confirmedBy?.name,
  ]);

  const filteredTransfers = transfers;

  useEffect(() => setPage(1), [debouncedSearchTerm, statusFilter]);
  useEffect(() => {
    if (!isPlaceholderData && transfersPage?.page && transfersPage.page !== page) {
      setPage(transfersPage.page);
    }
  }, [isPlaceholderData, page, transfersPage?.page]);

  const savePrintFields = async (options?: { silent?: boolean }) => {
    if (!detail?.transfer?.id) return false;

    const preparedByLabel = preparedByName.trim();
    const deliveredToLabel = deliveredToName.trim();
    const currentPreparedBy = String(detail.transfer.preparedByName || "").trim();
    const currentDeliveredTo = String(detail.transfer.deliveredToName || "").trim();

    if (
      preparedByLabel === currentPreparedBy &&
      deliveredToLabel === currentDeliveredTo
    ) {
      return true;
    }

    try {
      await updatePrintFieldsMutation.mutateAsync({
        id: detail.transfer.id,
        preparedByName: preparedByLabel || null,
        deliveredToName: deliveredToLabel || null,
      });
      if (!options?.silent) {
        toast.success("Datos de egreso guardados");
      }
      return true;
    } catch {
      return false;
    }
  };

  const handlePrintTransferExit = async () => {
    if (!detail) return;
    const preparedByLabel = preparedByName.trim();
    const deliveredToLabel = deliveredToName.trim();

    if (!preparedByLabel) {
      toast.error("Ingrese el nombre en Elaborado por");
      return;
    }
    if (!deliveredToLabel) {
      toast.error("Ingrese el nombre en Entregado a");
      return;
    }
    const saved = await savePrintFields({ silent: true });
    if (!saved) return;

    const transfer = detail.transfer;
    const transferRequest = detail.transferRequest;
    const originProjectLabel = detail.project
      ? `${detail.project.code} ${detail.project.name}`
      : transferRequest?.projectId
        ? `Proyecto ${transferRequest.projectId}`
        : "-";
    const originWarehouseLabel = getTransferSourceWarehouseSummary(detail);
    const destinationLabel = getDestinationLabel(detail) || "-";
    const destinationWarehouseLabel =
      transferRequest?.destinationType === "bodega_central"
        ? "Bodega Central"
        : detail.destinationWarehouse
          ? getWarehouseLabel(detail.destinationWarehouse)
          : detail.destinationProject?.name || destinationLabel;
    const printDestinationWarehouseLabel =
      destinationWarehouseLabel === originWarehouseLabel
        ? "-"
        : destinationWarehouseLabel;
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
            <td>${escapeHtml(getWarehouseLabel(item.sourceWarehouse))}</td>
            <td>${escapeHtml(getTransferItemTargetLabel(item))}</td>
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
            @page { size: Letter portrait; margin: 9mm; }
            @media print { @page { size: Letter portrait; margin: 9mm; } }
            * { box-sizing: border-box; }
            html {
              width: 216mm;
            }
            body {
              background: #fff;
              color: #000;
              font-family: Arial, Helvetica, sans-serif;
              font-size: 10px;
              margin: 0;
            }
            .sheet {
              margin: 0 auto;
              max-width: 216mm;
              padding: 2mm 4mm 4mm;
            }
            .header {
              align-items: start;
              display: grid;
              gap: 12px;
              grid-template-columns: 86px 1fr 100px;
            }
            .logo {
              display: block;
              height: 46px;
              object-fit: contain;
              width: 64px;
            }
            .title {
              color: #000;
              font-size: 13px;
              font-weight: 800;
              line-height: 1.5;
              text-align: center;
              text-transform: uppercase;
            }
            .company {
              color: #000;
              font-size: 14px;
              margin-bottom: 2px;
            }
            .document-number {
              border: 5px double #222;
              color: #000;
              font-size: 13px;
              font-weight: 900;
              margin-top: 0;
              padding: 4px 8px;
              text-align: center;
            }
            .meta {
              display: grid;
              gap: 18px;
              grid-template-columns: 1fr 1fr;
              margin-top: 6mm;
            }
            .meta-column {
              display: grid;
              gap: 5px;
            }
            .field {
              display: grid;
              gap: 6px;
              grid-template-columns: 95px 1fr;
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
              margin-top: 4mm;
              width: 100%;
            }
            th {
              border-bottom: 2px solid #111;
              border-top: 2px solid #111;
              font-size: 9px;
              font-weight: 800;
              padding: 4px 5px;
              text-align: left;
            }
            td {
              border-bottom: 1px solid #111;
              padding: 5px;
              vertical-align: top;
            }
            .center { text-align: center; }
            .numeric {
              font-variant-numeric: tabular-nums;
              text-align: right;
            }
            .total-row td {
              border-bottom: 2px solid #111;
              font-weight: 800;
            }
            .signatures {
              display: grid;
              gap: 58px;
              grid-template-columns: repeat(3, 180px);
              justify-content: center;
              margin-top: 10mm;
            }
            .signature-name {
              font-size: 12px;
              font-weight: 700;
              min-height: 17px;
              text-align: center;
            }
            .signature-line {
              border-top: 2px solid #111;
              font-size: 13px;
              font-weight: 700;
              margin-top: 12px;
              padding-top: 4px;
              text-align: center;
            }
            @media print {
              html, body { height: auto; overflow: hidden; }
              .sheet { max-width: none; padding: 0; page-break-after: avoid; }
            }
            ${getReadablePrintStyles()}
          </style>
        </head>
        <body>
          <main class="sheet">
            <section class="header">
              ${getPrintLogoMarkup()}
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
                  <div class="label">Referencia:</div>
                  <div class="value">${escapeHtml(referenceLabel)}</div>
                </div>
                <div class="field">
                  <div class="label">A Bodega:</div>
                  <div class="value">${escapeHtml(printDestinationWarehouseLabel)}</div>
                </div>
              </div>
            </section>

            <table>
              <thead>
                <tr>
                  <th style="width: 14%;">Código/No. Serie</th>
                  <th style="width: 19%;">Identificador</th>
                  <th style="width: 14%;">Almacén origen</th>
                  <th style="width: 18%;">Subproyecto / activo fijo</th>
                  <th style="width: 9%;" class="numeric">Cantidad</th>
                  <th style="width: 8%;" class="center">U Medida</th>
                  <th style="width: 12%;">Referencia</th>
                  <th style="width: 6%;" class="numeric">Total</th>
                </tr>
              </thead>
              <tbody>
                ${itemRows || `<tr><td colspan="8">Sin ítems</td></tr>`}
                <tr class="total-row">
                  <td colspan="7">Total general</td>
                  <td class="numeric">${escapeHtml(formatPrintNumber(totalQuantity))}</td>
                </tr>
              </tbody>
            </table>

            <section class="signatures">
              <div>
                <div class="signature-name">${escapeHtml(preparedByLabel)}</div>
                <div class="signature-line">Elaborado por:</div>
              </div>
              <div>
                <div class="signature-name">${escapeHtml(deliveredToLabel)}</div>
                <div class="signature-line">Entregado a:</div>
              </div>
              <div>
                <div class="signature-name">&nbsp;</div>
                <div class="signature-line">Autorizado por:</div>
              </div>
            </section>
          </main>
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindowWhenReady(printWindow);
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
          {transfersPage ? (
            <DataPagination
              page={transfersPage.page}
              pageSize={transfersPage.pageSize}
              total={transfersPage.total}
              totalPages={transfersPage.totalPages}
              onPageChange={setPage}
            />
          ) : null}
        </CardContent>
      </Card>

      <Dialog open={Boolean(selectedId)} onOpenChange={(open) => !open && setSelectedId(null)}>
        <DialogContent className="scrollbar-none max-h-[calc(100vh-0.75rem)] w-[calc(100vw-0.5rem)] max-w-[calc(100vw-0.5rem)] overflow-x-hidden overflow-y-auto rounded-2xl p-4 sm:max-h-[calc(100vh-1.5rem)] sm:w-[calc(100vw-2rem)] sm:max-w-[1500px] sm:p-6 lg:p-7 xl:max-w-[1600px]">
          <DialogHeader>
            <DialogTitle>{detail?.transfer.transferNumber || "Traslado"}</DialogTitle>
          </DialogHeader>

          {detail ? (
            <div className="space-y-5">
              <div className="grid gap-3 md:grid-cols-4">
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
                    Bodega origen
                  </p>
                  <p className="mt-2 truncate text-sm font-medium">
                    {getTransferSourceWarehouseSummary(detail)}
                  </p>
                </div>
                <div className="rounded-lg border border-border p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Bodega destino
                  </p>
                  <p className="mt-2 truncate text-sm font-medium">
                    {detail.transferRequest?.destinationType === "bodega_central"
                      ? "Bodega Central"
                      : getWarehouseLabel(detail.destinationWarehouse)}
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

              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full min-w-[1280px] text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="w-44 p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Código
                      </th>
                      <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Ítem
                      </th>
                      <th className="w-56 p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Bodega origen
                      </th>
                      <th className="w-56 p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Subproyecto / activo fijo
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
                    {(detail.items || []).map((item: any) => {
                      const lineTargetLabel = getTransferItemTargetLabel(item);

                      return (
                        <tr key={item.id} className="border-b border-border last:border-0">
                          <td className="p-3 font-mono text-xs text-muted-foreground">
                            {item.sapItemCode || "-"}
                          </td>
                          <td className="p-3">{item.itemName}</td>
                          <td className="p-3">
                            <p className="max-w-[220px] truncate text-xs font-medium">
                              {getWarehouseLabel(item.sourceWarehouse)}
                            </p>
                          </td>
                          <td className="p-3">
                            <p className="max-w-[220px] truncate text-xs font-medium">
                              {lineTargetLabel}
                            </p>
                          </td>
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
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="grid gap-3 border-t border-border/70 pt-4 md:grid-cols-2">
                <div className="space-y-1">
                  <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Elaborado por *
                  </Label>
                  <Input
                    value={preparedByName}
                    onChange={(event) => setPreparedByName(event.target.value)}
                    onBlur={() => void savePrintFields({ silent: true })}
                    placeholder="Nombre de quien elabora"
                    maxLength={160}
                    required
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Entregado a *
                  </Label>
                  <Input
                    value={deliveredToName}
                    onChange={(event) => setDeliveredToName(event.target.value)}
                    onBlur={() => void savePrintFields({ silent: true })}
                    placeholder="Nombre de quien recibe"
                    maxLength={160}
                    required
                  />
                </div>
              </div>

              <div className="flex flex-wrap justify-end gap-3">
                <Button
                  variant="outline"
                  size="lg"
                  className="h-10 min-w-[210px] px-5 text-sm font-semibold sm:h-11 sm:text-base"
                  onClick={handlePrintTransferExit}
                  disabled={
                    (detail.items || []).length === 0 ||
                    !preparedByName.trim() ||
                    !deliveredToName.trim()
                  }
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
