import { Button } from "@/components/ui/button";
import {
  CalendarDays,
  CheckCircle2,
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
  notes,
  history,
  historyDescription,
  emptyHistoryMessage,
  onPrint,
  onReject,
  onApprove,
  isPending = false,
}: CompactProcurementApprovalPanelProps) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-8 sm:py-6">
      <div
        className={`grid gap-3 sm:grid-cols-2 ${
          summaryFields.length >= 5 ? "xl:grid-cols-5" : "lg:grid-cols-4"
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

      <section className="mt-4 rounded-xl border border-border/70 bg-card p-4">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-muted-foreground" />
          <h3 className="font-semibold">Notas</h3>
        </div>
        <p className="mt-2 whitespace-pre-wrap pl-6 text-sm text-muted-foreground">
          {notes?.trim() || "Sin notas."}
        </p>
      </section>

      <section className="mt-4 rounded-xl border border-border/70 bg-card p-4">
        <div className="flex items-start gap-2">
          <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div>
            <h3 className="font-semibold">Historial de aprobación</h3>
            <p className="text-xs text-muted-foreground">
              {historyDescription}
            </p>
          </div>
        </div>

        {history.length > 0 ? (
          <ol className="mt-4 space-y-4 pl-2">
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
          <p className="mt-4 rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
            {emptyHistoryMessage}
          </p>
        )}
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
