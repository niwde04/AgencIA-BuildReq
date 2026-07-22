import { Button } from "@/components/ui/button";
import { useState, type ReactNode } from "react";
import {
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  CircleDollarSign,
  Clock3,
  FileText,
  Flag,
  FolderOpen,
  Package,
  Printer,
  ShoppingBag,
  XCircle,
} from "lucide-react";

export type CompactApprovalSummaryIcon =
  | "project"
  | "purchase"
  | "date"
  | "status"
  | "supplier"
  | "total";

export type CompactApprovalSummaryField = {
  label: string;
  value: string;
  icon: CompactApprovalSummaryIcon;
  accent?: boolean;
};

export type CompactApprovalHistoryEntry = {
  id: string | number;
  title: string;
  actor: string;
  date: string;
  comment?: string | null;
};

type CompactProcurementApprovalPanelProps = {
  summaryFields: CompactApprovalSummaryField[];
  detailTitle: string;
  detailContent: ReactNode;
  notes?: string | null;
  history: CompactApprovalHistoryEntry[];
  historyDescription: string;
  emptyHistoryMessage: string;
  onPrint: () => void;
  onReject: () => void;
  onApprove: () => void;
  isPending?: boolean;
};

const SUMMARY_ICONS = {
  project: FolderOpen,
  purchase: ShoppingBag,
  date: CalendarDays,
  status: Flag,
  supplier: Package,
  total: CircleDollarSign,
} as const;

export function CompactProcurementApprovalPanel({
  summaryFields,
  detailTitle,
  detailContent,
  notes,
  history,
  historyDescription,
  emptyHistoryMessage,
  onPrint,
  onReject,
  onApprove,
  isPending = false,
}: CompactProcurementApprovalPanelProps) {
  const [isDetailOpen, setIsDetailOpen] = useState(true);
  const [isNotesOpen, setIsNotesOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-8 sm:py-6">
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl border border-border/70 bg-card p-3 md:hidden">
        {summaryFields.map((field, index) => {
          const Icon = SUMMARY_ICONS[field.icon];
          const fillsLastRow =
            summaryFields.length % 2 === 1 &&
            index === summaryFields.length - 1;
          return (
            <div
              key={field.label}
              className={`min-w-0 ${fillsLastRow ? "col-span-2" : ""}`}
            >
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Icon className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{field.label}</span>
              </div>
              <p
                className={`mt-1 truncate text-sm font-semibold ${
                  field.accent ? "text-blue-600" : "text-foreground"
                }`}
                title={field.value}
              >
                {field.value}
              </p>
            </div>
          );
        })}
      </div>

      <div
        className={`hidden gap-3 md:grid md:grid-cols-2 ${
          summaryFields.length >= 5
            ? "xl:grid-cols-5"
            : summaryFields.length === 4
              ? "lg:grid-cols-4"
              : "lg:grid-cols-3"
        }`}
      >
        {summaryFields.map(field => {
          const Icon = SUMMARY_ICONS[field.icon];
          return (
            <div
              key={field.label}
              className="min-w-0 rounded-xl border border-border/70 bg-card p-4"
            >
              <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
                <Icon className="h-4 w-4 shrink-0" />
                <span>{field.label}</span>
              </div>
              <p
                className={`truncate text-sm font-semibold sm:text-base ${
                  field.accent ? "text-blue-600" : "text-foreground"
                }`}
                title={field.value}
              >
                {field.value}
              </p>
            </div>
          );
        })}
      </div>

      <section className="mt-4 overflow-hidden rounded-xl border border-border/70 bg-card">
        <button
          type="button"
          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/30"
          onClick={() => setIsDetailOpen(current => !current)}
          aria-expanded={isDetailOpen}
        >
          <span className="font-semibold">{detailTitle}</span>
          <ChevronDown
            className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
              isDetailOpen ? "rotate-180" : ""
            }`}
          />
        </button>
        {isDetailOpen ? (
          <div className="overflow-x-auto border-t border-border/70">
            {detailContent}
          </div>
        ) : null}
      </section>

      <section className="mt-4 overflow-hidden rounded-xl border border-border/70 bg-card">
        <button
          type="button"
          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/30"
          onClick={() => setIsNotesOpen(current => !current)}
          aria-expanded={isNotesOpen}
        >
          <span className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-muted-foreground" />
            <span className="font-semibold">Notas</span>
          </span>
          <ChevronDown
            className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
              isNotesOpen ? "rotate-180" : ""
            }`}
          />
        </button>
        {isNotesOpen ? (
          <p className="whitespace-pre-wrap border-t border-border/70 px-4 py-3 pl-10 text-sm text-muted-foreground">
            {notes?.trim() || "Sin notas."}
          </p>
        ) : null}
      </section>

      <section className="mt-4 overflow-hidden rounded-xl border border-border/70 bg-card">
        <button
          type="button"
          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/30"
          onClick={() => setIsHistoryOpen(current => !current)}
          aria-expanded={isHistoryOpen}
        >
          <span className="flex min-w-0 items-start gap-2">
            <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <span>
              <span className="block font-semibold">
                Historial de aprobación
              </span>
              <span className="block text-xs text-muted-foreground">
                {historyDescription}
              </span>
            </span>
          </span>
          <ChevronDown
            className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
              isHistoryOpen ? "rotate-180" : ""
            }`}
          />
        </button>

        {isHistoryOpen ? (
          <div className="border-t border-border/70 px-4 py-4">
            {history.length > 0 ? (
              <ol className="space-y-4 pl-2">
                {history.map(entry => (
                  <li
                    key={entry.id}
                    className="relative border-l border-border pb-1 pl-6 last:pb-0"
                  >
                    <span className="absolute -left-1.5 top-1 h-3 w-3 rounded-full border-2 border-blue-500 bg-blue-100" />
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold">{entry.title}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {entry.actor}
                        </p>
                      </div>
                      <time className="text-xs text-muted-foreground">
                        {entry.date}
                      </time>
                    </div>
                    {entry.comment ? (
                      <p className="mt-2 rounded-lg bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                        {entry.comment}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
                {emptyHistoryMessage}
              </p>
            )}
          </div>
        ) : null}
      </section>

      <div className="mt-5 flex flex-col gap-3 border-t border-border/70 pt-4 sm:flex-row sm:items-center sm:justify-between">
        <Button
          type="button"
          variant="outline"
          className="h-11 px-5"
          onClick={onPrint}
          disabled={isPending}
        >
          <Printer className="mr-2 h-4 w-4" />
          Imprimir
        </Button>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button
            type="button"
            variant="destructive"
            className="h-11 min-w-36 px-6"
            onClick={onReject}
            disabled={isPending}
          >
            <XCircle className="mr-2 h-4 w-4" />
            Rechazar
          </Button>
          <Button
            type="button"
            className="h-11 min-w-36 bg-emerald-600 px-6 text-white hover:bg-emerald-700"
            onClick={onApprove}
            disabled={isPending}
          >
            <CheckCircle2 className="mr-2 h-4 w-4" />
            Aprobar
          </Button>
        </div>
      </div>
    </div>
  );
}
