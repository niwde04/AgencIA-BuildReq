import { buildProcurementPdfBase64 } from "./_core/documents";

type Project = { code: string; name: string };
export type OpeningBalanceDocumentDetail = {
  openingBalance: {
    balanceNumber: string;
    openingDate: Date | string;
    notes?: string | null;
  };
  project?: Project | null;
  warehouse?: { displayName: string } | null;
  createdBy?: { name?: string | null; email?: string | null } | null;
  items: Array<{
    sapItemCode: string;
    itemName: string;
    quantity: string | number;
    unit?: string | null;
    storageLocation?: string | null;
    project?: Project | null;
    notes?: string | null;
  }>;
};

function projectLabel(project: Project | null | undefined) {
  return project ? `${project.code} - ${project.name}` : "Sin proyecto";
}
function dateLabel(value: Date | string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Sin fecha"
    : date.toLocaleDateString("es-HN", {
        timeZone: "America/Tegucigalpa",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });
}

export function buildOpeningBalanceDocument(
  detail: OpeningBalanceDocumentDetail,
  generatedAt = new Date()
) {
  const headerProject = projectLabel(detail.project);
  const codes = new Set(detail.items.map(item => item.sapItemCode));
  const content = buildProcurementPdfBase64({
    title: "Saldo inicial de inventario",
    documentNumber: detail.openingBalance.balanceNumber,
    badgeText: "SI",
    primaryFields: [
      { label: "Proyecto de apertura", value: headerProject },
      { label: "Bodega", value: detail.warehouse?.displayName || "Sin bodega" },
    ],
    secondaryFields: [
      {
        label: "Fecha de apertura",
        value: dateLabel(detail.openingBalance.openingDate),
      },
      {
        label: "Registrado por",
        value:
          detail.createdBy?.name || detail.createdBy?.email || "Sin registrar",
      },
      { label: "Ítems", value: String(detail.items.length) },
    ],
    items: detail.items.map(item => {
      const destination = projectLabel(item.project ?? detail.project);
      return {
        description: item.itemName,
        quantityLabel:
          `${Number(item.quantity).toLocaleString("es-HN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${item.unit || ""}`.trim(),
        metaLines: [
          `SAP: ${item.sapItemCode} | Ubicación: ${item.storageLocation || "Sin ubicación"}`,
          ...(destination !== headerProject
            ? [`Proyecto destino: ${destination}`]
            : []),
          ...(item.notes ? [`Notas: ${item.notes}`] : []),
        ],
      };
    }),
    notes: detail.openingBalance.notes || "Sin observaciones",
    preserveItemText: true,
    summaryRows: [
      { label: "Total renglones", value: String(detail.items.length) },
      {
        label: "Total códigos SAP",
        value: String(codes.size),
        emphasized: true,
      },
    ],
    generatedLabel: dateLabel(generatedAt),
    footerNote: "Saldo inicial generado por BuildReq.",
    detailTitle: "Detalle del saldo inicial",
    detailDescription: "Artículos registrados por proyecto y ubicación.",
  });
  return {
    content,
    mimeType: "application/pdf" as const,
    name: `saldo-inicial-${detail.openingBalance.balanceNumber.replace(/[\\/:*?"<>|]/g, "-")}.pdf`,
  };
}
