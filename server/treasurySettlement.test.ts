import { afterEach, describe, expect, it, vi } from "vitest";
import * as db from "./db";
import * as contractual from "./contractualAdvances";
import * as advances from "./purchaseOrderAdvances";
import * as settlement from "./invoiceSettlement";
import { getQualityRetentionReleaseSnapshots } from "./qualityRetentionReleases";
import { getTreasuryBatchById, updateTreasuryDraft } from "./treasury";
import type { InvoiceSettlementPolicy } from "../shared/invoice-settlement";

afterEach(() => vi.restoreAllMocks());

function queuedExecutor(results: unknown[][]) {
  const pending = [...results];
  const writes: Array<{ kind: string; value: any }> = [];
  const executor = {
    select: vi.fn(() => {
      if (!pending.length) throw new Error("Unexpected database read");
      const rows = pending.shift()!;
      const chain: any = new Proxy(
        {},
        {
          get(_target, property) {
            if (property === "then")
              return Promise.resolve(rows).then.bind(Promise.resolve(rows));
            return () => chain;
          },
        }
      );
      return chain;
    }),
    execute: vi.fn(async () => ({ rows: [] })),
    insert: vi.fn(() => ({
      values: vi.fn((value: any) => {
        writes.push({ kind: "insert", value });
        return { returning: async () => [{ id: 900, ...value }] };
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn((value: any) => {
        writes.push({ kind: "update", value });
        return {
          where: () => ({
            returning: async () => [{ id: 70, status: "borrador" }],
          }),
        };
      }),
    })),
  };
  return { executor, pending, writes };
}

function settlementValue(policy: InvoiceSettlementPolicy) {
  return {
    policy,
    amount: policy === "document_cents_v1" ? 43119.16 : 43119.17,
    originalNetPayable: 43119.165,
    difference: policy === "document_cents_v1" ? -0.01 : 0,
  };
}

describe("Treasury settlement integration", () => {
  it.each(["43119.1650", "43119.17", null])(
    "preserves existing draft snapshots (%s) and captures document cents for new lines",
    async existingSnapshot => {
      const invoice = {
        id: 2538,
        purchaseOrderId: 165,
        projectId: 23,
        currency: "USD",
        status: "registrada",
        invoiceDocumentNumber: "FT-023-00000164",
        invoiceNumber: "001-002-00000077",
        netPayable: "43119.1650",
      };
      const { executor, pending, writes } = queuedExecutor([
        [
          {
            id: 70,
            status: "borrador",
            paymentKind: "invoice",
            projectId: 23,
            currency: "USD",
          },
        ],
        [{ purchaseOrderId: 165 }],
        [
          {
            invoice,
            supplier: { id: 37, supplierCode: "SUP-TEST", name: "Supplier" },
          },
        ],
        [invoice],
        [],
        [],
        existingSnapshot === null
          ? []
          : [
              {
                id: 700,
                invoiceId: 2538,
                sourceType: "invoice",
                invoiceNetPayable: existingSnapshot,
              },
            ],
      ]);
      const database = {
        ...executor,
        transaction: async (action: any) => action(executor),
      };
      vi.spyOn(db, "getDb").mockResolvedValue(database as any);
      vi.spyOn(contractual, "lockAdvanceOrder").mockResolvedValue(undefined);
      vi.spyOn(
        contractual,
        "getInvoiceAdvanceReconciliationMap"
      ).mockResolvedValue(new Map());
      vi.spyOn(
        contractual,
        "getInvoiceContractualAmortizationMap"
      ).mockResolvedValue(new Map());
      vi.spyOn(advances, "getInvoiceAppliedAdvanceMap").mockResolvedValue(
        new Map()
      );
      vi.spyOn(
        advances,
        "getPurchaseOrderAdvanceBlockingSet"
      ).mockResolvedValue(new Set());
      vi.spyOn(settlement, "getInvoiceSettlementMap").mockResolvedValue(
        new Map([[2538, settlementValue("document_cents_v1")]])
      );

      await updateTreasuryDraft({
        batchId: 70,
        actor: { id: 1, role: "admin" },
        requestedPaymentDate: new Date("2026-10-30T12:00:00Z"),
        items: [{ invoiceId: 2538, requestedAmount: 43119.16 }],
      });

      const paymentWrite = writes.find(
        write => "invoiceNetPayable" in write.value
      );
      expect(paymentWrite).toMatchObject({
        kind: existingSnapshot === null ? "insert" : "update",
        value: {
          invoiceNetPayable: existingSnapshot ?? 43119.16,
          requestedAmount: "43119.16",
        },
      });
      expect(pending).toHaveLength(0);
    }
  );

  it.each(["43119.16", "43119.17"])(
    "preserves a batch's agreed payable %s when its invoice later changes",
    async agreedPayable => {
      const item = {
        id: 700,
        batchId: 70,
        sourceType: "invoice",
        invoiceId: 2538,
        invoiceNetPayable: agreedPayable,
      };
      const { executor, pending } = queuedExecutor([
        [{ batch: { id: 70 }, project: { id: 23, code: "023" } }],
        [item],
        [],
        [],
        [
          {
            invoiceId: 2538,
            invoiceProjectId: 23,
            invoiceProjectCode: "023",
            invoiceProjectName: "Carretera Ojo de Agua",
            invoiceNetPayable: "43019.1650",
          },
        ],
        [],
        [],
      ]);
      vi.spyOn(db, "getDb").mockResolvedValue(executor as any);
      vi.spyOn(db, "getAttachmentsByEntity").mockResolvedValue([]);

      const detail = await getTreasuryBatchById(70);

      expect(detail?.items[0]).toMatchObject({
        invoiceNetPayable: agreedPayable,
        invoiceNetPayableSnapshot: agreedPayable,
        invoiceNetPayableOriginal: "43019.1650",
      });
      expect(pending).toHaveLength(0);
    }
  );

  it.each([
    ["document_cents_v1", 43119.16, true],
    ["legacy", 43119.16, false],
    ["legacy", 43119.17, true],
  ] as const)(
    "checks quality eligibility against %s without changing the quality release amount",
    async (policy, paidAmount, isPaid) => {
      const { executor, pending } = queuedExecutor([
        [
          {
            release: { id: 71, approvedAmount: "10.1234" },
            adjustment: { id: 72, amount: "10.1234" },
            invoice: { id: 2538 },
            project: { id: 23 },
          },
        ],
        [],
        [{ id: 2538, netPayable: "43119.1650", purchaseOrderId: 165 }],
        [{ invoiceId: 2538, bankPaidAmount: paidAmount.toFixed(2) }],
        [],
      ]);
      vi.spyOn(
        advances,
        "getPurchaseOrderAdvanceBlockingSet"
      ).mockResolvedValue(new Set());
      vi.spyOn(settlement, "getInvoiceSettlementMap").mockResolvedValue(
        new Map([[2538, settlementValue(policy)]])
      );

      const [release] = await getQualityRetentionReleaseSnapshots(executor, [
        71,
      ]);

      expect(release.ordinaryPayment).toMatchObject({ isPaid });
      expect(release.money.approvedAmount).toBe(10.1234);
      expect(release.money.availableAmount).toBe(10.1234);
      expect(pending).toHaveLength(0);
    }
  );

  it.each([
    ["document_cents_v1", "direct", 43119.16],
    ["legacy", "direct", 43119.17],
    ["document_cents_v1", "legacy_manual", 103.77],
    ["document_cents_v1", "contractual", 103.77],
  ] as const)(
    "uses %s for direct advances and preserves %s consumption snapshots",
    async (policy, applicationMode, expectedAmount) => {
      const advance = {
        id: 136,
        supplierId: 37,
        projectId: 23,
        currency: "USD",
        requestedAmount: "50000.0000",
        applicationMode,
      };
      const { executor, pending } = queuedExecutor([
        [advance],
        [
          {
            id: 2538,
            purchaseOrderId: 165,
            supplierId: 37,
            projectId: 23,
            currency: "USD",
            netPayable: "43119.1650",
          },
        ],
        [advance],
        [
          {
            purchaseOrderAdvanceId: 136,
            status: "contabilizada",
            bankPaidAmount: "50000.00",
          },
        ],
        [],
        [],
        [],
        [],
        applicationMode === "direct"
          ? []
          : [
              {
                invoiceId: 2538,
                amount: "103.7650",
                treatment: applicationMode,
                invoiceDocumentAdjustmentId: 73,
              },
            ],
      ]);
      vi.spyOn(contractual, "lockAdvanceOrder").mockResolvedValue(undefined);
      vi.spyOn(
        contractual,
        "getInvoiceAdvanceReconciliationMap"
      ).mockResolvedValue(new Map());
      vi.spyOn(settlement, "getInvoiceSettlementMap").mockResolvedValue(
        new Map([[2538, settlementValue(policy)]])
      );

      const allocations = await advances.applyAvailableAdvancesForPurchaseOrder(
        {
          executor: executor as any,
          purchaseOrderId: 165,
          actorId: 1,
        }
      );

      expect(allocations).toEqual([
        {
          purchaseOrderAdvanceId: 136,
          invoiceId: 2538,
          amount: expectedAmount,
        },
      ]);
      expect(pending).toHaveLength(0);
    }
  );
});
