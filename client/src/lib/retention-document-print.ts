import type { RetentionSnapshot } from "@shared/retention-documents";
import { escapeNoteHtml } from "./financial-note-print";
export function buildRetentionPrintHtml(document: {
  documentNumber: string | null;
  status: string;
  currency: string;
  total: string;
  snapshot: RetentionSnapshot;
}) {
  const e = escapeNoteHtml,
    s = document.snapshot;
  const money = (v: string | null) =>
    v == null
      ? "No disponible"
      : e(
          document.currency +
            " " +
            Number(v).toLocaleString("es-HN", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 4,
            })
        );
  const field = (label: string, value: unknown) =>
    "<div><strong>" +
    e(label) +
    ":</strong> " +
    e(value ?? "No disponible") +
    "</div>";
  return (
    '<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Comprobante de retención</title><style>@page{size:letter;margin:16mm}body{font:12px Arial;color:#172033}h1{font-size:23px}.meta{display:grid;grid-template-columns:1fr 1fr;gap:10px}table{border-collapse:collapse;width:100%;margin-top:24px}td,th{padding:9px;border-bottom:1px solid #ccd1d9;text-align:left}tr{break-inside:avoid}thead{display:table-header-group}.amount{text-align:right;white-space:nowrap}p,td,div{overflow-wrap:anywhere}</style></head><body><h1>Comprobante de retención</h1><p>' +
    e(document.documentNumber) +
    " · " +
    (document.status === "historico"
      ? "HISTÓRICO · No constituye un comprobante vigente"
      : "Contabilizado") +
    "</p>" +
    (s.reviewWarnings?.length
      ? "<aside><strong>Revisión contable pendiente</strong>" +
        s.reviewWarnings.map(w => "<p>" + e(w) + "</p>").join("") +
        "</aside>"
      : "") +
    '<div class="meta">' +
    field("Proveedor", s.supplierName) +
    field("RTN", s.supplierRtn) +
    field("Proyecto", s.projectName) +
    field("Moneda", document.currency) +
    field("Factura de origen", s.invoiceDocumentNumber) +
    field("Número de factura", s.invoiceNumber) +
    field("CAI", s.cai) +
    field("Fecha de emisión", s.documentDate) +
    field("Rango inicial", s.documentRangeStart) +
    field("Rango final", s.documentRangeEnd) +
    field("Fecha límite de emisión", s.emissionDeadline) +
    "</div><table><thead><tr><th>Concepto</th><th>Base</th><th>Porcentaje</th><th>Retenido</th></tr></thead><tbody>" +
    s.lines
      .map(
        l =>
          "<tr><td>" +
          e(l.retentionCode) +
          " — " +
          e(l.description) +
          '</td><td class="amount">' +
          money(l.baseAmount) +
          '</td><td class="amount">' +
          e(l.percentage == null ? "No disponible" : l.percentage + " %") +
          '</td><td class="amount">' +
          money(l.amount) +
          "</td></tr>"
      )
      .join("") +
    '</tbody></table><p class="amount"><strong>' +
    (document.status === "historico" ? "Importe histórico" : "Total retenido") +
    ": " +
    money(document.total) +
    "</strong></p><h2>Historial</h2>" +
    field("Contabilizado por", s.actorName) +
    field("Fecha de contabilización", s.accountedAt) +
    "</body></html>"
  );
}
