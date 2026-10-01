import { useEffect, useState } from "react";
import { useSearch, useLocation } from "wouter";
import { FileText, Printer, ExternalLink, Search } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { FiscalDocumentDialogContent } from "@/components/FiscalDocument";
import { DataPagination } from "@/components/DataPagination";
import { canReadRetentionDocuments } from "@shared/retention-documents";
import { buildRetentionPrintHtml } from "@/lib/retention-document-print";

const selectClass =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm";
const shown = (v: unknown) =>
  v == null || v === "" ? "No disponible" : String(v);
const money = (v: unknown, currency: string) =>
  currency +
  " " +
  Number(v ?? 0).toLocaleString("es-HN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });
function Field({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm font-medium [overflow-wrap:anywhere]">
        {shown(value)}
      </dd>
    </div>
  );
}
export default function RetentionDocuments() {
  const { user } = useAuth();
  const allowed = canReadRetentionDocuments(user);
  const searchParams = useSearch();
  const [, navigate] = useLocation();
  const params = new URLSearchParams(searchParams);
  const selectedId = Number(params.get("id")) || null;
  const invoiceId = Number(params.get("invoiceId")) || undefined;
  const [filters, setFilters] = useState({
    search: "",
    supplierSearch: "",
    projectSearch: "",
    invoiceSearch: "",
    dateFrom: "",
    dateTo: "",
    status: "registrada",
  });
  const [applied, setApplied] = useState(filters);
  const [page, setPage] = useState(1),
    [pageSize, setPageSize] = useState(25);
  const utils = trpc.useUtils();
  const list = trpc.retentionDocuments.listPage.useQuery(
    {
      ...applied,
      status:
        applied.status === "all"
          ? undefined
          : (applied.status as "registrada" | "historico"),
      dateFrom: applied.dateFrom || undefined,
      dateTo: applied.dateTo || undefined,
      page,
      pageSize,
      invoiceId,
    },
    { enabled: allowed }
  );
  const detail = trpc.retentionDocuments.getById.useQuery(
    { id: selectedId ?? 0 },
    { enabled: allowed && !!selectedId }
  );
  useEffect(() => {
    setPage(1);
  }, [invoiceId]);
  const d = detail.data?.document,
    s = d?.snapshot;
  const close = () =>
    navigate("/retenciones" + (invoiceId ? "?invoiceId=" + invoiceId : ""));
  function print() {
    if (!d) return;
    const target = window.open("", "_blank");
    if (!target) {
      toast.error("Permita las ventanas emergentes para imprimir");
      return;
    }
    target.opener = null;
    target.document.write(buildRetentionPrintHtml(d));
    target.document.close();
    target.focus();
    target.print();
  }
  async function openAttachment(id: number) {
    if (!d) return;
    const target = window.open("", "_blank");
    if (!target) {
      toast.error("Permita las ventanas emergentes para abrir el archivo");
      return;
    }
    target.opener = null;
    try {
      const result = await utils.retentionDocuments.attachmentUrl.fetch({
        documentId: d.id,
        attachmentId: id,
      });
      target.location.href = result.url;
    } catch (error) {
      target.close();
      toast.error(
        error instanceof Error ? error.message : "No se pudo abrir el adjunto"
      );
    }
  }
  if (!allowed)
    return (
      <div className="p-6">
        <h1 className="text-xl font-semibold">Retenciones</h1>
        <p className="mt-2 text-muted-foreground">
          No tiene acceso a este módulo.
        </p>
      </div>
    );
  return (
    <div className="space-y-5 p-3 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Retenciones</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Comprobantes registrados al contabilizar las facturas en Tesorería.
          </p>
        </div>
        <Button variant="outline" asChild>
          <a href="/tipos-retencion">Tipos de retención</a>
        </Button>
      </header>
      <form
        className="grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4"
        onSubmit={e => {
          e.preventDefault();
          setApplied(filters);
          setPage(1);
        }}
      >
        {(
          [
            ["search", "Número de comprobante"],
            ["supplierSearch", "Proveedor"],
            ["projectSearch", "Proyecto"],
            ["invoiceSearch", "Factura"],
          ] as const
        ).map(([key, label]) => (
          <div key={key} className="space-y-1.5">
            <Label htmlFor={"ret-" + key}>{label}</Label>
            <Input
              id={"ret-" + key}
              value={filters[key]}
              onChange={e => setFilters({ ...filters, [key]: e.target.value })}
              placeholder={"Buscar " + label.toLowerCase()}
            />
          </div>
        ))}
        {(
          [
            ["dateFrom", "Emisión desde"],
            ["dateTo", "Emisión hasta"],
          ] as const
        ).map(([key, label]) => (
          <div key={key} className="space-y-1.5">
            <Label htmlFor={"ret-" + key}>{label}</Label>
            <Input
              id={"ret-" + key}
              type="date"
              value={filters[key]}
              onChange={e => setFilters({ ...filters, [key]: e.target.value })}
            />
          </div>
        ))}
        <div className="space-y-1.5">
          <Label htmlFor="ret-status">Estado</Label>
          <select
            id="ret-status"
            className={selectClass}
            value={filters.status}
            onChange={e => setFilters({ ...filters, status: e.target.value })}
          >
            <option value="registrada">Contabilizados</option>
            <option value="historico">Históricos</option>
            <option value="all">Todos</option>
          </select>
        </div>
        <div className="flex items-end gap-2">
          <Button type="submit" className="min-h-10 flex-1">
            <Search className="mr-2 h-4 w-4" />
            Buscar
          </Button>
          <select
            aria-label="Registros por página"
            className={selectClass + " w-24"}
            value={pageSize}
            onChange={e => {
              setPageSize(Number(e.target.value));
              setPage(1);
            }}
          >
            {[25, 50, 100].map(n => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
      </form>
      {invoiceId && (
        <p className="text-sm">
          Mostrando comprobantes de la factura seleccionada.{" "}
          <a className="text-primary underline" href="/retenciones">
            Ver todas
          </a>
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        {list.data?.totals.map(t => (
          <div key={t.currency} className="rounded-lg border bg-card px-4 py-3">
            <p className="text-xs text-muted-foreground">
              Total retenido · {t.currency}
            </p>
            <p className="text-lg font-semibold tabular-nums">
              {money(t.total, t.currency)}
            </p>
          </div>
        ))}
      </div>
      <section
        className="overflow-hidden rounded-lg border bg-card"
        aria-label="Listado de retenciones"
      >
        {list.isLoading ? (
          <p role="status" className="p-6 text-muted-foreground">
            Cargando comprobantes…
          </p>
        ) : list.error ? (
          <div role="alert" className="p-6">
            <p>{list.error.message}</p>
            <Button variant="outline" onClick={() => list.refetch()}>
              Reintentar
            </Button>
          </div>
        ) : !list.data?.items.length ? (
          <div className="p-10 text-center">
            <FileText className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
            <h2 className="font-medium">
              No hay comprobantes para estos filtros
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Las facturas con retenciones generan su comprobante al
              contabilizarse.
            </p>
          </div>
        ) : (
          <>
            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40 text-left">
                  <tr>
                    {[
                      "Comprobante",
                      "Proveedor / proyecto",
                      "Factura",
                      "Emisión",
                      "Estado",
                      "Retenido",
                      "",
                    ].map(h => (
                      <th key={h} className="px-4 py-3 font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {list.data.items.map(row => (
                    <tr
                      key={row.id}
                      className="border-b last:border-0 hover:bg-muted/30"
                    >
                      <td className="px-4 py-3 font-medium">
                        {shown(row.documentNumber)}
                        {row.requiresReview && (
                          <span className="mt-1 block text-xs font-medium text-amber-800">
                            Revisión contable pendiente
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {row.supplierName}
                        <p className="text-xs text-muted-foreground">
                          {row.projectName}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        {row.invoiceDocumentNumber}
                        <p className="text-xs text-muted-foreground">
                          {row.invoiceNumber}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        {shown(row.documentDate).slice(0, 10)}
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          variant={
                            row.status === "historico" ? "secondary" : "outline"
                          }
                        >
                          {row.status === "historico"
                            ? "Histórico"
                            : "Contabilizado"}
                        </Badge>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                        {money(row.total, row.currency)}
                      </td>
                      <td className="px-4 py-3">
                        <Button
                          variant="outline"
                          size="sm"
                          aria-label={"Consultar " + row.documentNumber}
                          onClick={() => navigate("/retenciones?id=" + row.id)}
                        >
                          Consultar
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="divide-y lg:hidden">
              {list.data.items.map(row => (
                <article className="space-y-3 p-4" key={row.id}>
                  <div className="flex flex-wrap justify-between gap-2">
                    <h2 className="break-all font-medium">
                      {shown(row.documentNumber)}
                    </h2>
                    <Badge variant="outline">
                      {row.status === "historico"
                        ? "Histórico"
                        : "Contabilizado"}
                    </Badge>
                  </div>
                  {row.requiresReview && (
                    <p className="text-xs font-medium text-amber-800">
                      Revisión contable pendiente
                    </p>
                  )}
                  <p className="text-sm">
                    {row.supplierName}
                    <span className="block text-muted-foreground">
                      {row.projectName}
                    </span>
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {row.invoiceDocumentNumber} ·{" "}
                    {shown(row.documentDate).slice(0, 10)}
                  </p>
                  <div className="flex items-center justify-between gap-2">
                    <strong className="tabular-nums">
                      {money(row.total, row.currency)}
                    </strong>
                    <Button
                      variant="outline"
                      onClick={() => navigate("/retenciones?id=" + row.id)}
                    >
                      Consultar
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          </>
        )}
        {list.data && <DataPagination {...list.data} onPageChange={setPage} />}
      </section>
      <Dialog
        open={!!selectedId}
        onOpenChange={open => {
          if (!open) close();
        }}
      >
        <FiscalDocumentDialogContent className="grid-cols-[minmax(0,1fr)]">
          <DialogHeader className="min-w-0 border-b p-4 pr-12 sm:p-6 sm:pr-14">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <DialogTitle>Comprobante de retención</DialogTitle>
                <DialogDescription>
                  {d
                    ? shown(d.documentNumber)
                    : "Consulta del documento y sus soportes"}
                </DialogDescription>
              </div>
              {d && (
                <Button variant="outline" onClick={print}>
                  <Printer className="mr-2 h-4 w-4" />
                  Imprimir
                </Button>
              )}
            </div>
          </DialogHeader>
          {detail.isLoading ? (
            <p role="status" className="p-6">
              Cargando comprobante…
            </p>
          ) : detail.error ? (
            <p role="alert" className="p-6">
              {detail.error.message}
            </p>
          ) : (
            d &&
            s && (
              <div className="min-w-0 space-y-5 p-4 sm:p-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <Badge variant="outline">
                    {d.status === "historico"
                      ? "Histórico"
                      : "Contabilizado · Cerrado"}
                  </Badge>
                  <p className="text-xl font-semibold tabular-nums">
                    {money(d.total, d.currency)}
                  </p>
                </div>
                {d.status === "historico" && (
                  <p className="rounded-md bg-muted p-3 text-sm">
                    Antecedente conservado para auditoría. Su importe no se suma
                    a los comprobantes actuales. Las bases y porcentajes que no
                    constan en el documento original se muestran como no
                    disponibles.
                  </p>
                )}
                {!!s.reviewWarnings?.length && (
                  <aside
                    role="note"
                    className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"
                  >
                    <h2 className="font-semibold">
                      Revisión contable pendiente
                    </h2>
                    {s.reviewWarnings.map(warning => (
                      <p className="mt-1" key={warning}>
                        {warning}
                      </p>
                    ))}
                  </aside>
                )}
                <section className="rounded-lg border p-4">
                  <h2 className="mb-4 font-semibold">Datos fiscales</h2>
                  <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <Field label="Proveedor" value={s.supplierName} />
                    <Field label="RTN" value={s.supplierRtn} />
                    <Field label="Proyecto" value={s.projectName} />
                    <Field label="Moneda" value={d.currency} />
                    <Field
                      label="Factura de origen"
                      value={s.invoiceDocumentNumber}
                    />
                    <Field
                      label="Número fiscal de factura"
                      value={s.invoiceNumber}
                    />
                    <Field
                      label="Número del comprobante"
                      value={d.documentNumber}
                    />
                    <Field label="CAI" value={s.cai} />
                    <Field label="Rango inicial" value={s.documentRangeStart} />
                    <Field label="Rango final" value={s.documentRangeEnd} />
                    <Field label="Fecha de emisión" value={s.documentDate} />
                    <Field
                      label="Límite de emisión"
                      value={s.emissionDeadline}
                    />
                  </dl>
                </section>
                <section className="rounded-lg border">
                  <h2 className="p-4 font-semibold">Conceptos de retención</h2>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="border-y bg-muted/40 text-left">
                        <tr>
                          {["Concepto", "Base", "Porcentaje", "Retenido"].map(
                            h => (
                              <th key={h} className="p-3 font-medium">
                                {h}
                              </th>
                            )
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {s.lines.map(l => (
                          <tr key={l.id} className="border-b last:border-0">
                            <td className="min-w-44 p-3">
                              {l.retentionCode} {l.description}
                              {l.financialGroupDescription && (
                                <p className="text-xs text-muted-foreground">
                                  {l.financialGroupDescription}
                                </p>
                              )}
                            </td>
                            <td className="whitespace-nowrap p-3 tabular-nums">
                              {l.baseAmount == null
                                ? "No disponible"
                                : money(l.baseAmount, d.currency)}
                            </td>
                            <td className="whitespace-nowrap p-3">
                              {l.percentage == null
                                ? "No disponible"
                                : l.percentage + " %"}
                            </td>
                            <td className="whitespace-nowrap p-3 text-right tabular-nums">
                              {money(l.amount, d.currency)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="border-t p-4 text-right font-semibold">
                    Total {d.status === "historico" ? "histórico" : "retenido"}:{" "}
                    {money(d.total, d.currency)}
                  </p>
                </section>
                <section className="rounded-lg border p-4">
                  <h2 className="mb-3 font-semibold">Documentos</h2>
                  {detail.data!.attachments.length ? (
                    <ul className="space-y-2">
                      {detail.data!.attachments.map(a => (
                        <li key={a.id}>
                          <Button
                            variant="link"
                            className="h-auto max-w-full whitespace-normal p-0 text-left"
                            onClick={() => openAttachment(a.id)}
                          >
                            <ExternalLink className="mr-2 h-4 w-4 shrink-0" />
                            <span className="break-all">{a.fileName}</span>
                          </Button>
                          {a.legacyNoteId && (
                            <span className="ml-2 text-xs text-muted-foreground">
                              Antecedente
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Sin soportes adjuntos.
                    </p>
                  )}
                </section>
                <section className="rounded-lg border p-4">
                  <h2 className="mb-3 font-semibold">Historial</h2>
                  {d.status === "registrada" && (
                    <p className="text-sm">
                      Contabilizado por {shown(s.actorName)} ·{" "}
                      {s.accountedAt
                        ? new Date(s.accountedAt).toLocaleString("es-HN")
                        : "Fecha no disponible"}
                    </p>
                  )}
                  {detail.data!.antecedents.map(a => (
                    <details
                      className="mt-3 rounded-md border p-3"
                      key={a.noteId}
                    >
                      <summary className="cursor-pointer text-sm font-medium">
                        Antecedente {shown(a.snapshot.note.documentNumber)} ·{" "}
                        {shown(a.snapshot.note.status)}
                      </summary>
                      <div className="mt-3 space-y-3 text-sm">
                        <p>
                          Número fiscal: {shown(a.snapshot.note.fiscalNumber)} ·
                          CAI: {shown(a.snapshot.note.cai)}
                        </p>
                        <p>
                          Rango: {shown(a.snapshot.note.documentRangeStart)} —{" "}
                          {shown(a.snapshot.note.documentRangeEnd)}
                        </p>
                        <p>
                          Emisión: {shown(a.snapshot.note.documentDate)} ·
                          Límite: {shown(a.snapshot.note.emissionDeadline)}
                        </p>
                        <p>
                          Importe original:{" "}
                          {money(
                            a.snapshot.note.total,
                            a.snapshot.note.currency
                          )}
                        </p>
                        <ul className="space-y-1">
                          {a.snapshot.lines.map((l: any) => (
                            <li key={l.id}>
                              {l.code} — {l.description}:{" "}
                              {money(l.total, a.snapshot.note.currency)} · Base
                              fiscal: no disponible · Porcentaje: no disponible
                            </li>
                          ))}
                        </ul>
                        <h3 className="font-medium">Eventos originales</h3>
                        {a.snapshot.events.map((ev: any) => (
                          <p key={ev.id}>
                            {ev.action} · {ev.actorName} ·{" "}
                            {new Date(ev.createdAt).toLocaleString("es-HN")}
                            <span className="block text-muted-foreground">
                              {ev.comment}
                            </span>
                          </p>
                        ))}
                      </div>
                    </details>
                  ))}
                </section>
              </div>
            )
          )}
        </FiscalDocumentDialogContent>
      </Dialog>
    </div>
  );
}
