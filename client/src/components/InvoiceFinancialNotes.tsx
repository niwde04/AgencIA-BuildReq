import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { NOTE_STATUS_LABELS } from "@shared/financial-notes";

export function InvoiceFinancialNotes({ invoiceId }: { invoiceId: number }) {
  const credit = trpc.financialNotes.listPage.useQuery({
    type: "credit",
    invoiceId,
    page: 1,
    pageSize: 10,
  });
  const debit = trpc.financialNotes.listPage.useQuery({
    type: "debit",
    invoiceId,
    page: 1,
    pageSize: 10,
  });
  return (
    <section className="rounded-lg border border-border/70 p-4">
      <h3 className="font-semibold">Notas vinculadas</h3>
      <div className="mt-3 space-y-3">
        {(
          [
            { query: credit, type: "credit", label: "Crédito" },
            { query: debit, type: "debit", label: "Débito" },
          ] as const
        ).map(({ query, type, label }) => (
          <div key={type}>
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="font-medium">
                {label} ({query.data?.total ?? 0})
              </span>
              <a
                className="inline-flex min-h-11 items-center text-primary hover:underline"
                href={`/${type === "credit" ? "notas-credito" : "notas-debito"}?invoiceId=${invoiceId}`}
              >
                Ver todas
              </a>
            </div>
            {query.isLoading ? (
              <p className="text-xs text-muted-foreground">Cargando…</p>
            ) : query.error ? (
              <p className="text-xs text-destructive">{query.error.message}</p>
            ) : query.data?.items.length ? (
              query.data.items.map(note => (
                <a
                  key={note.id}
                  href={`/${type === "credit" ? "notas-credito" : "notas-debito"}?id=${note.id}`}
                  className="flex min-h-11 flex-wrap items-center justify-between gap-2 border-t py-2 text-sm"
                >
                  <span className="text-primary">{note.documentNumber}</span>
                  <Badge variant="outline">
                    {NOTE_STATUS_LABELS[note.status]}
                  </Badge>
                </a>
              ))
            ) : (
              <p className="text-xs text-muted-foreground">
                Sin notas de {label.toLowerCase()}.
              </p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
