import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  buildInvoiceAdvanceBalance,
  buildTreasuryMoneySummary,
  getTreasuryBatchStatusLabel,
  getTreasuryPaymentStatus,
  matchesTreasuryBatchSearch,
  roundTreasuryMoney,
} from "../shared/treasury";
import {
  assertTreasuryBatchCanBeCancelled,
  assertTreasuryBatchesCanBeConsolidated,
  buildTreasuryFullPaymentRows,
  getTreasuryApprovalRouting,
  getTreasuryBatchPaymentRegistrationDate,
  getTreasuryBusinessDate,
  getTreasuryConsolidationRouting,
  getTreasuryReopenTargetStatus,
  parseTreasuryBankWorkbook,
  prepareTreasuryBankAttachment,
  resolveTreasuryPaymentReportAmount,
  resolveTreasuryPaymentSignatures,
  resolveTreasurySettingsUpdate,
  TreasuryRuleError,
} from "./treasury";

describe("treasury batch payment registration date", () => {
  it("returns the latest registered payment date in the batch", () => {
    const result = getTreasuryBatchPaymentRegistrationDate([
      { bankPaidDate: "2026-08-02" },
      { bankPaidDate: null },
      { bankPaidDate: new Date("2026-08-04T00:00:00.000Z") },
      { bankPaidDate: "invalid" },
    ]);

    expect(result?.toISOString().slice(0, 10)).toBe("2026-08-04");
  });

  it("returns null while the batch has no registered payment", () => {
    expect(
      getTreasuryBatchPaymentRegistrationDate([
        { bankPaidDate: null },
        { bankPaidDate: undefined },
      ])
    ).toBeNull();
  });
});

describe("treasury batch search", () => {
  const searchableBatch = {
    values: ["TES-2026-000163", "017", "CA-4 Ocotepeque - El Portillo"],
    invoiceDocumentNumbers: ["FT-017-00000054"],
    invoiceNumbers: ["000-001-01-00258451"],
  };

  it.each([
    "TES-2026-000163",
    "Ocotepeque",
    "FT-017-00000054",
    "FT-017-000000054",
    "000-001-01-00258451",
    "258451",
  ])("finds a batch with search term %s", search => {
    expect(matchesTreasuryBatchSearch({ search, ...searchableBatch })).toBe(
      true
    );
  });

  it("does not match an unrelated invoice", () => {
    expect(
      matchesTreasuryBatchSearch({
        search: "FT-017-99999999",
        ...searchableBatch,
      })
    ).toBe(false);
  });
});

describe("invoice advance balance preview", () => {
  it("shows an accounted supplier advance on a draft invoice balance", () => {
    expect(
      buildInvoiceAdvanceBalance({
        invoiceStatus: "borrador",
        netPayable: 52070.54,
        appliedAdvanceAmount: 0,
        availableAccountedAdvanceAmount: 2070.54,
      })
    ).toEqual({
      actualAppliedAmount: 0,
      pendingApplicationAmount: 2070.54,
      displayedAppliedAmount: 2070.54,
      balanceAfterAdvance: 50000,
      isPendingApplication: true,
    });
  });

  it("does not preview an unapplied amount on a voided invoice", () => {
    expect(
      buildInvoiceAdvanceBalance({
        invoiceStatus: "anulada",
        netPayable: 52070.54,
        availableAccountedAdvanceAmount: 2070.54,
      })
    ).toMatchObject({
      displayedAppliedAmount: 0,
      balanceAfterAdvance: 52070.54,
      isPendingApplication: false,
    });
  });
});

describe("treasury batch cancellation", () => {
  it("allows cancelling a batch sent to the bank before a response is registered", () => {
    expect(() =>
      assertTreasuryBatchCanBeCancelled("enviado_banco", [
        {
          status: "aprobada",
          bankPaidAmount: null,
          bankPaidDate: null,
          bankReference: null,
        },
      ])
    ).not.toThrow();
  });

  it("blocks cancellation after any bank response or payment is registered", () => {
    expect(() =>
      assertTreasuryBatchCanBeCancelled("pendiente_contabilizacion", [
        {
          status: "pagada",
          bankPaidAmount: "1399.9985",
          bankPaidDate: "2026-07-27",
          bankReference: "REF-001",
        },
      ])
    ).toThrow("ya tiene una respuesta o pago bancario registrado");

    expect(() =>
      assertTreasuryBatchCanBeCancelled("enviado_banco", [
        {
          status: "aprobada",
          bankPaidAmount: "1399.9985",
          bankReference: "REF-001",
        },
      ])
    ).toThrow("ya tiene una respuesta o pago bancario registrado");
  });
});

