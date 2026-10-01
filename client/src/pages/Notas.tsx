import { useEffect, useRef, useState } from "react";
import { useSearch, useLocation } from "wouter";
import {
  Plus,
  FileText,
  Printer,
  Save,
  Send,
  CheckCircle2,
  Trash2,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { DataPagination } from "@/components/DataPagination";
import { DocumentAttachmentsPanel } from "@/components/DocumentAttachmentsPanel";
import {
  FiscalDocumentDialogContent,
  NoteFiscalFields,
} from "@/components/FiscalDocument";
import {
  NoteConceptPicker,
  NoteInvoicePicker,
  type NoteInvoiceOption,
} from "@/components/NoteSelectors";
import { buildFinancialNotePrintHtml } from "@/lib/financial-note-print";
import { calculatePurchaseOrderLineAmounts } from "@shared/purchase-orders";
import {
  NOTE_STATUSES,
  NOTE_STATUS_LABELS,
  NOTE_ORIGIN_LABELS,
  canPrepareFinancialNotes,
  canAccountFinancialNotes,
  canReadFinancialNotes,
  noteDraftSchema,
  assertNoteAllocationTotals,
  type FinancialNoteType,
  type NoteFiscalInput,
} from "@shared/financial-notes";

type DraftLine = {
  key: string;
  conceptId: number;
  code: string;
  description: string;
  financialGroupDescription: string | null;
  allowsTaxOnly: boolean;
  retentionCatalogId: number | null;
  baseAmount: string;
  taxCode: string | null;
  taxAmount: string;
  notes: string;
};
type DraftAllocation = {
  invoiceId: number;
  amount: string;
  invoiceDocumentNumber: string;
  invoiceNumber: string;
  available?: string;
};
type Scope = {
  supplierId: number;
  projectId: number;
  currency: "HNL" | "USD";
  supplierName: string;
  projectName: string;
};
const emptyFiscal: NoteFiscalInput = {
  cai: "",
  fiscalNumber: "",
  documentRangeStart: "",
  documentRangeEnd: "",
  documentDate: "",
  documentDueDate: "",
  emissionDeadline: "",
  notes: "",
};
const newLine = (): DraftLine => ({
  key: crypto.randomUUID(),
  conceptId: 0,
  code: "",
  description: "",
  financialGroupDescription: null,
  allowsTaxOnly: false,
  retentionCatalogId: null,
  baseAmount: "",
  taxCode: null,
  taxAmount: "0.0000",
  notes: "",
});
const selectClass =
  "h-10 rounded-md border border-input bg-background px-3 text-sm";
const eventLabels: Record<string, string> = {
  creada: "Creada",
  editada: "Actualizada",
  sincronizada: "Retenciones sincronizadas",
  revisada: "Enviada a revisión",
  registrada: "Contabilizada",
  rechazada: "Rechazada",
  anulada: "Anulada",
  eliminada: "Eliminada",
  adjunto_agregado: "Adjunto agregado",
  adjunto_eliminado: "Adjunto eliminado",
};

export default function Notas({ type }: { type: FinancialNoteType }) {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const searchParams = useSearch();
  const canPrepare = canPrepareFinancialNotes(user);
  const canAccount = canAccountFinancialNotes(user);
  const canRead = canReadFinancialNotes(user);
  const [search, setSearch] = useState(
    () => new URLSearchParams(window.location.search).get("search") ?? ""
  );
  const [term, setTerm] = useState("");
  const [status, setStatus] = useState("all");
  const [origin, setOrigin] = useState("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [editType, setEditType] = useState(type);
  const [fiscal, setFiscal] = useState<NoteFiscalInput>(emptyFiscal);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [allocations, setAllocations] = useState<DraftAllocation[]>([]);
  const [noteScope, setNoteScope] = useState<Scope | null>(null);
  const [dirty, setDirty] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [requestKey, setRequestKey] = useState("");
  const [confirm, setConfirm] = useState<
    "review" | "account" | "reject" | "void" | "remove" | "discard" | null
  >(null);
  const [comment, setComment] = useState("");
  const loadedId = useRef<number | null>(null);
  const [attachedCount, setAttachedCount] = useState(0);
  const parameters = new URLSearchParams(searchParams);
  const invoiceFilter = Number(parameters.get("invoiceId")) || undefined;
  useEffect(() => {
    const id = Number(new URLSearchParams(searchParams).get("id"));
    if (id > 0) {
      loadedId.current = null;
      setDirty(false);
      setSelectedId(id);
    }
  }, [searchParams]);
  useEffect(() => {
    const timer = setTimeout(() => {
      setTerm(search);
      setPage(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);
  const query = trpc.financialNotes.listPage.useQuery(
    {
      type,
      search: term,
      status:
        status === "all"
          ? undefined
          : (status as (typeof NOTE_STATUSES)[number]),
      origin:
        origin === "all"
          ? undefined
          : (origin as "manual" | "retentions" | "supplier_return"),
      page,
      pageSize,
      invoiceId: invoiceFilter,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
    },
    { enabled: canRead, placeholderData: previous => previous }
  );
  const detail = trpc.financialNotes.getById.useQuery(
    { id: selectedId ?? 0 },
    { enabled: canRead && !!selectedId }
  );
  const taxes = trpc.taxes.activeOptions.useQuery(undefined, {
    enabled: canRead && selectedId !== null,
  });
  const note = selectedId ? detail.data?.note : undefined;
  useEffect(() => {
    if (!selectedId || !detail.data || detail.data.note.id !== selectedId)
      return;
    if (loadedId.current === selectedId && dirty) return;
    const d = detail.data;
    if (d.note.origin === "retentions") {
      if (d.retentionDocumentId) navigate("/retenciones?id=" + d.retentionDocumentId);
      return;
    }
    setEditType(d.note.type);
    setNoteScope({
      supplierId: d.note.supplierId,
      projectId: d.note.projectId,
      currency: d.note.currency as "HNL" | "USD",
      supplierName: d.note.supplierName,
      projectName: d.note.projectName,
    });
    setFiscal(
      Object.fromEntries(
        Object.keys(emptyFiscal).map(k => [
          k,
          String(d.note[k as keyof typeof d.note] ?? ""),
        ])
      ) as NoteFiscalInput
    );
    setLines(
      d.lines.map(l => ({
        ...l,
        key: String(l.id),
        financialGroupDescription: l.financialGroupDescription,
        allowsTaxOnly:
          !!(l as any).allowsTaxOnly ||
          (Number(l.baseAmount) === 0 && Number(l.taxAmount) > 0),
        retentionCatalogId: (l as any).retentionCatalogId ?? null,
        notes: l.notes ?? "",
      }))
    );
    setAllocations(
      d.allocations.map(a => ({ ...a, available: (a as any).available }))
    );
    loadedId.current = selectedId;
  }, [detail.data, selectedId]);
  const editing =
    selectedId === 0 ||
    (canPrepare && !!note && note.origin !== "retentions" && ["borrador", "rechazada"].includes(note.status));
  const financialEditing = editing && note?.origin !== "retentions";
  const money = (amount: unknown) =>
    `${noteScope?.currency ?? "HNL"} ${Number(amount ?? 0).toLocaleString("es-HN", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
  const totals = lines.reduce(
    (sum, l) => ({
      base: sum.base + Number(l.baseAmount || 0),
      tax: sum.tax + Number(l.taxAmount || 0),
    }),
    { base: 0, tax: 0 }
  );
  const total = totals.base + totals.tax;
  const applied = allocations.reduce(
    (sum, a) => sum + Number(a.amount || 0),
    0
  );
  const difference = Math.round((total - applied) * 10000) / 10000;
  function fail(error: { message: string }) {
    setErrors(current => ({ ...current, form: error.message }));
    toast.error(error.message);
  }
  async function invalidate() {
    await Promise.all([
      utils.financialNotes.invalidate(),
      utils.invoices.invalidate(),
      utils.treasury.invalidate(),
      utils.purchaseOrderAdvances.invalidate(),
      utils.qualityRetentionReleases.invalidate(),
    ]);
  }
  const create = trpc.financialNotes.create.useMutation({ onError: fail });
  const update = trpc.financialNotes.update.useMutation({ onError: fail });
  const transitionSuccess = async () => {
    setDirty(false);
    setConfirm(null);
    setComment("");
    await invalidate();
    toast.success("Nota actualizada");
  };
  const review = trpc.financialNotes.review.useMutation({
    onSuccess: transitionSuccess,
    onError: fail,
  });
  const account = trpc.financialNotes.account.useMutation({
    onSuccess: transitionSuccess,
    onError: fail,
  });
  const reject = trpc.financialNotes.reject.useMutation({
    onSuccess: transitionSuccess,
    onError: fail,
  });
  const voidNote = trpc.financialNotes.void.useMutation({
    onSuccess: transitionSuccess,
    onError: fail,
  });
  const remove = trpc.financialNotes.remove.useMutation({
    onSuccess: async () => {
      setConfirm(null);
      setSelectedId(null);
      await invalidate();
      toast.success("Borrador eliminado");
    },
    onError: fail,
  });
  const busy =
    create.isPending ||
    update.isPending ||
    review.isPending ||
    account.isPending ||
    reject.isPending ||
    voidNote.isPending ||
    remove.isPending;
  function patchFiscal(patch: Partial<NoteFiscalInput>) {
    setFiscal(current => ({ ...current, ...patch }));
    setDirty(true);
    setErrors({});
  }
  function patchLine(index: number, patch: Partial<DraftLine>) {
    setLines(current =>
      current.map((line, i) => {
        if (i !== index) return line;
        const next = { ...line, ...patch };
        if (
          !next.allowsTaxOnly &&
          ("baseAmount" in patch || "taxCode" in patch || "conceptId" in patch)
        )
          next.taxAmount = next.retentionCatalogId
            ? "0.0000"
            : calculatePurchaseOrderLineAmounts({
                quantity: 1,
                unitPrice: next.baseAmount || "0",
                taxCode: next.taxCode || "exe",
                taxes: taxes.data ?? [],
              }).taxAmount.toFixed(4);
        return next;
      })
    );
    setDirty(true);
    setErrors({});
  }
  function start(t: FinancialNoteType) {
    setSelectedId(0);
    setEditType(t);
    setFiscal({ ...emptyFiscal });
    setLines([newLine()]);
    setAllocations([]);
    setNoteScope(null);
    setDirty(false);
    setErrors({});
    setAttachedCount(0);
    setRequestKey(crypto.randomUUID());
    loadedId.current = null;
  }
  function openNote(id: number) {
    loadedId.current = null;
    setDirty(false);
    setErrors({});
    setAttachedCount(0);
    setSelectedId(id);
  }
  function close() {
    if (busy) return;
    if (dirty) setConfirm("discard");
    else setSelectedId(null);
  }
  async function save() {
    setErrors({});
    const parsed = noteDraftSchema.safeParse({
      ...fiscal,
      type: editType,
      lines: lines.map(
        ({ conceptId, baseAmount, taxCode, taxAmount, notes }) => ({
          conceptId,
          baseAmount,
          taxCode,
          taxAmount,
          notes,
        })
      ),
      allocations: allocations.map(({ invoiceId, amount }) => ({
        invoiceId,
        amount,
      })),
    });
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues)
        fieldErrors[issue.path.join(".")] = issue.message;
      fieldErrors.form =
        "Revise los campos marcados y seleccione al menos un concepto y una factura.";
      setErrors(fieldErrors);
      return;
    }
    try {
      assertNoteAllocationTotals(
        editType,
        parsed.data.lines,
        parsed.data.allocations
      );
    } catch (error) {
      fail(error as Error);
      return;
    }
    try {
      if (selectedId === 0) {
        const result = await create.mutateAsync({ ...parsed.data, requestKey });
        setDirty(false);
        setSelectedId(result.id);
        loadedId.current = null;
        toast.success(`${result.documentNumber} creada`);
      } else if (selectedId) {
        await update.mutateAsync({ ...parsed.data, id: selectedId });
        setDirty(false);
        toast.success("Cambios guardados");
      }
      await invalidate();
    } catch {
      /* Mutations preserve the form and report their own error. */
    }
  }
  async function lookup() {
    if (!noteScope) return;
    try {
      const found = await utils.financialNotes.lookupFiscalRange.fetch({
        type: editType,
        supplierId: noteScope.supplierId,
        fiscalNumber: fiscal.fiscalNumber,
      });
      if (found) {
        patchFiscal({
          cai: found.cai ?? "",
          documentRangeStart: found.documentRangeStart ?? "",
          documentRangeEnd: found.documentRangeEnd ?? "",
          emissionDeadline: found.emissionDeadline ?? "",
        });
        toast.success("Rango fiscal completado");
      } else
        toast.info(
          "No existe un rango conocido para este documento y proveedor"
        );
    } catch (e) {
      fail(e as Error);
    }
  }
  function addInvoice(invoice: NoteInvoiceOption) {
    if (allocations.some(a => a.invoiceId === invoice.id)) return;
    setNoteScope({
      supplierId: invoice.supplierId,
      projectId: invoice.projectId,
      currency: invoice.currency as "HNL" | "USD",
      supplierName: invoice.supplierName,
      projectName: invoice.projectName,
    });
    setAllocations(current => [
      ...current,
      {
        invoiceId: invoice.id,
        amount: "",
        invoiceDocumentNumber: invoice.invoiceDocumentNumber,
        invoiceNumber: invoice.invoiceNumber,
        available: invoice.available,
      },
    ]);
    setDirty(true);
  }
  function print() {
    if (!detail.data) return;
    const target = window.open("", "_blank");
    if (!target) {
      toast.error("Permita ventanas emergentes para imprimir");
      return;
    }
    target.document.write(buildFinancialNotePrintHtml(detail.data));
    target.document.close();
    target.focus();
    target.print();
  }
  function applyAction() {
    if (confirm === "discard") {
      setDirty(false);
      setConfirm(null);
      setSelectedId(null);
      return;
    }
    if (!selectedId) return;
    const input = { id: selectedId };
    if (confirm === "review") review.mutate(input);
    if (confirm === "account") account.mutate({ ...input, comment });
    if (confirm === "reject") reject.mutate({ ...input, comment });
    if (confirm === "void") voidNote.mutate({ ...input, comment });
    if (confirm === "remove") remove.mutate(input);
  }
  if (!canRead)
    return (
      <p className="p-6 text-muted-foreground">No tiene acceso a notas.</p>
    );
  const title = `Notas de ${type === "credit" ? "crédito" : "débito"}`;
  const modalTitle = `Nota de ${editType === "credit" ? "crédito" : "débito"}`;
  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <FileText className="h-6 w-6" />
            {title}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {type === "credit"
              ? "Ajustes fiscales y aplicaciones a facturas de proveedores."
              : "Ajustes independientes para una factura de proveedor."}
          </p>
          {invoiceFilter ? (
            <p className="mt-1 text-sm">
              Filtrado por factura ·{" "}
              <a
                href={type === "credit" ? "/notas-credito" : "/notas-debito"}
                className="text-primary underline"
              >
                Ver todas
              </a>
            </p>
          ) : null}
        </div>
        {canPrepare ? (
          <Button onClick={() => start(type)}>
            <Plus className="mr-2 h-4 w-4" />
            Nueva nota de {type === "credit" ? "crédito" : "débito"}
          </Button>
        ) : null}
      </header>
      <section className="rounded-lg border bg-card">
        <div className="flex flex-wrap items-end gap-3 border-b p-4">
          <div className="min-w-0 flex-1 basis-60">
            <Label htmlFor="notes-search" className="sr-only">
              Buscar notas
            </Label>
            <Input
              id="notes-search"
              placeholder="Buscar consecutivo, número fiscal o proveedor…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <select
            aria-label="Estado"
            className={selectClass}
            value={status}
            onChange={e => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="all">Todos los estados</option>
            {NOTE_STATUSES.map(s => (
              <option key={s} value={s}>
                {NOTE_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
          {type === "credit" ? (
            <select
              aria-label="Origen"
              className={selectClass}
              value={origin}
              onChange={e => {
                setOrigin(e.target.value);
                setPage(1);
              }}
            >
              <option value="all">Todos los orígenes</option>
              {Object.entries(NOTE_ORIGIN_LABELS).filter(([value]) => value !== "retentions").map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          ) : null}
          <div>
            <Label htmlFor="notes-from" className="text-xs">
              Desde
            </Label>
            <Input
              id="notes-from"
              type="date"
              value={dateFrom}
              onChange={e => {
                setDateFrom(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <div>
            <Label htmlFor="notes-to" className="text-xs">
              Hasta
            </Label>
            <Input
              id="notes-to"
              type="date"
              value={dateTo}
              onChange={e => {
                setDateTo(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <select
            aria-label="Registros por página"
            className={selectClass}
            value={pageSize}
            onChange={e => {
              setPageSize(Number(e.target.value));
              setPage(1);
            }}
          >
            {[25, 50, 100].map(n => (
              <option key={n} value={n}>
                {n} por página
              </option>
            ))}
          </select>
        </div>
        {query.isLoading ? (
          <p className="p-6" role="status">
            Cargando notas…
          </p>
        ) : query.error ? (
          <div className="p-6 text-destructive" role="alert">
            {query.error.message}
            <Button
              className="ml-3"
              variant="outline"
              onClick={() => void query.refetch()}
            >
              Reintentar
            </Button>
          </div>
        ) : !query.data?.items.length ? (
          <div className="p-8 text-center">
            <FileText className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
            <p className="font-medium">No hay notas para estos filtros</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Las notas nuevas aparecerán aquí con su estado y monto.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto" aria-busy={query.isFetching}>
            <table className="w-full text-sm max-sm:[&_thead]:hidden max-sm:[&_tbody]:block max-sm:[&_tr]:block max-sm:[&_tr]:py-3 max-sm:[&_td]:block max-sm:[&_td]:min-w-0 max-sm:[&_td]:whitespace-normal max-sm:[&_td]:py-1">
              <thead className="border-b bg-muted/40 text-left">
                <tr>
                  {[
                    "Documento",
                    "Proveedor / proyecto",
                    "Origen",
                    "Estado",
                    "Total",
                    "",
                  ].map((h, i) => (
                    <th key={i} className="px-4 py-3 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {query.data.items.map(row => (
                  <tr
                    key={row.id}
                    className="border-b last:border-0 hover:bg-muted/20"
                  >
                    <td className="whitespace-nowrap px-4 py-3">
                      <button
                        className="min-h-11 font-semibold text-primary hover:underline"
                        onClick={() => openNote(row.id)}
                      >
                        {row.documentNumber}
                      </button>
                      <p className="text-xs text-muted-foreground">
                        {row.fiscalNumber || "Número fiscal pendiente"}
                      </p>
                    </td>
                    <td className="min-w-48 px-4 py-3">
                      <p>{row.supplierName}</p>
                      <p className="text-xs text-muted-foreground">
                        {row.projectName}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      {NOTE_ORIGIN_LABELS[row.origin]}
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        variant={
                          row.status === "registrada" ? "secondary" : "outline"
                        }
                      >
                        {NOTE_STATUS_LABELS[row.status]}
                      </Badge>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-medium">
                      {row.currency}{" "}
                      {Number(row.total).toLocaleString("es-HN", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 4,
                      })}
                    </td>
                    <td className="px-4 py-3">
                      <Button variant="ghost" onClick={() => openNote(row.id)}>
                        Abrir
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {query.data ? (
          <DataPagination {...query.data} onPageChange={setPage} />
        ) : null}
      </section>
      <Dialog
        open={selectedId !== null}
        onOpenChange={v => {
          if (!v) close();
        }}
      >
        <FiscalDocumentDialogContent
          onInteractOutside={e => {
            if (dirty || busy) e.preventDefault();
          }}
        >
          <DialogHeader className="min-w-0 border-b border-border/70 px-4 py-4 pr-16 sm:px-6 sm:pr-20">
            <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <DialogTitle className="break-words text-2xl font-bold tracking-tight sm:text-3xl">
                  {note?.documentNumber || `Nueva ${modalTitle.toLowerCase()}`}
                </DialogTitle>
                <DialogDescription className="mt-1">
                  {note
                    ? `${modalTitle} · ${NOTE_ORIGIN_LABELS[note.origin]}`
                    : modalTitle}
                </DialogDescription>
                {note ? (
                  <Badge variant="outline" className="mt-2">
                    {NOTE_STATUS_LABELS[note.status]}
                  </Badge>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                {note ? (
                  <Button variant="outline" onClick={print} disabled={dirty}>
                    <Printer className="mr-2 h-4 w-4" />
                    Imprimir
                  </Button>
                ) : null}
                {editing ? (
                  <Button onClick={() => void save()} disabled={busy}>
                    <Save className="mr-2 h-4 w-4" />
                    {busy ? "Guardando…" : "Guardar"}
                  </Button>
                ) : null}
                {note && editing ? (
                  <Button
                    variant="outline"
                    disabled={busy || dirty || attachedCount === 0}
                    onClick={() => setConfirm("review")}
                  >
                    <Send className="mr-2 h-4 w-4" />
                    Enviar a revisión
                  </Button>
                ) : null}
                {note?.status === "revisada" && canAccount ? (
                  <>
                    <Button
                      disabled={busy}
                      onClick={() => setConfirm("account")}
                    >
                      <CheckCircle2 className="mr-2 h-4 w-4" />
                      Contabilizar
                    </Button>
                    <Button
                      disabled={busy}
                      variant="outline"
                      onClick={() => setConfirm("reject")}
                    >
                      Rechazar
                    </Button>
                  </>
                ) : null}
                {note && note.status !== "anulada" && canAccount ? (
                  <Button
                    variant="outline"
                    disabled={busy || dirty}
                    onClick={() => setConfirm("void")}
                  >
                    Anular
                  </Button>
                ) : null}
                {note && editing && note.origin === "manual" ? (
                  <Button
                    variant="ghost"
                    disabled={busy}
                    aria-label="Eliminar borrador"
                    onClick={() => setConfirm("remove")}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                ) : null}
              </div>
            </div>
          </DialogHeader>
          {selectedId !== 0 &&
          (detail.isLoading || detail.data?.note.id !== selectedId) &&
          !detail.error ? (
            <p className="p-8" role="status">
              Cargando nota…
            </p>
          ) : detail.error && selectedId !== 0 ? (
            <p className="p-8 text-destructive" role="alert">
              {detail.error.message}
            </p>
          ) : (
            <div className="grid min-w-0 gap-4 p-4 sm:p-6 xl:grid-cols-[minmax(0,1fr)_360px]">
              <main className="min-w-0 space-y-4">
                {errors.form ? (
                  <div
                    className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
                    role="alert"
                  >
                    {errors.form}
                  </div>
                ) : null}
                {note?.origin === "retentions" ? (
                  <p className="rounded-lg border bg-muted/30 p-4 text-sm">
                    Esta nota agrupa retenciones ya descontadas en la factura.{" "}
                    <strong>No reduce nuevamente el saldo.</strong> Sus
                    conceptos y montos se actualizan desde la factura de origen.
                  </p>
                ) : null}
                {dirty ? (
                  <p className="text-sm text-muted-foreground" role="status">
                    Hay cambios sin guardar. Guárdelos antes de enviar a
                    revisión o imprimir.
                  </p>
                ) : null}
                <section className="rounded-lg border border-border/70 p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-semibold">
                      {editType === "credit"
                        ? "Facturas aplicadas"
                        : "Factura aplicada"}
                    </h3>
                    {financialEditing &&
                    note?.origin !== "supplier_return" &&
                    (editType === "credit" || allocations.length === 0) ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPickerOpen(true)}
                      >
                        <Plus className="mr-2 h-4 w-4" />
                        Agregar factura
                      </Button>
                    ) : null}
                  </div>
                  {noteScope ? (
                    <div className="mb-3 grid gap-2 rounded-md bg-muted/30 p-3 text-sm sm:grid-cols-2">
                      <div>
                        <span className="text-muted-foreground">Proveedor</span>
                        <p className="font-medium">{noteScope.supplierName}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">
                          Proyecto / moneda
                        </span>
                        <p className="font-medium">
                          {noteScope.projectName} · {noteScope.currency}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <p className="py-4 text-sm text-muted-foreground">
                      Seleccione una factura para establecer proveedor, proyecto
                      y moneda.
                    </p>
                  )}
                  {allocations.map((a, i) => (
                    <div
                      key={a.invoiceId}
                      className="grid items-end gap-3 border-t py-3 sm:grid-cols-[minmax(0,1fr)_180px_auto]"
                    >
                      <div className="min-w-0">
                        <a
                          href={`/facturas?editar=${a.invoiceId}`}
                          className="inline-flex min-h-11 items-center gap-1 font-medium text-primary hover:underline"
                        >
                          {a.invoiceDocumentNumber}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                        <p className="text-xs text-muted-foreground">
                          {a.invoiceNumber}
                          {a.available !== undefined
                            ? ` · Disponible: ${money(a.available)}`
                            : ""}
                        </p>
                      </div>
                      <div>
                        <Label htmlFor={`applied-${a.invoiceId}`}>
                          Monto aplicado
                        </Label>
                        <Input
                          id={`applied-${a.invoiceId}`}
                          type="number"
                          inputMode="decimal"
                          min="0"
                          step="0.0001"
                          value={a.amount}
                          disabled={!financialEditing}
                          aria-invalid={!!errors[`allocations.${i}.amount`]}
                          onChange={e => {
                            setAllocations(current =>
                              current.map((row, index) =>
                                index === i
                                  ? { ...row, amount: e.target.value }
                                  : row
                              )
                            );
                            setDirty(true);
                          }}
                        />
                        {errors[`allocations.${i}.amount`] ? (
                          <p className="text-xs text-destructive">
                            {errors[`allocations.${i}.amount`]}
                          </p>
                        ) : null}
                      </div>
                      {financialEditing &&
                      note?.origin !== "supplier_return" ? (
                        <Button
                          variant="ghost"
                          aria-label={`Quitar ${a.invoiceDocumentNumber}`}
                          onClick={() => {
                            setAllocations(current =>
                              current.filter((_, index) => index !== i)
                            );
                            if (allocations.length === 1 && !note)
                              setNoteScope(null);
                            setDirty(true);
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      ) : null}
                    </div>
                  ))}
                  {errors.allocations ? (
                    <p className="text-sm text-destructive">
                      Seleccione al menos una factura.
                    </p>
                  ) : null}
                </section>
                <NoteFiscalFields
                  value={fiscal}
                  onChange={patchFiscal}
                  disabled={!editing}
                  errors={errors}
                  onLookup={noteScope ? () => void lookup() : undefined}
                />
                <section className="rounded-lg border border-border/70 p-4">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-semibold">Detalle de conceptos</h3>
                    {financialEditing ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setLines(current => [...current, newLine()]);
                          setDirty(true);
                        }}
                      >
                        <Plus className="mr-2 h-4 w-4" />
                        Agregar concepto
                      </Button>
                    ) : null}
                  </div>
                  <div className="space-y-4">
                    {lines.map((line, i) => (
                      <div
                        key={line.key}
                        className="min-w-0 rounded-md border bg-muted/10 p-3"
                      >
                        <div className="flex items-start gap-2">
                          <div className="min-w-0 flex-1">
                            <Label className="mb-2 block">
                              Concepto {i + 1}
                            </Label>
                            <NoteConceptPicker
                              type={editType}
                              value={line.conceptId}
                              label={
                                line.code
                                  ? `${line.code} — ${line.description}`
                                  : ""
                              }
                              disabled={!financialEditing}
                              onChange={c =>
                                patchLine(i, {
                                  conceptId: c.id,
                                  code: c.code,
                                  description: c.description,
                                  financialGroupDescription:
                                    c.financialGroupDescription ?? null,
                                  allowsTaxOnly: c.allowsTaxOnly,
                                  retentionCatalogId: c.retentionCatalogId,
                                  ...(c.retentionCatalogId
                                    ? { taxCode: null, taxAmount: "0.0000" }
                                    : {}),
                                })
                              }
                            />
                            {errors[`lines.${i}.conceptId`] ? (
                              <p className="mt-1 text-xs text-destructive">
                                Seleccione un concepto.
                              </p>
                            ) : null}
                            <p className="mt-2 text-xs text-muted-foreground">
                              Grupo financiero:{" "}
                              {line.financialGroupDescription ||
                                "Sin grupo financiero"}
                            </p>
                          </div>
                          {financialEditing ? (
                            <Button
                              variant="ghost"
                              className="mt-6"
                              aria-label={`Quitar concepto ${i + 1}`}
                              onClick={() => {
                                setLines(current =>
                                  current.filter((_, index) => index !== i)
                                );
                                setDirty(true);
                              }}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          ) : null}
                        </div>
                        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                          <div>
                            <Label htmlFor={`base-${line.key}`}>Base</Label>
                            <Input
                              id={`base-${line.key}`}
                              type="number"
                              inputMode="decimal"
                              min="0"
                              step="0.0001"
                              disabled={!financialEditing}
                              value={line.baseAmount}
                              aria-invalid={!!errors[`lines.${i}.baseAmount`]}
                              onChange={e =>
                                patchLine(i, { baseAmount: e.target.value })
                              }
                            />
                            {errors[`lines.${i}.baseAmount`] ? (
                              <p className="text-xs text-destructive">
                                {errors[`lines.${i}.baseAmount`]}
                              </p>
                            ) : null}
                          </div>
                          <div>
                            <Label htmlFor={`tax-code-${line.key}`}>
                              Impuesto
                            </Label>
                            <select
                              id={`tax-code-${line.key}`}
                              className={`${selectClass} w-full`}
                              value={line.taxCode ?? ""}
                              disabled={
                                !financialEditing || !!line.retentionCatalogId
                              }
                              onChange={e =>
                                patchLine(i, {
                                  taxCode: e.target.value || null,
                                })
                              }
                            >
                              <option value="">Sin ISV</option>
                              {line.taxCode &&
                              !taxes.data?.some(
                                t => t.taxCode === line.taxCode
                              ) ? (
                                <option value={line.taxCode}>
                                  {line.taxCode}
                                </option>
                              ) : null}
                              {taxes.data
                                ?.filter(t => t.taxType === "base")
                                .map(t => (
                                  <option key={t.id} value={t.taxCode}>
                                    {t.description}
                                  </option>
                                ))}
                            </select>
                          </div>
                          <div>
                            <Label htmlFor={`tax-${line.key}`}>ISV</Label>
                            <Input
                              id={`tax-${line.key}`}
                              type="number"
                              inputMode="decimal"
                              min="0"
                              step="0.0001"
                              disabled={
                                !financialEditing || !line.allowsTaxOnly
                              }
                              value={line.taxAmount}
                              aria-invalid={!!errors[`lines.${i}.taxAmount`]}
                              onChange={e =>
                                patchLine(i, { taxAmount: e.target.value })
                              }
                            />
                            {errors[`lines.${i}.taxAmount`] ? (
                              <p className="text-xs text-destructive">
                                {errors[`lines.${i}.taxAmount`]}
                              </p>
                            ) : null}
                          </div>
                          <div>
                            <Label>Total concepto</Label>
                            <p className="mt-2 break-words font-semibold">
                              {money(
                                Number(line.baseAmount || 0) +
                                  Number(line.taxAmount || 0)
                              )}
                            </p>
                          </div>
                        </div>
                        <div className="mt-3">
                          <Label
                            htmlFor={`line-note-${line.key}`}
                            className="text-xs"
                          >
                            Observación del concepto
                          </Label>
                          <Input
                            id={`line-note-${line.key}`}
                            maxLength={1000}
                            value={line.notes}
                            disabled={!financialEditing}
                            onChange={e =>
                              patchLine(i, { notes: e.target.value })
                            }
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                  {!lines.length ? (
                    <p className="text-sm text-muted-foreground">
                      Agregue al menos un concepto.
                    </p>
                  ) : null}
                </section>
                <section className="rounded-lg border border-border/70 p-4">
                  <Label htmlFor="note-observations" className="font-semibold">
                    Observaciones
                  </Label>
                  <Textarea
                    id="note-observations"
                    className="mt-3"
                    value={fiscal.notes}
                    disabled={!editing}
                    maxLength={4000}
                    onChange={e => patchFiscal({ notes: e.target.value })}
                  />
                </section>
                {selectedId ? (
                  <DocumentAttachmentsPanel
                    entityType="financial_note"
                    entityId={selectedId}
                    title="Documento fiscal y soportes"
                    canManage={editing}
                    onStateChange={state =>
                      setAttachedCount(state.attachments.length)
                    }
                  />
                ) : (
                  <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                    Guarde el borrador para adjuntar el documento fiscal y sus
                    soportes.
                  </p>
                )}
              </main>
              <aside className="min-w-0 space-y-4">
                <section className="rounded-lg border border-border/70 p-4">
                  <h3 className="font-semibold">Resumen de la nota</h3>
                  <dl className="mt-4 space-y-3 text-sm">
                    <div className="flex justify-between gap-2">
                      <dt>Base</dt>
                      <dd>{money(totals.base)}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt>ISV</dt>
                      <dd>{money(totals.tax)}</dd>
                    </div>
                    <div className="flex justify-between gap-2 border-t pt-3 text-base font-semibold">
                      <dt>Total</dt>
                      <dd>{money(total)}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt>Aplicado a facturas</dt>
                      <dd>{money(applied)}</dd>
                    </div>
                    <div
                      className={`flex justify-between gap-2 ${difference ? "text-destructive" : "text-muted-foreground"}`}
                    >
                      <dt>Por distribuir</dt>
                      <dd>{money(difference)}</dd>
                    </div>
                  </dl>
                  {allocations.length === 1 && financialEditing ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-4 w-full"
                      onClick={() => {
                        setAllocations(current =>
                          current.map(a => ({ ...a, amount: total.toFixed(4) }))
                        );
                        setDirty(true);
                      }}
                    >
                      Aplicar total a la factura
                    </Button>
                  ) : null}
                  <p className="mt-4 text-xs text-muted-foreground">
                    {note?.origin === "retentions"
                      ? "Efecto adicional en saldo: cero."
                      : `El saldo se ${editType === "credit" ? "reduce" : "incrementa"} cuando la nota se contabiliza.`}
                  </p>
                </section>
                {note?.sourceReturnId ? (
                  <section className="rounded-lg border p-4 text-sm">
                    <h3 className="font-semibold">Documento de origen</h3>
                    <a
                      className="mt-2 inline-flex min-h-11 items-center gap-1 text-primary underline"
                      href={`/devoluciones?returnId=${note.sourceReturnId}`}
                    >
                      {note.sourceReturnNumber || "Ver devolución"}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </section>
                ) : null}
                <section className="rounded-lg border border-border/70 p-4">
                  <h3 className="font-semibold">Historial</h3>
                  <div className="mt-4 space-y-4">
                    {detail.data && selectedId ? (
                      detail.data.events.map(entry => (
                        <div
                          key={entry.id}
                          className="border-l-2 border-border pl-3 text-sm"
                        >
                          <p className="font-medium">
                            {eventLabels[entry.action] ?? entry.action}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {entry.actorName} ·{" "}
                            {new Date(entry.createdAt).toLocaleString("es-HN")}
                          </p>
                          {entry.comment ? (
                            <p className="mt-1 break-words text-xs">
                              {entry.comment}
                            </p>
                          ) : null}
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        Se registrará al guardar el borrador.
                      </p>
                    )}
                  </div>
                </section>
              </aside>
            </div>
          )}
        </FiscalDocumentDialogContent>
      </Dialog>
      <NoteInvoicePicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        type={editType}
        projectId={noteScope?.projectId}
        supplierId={noteScope?.supplierId}
        currency={noteScope?.currency}
        selectedIds={allocations.map(a => a.invoiceId)}
        onSelect={addInvoice}
      />
      <Dialog
        open={confirm !== null}
        onOpenChange={v => {
          if (!v && !busy) {
            setConfirm(null);
            setComment("");
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {confirm === "review"
                ? "Enviar a revisión"
                : confirm === "account"
                  ? "Contabilizar nota"
                  : confirm === "reject"
                    ? "Rechazar nota"
                    : confirm === "void"
                      ? "Anular nota"
                      : confirm === "discard"
                        ? "Descartar cambios"
                        : "Eliminar borrador"}
            </DialogTitle>
            <DialogDescription>
              {confirm === "discard"
                ? "Se perderán los cambios que todavía no ha guardado."
                : `${note?.documentNumber ?? modalTitle} · ${money(note?.total ?? total)}`}
            </DialogDescription>
          </DialogHeader>
          {confirm === "account" ? (
            <p className="text-sm">
              {note?.origin === "retentions"
                ? "La retención ya está reflejada en el saldo de la factura."
                : "Se aplicarán los importes a las facturas y se actualizará el saldo disponible."}{" "}
              Los importes quedarán bloqueados.
            </p>
          ) : confirm === "void" ? (
            <p className="text-sm">
              Se conservará el historial y se revertirá el efecto financiero de
              esta nota. Los movimientos de inventario se gestionan en
              Devoluciones.
            </p>
          ) : null}
          {["account", "reject", "void"].includes(confirm ?? "") ? (
            <div className="space-y-2">
              <Label htmlFor="note-action-comment">
                {confirm === "account"
                  ? "Comentario contable (opcional)"
                  : "Motivo"}
              </Label>
              <Textarea
                id="note-action-comment"
                value={comment}
                onChange={e => setComment(e.target.value)}
                maxLength={2000}
              />
            </div>
          ) : null}
          {errors.form ? (
            <p className="text-sm text-destructive" role="alert">
              {errors.form}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setConfirm(null);
                setComment("");
              }}
            >
              Cancelar
            </Button>
            <Button
              disabled={
                busy ||
                (["reject", "void"].includes(confirm ?? "") &&
                  comment.trim().length < 5)
              }
              variant={
                ["void", "remove", "discard"].includes(confirm ?? "")
                  ? "destructive"
                  : "default"
              }
              onClick={applyAction}
            >
              {busy ? "Procesando…" : "Confirmar"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
