export function getReadablePrintStyles() {
  return `
            body {
              font-size: 11px !important;
              line-height: 1.28 !important;
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }
            .header,
            .meta,
            .signatures,
            .note,
            .observations,
            .justification {
              break-inside: avoid;
              page-break-inside: avoid;
            }
            .title {
              font-size: 13.8px !important;
              letter-spacing: 0 !important;
              line-height: 1.25 !important;
            }
            .company,
            .title .company {
              font-size: 15.5px !important;
              line-height: 1.18 !important;
            }
            .title-box {
              font-size: 15px !important;
            }
            .document-number {
              font-size: 13.5px !important;
              line-height: 1.2 !important;
            }
            .field {
              align-items: start;
              min-height: 15px !important;
            }
            .label,
            .value {
              font-size: 10.8px !important;
              line-height: 1.28 !important;
            }
            .value,
            td,
            th {
              overflow-wrap: anywhere;
              word-break: normal;
            }
            table {
              font-size: 10.7px !important;
              line-height: 1.25 !important;
              page-break-inside: auto;
            }
            thead {
              display: table-header-group;
            }
            tfoot {
              display: table-row-group;
            }
            tr {
              break-inside: avoid;
              page-break-inside: avoid;
            }
            th,
            td {
              font-size: 10.7px !important;
              line-height: 1.24 !important;
              padding: 4px 5px !important;
            }
            th {
              font-weight: 800 !important;
            }
            .muted,
            .item-meta,
            .line-note,
            .asset-meta {
              font-size: 10px !important;
              line-height: 1.25 !important;
            }
            .summary,
            .summary-table {
              font-size: 10.2px !important;
              line-height: 1.18 !important;
            }
            .summary td,
            .summary-table td {
              font-size: 10.2px !important;
              height: auto !important;
              line-height: 1.18 !important;
              padding: 2px 5px !important;
            }
            .summary-table .emphasized td {
              font-size: 10.8px !important;
            }
            .signature,
            .signature-line,
            .signature-name {
              font-size: 10.8px !important;
              line-height: 1.25 !important;
            }
            .note,
            .justification,
            .observation-text {
              font-size: 10px !important;
              line-height: 1.3 !important;
            }
            .section-title {
              font-size: 11px !important;
              letter-spacing: 0 !important;
            }
            @media print {
              html,
              body {
                height: auto !important;
                overflow: visible !important;
              }
              .sheet {
                padding: 0 !important;
              }
            }
`;
}

export function getReadablePurchaseOrderPrintStyles() {
  return `
            .header {
              gap: 10px !important;
              grid-template-columns: 108px minmax(0, 1fr) 64px !important;
            }
            .logo {
              height: 58px !important;
              width: 104px !important;
            }
            .rule {
              margin: 5px 0 9px !important;
            }
            .meta {
              gap: 10px 12px !important;
              grid-template-columns: 1fr 0.72fr 1fr !important;
            }
            .meta-left,
            .meta-mid,
            .meta-right {
              gap: 4px !important;
            }
            .field {
              gap: 5px !important;
              grid-template-columns: 82px minmax(0, 1fr) !important;
            }
            .meta-mid .field {
              grid-template-columns: 60px minmax(0, 1fr) !important;
            }
            .meta-right .field {
              grid-template-columns: 82px minmax(0, 1fr) !important;
            }
            table {
              margin-top: 10px !important;
            }
            .summary-row {
              margin-top: 8px !important;
            }
            .summary td:first-child {
              padding-right: 14px !important;
            }
            .summary td.numeric {
              min-width: 70px !important;
            }
            .signatures {
              gap: 52px !important;
              grid-template-columns: repeat(2, 160px) !important;
              margin: 18px 0 12px !important;
            }
            .signature-name {
              min-height: 22px !important;
            }
            .note {
              border-radius: 7px !important;
              margin-top: 10px !important;
              padding: 7px 12px !important;
            }
`;
}
