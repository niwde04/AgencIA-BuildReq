import { Button } from "@/components/ui/button";
import { ChevronRight } from "lucide-react";

type DocumentItem = {
  id?: string | number | null;
  currentSapItemCode?: string | null;
  sapItemCode?: string | null;
  originalSapItemCode?: string | null;
  fixedAssetSapItemCode?: string | null;
  itemName?: string | null;
  sapItemDescription?: string | null;
  description?: string | null;
  quantity?: string | number | null;
  unit?: string | null;
  catalogItem?: {
    itemCode?: string | null;
    description?: string | null;
  } | null;
};

type DocumentItemsAccordionTriggerProps = {
  expanded: boolean;
  onToggle: () => void;
  count?: number | null;
  label?: string;
};

type DocumentItemsAccordionPanelProps = {
  items?: DocumentItem[] | null;
  isLoading?: boolean;
  error?: string | { message?: string | null } | null;
};

function formatQuantity(value: string | number | null | undefined) {
  const quantity = Number(value);
  if (!Number.isFinite(quantity)) return String(value ?? "—");
  return quantity.toLocaleString("es-HN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  });
}

function getItemCode(item: DocumentItem) {
  return (
    item.currentSapItemCode?.trim() ||
    item.sapItemCode?.trim() ||
    item.originalSapItemCode?.trim() ||
    item.catalogItem?.itemCode?.trim() ||
    item.fixedAssetSapItemCode?.trim() ||
    "—"
  );
}

function getItemDescription(item: DocumentItem) {
  return (
    item.itemName?.trim() ||
    item.sapItemDescription?.trim() ||
    item.catalogItem?.description?.trim() ||
    item.description?.trim() ||
    "Sin descripción"
  );
}

export function DocumentItemsAccordionTrigger({
  expanded,
  onToggle,
  count,
  label = "Artículos",
}: DocumentItemsAccordionTriggerProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-8 gap-1.5 px-2 text-xs font-medium"
      onClick={onToggle}
      aria-expanded={expanded}
    >
      <ChevronRight
        className={`h-4 w-4 transition-transform ${
          expanded ? "rotate-90" : ""
        }`}
      />
      {label}
      {typeof count === "number" ? ` (${count})` : ""}
    </Button>
  );
}

export function DocumentItemsAccordionPanel({
  items,
  isLoading = false,
  error,
}: DocumentItemsAccordionPanelProps) {
  const errorMessage =
    typeof error === "string"
      ? error
      : error?.message || "Ocurrió un error inesperado.";

  return (
    <div className="border-y border-border/70 bg-muted/15 px-4 py-4">
      {isLoading ? (
        <p className="py-4 text-center text-sm text-muted-foreground">
          Cargando artículos...
        </p>
      ) : error ? (
        <p className="py-4 text-center text-sm text-destructive">
          No se pudieron cargar los artículos: {errorMessage}
        </p>
      ) : !items?.length ? (
        <p className="py-4 text-center text-sm text-muted-foreground">
          Este documento no tiene artículos registrados.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-background">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="bg-muted/40">
              <tr className="border-b border-border">
                <th className="w-52 px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Código
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Descripción
                </th>
                <th className="w-44 px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Cantidad
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, index) => (
                <tr
                  key={item.id ?? `${getItemCode(item)}-${index}`}
                  className="border-b border-border/70 last:border-0"
                >
                  <td className="px-4 py-2.5 font-mono text-xs font-medium">
                    {getItemCode(item)}
                  </td>
                  <td className="px-4 py-2.5">{getItemDescription(item)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {formatQuantity(item.quantity)}
                    {item.unit?.trim() ? (
                      <span className="ml-1 text-xs text-muted-foreground">
                        {item.unit.trim()}
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