describe("treasury payment report signatures", () => {
  it("maps each workflow participant to the corresponding signature", () => {
    expect(
      resolveTreasuryPaymentSignatures([
        { action: "registrar_pago_banco", actorName: "Ana Autorizadora" },
        { action: "aprobar_lote", actorName: "Carlos Aprobador" },
        { action: "enviar_aprobacion", actorName: "Rosa Revisora" },
        { action: "crear_lote", actorName: "María Elaboradora" },
      ])
    ).toEqual({
      preparedBy: "María Elaboradora",
      reviewedBy: "Rosa Revisora",
      approvedBy: "Carlos Aprobador",
    });
  });

  it("uses the submitter as approver when approvals were bypassed", () => {
    expect(
      resolveTreasuryPaymentSignatures([
        { action: "registrar_pago_banco", actorName: "Ana Autorizadora" },
        { action: "enviar_sin_aprobacion", actorName: "César Administrador" },
        { action: "crear_lote", actorName: "César Administrador" },
      ]).approvedBy
    ).toBe("César Administrador");
  });
});

describe("treasury payment report amounts", () => {
  it("uses the requested amount immediately after creating the batch", () => {
    expect(
      resolveTreasuryPaymentReportAmount({
        requestedAmount: "600.0010",
      })
    ).toBe(600);
  });

  it("prefers the approved amount before the bank payment", () => {
    expect(
      resolveTreasuryPaymentReportAmount({
        requestedAmount: "600.00",
        approvedAmount: "550.25",
      })
    ).toBe(550.25);
  });

  it("prefers the registered bank payment over previous amounts", () => {
    expect(
      resolveTreasuryPaymentReportAmount({
        requestedAmount: "600.00",
        approvedAmount: "550.25",
        bankPaidAmount: "525.10",
      })
    ).toBe(525.1);
  });
});

function bankWorkbook(rows: Array<Record<string, unknown>>) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(rows),
    "Pagos"
  );
  return Buffer.from(
    XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer
  );
}

describe("treasury partial-payment math", () => {
  it("keeps the whole invoice available before the first payment", () => {
    expect(
      buildTreasuryMoneySummary({
        currency: "HNL",
        invoiceNetPayable: "1250.5000",
      })
    ).toEqual({
      currency: "HNL",
      invoiceNetPayable: 1250.5,
      appliedAdvanceAmount: 0,
      payableAfterAdvance: 1250.5,
      paidAmount: 0,
      reservedAmount: 0,
      availableAmount: 1250.5,
      paymentStatus: "sin_pago",
    });
  });

  it("subtracts prior payments and an active reservation from the available balance", () => {
    expect(
      buildTreasuryMoneySummary({
        currency: "USD",
        invoiceNetPayable: 1000,
        paidAmount: 325.25,
        reservedAmount: 125.5,
      })
    ).toMatchObject({
      paidAmount: 325.25,
      reservedAmount: 125.5,
      availableAmount: 549.25,
      paymentStatus: "parcialmente_pagada",
    });
  });

  it("subtracts applied advances separately from prior invoice payments", () => {
    expect(
      buildTreasuryMoneySummary({
        currency: "HNL",
        invoiceNetPayable: 1000,
        appliedAdvanceAmount: 300,
        paidAmount: 125,
        reservedAmount: 75,
      })
    ).toMatchObject({
      invoiceNetPayable: 1000,
      appliedAdvanceAmount: 300,
      payableAfterAdvance: 700,
      paidAmount: 125,
      reservedAmount: 75,
      availableAmount: 500,
      paymentStatus: "parcialmente_pagada",
    });
  });

  it("never exposes a negative balance after the invoice is fully paid", () => {
    expect(
      buildTreasuryMoneySummary({
        currency: "HNL",
        invoiceNetPayable: 500,
        paidAmount: 500,
        reservedAmount: 25,
      })
    ).toMatchObject({ availableAmount: 0, paymentStatus: "pagada" });
  });

  it("uses two-decimal currency precision for invoices and payments", () => {
    expect(roundTreasuryMoney(10.123456)).toBe(10.12);
    expect(roundTreasuryMoney(10.125)).toBe(10.13);
    expect(roundTreasuryMoney(600.001)).toBe(600);
    expect(
      buildTreasuryMoneySummary({
        currency: "HNL",
        invoiceNetPayable: "600.0010",
      })
    ).toMatchObject({
      invoiceNetPayable: 600,
      availableAmount: 600,
    });
    expect(getTreasuryPaymentStatus(100, 99.9999)).toBe("pagada");
    expect(getTreasuryPaymentStatus(100, 99.99)).toBe("parcialmente_pagada");
  });
});

