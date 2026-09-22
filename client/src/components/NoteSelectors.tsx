import { useEffect, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandInput,
  CommandList,
  CommandItem,
  CommandEmpty,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { DataPagination } from "@/components/DataPagination";
import type { FinancialNoteType } from "@shared/financial-notes";

export type NoteConceptOption = {
  id: number;
  code: string;
  description: string;
  financialGroupCode: string | null;
  financialGroupDescription?: string | null;
  allowsTaxOnly: boolean;
  retentionCatalogId: number | null;
};
export function NoteConceptPicker({
  type,
  value,
  label,
  onChange,
  disabled,
}: {
  type: FinancialNoteType;
  value: number;
  label: string;
  onChange: (concept: NoteConceptOption) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  const [page, setPage] = useState(1);
  useEffect(() => {
    const timer = setTimeout(() => {
      setTerm(search);
      setPage(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);
  const query = trpc.noteConcepts.listPage.useQuery(
    { type, search: term, isActive: true, page, pageSize: 25 },
    { enabled: open }
  );
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="h-auto min-h-10 w-full justify-between whitespace-normal text-left font-normal"
        >
          <span>{label || "Seleccione un concepto"}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[min(32rem,calc(100vw-2rem))] p-0"
      >
        <Command shouldFilter={false}>
          <CommandInput
            value={search}
            onValueChange={setSearch}
            placeholder="Buscar concepto…"
          />
          <CommandList>
            {query.isLoading ? (
              <p className="p-3 text-sm">Cargando…</p>
            ) : query.error ? (
              <p className="p-3 text-sm text-destructive">
                {query.error.message}
              </p>
            ) : (
              <>
                <CommandEmpty>No se encontraron conceptos.</CommandEmpty>
                {query.data?.items.map(item => (
                  <CommandItem
                    key={item.id}
                    value={String(item.id)}
                    onSelect={() => {
                      onChange(item);
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={`mr-2 h-4 w-4 shrink-0 ${value === item.id ? "opacity-100" : "opacity-0"}`}
                    />
                    <span>
                      <span className="font-medium">{item.code}</span> —{" "}
                      {item.description}
                    </span>
                  </CommandItem>
                ))}
              </>
            )}
          </CommandList>
        </Command>
        <div className="flex items-center justify-between gap-2 border-t p-2">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          >
            Anterior
          </Button>
          <span className="text-xs text-muted-foreground">
            {page} / {query.data?.totalPages ?? 1}
          </span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={page >= (query.data?.totalPages ?? 1)}
            onClick={() => setPage(page + 1)}
          >
            Siguiente
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export type NoteInvoiceOption = {
  id: number;
  invoiceDocumentNumber: string;
  invoiceNumber: string;
  supplierId: number;
  projectId: number;
  currency: string;
  supplierName: string;
  projectName: string;
  available: string;
};
export function NoteInvoicePicker({
  open,
  onOpenChange,
  type,
  projectId,
  supplierId,
  currency,
  selectedIds,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  type: FinancialNoteType;
  projectId?: number;
  supplierId?: number;
  currency?: "HNL" | "USD";
  selectedIds: number[];
  onSelect: (invoice: NoteInvoiceOption) => void;
}) {
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  const [page, setPage] = useState(1);
  useEffect(() => {
    const timer = setTimeout(() => {
      setTerm(search);
      setPage(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);
  const query = trpc.financialNotes.eligibleInvoices.useQuery(
    { type, projectId, supplierId, currency, search: term, page, pageSize: 25 },
    { enabled: open }
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Agregar factura</DialogTitle>
          <DialogDescription>
            {type === "credit"
              ? "Seleccione facturas contabilizadas del mismo proveedor, proyecto y moneda."
              : "La nota de débito aplica a una sola factura contabilizada."}
          </DialogDescription>
        </DialogHeader>
        <Input
          aria-label="Buscar factura o proveedor"
          placeholder="Buscar consecutivo, número fiscal o proveedor…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        {query.isLoading ? (
          <p role="status">Cargando facturas…</p>
        ) : query.error ? (
          <p className="text-destructive" role="alert">
            {query.error.message}
          </p>
        ) : !query.data?.items.length ? (
          <p className="py-6 text-muted-foreground">
            No hay facturas para estos filtros.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm max-sm:[&_thead]:hidden max-sm:[&_tbody]:block max-sm:[&_tr]:block max-sm:[&_tr]:py-3 max-sm:[&_td]:block max-sm:[&_td]:min-w-0 max-sm:[&_td]:whitespace-normal max-sm:[&_td]:py-1">
              <thead>
                <tr className="border-b text-left">
                  {["Factura / proveedor", "Proyecto", "Disponible", ""].map(
                    (h, i) => (
                      <th key={i} className="p-3">
                        {h}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {query.data.items.map(invoice => (
                  <tr key={invoice.id} className="border-b">
                    <td className="p-3">
                      <p className="font-medium">
                        {invoice.invoiceDocumentNumber}
                      </p>
                      <p>{invoice.invoiceNumber}</p>
                      <p className="text-xs text-muted-foreground">
                        {invoice.supplierName}
                      </p>
                    </td>
                    <td className="p-3">{invoice.projectName}</td>
                    <td className="whitespace-nowrap p-3 text-right">
                      {invoice.currency}{" "}
                      {Number(invoice.available).toLocaleString("es-HN", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 4,
                      })}
                    </td>
                    <td className="p-3">
                      <Button
                        size="sm"
                        disabled={
                          selectedIds.includes(invoice.id) ||
                          (type === "credit" && Number(invoice.available) <= 0)
                        }
                        onClick={() => {
                          onSelect(invoice);
                          onOpenChange(false);
                        }}
                      >
                        Agregar
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
      </DialogContent>
    </Dialog>
  );
}
