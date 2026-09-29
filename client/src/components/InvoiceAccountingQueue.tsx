import { useRef, useState } from "react";
import { Link } from "wouter";
import {
  CheckCircle2,
  ChevronDown,
  Download,
  Loader2,
  Search,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { buildDatedExcelFileName, downloadWorkbook } from "@/lib/excel-export";
import {
  buildInvoiceAccountingWorksheets,
  collectInvoiceAccountingExport,
} from "@/lib/invoice-accounting-export";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { DataPagination } from "@/components/DataPagination";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { INVOICE_ACCOUNTING_STATUS_LABELS } from "@shared/invoice-accounting";
import { formatPurchaseOrderCurrency } from "@shared/purchase-orders";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";

type Row =
  inferRouterOutputs<AppRouter>["treasury"]["invoiceAccountingQueue"]["items"][number];
type QueueStatus =
  | "pendiente_contabilizar"
  | "registrada"
  | "rechazada"
  | "anulada"
  | "all";
const PAGE_SIZE = 10;
function dateLabel(value: Date | string | null) {
  if (!value) return "-";
  const [year, month, day] = (
    value instanceof Date ? value.toISOString() : value
  )
    .slice(0, 10)
    .split("-");
  return day + "/" + month + "/" + year;
}

export function InvoiceAccountingQueue({
  canAccount,
}: {
  canAccount: boolean;
}) {
  const utils = trpc.useUtils();
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [project, setProject] = useState("all");
  const [currency, setCurrency] = useState<"all" | "HNL" | "USD">("all");
  const [status, setStatus] = useState<QueueStatus>("pendiente_contabilizar");
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebouncedValue(search);
  const [taxDetail, setTaxDetail] = useState<Row | null>(null);
  const [decision, setDecision] = useState<{
    row: Row;
    action: "account" | "reject";
  } | null>(null);
  const [comment, setComment] = useState("");
  const exportInProgress = useRef(false);
  const [exportProgress, setExportProgress] = useState<{
    loaded: number;
    total: number;
  } | null>(null);
  const exporting = exportProgress !== null;
  const filters = {
    search: debouncedSearch.trim() || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    projectId: project === "all" ? undefined : Number(project),
    currency: currency === "all" ? undefined : currency,
    status,
  };
  const query = trpc.treasury.invoiceAccountingQueue.useQuery({
    ...filters,
    page,
    pageSize: PAGE_SIZE,
  });
  const projects = trpc.projects.list.useQuery();
  const invalidate = async () => {
    await Promise.all([
      utils.invoices.invalidate(),
      utils.treasury.invalidate(),
      utils.financialNotes.invalidate(),
      utils.dashboard.sidebarCounts.invalidate(),
    ]);
  };
  const account = trpc.invoices.account.useMutation({
    onSuccess: async () => {
      toast.success("Factura contabilizada");
      setDecision(null);
      await invalidate();
    },
    onError: error => {
      toast.error(error.message);
      void query.refetch();
    },
  });
  const reject = trpc.invoices.reject.useMutation({
    onSuccess: async () => {
      toast.success("Factura rechazada; disponible para corregir en Facturas");
      setDecision(null);
      await invalidate();
    },
    onError: error => {
      toast.error(error.message);
      void query.refetch();
    },
  });
  const busy = account.isPending || reject.isPending;
  const choose = (row: Row, action: "account" | "reject") => {
    setDecision({ row, action });
    setComment(action === "account" ? (row.accountingComment ?? "") : "");
  };
  const confirm = () => {
    if (!decision || busy) return;
    if (decision.action === "reject") {
      if (comment.trim().length < 5) {
        toast.error("Escribe un motivo de al menos 5 caracteres");
        return;
      }
      reject.mutate({
        id: decision.row.id,
        rejectionComment: comment.trim(),
        stage: "treasury",
      });
    } else
      account.mutate({
        id: decision.row.id,
        accountingComment: comment.trim() || undefined,
      });
  };
  const exportExcel = async () => {
    if (exportInProgress.current || busy) return;
    exportInProgress.current = true;
    setExportProgress({ loaded: 0, total: query.data?.total ?? 0 });
    // Capture exactly the filters visible when Download is pressed, including typed search.
    const exportFilters = { ...filters, search: search.trim() || undefined };
    try {
      const invoices = await collectInvoiceAccountingExport(
        (page, pageSize) =>
          utils.treasury.invoiceAccountingQueue.fetch(
            { ...exportFilters, page, pageSize },
            { staleTime: 0 }
          ),
        (loaded, total) => setExportProgress({ loaded, total })
      );
      if (!invoices.length) {
        toast.info("No hay facturas para exportar con estos filtros.");
        return;
      }
      await downloadWorkbook(
        buildDatedExcelFileName("facturas-por-contabilizar"),
        buildInvoiceAccountingWorksheets(invoices)
      );
      toast.success(
        "Excel generado con " +
          invoices.length.toLocaleString("es-HN") +
          " facturas"
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "No se pudo generar el Excel. Intenta nuevamente."
      );
    } finally {
      exportInProgress.current = false;
      setExportProgress(null);
    }
  };
  const rows = query.data?.items ?? [];
  return (
    <>
      <Card
        className="order-[-2] min-w-0"
        data-testid="invoice-accounting-queue"
      >
        <Accordion type="single" collapsible>
          <AccordionItem value="invoice-accounting" className="border-b-0">
            <AccordionTrigger className="px-4 py-5 text-left hover:no-underline sm:px-6">
              <span className="flex min-w-0 flex-1 flex-col items-start gap-1">
                <span className="flex min-w-0 items-start gap-3 text-base font-semibold sm:text-lg">
                  <span className="mt-1 h-5 w-1 shrink-0 rounded-full bg-primary" />
                  <span className="min-w-0">
                    Facturas pendientes de contabilizar
                  </span>
                  {query.isFetching ? (
                    <Loader2
                      className="mt-1 h-4 w-4 shrink-0 animate-spin"
                      aria-label="Cargando facturas"
                    />
                  ) : (
                    <Badge variant="secondary" className="mt-1 shrink-0">
                      {query.data?.total.toLocaleString("es-HN") ?? "—"}
                    </Badge>
                  )}
                </span>
                <span className="pl-4 text-sm font-normal text-muted-foreground">
                  Revisa las facturas enviadas y contabilízalas o recházalas
                  para corrección.
                </span>
              </span>
            </AccordionTrigger>
            <AccordionContent className="pb-0">
              <CardContent className="min-w-0 space-y-4 border-t px-4 pt-6 sm:px-6">
                <div className="grid min-w-0 items-end gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <div className="min-w-0 space-y-2">
                    <Label htmlFor="accounting-status">Estado de factura</Label>
                    <Select
                      value={status}
                      onValueChange={value => {
                        setStatus(value as QueueStatus);
                        setPage(1);
                      }}
                    >
                      <SelectTrigger id="accounting-status" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todos los enviados</SelectItem>
                        {Object.entries(INVOICE_ACCOUNTING_STATUS_LABELS).map(
                          ([value, label]) => (
                            <SelectItem value={value} key={value}>
                              {label}
                            </SelectItem>
                          )
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="min-w-0 space-y-2">
                    <Label htmlFor="accounting-project">Proyecto</Label>
                    <Select
                      value={project}
                      onValueChange={value => {
                        setProject(value);
                        setPage(1);
                      }}
                    >
                      <SelectTrigger id="accounting-project" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todos los proyectos</SelectItem>
                        {projects.data?.map(item => (
                          <SelectItem value={String(item.id)} key={item.id}>
                            {item.code} - {item.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="accounting-currency">Moneda</Label>
                    <Select
                      value={currency}
                      onValueChange={value => {
                        setCurrency(value as typeof currency);
                        setPage(1);
                      }}
                    >
                      <SelectTrigger
                        id="accounting-currency"
                        className="w-full"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todas las monedas</SelectItem>
                        <SelectItem value="HNL">Lempiras (HNL)</SelectItem>
                        <SelectItem value="USD">Dólares (USD)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid min-w-0 grid-cols-2 gap-3">
                    <div className="min-w-0 space-y-2">
                      <Label htmlFor="accounting-from">Desde</Label>
                      <Input
                        id="accounting-from"
                        type="date"
                        value={dateFrom}
                        max={dateTo || undefined}
                        onChange={event => {
                          setDateFrom(event.target.value);
                          if (dateTo && event.target.value > dateTo)
                            setDateTo(event.target.value);
                          setPage(1);
                        }}
                      />
                    </div>
                    <div className="min-w-0 space-y-2">
                      <Label htmlFor="accounting-to">Hasta</Label>
                      <Input
                        id="accounting-to"
                        type="date"
                        value={dateTo}
                        min={dateFrom || undefined}
                        onChange={event => {
                          setDateTo(event.target.value);
                          if (
                            dateFrom &&
                            event.target.value &&
                            event.target.value < dateFrom
                          )
                            setDateFrom(event.target.value);
                          setPage(1);
                        }}
                      />
                    </div>
                  </div>
                  <div className="min-w-0 space-y-2 sm:col-span-2 xl:col-span-3">
                    <Label htmlFor="accounting-search">Buscar</Label>
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="accounting-search"
                        className="pl-9"
                        value={search}
                        maxLength={200}
                        onChange={event => {
                          setSearch(event.target.value);
                          setPage(1);
                        }}
                        placeholder="Factura, OC, recepción, REQ, artículo, requiriente, creador, proveedor o proyecto"
                      />
                    </div>
                  </div>
                  <Button
                    className="min-h-10 w-full sm:col-span-2 xl:col-span-1"
                    onClick={() => void exportExcel()}
                    disabled={
                      exporting ||
                      busy ||
                      query.isLoading ||
                      query.isError ||
                      query.data?.total === 0
                    }
                    title="Descargar todas las facturas que coincidan con los filtros"
                    aria-live="polite"
                  >
                    {exporting ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Download className="mr-2 h-4 w-4" />
                    )}
                    {exportProgress
                      ? "Exportando " +
                        exportProgress.loaded.toLocaleString("es-HN") +
                        "/" +
                        exportProgress.total.toLocaleString("es-HN")
                      : "Exportar Excel"}
                  </Button>
                </div>
                {query.isError ? (
                  <div
                    role="alert"
                    className="space-y-2 text-sm text-destructive"
                  >
                    <p>{query.error.message}</p>
                    <Button
                      variant="outline"
                      onClick={() => void query.refetch()}
                    >
                      Reintentar
                    </Button>
                  </div>
                ) : query.isLoading ? (
                  <p
                    className="py-8 text-center text-muted-foreground"
                    role="status"
                  >
                    Cargando facturas…
                  </p>
                ) : (
                  <>
                    <p className="text-xs text-muted-foreground">
                      Abre el importe de ISV para ver su desglose. Desplaza la
                      tabla para consultar todas las columnas.
                    </p>
                    <div className="min-w-0 overflow-hidden rounded-md border">
                      <Table className="min-w-[2800px] tabular-nums">
                        <TableHeader>
                          <TableRow>
                            {[
                              "Documento",
                              "Proyecto",
                              "Proveedor",
                              "RTN",
                              "Nro. Factura",
                              "Fecha del Documento",
                              "Subtotal",
                              "ISV",
                              "Otros Cargos",
                              "Total Factura",
                              "Retención 1%",
                              "Retención 10%",
                              "Honorarios y Servicios (12.5%)",
                              "Retención 15%",
                              "Retención 25%",
                              "Otras Retenciones",
                              "Descuento por documento",
                              "Neto a Pagar",
                              "Anticipo Aplicado",
                              "Saldo Pendiente",
                              "Estatus",
                              "Acciones",
                            ].map((header, index) => (
                              <TableHead
                                key={header}
                                className={
                                  index === 0
                                    ? "sticky left-0 z-10 min-w-44 bg-background"
                                    : index >= 6 && index <= 19
                                      ? "text-right"
                                      : ""
                                }
                              >
                                {header}
                              </TableHead>
                            ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {rows.length ? (
                            rows.map(row => {
                              const fmt = (amount: number) =>
                                formatPurchaseOrderCurrency(
                                  amount,
                                  row.currency
                                );
                              return (
                                <TableRow key={row.id}>
                                  <TableCell className="sticky left-0 z-10 bg-background">
                                    <Link
                                      className="font-medium text-primary hover:underline"
                                      href={"/facturas?editar=" + row.id}
                                    >
                                      {row.document}
                                    </Link>
                                    <div className="text-xs text-muted-foreground">
                                      {row.currency}
                                    </div>
                                  </TableCell>
                                  <TableCell className="min-w-56 max-w-64 whitespace-normal">
                                    {row.project}
                                  </TableCell>
                                  <TableCell className="min-w-56 max-w-64 whitespace-normal">
                                    {row.supplier}
                                  </TableCell>
                                  <TableCell>{row.rtn}</TableCell>
                                  <TableCell>{row.number || "-"}</TableCell>
                                  <TableCell>
                                    {dateLabel(row.documentDate)}
                                  </TableCell>
                                  <TableCell className="text-right">
                                    {fmt(row.subtotal)}
                                  </TableCell>
                                  <TableCell className="text-right">
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-8 px-1 text-primary"
                                      onClick={() => setTaxDetail(row)}
                                      aria-label={
                                        "Ver desglose ISV de " + row.document
                                      }
                                    >
                                      {fmt(row.tax)}
                                      <ChevronDown className="ml-1 h-3 w-3" />
                                    </Button>
                                  </TableCell>
                                  {[
                                    row.otherCharges,
                                    row.total,
                                    row.retentions.one,
                                    row.retentions.ten,
                                    row.retentions.services,
                                    row.retentions.fifteen,
                                    row.retentions.twentyFive,
                                    row.retentions.other,
                                    row.discount,
                                    row.net,
                                    row.appliedAdvance,
                                  ].map((amount, index) => (
                                    <TableCell
                                      key={index}
                                      className="text-right"
                                    >
                                      {fmt(amount)}
                                    </TableCell>
                                  ))}
                                  <TableCell className="text-right font-medium">
                                    {fmt(row.balance)}
                                    <div className="text-xs font-normal text-muted-foreground">
                                      {row.balance <= 0
                                        ? "Pagado"
                                        : row.paid + row.appliedAdvance > 0
                                          ? "Parcial"
                                          : "Pendiente"}
                                    </div>
                                  </TableCell>
                                  <TableCell>
                                    <Badge variant="outline">
                                      {INVOICE_ACCOUNTING_STATUS_LABELS[
                                        row.status
                                      ] ?? row.status}
                                    </Badge>
                                    {row.status === "rechazada" &&
                                      row.rejectionComment && (
                                        <p className="mt-1 min-w-56 max-w-64 whitespace-normal text-xs text-destructive">
                                          {row.rejectionComment}
                                        </p>
                                      )}
                                  </TableCell>
                                  <TableCell>
                                    {canAccount &&
                                    row.status === "pendiente_contabilizar" ? (
                                      <div className="flex gap-2">
                                        <Button
                                          size="sm"
                                          disabled={
                                            busy ||
                                            query.isFetching ||
                                            exporting
                                          }
                                          onClick={() => choose(row, "account")}
                                        >
                                          <CheckCircle2 className="mr-1 h-4 w-4" />
                                          Contabilizar
                                        </Button>
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          disabled={
                                            busy ||
                                            query.isFetching ||
                                            exporting
                                          }
                                          onClick={() => choose(row, "reject")}
                                        >
                                          <XCircle className="mr-1 h-4 w-4" />
                                          Rechazar
                                        </Button>
                                      </div>
                                    ) : (
                                      <span className="text-xs text-muted-foreground">
                                        {row.status === "pendiente_contabilizar"
                                          ? "Revisión de Contabilidad"
                                          : "—"}
                                      </span>
                                    )}
                                  </TableCell>
                                </TableRow>
                              );
                            })
                          ) : (
                            <TableRow>
                              <TableCell
                                colSpan={22}
                                className="h-24 text-left text-muted-foreground"
                              >
                                No hay facturas con estos filtros.
                              </TableCell>
                            </TableRow>
                          )}
                        </TableBody>
                      </Table>
                    </div>
                    <div className="max-w-full overflow-x-auto">
                      <DataPagination
                        page={query.data?.page ?? page}
                        pageSize={PAGE_SIZE}
                        total={query.data?.total ?? 0}
                        totalPages={query.data?.totalPages ?? 1}
                        onPageChange={setPage}
                      />
                    </div>
                  </>
                )}
              </CardContent>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </Card>
      <Dialog
        open={Boolean(taxDetail)}
        onOpenChange={open => {
          if (!open) setTaxDetail(null);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Desglose de ISV</DialogTitle>
            <DialogDescription>
              {taxDetail?.document} · Impuestos registrados en la factura.
            </DialogDescription>
          </DialogHeader>
          {taxDetail && (
            <div className="space-y-3">
              {taxDetail.taxes.length ? (
                taxDetail.taxes.map(tax => (
                  <div
                    key={tax.code + ":" + tax.ratePercent}
                    className="flex items-start justify-between gap-4 border-b pb-2 text-sm"
                  >
                    <span className="min-w-0 break-words">
                      {tax.label}
                      {tax.ratePercent !== null && (
                        <span className="block text-xs text-muted-foreground">
                          {tax.ratePercent}%
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 tabular-nums">
                      {formatPurchaseOrderCurrency(
                        tax.amount,
                        taxDetail.currency
                      )}
                    </span>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">
                  Esta factura no tiene impuestos registrados.
                </p>
              )}
              <div className="flex justify-between gap-3 font-semibold">
                <span>Total ISV</span>
                <span>
                  {formatPurchaseOrderCurrency(
                    taxDetail.tax,
                    taxDetail.currency
                  )}
                </span>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(decision)}
        onOpenChange={open => {
          if (!open && !busy) setDecision(null);
        }}
      >
        <DialogContent
          className="max-w-lg"
          onInteractOutside={event => {
            if (busy) event.preventDefault();
          }}
          onEscapeKeyDown={event => {
            if (busy) event.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {decision?.action === "account"
                ? "Contabilizar factura"
                : "Rechazar factura"}
            </DialogTitle>
            <DialogDescription>
              {decision?.action === "account"
                ? "Segunda validación: se registrará la contabilización y se aplicarán los anticipos disponibles correspondientes."
                : "La factura volverá a Facturas para corregirla, enviarla a revisión y pasar nuevamente por ambas validaciones."}
            </DialogDescription>
          </DialogHeader>
          {decision && (
            <>
              <div className="space-y-1 rounded-md border p-3 text-sm">
                <p className="font-medium">
                  {decision.row.document} · {decision.row.number}
                </p>
                <p>{decision.row.supplier}</p>
                <p>
                  Neto a pagar:{" "}
                  <strong>
                    {formatPurchaseOrderCurrency(
                      decision.row.net,
                      decision.row.currency
                    )}
                  </strong>
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="accounting-comment">
                  {decision.action === "account"
                    ? "Comentario (opcional)"
                    : "Motivo de rechazo *"}
                </Label>
                <Textarea
                  id="accounting-comment"
                  value={comment}
                  onChange={event => setComment(event.target.value)}
                  maxLength={2000}
                  rows={4}
                  disabled={busy}
                />
              </div>
            </>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setDecision(null)}
            >
              Cancelar
            </Button>
            <Button
              disabled={
                busy ||
                (decision?.action === "reject" && comment.trim().length < 5)
              }
              onClick={confirm}
            >
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {busy
                ? "Procesando…"
                : decision?.action === "account"
                  ? "Confirmar contabilización"
                  : "Confirmar rechazo"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