describe("treasury approval-bypass labels", () => {
  it("labels only bypassed approved batches as ready for bank", () => {
    expect(getTreasuryBatchStatusLabel("aprobado", true)).toBe(
      "Listo para banco"
    );
    expect(getTreasuryBatchStatusLabel("aprobado", false)).toBe("Aprobado");
    expect(getTreasuryBatchStatusLabel("enviado_banco", true)).toBe(
      "Enviado al banco"
    );
  });
});

describe("treasury approval routing", () => {
  it("sends submitted and reopened batches directly to bank when approvals are disabled", () => {
    expect(getTreasuryApprovalRouting(false)).toEqual({
      approvalBypassed: true,
      submissionStatus: "aprobado",
      rejectedReopenStatus: "aprobado",
      activeItemStatus: "aprobada",
    });
  });

  it("preserves the complete review and approval flow when enabled", () => {
    expect(getTreasuryApprovalRouting(true)).toEqual({
      approvalBypassed: false,
      submissionStatus: "enviado_depuracion",
      rejectedReopenStatus: "pendiente_aprobacion",
      activeItemStatus: "incluida",
    });
  });

  it("requires Financiero only when an enabled flow will use approvals", () => {
    expect(
      resolveTreasurySettingsUpdate(
        {
          treasuryEnabled: false,
          treasuryBatchApprovalsEnabled: false,
        },
        { treasuryEnabled: true }
      )
    ).toMatchObject({
      treasuryEnabled: true,
      treasuryBatchApprovalsEnabled: false,
      requiresFinancialRole: false,
    });

    expect(
      resolveTreasurySettingsUpdate(
        {
          treasuryEnabled: true,
          treasuryBatchApprovalsEnabled: false,
        },
        { treasuryBatchApprovalsEnabled: true }
      ).requiresFinancialRole
    ).toBe(true);

    expect(
      resolveTreasurySettingsUpdate(
        {
          treasuryEnabled: false,
          treasuryBatchApprovalsEnabled: true,
        },
        { treasuryEnabled: true }
      ).requiresFinancialRole
    ).toBe(true);
  });
});

describe("treasury consolidation routing", () => {
  it("creates a bank-ready consolidated batch when approvals are disabled", () => {
    expect(getTreasuryConsolidationRouting(false)).toEqual({
      approvalBypassed: true,
      consolidatableStatuses: ["aprobado"],
      consolidatedStatus: "aprobado",
      consolidatedItemStatus: "aprobada",
    });
  });

  it("keeps the approval flow when approvals are enabled", () => {
    expect(getTreasuryConsolidationRouting(true)).toEqual({
      approvalBypassed: false,
      consolidatableStatuses: [
        "enviado_depuracion",
        "pendiente_aprobacion",
      ],
      consolidatedStatus: "pendiente_aprobacion",
      consolidatedItemStatus: "incluida",
    });
  });

  it.each([
    {
      approvalsEnabled: true,
      status: "enviado_depuracion" as const,
    },
    {
      approvalsEnabled: false,
      status: "aprobado" as const,
    },
  ])(
    "allows different projects and dates when approvalsEnabled is $approvalsEnabled",
    ({ approvalsEnabled, status }) => {
      expect(() =>
        assertTreasuryBatchesCanBeConsolidated(
          [
            {
              batchNumber: "TES-2026-000040",
              projectId: 1,
              currency: "HNL",
              requestedPaymentDate: "2026-07-31",
              status,
            },
            {
              batchNumber: "TES-2026-000041",
              projectId: 17,
              currency: "HNL",
              requestedPaymentDate: "2026-08-05",
              status,
            },
          ],
          approvalsEnabled
        )
      ).not.toThrow();
    }
  );

  it("uses the Tegucigalpa calendar date when the consolidation is created", () => {
    expect(
      getTreasuryBusinessDate(new Date("2026-07-29T03:00:00.000Z"))
        .toISOString()
        .slice(0, 10)
    ).toBe("2026-07-28");
    expect(
      getTreasuryBusinessDate(new Date("2026-07-29T15:00:00.000Z"))
        .toISOString()
        .slice(0, 10)
    ).toBe("2026-07-29");
  });
});

