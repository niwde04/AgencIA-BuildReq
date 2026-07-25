import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("treasury batch approval settings migration", () => {
  const migration = readFileSync(
    new URL(
      "../drizzle/0124_treasury_batch_approval_settings.sql",
      import.meta.url
    ),
    "utf8"
  );

  it("adds both switches idempotently with approvals disabled by default", () => {
    expect(migration).toContain(
      'ADD COLUMN IF NOT EXISTS "treasuryBatchApprovalsEnabled" boolean DEFAULT false NOT NULL'
    );
    expect(migration).toContain(
      'ADD COLUMN IF NOT EXISTS "approvalBypassed" boolean DEFAULT false NOT NULL'
    );
  });

  it("moves only review and approval batches directly to bank-ready state", () => {
    expect(migration).toContain(
      "batch.\"status\" IN ('enviado_depuracion', 'pendiente_aprobacion')"
    );
    expect(migration).toContain("\"status\" = 'aprobada'");
    expect(migration).toContain('"approvedAmount" = item."requestedAmount"');
    expect(migration).toContain("\"status\" = 'aprobado'");
    expect(migration).toContain('"approvalBypassed" = true');
    expect(migration).not.toContain("'borrador', 'devuelto'");
    expect(migration).not.toContain("'rechazado'");
  });

  it("records why approval was bypassed", () => {
    expect(migration).toContain("'omitir_aprobacion_configuracion'");
    expect(migration).toContain("'treasury_batch_approvals_disabled'");
    expect(migration).toContain('"treasuryPaymentEvents"');
  });
});
