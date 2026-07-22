import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("procurement approvals migration", () => {
  it("adds approval roles, states, history, and open-document backfills", () => {
    const sql = readFileSync(
      new URL("../drizzle/0110_procurement_approvals.sql", import.meta.url),
      "utf8"
    );
    const statements = sql
      .split(";")
      .map(statement => statement.trim())
      .filter(Boolean);

    for (const role of ["superintendente_aprobador", "gerente"]) {
      expect(sql).toContain(
        `ALTER TYPE "buildreq_role" ADD VALUE IF NOT EXISTS '${role}'`
      );
    }

    for (const status of ["pendiente_aprobacion", "aprobada", "rechazada"]) {
      expect(sql).toContain(
        `ALTER TYPE "purchase_order_status" ADD VALUE IF NOT EXISTS '${status}'`
      );
    }

    for (const table of ["purchaseRequests", "purchaseOrders"]) {
      const approvalColumnStatement = statements.find(
        statement =>
          statement.startsWith(`ALTER TABLE "${table}"`) &&
          statement.includes(
            'ADD COLUMN IF NOT EXISTS "approvalStatus" "approval_status"'
          )
      );
      expect(approvalColumnStatement).toBeDefined();
    }

    expect(sql).toContain(
      'CREATE TABLE IF NOT EXISTS "procurementApprovalHistory"'
    );
    for (const column of [
      "documentType",
      "documentId",
      "action",
      "previousStatus",
      "newStatus",
      "actorUserId",
      "actorName",
      "actorRole",
      "comment",
      "amount",
      "currency",
      "createdAt",
    ]) {
      expect(sql).toContain(`"${column}"`);
    }
    expect(sql).toContain('"proc_approval_document_date_idx"');
    expect(sql).toContain('"proc_approval_actor_idx"');
    expect(sql).toContain(
      'REVOKE ALL ON TABLE "procurementApprovalHistory" FROM authenticated'
    );

    const legacyRejectedBackfill = statements.find(
      statement =>
        statement.includes('UPDATE "purchaseRequests"') &&
        statement.includes("\"status\" = 'anulada'") &&
        statement.includes("WHERE \"status\" = 'rechazada'")
    );
    expect(legacyRejectedBackfill).toContain(
      "\"approvalStatus\" = 'no_requiere'"
    );

    const openRequestBackfill = statements.find(
      statement =>
        statement.includes('UPDATE "purchaseRequests"') &&
        statement.includes("\"status\" = 'pendiente'") &&
        statement.includes("WHERE \"status\" NOT IN ('convertida', 'anulada')")
    );
    expect(openRequestBackfill).toContain('"approvalStatus" = NULL');

    const finalizedOrderBackfill = statements.find(
      statement =>
        statement.includes('UPDATE "purchaseOrders"') &&
        statement.includes("\"approvalStatus\" = 'no_requiere'")
    );
    for (const status of [
      "emitida",
      "enviada",
      "parcialmente_recibida",
      "recibida",
      "anulada",
    ]) {
      expect(finalizedOrderBackfill).toContain(`'${status}'`);
    }

    const draftOrderBackfill = statements.find(
      statement =>
        statement.includes('UPDATE "purchaseOrders"') &&
        statement.includes('"approvalStatus" = NULL')
    );
    expect(draftOrderBackfill).toContain("WHERE \"status\" = 'borrador'");
  });

  it("reopens only pending or rejected documents during the temporary pause", () => {
    const sql = readFileSync(
      new URL(
        "../drizzle/0111_temporarily_disable_procurement_approvals.sql",
        import.meta.url
      ),
      "utf8"
    );

    expect(sql).toContain('UPDATE "purchaseRequests"');
    expect(sql).toContain(
      "\"status\" = 'en_revision' AND \"approvalStatus\" = 'pendiente'"
    );
    expect(sql).toContain(
      "\"status\" = 'rechazada' AND \"approvalStatus\" = 'rechazada'"
    );
    expect(sql).toContain('UPDATE "purchaseOrders"');
    expect(sql).toContain(
      "\"status\" = 'pendiente_aprobacion' AND \"approvalStatus\" = 'pendiente'"
    );
    expect(sql).not.toContain("\"status\" = 'aprobada'");
    expect(sql).not.toContain('DELETE FROM "procurementApprovalHistory"');
  });

  it("adds and backfills approval state for purchase request items", () => {
    const sql = readFileSync(
      new URL(
        "../drizzle/0114_purchase_request_item_approvals.sql",
        import.meta.url
      ),
      "utf8"
    );

    for (const column of [
      "approvalStatus",
      "approvedById",
      "approvedAt",
      "rejectionReason",
    ]) {
      expect(sql).toContain(`ADD COLUMN IF NOT EXISTS "${column}"`);
    }
    expect(sql).toContain('FROM "purchaseRequests" AS request');
    expect(sql).toContain(
      "WHEN request.\"approvalStatus\" = 'aprobada' THEN 'aprobada'"
    );
    expect(sql).toContain(
      "WHEN request.\"approvalStatus\" = 'rechazada' THEN 'rechazada'"
    );
    expect(sql).toContain(
      'CREATE INDEX IF NOT EXISTS "pri_approval_status_idx"'
    );
  });

  it("adds configurable nonnegative purchase order approval amounts", () => {
    const sql = readFileSync(
      new URL(
        "../drizzle/0119_purchase_order_approval_amounts.sql",
        import.meta.url
      ),
      "utf8"
    );

    expect(sql).toContain(
      'ADD COLUMN IF NOT EXISTS "purchaseOrderApprovalMinimumHnl" numeric(18, 2)'
    );
    expect(sql).toContain(
      'ADD COLUMN IF NOT EXISTS "purchaseOrderApprovalMinimumUsd" numeric(18, 2)'
    );
    expect(sql).toContain(
      '"purchaseOrderApprovalMinimumHnl" SET DEFAULT 250000.00'
    );
    expect(sql).toContain(
      '"purchaseOrderApprovalMinimumUsd" SET DEFAULT 10000.00'
    );
    expect(sql).toContain('CHECK ("purchaseOrderApprovalMinimumHnl" >= 0)');
    expect(sql).toContain('CHECK ("purchaseOrderApprovalMinimumUsd" >= 0)');
    expect(sql).not.toContain('UPDATE "purchaseOrders"');
  });
});
