import {
  NOTE_ORIGIN_LABELS,
  NOTE_STATUS_LABELS,
} from "@shared/financial-notes";
export function escapeNoteHtml(value: unknown) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    c =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!
  );
}
export function buildFinancialNotePrintHtml(detail: {
  note: any;
  lines: any[];
  allocations: any[];
  events: any[];
}) {
  const { note, lines, allocations, events } = detail;
  const e = escapeNoteHtml;
  const money = (v: unknown) =>
    e(
      `${note.currency} ${Number(v ?? 0).toLocaleString("es-HN", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`
    );
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${e(note.documentNumber)}</title><style>@page{size:letter;margin:16mm}body{font:12px Arial,sans-serif;color:#172033}h1{font-size:23px;margin-bottom:5px}h2{font-size:14px;margin-top:24px}table{border-collapse:collapse;width:100%;margin-top:10px}td,th{padding:8px;border-bottom:1px solid #ccd1d9;text-align:left;vertical-align:top}thead{display:table-header-group}tr{break-inside:avoid}.amount{text-align:right;white-space:nowrap}.meta{display:grid;grid-template-columns:1fr 1fr;gap:8px}.muted{color:#526071}.badge{padding:6px;border:1px solid #8893a4;display:inline-block}.summary{margin-left:auto;width:300px}pre{font:inherit;white-space:pre-wrap;overflow-wrap:anywhere}</style></head><body><h1>Nota de ${note.type === "credit" ? "crédito" : "débito"}</h1><p><strong>${e(note.documentNumber)}</strong> · <span class="badge">${e(NOTE_STATUS_LABELS[note.status] ?? note.status)}</span></p><div class="meta"><div><strong>Proveedor:</strong> ${e(note.supplierName)}</div><div><strong>RTN:</strong> ${e(note.supplierRtn)}</div><div><strong>Proyecto:</strong> ${e(note.projectName)}</div><div><strong>Origen:</strong> ${e(NOTE_ORIGIN_LABELS[note.origin])}</div><div><strong>Número fiscal:</strong> ${e(note.fiscalNumber || "Pendiente")}</div><div><strong>CAI:</strong> ${e(note.cai || "Pendiente")}</div><div><strong>Emisión:</strong> ${e(note.documentDate)}</div><div><strong>Vencimiento:</strong> ${e(note.documentDueDate)}</div><div><strong>Rango:</strong> ${e(note.documentRangeStart)} — ${e(note.documentRangeEnd)}</div><div><strong>Límite de emisión:</strong> ${e(note.emissionDeadline)}</div></div>${note.origin === "retentions" ? '<p class="badge">Retenciones ya descontadas en la factura. Efecto adicional en saldo: cero.</p>' : ""}<h2>Detalle de conceptos</h2><table><thead><tr><th>Concepto</th><th>Grupo financiero</th><th>Base</th><th>ISV</th><th>Total</th></tr></thead><tbody>${lines.map(l => `<tr><td>${e(l.code)} — ${e(l.description)}<br><span class="muted">${e(l.notes)}</span></td><td>${e(l.financialGroupDescription || "Sin grupo")}</td><td class="amount">${money(l.baseAmount)}</td><td class="amount">${money(l.taxAmount)}</td><td class="amount">${money(l.total)}</td></tr>`).join("")}</tbody></table><table class="summary"><tr><th>Base</th><td class="amount">${money(note.subtotal)}</td></tr><tr><th>ISV</th><td class="amount">${money(note.taxAmount)}</td></tr><tr><th>Total</th><td class="amount"><strong>${money(note.total)}</strong></td></tr></table><h2>Facturas aplicadas</h2><table><thead><tr><th>Factura</th><th>Número fiscal</th><th>Monto aplicado</th></tr></thead><tbody>${allocations.map(a => `<tr><td>${e(a.invoiceDocumentNumber)}</td><td>${e(a.invoiceNumber)}</td><td class="amount">${money(a.amount)}</td></tr>`).join("")}</tbody></table>${note.sourceReturnNumber ? `<p>Devolución de origen: ${e(note.sourceReturnNumber)}</p>` : ""}<h2>Observaciones</h2><pre>${e(note.notes || "—")}</pre><h2>Historial</h2>${events.map(v => `<p>${e(v.action)} · ${e(v.actorName)} · ${e(new Date(v.createdAt).toLocaleString("es-HN"))}<br>${e(v.comment)}</p>`).join("")}</body></html>`;
}
