import type { ComponentProps } from "react";
import { DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  CAI_FORMAT_EXAMPLE,
  INVOICE_NUMBER_FORMAT_EXAMPLE,
  formatCaiInput,
  formatInvoiceNumberInput,
} from "@shared/invoices";
import type { NoteFiscalInput } from "@shared/financial-notes";

/** Shared with Facturas: identical document modal geometry and scroll behavior. */
export function FiscalDocumentDialogContent({
  className,
  ...props
}: ComponentProps<typeof DialogContent>) {
  return (
    <DialogContent
      {...props}
      className={cn(
        "scrollbar-visible max-h-[calc(100dvh-0.75rem)] w-[calc(100vw-0.5rem)] max-w-[calc(100vw-0.5rem)] overflow-x-hidden overflow-y-auto rounded-lg p-0 sm:max-h-[calc(100dvh-1.5rem)] sm:w-[calc(100vw-2rem)] sm:max-w-[1580px]",
        className
      )}
    />
  );
}

export function FiscalDocumentInput({
  format,
  fiscal = true,
  onChange,
  ...props
}: ComponentProps<typeof Input> & {
  format: "cai" | "number";
  fiscal?: boolean;
}) {
  const example =
    format === "cai" ? CAI_FORMAT_EXAMPLE : INVOICE_NUMBER_FORMAT_EXAMPLE;
  return (
    <Input
      placeholder={fiscal ? example : undefined}
      maxLength={fiscal ? example.length : undefined}
      autoCapitalize="characters"
      {...props}
      onChange={event => {
        if (fiscal)
          event.target.value =
            format === "cai"
              ? formatCaiInput(event.target.value)
              : formatInvoiceNumberInput(event.target.value);
        onChange?.(event);
      }}
    />
  );
}

export function NoteFiscalFields({
  value,
  onChange,
  disabled,
  errors = {},
  onLookup,
  lookupPending,
}: {
  value: NoteFiscalInput;
  onChange: (patch: Partial<NoteFiscalInput>) => void;
  disabled: boolean;
  errors?: Record<string, string>;
  onLookup?: () => void;
  lookupPending?: boolean;
}) {
  const fields = [
    ["fiscalNumber", "Número documento", "number"],
    ["cai", "CAI", "cai"],
    ["documentRangeStart", "Rango autorizado inicial", "number"],
    ["documentRangeEnd", "Rango autorizado final", "number"],
    ["documentDate", "Fecha de emisión", "date"],
    ["documentDueDate", "Fecha de vencimiento", "date"],
    ["emissionDeadline", "Fecha límite de emisión", "date"],
  ] as const;
  return (
    <section className="rounded-lg border border-border/70 p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">Datos fiscales</h3>
        {!disabled && onLookup ? (
          <button
            type="button"
            className="min-h-11 text-sm font-medium text-primary underline-offset-4 hover:underline disabled:opacity-50"
            disabled={lookupPending || !value.fiscalNumber}
            onClick={onLookup}
          >
            {lookupPending ? "Consultando…" : "Completar desde rango conocido"}
          </button>
        ) : null}
      </div>
      <div className="grid min-w-0 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {fields.map(([key, label, format]) => (
          <div
            key={key}
            className={cn(
              "min-w-0 space-y-2",
              key === "cai" && "md:col-span-2"
            )}
          >
            <Label htmlFor={`note-${key}`}>{label}</Label>
            {format === "date" ? (
              <Input
                id={`note-${key}`}
                type="date"
                value={value[key]}
                disabled={disabled}
                onChange={e => onChange({ [key]: e.target.value })}
                aria-invalid={!!errors[key]}
                aria-describedby={errors[key] ? `note-${key}-error` : undefined}
              />
            ) : (
              <FiscalDocumentInput
                id={`note-${key}`}
                format={format}
                value={value[key]}
                disabled={disabled}
                onChange={e => onChange({ [key]: e.target.value })}
                aria-invalid={!!errors[key]}
                aria-describedby={errors[key] ? `note-${key}-error` : undefined}
              />
            )}{" "}
            {errors[key] ? (
              <p id={`note-${key}-error`} className="text-sm text-destructive">
                {errors[key]}
              </p>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}
