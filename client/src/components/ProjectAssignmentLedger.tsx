import { Fragment, useState } from "react";
import {
  ArrowLeft,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronRight,
  Download,
  Eye,
  PackageSearch,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import { DataPagination } from "@/components/DataPagination";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { downloadWorkbook } from "@/lib/excel-export";
import { trpc } from "@/lib/trpc";

const TARGETS_PAGE_SIZE = 10;
const MOVEMENTS_PAGE_SIZE = 10;

type VisibleTargetType = "subproyecto" | "activo_fijo";
type AssignmentTargetType = VisibleTargetType | "sin_destino";
type TargetSortBy =
  | "destino"
  | "estado"
  | "articulos"
  | "movimientos"
  | "ultima_asignacion";
type TargetSortDirection = "asc" | "desc";

type AssignmentTarget = {
  targetType: AssignmentTargetType;
  targetKey: string;
  code: string;
  name: string;
  isActive: boolean;
  isHistorical: boolean;
  articleCount: number;
  movementCount: number;
  lastAssignmentAt: Date | string | null;
};

function formatQuantity(value: number) {
  return Number(value ?? 0).toLocaleString("es-HN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatPurchaseMoney(value: number, currency: "HNL" | "USD") {
  const symbol = currency === "USD" ? "US$" : "L";
  return `${symbol} ${Number(value ?? 0).toLocaleString("es-HN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatMovementDate(value?: Date | string | null) {
  if (!value) return "-";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("es-HN", {
    timeZone: "America/Tegucigalpa",
    dateStyle: "short",
    timeStyle: "short",
  });
}

function getSummaryRowKey(row: {
  sapItemCode: string;
  itemName: string;
  unit: string;
}) {
  return `${row.sapItemCode}\u001f${row.itemName}\u001f${row.unit}`;
}

function safeFileSegment(value: string) {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function DocumentLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="font-mono text-xs font-medium text-primary underline-offset-2 hover:underline"
    >
      {label}
    </a>
  );
}

function SortableTargetHeader({
  label,
  column,
  activeColumn,
  direction,
  align = "left",
  onSort,
}: {
  label: string;
  column: TargetSortBy;
  activeColumn: TargetSortBy;
  direction: TargetSortDirection;
  align?: "left" | "right";
  onSort: (column: TargetSortBy) => void;
}) {
  const isActive = column === activeColumn;
  const SortIcon = !isActive
    ? ArrowUpDown
    : direction === "asc"
      ? ArrowUp
      : ArrowDown;
  return (
    <TableHead
      className={align === "right" ? "text-right" : undefined}
      aria-sort={
        isActive ? (direction === "asc" ? "ascending" : "descending") : "none"
      }
    >
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={`h-8 px-2 ${align === "right" ? "ml-auto" : "-ml-2"}`}
        onClick={() => onSort(column)}
      >
        {label}
        <SortIcon className="ml-1.5 h-3.5 w-3.5" />
      </Button>
    </TableHead>
  );
}

export function ProjectAssignmentLedger({
  projectId,
  projectCode,
}: {
  projectId: number;
  projectCode: string;
}) {
  const utils = trpc.useUtils();
  const [targetType, setTargetType] =
    useState<VisibleTargetType>("subproyecto");
  const [search, setSearch] = useState("");
  const [targetsPage, setTargetsPage] = useState(1);
  const [targetSort, setTargetSort] = useState<{
    sortBy: TargetSortBy;
    sortDirection: TargetSortDirection;
  }>({ sortBy: "destino", sortDirection: "asc" });
  const [historyPage, setHistoryPage] = useState(1);
  const [selectedTarget, setSelectedTarget] = useState<AssignmentTarget | null>(
    null
  );
  const [expandedSummaryRow, setExpandedSummaryRow] = useState<string | null>(
    null
  );
  const [isExporting, setIsExporting] = useState(false);
  const debouncedSearch = useDebouncedValue(search);

  const targetsQuery = trpc.projects.listAssignmentTargets.useQuery(
    {
      projectId,
      targetType,
      search: debouncedSearch.trim() || undefined,
      page: targetsPage,
      pageSize: TARGETS_PAGE_SIZE,
      sortBy: targetSort.sortBy,
      sortDirection: targetSort.sortDirection,
    },
    { placeholderData: previousData => previousData }
  );

  const ledgerQuery = trpc.projects.getAssignmentLedger.useQuery(
    {
      projectId,
      targetType: selectedTarget?.targetType ?? "subproyecto",
      targetKey: selectedTarget?.targetKey ?? "pendiente",
      historyPage,
      historyPageSize: MOVEMENTS_PAGE_SIZE,
    },
    { enabled: Boolean(selectedTarget) }
  );

  const selectTarget = (target: AssignmentTarget) => {
    setSelectedTarget(target);
    setHistoryPage(1);
    setExpandedSummaryRow(null);
  };

  const summaryPurchasedTotals = (ledgerQuery.data?.summary ?? []).reduce(
    (totals, row) => ({
      hnl: totals.hnl + row.purchasedHnl,
      usd: totals.usd + row.purchasedUsd,
    }),
    { hnl: 0, usd: 0 }
  );

  const sortTargets = (sortBy: TargetSortBy) => {
    setTargetSort(current => ({
      sortBy,
      sortDirection:
        current.sortBy === sortBy && current.sortDirection === "asc"
          ? "desc"
          : "asc",
    }));
    setTargetsPage(1);
  };

  const exportLedger = async () => {
    if (!selectedTarget || isExporting) return;
    setIsExporting(true);
    try {
      const payload = await utils.projects.exportAssignmentLedger.fetch({
        projectId,
        targetType: selectedTarget.targetType,
        targetKey: selectedTarget.targetKey,
      });
      const dateForExcel = (value: Date | string) => {
        const date = value instanceof Date ? value : new Date(value);
        return Number.isNaN(date.getTime()) ? "" : date;
      };

      await downloadWorkbook(
        `asignaciones-${safeFileSegment(projectCode)}-${safeFileSegment(
          payload.target.code || payload.target.name
        )}.xlsx`,
        [
          {
            sheetName: "Resumen",
            rows: payload.summary,
            columns: [
              { header: "Código SAP", value: row => row.sapItemCode },
              { header: "Descripción", value: row => row.itemName },
              { header: "Unidad", value: row => row.unit },
              {
                header: "Entregado",
                value: row => row.deliveredQuantity,
                numFmt: "0.00",
              },
              {
                header: "Devuelto",
                value: row => row.returnedQuantity,
                numFmt: "0.00",
              },
              {
                header: "Asignado neto",
                value: row => row.netQuantity,
                numFmt: "0.00",
              },
              {
                header: "Total comprado HNL",
                value: row => row.purchasedHnl,
                numFmt: "0.00",
              },
              {
                header: "Total comprado USD",
                value: row => row.purchasedUsd,
                numFmt: "0.00",
              },
            ],
          },
          {
            sheetName: "Movimientos",
            rows: payload.movements,
            columns: [
              {
                header: "Fecha",
                value: row => dateForExcel(row.movementDate),
                numFmt: "dd/mm/yyyy hh:mm",
              },
              {
                header: "Tipo",
                value: row =>
                  row.movementType === "salida" ? "Salida" : "Devolución",
              },
              { header: "Salida SB", value: row => row.warehouseExitNumber },
              { header: "Devolución DEV", value: row => row.returnNumber },
              { header: "Requisición REQ", value: row => row.requestNumber },
              { header: "Código SAP", value: row => row.sapItemCode },
              { header: "Artículo", value: row => row.itemName },
              { header: "Unidad", value: row => row.unit },
              {
                header: "Entregado",
                value: row => row.deliveredQuantity,
                numFmt: "0.00",
              },
              {
                header: "Devuelto",
                value: row => row.returnedQuantity,
                numFmt: "0.00",
              },
              {
                header: "Asignado neto",
                value: row => row.netQuantity,
                numFmt: "0.00",
              },
              { header: "Recibido por", value: row => row.receivedByName },
            ],
          },
        ]
      );
      toast.success("Excel de asignaciones generado");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "No se pudo generar el Excel de asignaciones"
      );
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="border-t pt-4 space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-base font-semibold">Asignaciones por destino</h2>
          <p className="text-xs text-muted-foreground">
            Materiales entregados netos por subproyecto o activo fijo, con sus
            devoluciones y documentos relacionados.
          </p>
        </div>
        {selectedTarget && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setSelectedTarget(null);
              setExpandedSummaryRow(null);
            }}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Volver a destinos
          </Button>
        )}
      </div>

      {selectedTarget ? (
        <div className="space-y-4 rounded-md border p-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-muted-foreground">
                  {selectedTarget.code}
                </span>
                <h3 className="text-sm font-semibold">{selectedTarget.name}</h3>
                {selectedTarget.targetType !== "sin_destino" && (
                  <Badge variant="outline" className="text-xs">
                    {selectedTarget.isActive ? "Activo" : "Inactivo"}
                  </Badge>
                )}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {selectedTarget.articleCount} artículos ·{" "}
                {selectedTarget.movementCount} movimientos
              </p>
            </div>
            <Button
              size="sm"
              onClick={exportLedger}
              disabled={isExporting || ledgerQuery.isLoading}
            >
              <Download className="mr-2 h-4 w-4" />
              {isExporting ? "Exportando..." : "Exportar Excel"}
            </Button>
          </div>

          {ledgerQuery.isLoading ? (
            <div className="h-32 animate-pulse rounded-md bg-muted" />
          ) : ledgerQuery.error ? (
            <div className="rounded-md border border-destructive/30 p-4 text-sm text-destructive">
              {ledgerQuery.error.message}
            </div>
          ) : ledgerQuery.data ? (
            <>
              <div className="space-y-2">
                <h4 className="text-sm font-semibold">Resumen por artículo</h4>
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Código SAP</TableHead>
                        <TableHead>Descripción</TableHead>
                        <TableHead>Unidad</TableHead>
                        <TableHead className="text-right">Entregado</TableHead>
                        <TableHead className="text-right">Devuelto</TableHead>
                        <TableHead className="text-right">
                          Asignado neto
                        </TableHead>
                        <TableHead className="text-right">
                          Total comprado
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {ledgerQuery.data.summary.length === 0 ? (
                        <TableRow>
                          <TableCell
                            colSpan={7}
                            className="h-20 text-center text-muted-foreground"
                          >
                            Sin asignaciones
                          </TableCell>
                        </TableRow>
                      ) : (
                        ledgerQuery.data.summary.map(row => {
                          const rowKey = getSummaryRowKey(row);
                          const isExpanded = expandedSummaryRow === rowKey;
                          const hasInvoices = row.purchaseInvoices.length > 0;

                          return (
                            <Fragment key={rowKey}>
                              <TableRow>
                                <TableCell className="font-mono text-xs">
                                  <span className="flex items-center gap-1">
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7 shrink-0"
                                      disabled={!hasInvoices}
                                      aria-expanded={isExpanded}
                                      aria-label={
                                        hasInvoices
                                          ? `${isExpanded ? "Ocultar" : "Ver"} facturas de ${row.itemName}`
                                          : `Sin facturas contabilizadas para ${row.itemName}`
                                      }
                                      onClick={() =>
                                        setExpandedSummaryRow(current =>
                                          current === rowKey ? null : rowKey
                                        )
                                      }
                                    >
                                      <ChevronRight
                                        className={`h-4 w-4 transition-transform ${
                                          isExpanded ? "rotate-90" : ""
                                        }`}
                                      />
                                    </Button>
                                    {row.sapItemCode}
                                  </span>
                                </TableCell>
                                <TableCell className="min-w-56 whitespace-normal">
                                  {row.itemName}
                                </TableCell>
                                <TableCell>{row.unit}</TableCell>
                                <TableCell className="text-right tabular-nums">
                                  {formatQuantity(row.deliveredQuantity)}
                                </TableCell>
                                <TableCell className="text-right tabular-nums">
                                  {formatQuantity(row.returnedQuantity)}
                                </TableCell>
                                <TableCell className="text-right font-semibold tabular-nums">
                                  {formatQuantity(row.netQuantity)}
                                </TableCell>
                                <TableCell className="text-right font-medium tabular-nums">
                                  {row.purchasedHnl > 0 ||
                                  row.purchasedUsd > 0 ? (
                                    <span className="flex flex-col gap-0.5">
                                      {row.purchasedHnl > 0 && (
                                        <span>
                                          {formatPurchaseMoney(
                                            row.purchasedHnl,
                                            "HNL"
                                          )}
                                        </span>
                                      )}
                                      {row.purchasedUsd > 0 && (
                                        <span>
                                          {formatPurchaseMoney(
                                            row.purchasedUsd,
                                            "USD"
                                          )}
                                        </span>
                                      )}
                                    </span>
                                  ) : (
                                    "-"
                                  )}
                                </TableCell>
                              </TableRow>

                              {isExpanded && (
                                <TableRow className="bg-muted/20 hover:bg-muted/20">
                                  <TableCell colSpan={7} className="p-3">
                                    <div className="ml-8 space-y-2 rounded-md border bg-background p-3">
                                      <p className="text-xs font-semibold">
                                        Facturas contabilizadas de este artículo
                                      </p>
                                      <Table>
                                        <TableHeader>
                                          <TableRow>
                                            <TableHead>Factura</TableHead>
                                            <TableHead>No. fiscal</TableHead>
                                            <TableHead>
                                              Fecha documento
                                            </TableHead>
                                            <TableHead>Proveedor</TableHead>
                                            <TableHead>Moneda</TableHead>
                                            <TableHead className="text-right">
                                              Total línea
                                            </TableHead>
                                          </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                          {row.purchaseInvoices.map(invoice => (
                                            <TableRow key={invoice.invoiceId}>
                                              <TableCell>
                                                <DocumentLink
                                                  href={`/facturas?editar=${invoice.invoiceId}`}
                                                  label={
                                                    invoice.invoiceDocumentNumber
                                                  }
                                                />
                                              </TableCell>
                                              <TableCell className="font-mono text-xs">
                                                {invoice.fiscalInvoiceNumber ||
                                                  "-"}
                                              </TableCell>
                                              <TableCell className="text-xs">
                                                {formatMovementDate(
                                                  invoice.documentDate ??
                                                    invoice.accountedAt
                                                )}
                                              </TableCell>
                                              <TableCell className="min-w-48 whitespace-normal text-xs">
                                                {invoice.supplierName || "-"}
                                              </TableCell>
                                              <TableCell>
                                                {invoice.currency}
                                              </TableCell>
                                              <TableCell className="text-right font-medium tabular-nums">
                                                {formatPurchaseMoney(
                                                  invoice.lineTotal,
                                                  invoice.currency
                                                )}
                                              </TableCell>
                                            </TableRow>
                                          ))}
                                        </TableBody>
                                      </Table>
                                    </div>
                                  </TableCell>
                                </TableRow>
                              )}
                            </Fragment>
                          );
                        })
                      )}
                    </TableBody>
                    {ledgerQuery.data.summary.length > 0 && (
                      <TableFooter>
                        <TableRow>
                          <TableCell
                            colSpan={6}
                            className="text-right font-semibold"
                          >
                            Total comprado
                          </TableCell>
                          <TableCell className="text-right font-bold tabular-nums">
                            {summaryPurchasedTotals.hnl > 0 ||
                            summaryPurchasedTotals.usd > 0 ? (
                              <span className="flex flex-col gap-0.5">
                                {summaryPurchasedTotals.hnl > 0 && (
                                  <span>
                                    {formatPurchaseMoney(
                                      summaryPurchasedTotals.hnl,
                                      "HNL"
                                    )}
                                  </span>
                                )}
                                {summaryPurchasedTotals.usd > 0 && (
                                  <span>
                                    {formatPurchaseMoney(
                                      summaryPurchasedTotals.usd,
                                      "USD"
                                    )}
                                  </span>
                                )}
                              </span>
                            ) : (
                              "-"
                            )}
                          </TableCell>
                        </TableRow>
                      </TableFooter>
                    )}
                  </Table>
                </div>
              </div>

              <div className="space-y-2">
                <h4 className="text-sm font-semibold">
                  Historial de movimientos
                </h4>
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Fecha</TableHead>
                        <TableHead>Tipo</TableHead>
                        <TableHead>Documentos</TableHead>
                        <TableHead>Requisición</TableHead>
                        <TableHead>Artículo</TableHead>
                        <TableHead className="text-right">Entregado</TableHead>
                        <TableHead className="text-right">Devuelto</TableHead>
                        <TableHead className="text-right">Neto</TableHead>
                        <TableHead>Recibido por</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {ledgerQuery.data.movements.items.length === 0 ? (
                        <TableRow>
                          <TableCell
                            colSpan={9}
                            className="h-20 text-center text-muted-foreground"
                          >
                            No hay movimientos para este destino.
                          </TableCell>
                        </TableRow>
                      ) : (
                        ledgerQuery.data.movements.items.map(movement => (
                          <TableRow key={movement.movementId}>
                            <TableCell className="text-xs">
                              {formatMovementDate(movement.movementDate)}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant="outline"
                                className={
                                  movement.movementType === "salida"
                                    ? "border-blue-300 text-blue-700"
                                    : "border-amber-300 text-amber-700"
                                }
                              >
                                {movement.movementType === "salida"
                                  ? "Salida"
                                  : "Devolución"}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-col gap-1">
                                <DocumentLink
                                  href={`/salidas-inventario?exitId=${movement.warehouseExitId}`}
                                  label={movement.warehouseExitNumber}
                                />
                                {movement.returnId && movement.returnNumber && (
                                  <DocumentLink
                                    href={`/devoluciones?returnId=${movement.returnId}`}
                                    label={movement.returnNumber}
                                  />
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              {movement.requestId && movement.requestNumber ? (
                                <DocumentLink
                                  href={`/solicitudes/${movement.requestId}`}
                                  label={movement.requestNumber}
                                />
                              ) : (
                                "-"
                              )}
                            </TableCell>
                            <TableCell className="min-w-56 whitespace-normal">
                              <span className="font-mono text-xs">
                                {movement.sapItemCode}
                              </span>
                              <span className="block text-xs text-muted-foreground">
                                {movement.itemName} · {movement.unit}
                              </span>
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {formatQuantity(movement.deliveredQuantity)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {formatQuantity(movement.returnedQuantity)}
                            </TableCell>
                            <TableCell className="text-right font-medium tabular-nums">
                              {formatQuantity(movement.netQuantity)}
                            </TableCell>
                            <TableCell className="max-w-48 whitespace-normal text-xs">
                              {movement.receivedByName || "-"}
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                  {ledgerQuery.data.movements.total > 0 && (
                    <DataPagination
                      page={ledgerQuery.data.movements.page}
                      pageSize={ledgerQuery.data.movements.pageSize}
                      total={ledgerQuery.data.movements.total}
                      totalPages={ledgerQuery.data.movements.totalPages}
                      onPageChange={setHistoryPage}
                    />
                  )}
                </div>
              </div>
            </>
          ) : null}
        </div>
      ) : (
        <div className="space-y-3">
          <Tabs
            value={targetType}
            onValueChange={value => {
              setTargetType(value as VisibleTargetType);
              setTargetsPage(1);
            }}
          >
            <TabsList className="grid w-full max-w-md grid-cols-2">
              <TabsTrigger value="subproyecto">Subproyectos</TabsTrigger>
              <TabsTrigger value="activo_fijo">Activos fijos</TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={event => {
                setSearch(event.target.value);
                setTargetsPage(1);
              }}
              placeholder={
                targetType === "subproyecto"
                  ? "Buscar subproyecto..."
                  : "Buscar activo fijo..."
              }
              className="pl-9"
            />
          </div>

          {targetsQuery.isLoading ? (
            <div className="h-28 animate-pulse rounded-md bg-muted" />
          ) : targetsQuery.error ? (
            <div className="rounded-md border border-destructive/30 p-4 text-sm text-destructive">
              {targetsQuery.error.message}
            </div>
          ) : targetsQuery.data?.items.length === 0 ? (
            <div className="rounded-md border border-dashed p-6 text-center">
              <PackageSearch className="mx-auto mb-2 h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">
                No se encontraron destinos.
              </p>
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortableTargetHeader
                      label="Destino"
                      column="destino"
                      activeColumn={targetSort.sortBy}
                      direction={targetSort.sortDirection}
                      onSort={sortTargets}
                    />
                    <SortableTargetHeader
                      label="Estado"
                      column="estado"
                      activeColumn={targetSort.sortBy}
                      direction={targetSort.sortDirection}
                      onSort={sortTargets}
                    />
                    <SortableTargetHeader
                      label="Artículos"
                      column="articulos"
                      activeColumn={targetSort.sortBy}
                      direction={targetSort.sortDirection}
                      align="right"
                      onSort={sortTargets}
                    />
                    <SortableTargetHeader
                      label="Movimientos"
                      column="movimientos"
                      activeColumn={targetSort.sortBy}
                      direction={targetSort.sortDirection}
                      align="right"
                      onSort={sortTargets}
                    />
                    <SortableTargetHeader
                      label="Última asignación"
                      column="ultima_asignacion"
                      activeColumn={targetSort.sortBy}
                      direction={targetSort.sortDirection}
                      onSort={sortTargets}
                    />
                    <TableHead className="text-right">Acción</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {targetsQuery.data?.items.map(target => (
                    <TableRow key={`${target.targetType}-${target.targetKey}`}>
                      <TableCell className="min-w-64 whitespace-normal">
                        <span className="font-mono text-xs text-muted-foreground">
                          {target.code}
                        </span>
                        <span className="block text-sm font-medium">
                          {target.name}
                        </span>
                      </TableCell>
                      <TableCell>
                        {target.articleCount === 0 ? (
                          <Badge
                            variant="outline"
                            className="text-muted-foreground"
                          >
                            Sin asignaciones
                          </Badge>
                        ) : target.targetType === "sin_destino" ? (
                          <Badge
                            variant="outline"
                            className="border-amber-300 text-amber-700"
                          >
                            Histórico
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className={
                              target.isActive
                                ? "border-emerald-300 text-emerald-700"
                                : "text-muted-foreground"
                            }
                          >
                            {target.isActive ? "Activo" : "Inactivo"}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {target.articleCount}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {target.movementCount}
                      </TableCell>
                      <TableCell className="text-xs">
                        {formatMovementDate(target.lastAssignmentAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => selectTarget(target)}
                        >
                          <Eye className="mr-2 h-4 w-4" />
                          Ver
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {targetsQuery.data && targetsQuery.data.total > 0 && (
                <DataPagination
                  page={targetsQuery.data.page}
                  pageSize={targetsQuery.data.pageSize}
                  total={targetsQuery.data.total}
                  totalPages={targetsQuery.data.totalPages}
                  onPageChange={setTargetsPage}
                />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
