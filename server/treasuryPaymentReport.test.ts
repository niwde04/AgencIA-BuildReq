import { describe, expect, it } from "vitest";
import {
  buildTreasuryPaymentReportHtml,
  type TreasuryPaymentReportPayload,
} from "../client/src/lib/treasury-payment-report";

function reportPayload(): TreasuryPaymentReportPayload {
  return {
    generatedAt: "2026-07-27T15:00:00.000Z",
    batch: {
      batchNumber: "TES-2026-000001",
      currency: "HNL",
      requestedPaymentDate: "2026-07-26",
    },
    project: {
      code: "017",
      name: "CA-4 Ocotepeque - El Portillo",
    },
    lines: [
      {
        paymentItem: {
          supplierCode: "PROV-000114",
          supplierName:
            "ACCESORIOS PARA COMPUTADORAS Y OFICINAS SA DE CV",
          invoiceDocumentNumber: "FT-017-00000033",
          invoiceNumber: "000-013-01-00083329",
          previousPaidAmount: "100.00",
          bankPaidAmount: "2,032.31".replace(",", ""),
          bankPaidDate: "2026-07-27",
          bankReference: "TRX-778899",
        },
        invoice: {
          invoiceDocumentNumber: "FT-017-00000033",
          invoiceNumber: "000-013-01-00083329",
          documentDate: "2026-07-22",
          total: "2151.01",
          supplierCode: "PROV-000114",
          supplierName:
            "ACCESORIOS PARA COMPUTADORAS Y OFICINAS SA DE CV",
          items: [
            {
              itemName: "Servicio de mantenimiento",
              financialGroupCode: "FG-4100",
            },
          ],
          retentions: [
            {
              retentionCode: "ISR1",
              description: "Retención ISR 1%",
              percentage: "1.0000",
              amount: "18.70",
            },
          ],
        },
      },
    ],
  };
}

describe("reporte de detalle de pago de Tesorería", () => {
  it("incluye la información fiscal, financiera y bancaria del pago", () => {
    const html = buildTreasuryPaymentReportHtml(reportPayload());

    expect(html).toContain("DETALLE PAGO A PROVEEDORES OFICINA CENTRAL");
    expect(html).toContain("TES-2026-000001");
    expect(html).toContain("TRX-778899");
    expect(html).toContain(
      "ACCESORIOS PARA COMPUTADORAS Y OFICINAS SA DE CV"
    );
    expect(html).toContain("000-013-01-00083329");
    expect(html).toContain("22/07/2026");
    expect(html).toContain("FG-4100");
    expect(html).toContain("Servicio de mantenimiento");
    expect(html).toContain("L 2,151.01");
    expect(html).toContain("L 100.00");
    expect(html).toContain("L 18.70");
    expect(html).toContain("L 2,032.31");
    expect(html).toContain("Elaborado por.");
    expect(html).toContain("Aprobado por.");
    expect(html).toContain("Autorizado por.");
  });

  it("separa retención ISV, ISR 1% y otras retenciones", () => {
    const payload = reportPayload();
    payload.lines[0].invoice.retentions = [
      {
        description: "Retención ISV",
        percentage: 15,
        amount: 150,
      },
      {
        description: "Retención ISR",
        percentage: 1,
        amount: 10,
      },
      {
        description: "Retención especial",
        percentage: 12.5,
        amount: 125,
      },
    ];

    const html = buildTreasuryPaymentReportHtml(payload);

    expect(html).toContain("Ret. ISV");
    expect(html).toContain("Ret. ISR 1%");
    expect(html).toContain("Otras ret.");
    expect(html).toContain("L 150.00");
    expect(html).toContain("L 10.00");
    expect(html).toContain("L 125.00");
  });

  it("escapa textos de facturas y proveedores antes de imprimir", () => {
    const payload = reportPayload();
    payload.lines[0].invoice.supplierName = "<script>alert(1)</script>";

    const html = buildTreasuryPaymentReportHtml(payload);

    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });
});