describe("treasury bank workbook", () => {
  it("parses paid and rejected lines from the bank response", () => {
    const rows = parseTreasuryBankWorkbook(
      bankWorkbook([
        {
          LOTE: "TES-2026-000001",
          VERSION: 2,
          LINEA_ID: 10,
          ESTADO_BANCO: "PAGADO",
          MONTO_PAGADO: 250.125,
          FECHA_PAGO: "2026-07-20",
          REFERENCIA_BANCO: "REF-100",
          COMENTARIO_BANCO: "Aplicado",
        },
        {
          LOTE: "TES-2026-000001",
          VERSION: 2,
          LINEA_ID: 11,
          ESTADO_BANCO: "RECHAZADO",
          MONTO_PAGADO: "",
          FECHA_PAGO: "",
          REFERENCIA_BANCO: "",
          COMENTARIO_BANCO: "Cuenta inválida",
        },
      ])
    );

    expect(rows[0]).toMatchObject({
      itemId: 10,
      bankStatus: "PAGADO",
      paidAmount: 250.13,
      bankReference: "REF-100",
    });
    expect(rows[0]?.paidDate).toBeInstanceOf(Date);
    expect(rows[1]).toMatchObject({
      itemId: 11,
      bankStatus: "RECHAZADO",
      paidAmount: 0,
      paidDate: null,
    });
  });

  it("rejects an unknown bank status", () => {
    expect(() =>
      parseTreasuryBankWorkbook(
        bankWorkbook([
          {
            LOTE: "TES-2026-000001",
            VERSION: 1,
            LINEA_ID: 10,
            ESTADO_BANCO: "PENDIENTE",
          },
        ])
      )
    ).toThrow(TreasuryRuleError);
  });
});

describe("treasury closed batch reopening", () => {
  it("returns a fully rejected closed batch to the bank-response stage", () => {
    expect(
      getTreasuryReopenTargetStatus("cerrado", ["rechazada_banco", "excluida"])
    ).toBe("enviado_banco");
  });

  it("does not reopen a batch with paid or accounted lines", () => {
    expect(() =>
      getTreasuryReopenTargetStatus("cerrado", [
        "rechazada_banco",
        "contabilizada",
      ])
    ).toThrow("tiene pagos realizados o contabilizados");
  });

  it("does not reopen a batch that is not closed", () => {
    expect(() =>
      getTreasuryReopenTargetStatus("enviado_banco", ["rechazada_banco"])
    ).toThrow("Solo se puede reabrir un lote cerrado");
  });
});

describe("treasury bank response attachments", () => {
  it("accepts a supported bank attachment", () => {
    const result = prepareTreasuryBankAttachment({
      fileName: "respuesta-banco.pdf",
      mimeType: "application/pdf",
      base64: Buffer.from("%PDF-1.7").toString("base64"),
    });

    expect(result.fileName).toBe("respuesta-banco.pdf");
    expect(result.mimeType).toBe("application/pdf");
    expect(result.buffer.byteLength).toBeGreaterThan(0);
  });

  it("rejects unsupported bank attachments", () => {
    expect(() =>
      prepareTreasuryBankAttachment({
        fileName: "respuesta.exe",
        mimeType: "application/octet-stream",
        base64: Buffer.from("invalid").toString("base64"),
      })
    ).toThrow("El adjunto debe ser PDF");
  });
});

describe("treasury full batch payment", () => {
  it("marks every approved line as fully paid with one batch reference", () => {
    const paidDate = new Date("2026-07-21T00:00:00.000Z");
    const rows = buildTreasuryFullPaymentRows({
      batch: { batchNumber: "TES-2026-000006", version: 1 },
      bankReference: "REF-LOTE-100",
      paidDate,
      items: [
        {
          id: 10,
          status: "aprobada",
          approvedAmount: "3844.4900",
          requestedAmount: "3844.4900",
        },
        {
          id: 11,
          status: "aprobada",
          approvedAmount: "224016.8000",
          requestedAmount: "224016.8000",
        },
        {
          id: 12,
          status: "excluida",
          requestedAmount: "100.0000",
        },
      ],
    });

    expect(rows).toHaveLength(2);
    expect(rows.map(row => row.paidAmount)).toEqual([3844.49, 224016.8]);
    expect(rows.every(row => row.bankStatus === "PAGADO")).toBe(true);
    expect(rows.every(row => row.bankReference === "REF-LOTE-100")).toBe(true);
    expect(rows.every(row => row.paidDate === paidDate)).toBe(true);
  });

  it("rounds legacy four-decimal approved amounts to invoice cents", () => {
    const rows = buildTreasuryFullPaymentRows({
      batch: { batchNumber: "TES-2026-000006", version: 1 },
      bankReference: "REF-CENTAVOS",
      paidDate: new Date("2026-07-21T00:00:00.000Z"),
      items: [
        {
          id: 10,
          status: "aprobada",
          approvedAmount: "600.0010",
          requestedAmount: "600.0010",
        },
      ],
    });

    expect(rows[0]?.paidAmount).toBe(600);
  });

  it("requires one bank reference for the whole batch", () => {
    expect(() =>
      buildTreasuryFullPaymentRows({
        batch: { batchNumber: "TES-2026-000006", version: 1 },
        bankReference: "  ",
        paidDate: new Date(),
        items: [
          {
            id: 10,
            status: "aprobada",
            approvedAmount: "10.0000",
            requestedAmount: "10.0000",
          },
        ],
      })
    ).toThrow("Ingrese la referencia bancaria del lote");
  });
});
