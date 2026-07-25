ALTER TABLE "systemSettings"
  ADD COLUMN IF NOT EXISTS "treasuryBatchApprovalsEnabled" boolean DEFAULT false NOT NULL;

ALTER TABLE "treasuryPaymentBatches"
  ADD COLUMN IF NOT EXISTS "approvalBypassed" boolean DEFAULT false NOT NULL;

DO $$
BEGIN
  UPDATE "treasuryPaymentItems" AS item
  SET
    "status" = 'aprobada',
    "approvedAmount" = item."requestedAmount",
    "updatedAt" = now()
  FROM "treasuryPaymentBatches" AS batch
  WHERE item."batchId" = batch."id"
    AND batch."status" IN ('enviado_depuracion', 'pendiente_aprobacion')
    AND item."activeReservation" = true
    AND item."status" <> 'excluida'
    AND COALESCE(
      (SELECT settings."treasuryBatchApprovalsEnabled"
       FROM "systemSettings" AS settings
       WHERE settings."id" = 1),
      false
    ) = false;

  INSERT INTO "treasuryPaymentEvents" (
    "batchId",
    "action",
    "previousStatus",
    "newStatus",
    "actorUserId",
    "actorName",
    "actorRole",
    "metadata"
  )
  SELECT
    batch."id",
    'omitir_aprobacion_configuracion',
    batch."status"::text,
    'aprobado',
    actor."id",
    COALESCE(NULLIF(BTRIM(actor."name"), ''), 'Usuario ' || actor."id"),
    CASE
      WHEN actor."role" = 'admin' THEN 'admin'
      ELSE COALESCE(actor."buildreqRole"::text, 'sin_rol')
    END,
    jsonb_build_object(
      'reason', 'treasury_batch_approvals_disabled',
      'source', 'migration'
    )
  FROM "treasuryPaymentBatches" AS batch
  JOIN "users" AS actor
    ON actor."id" = COALESCE(
      (SELECT settings."updatedByUserId"
       FROM "systemSettings" AS settings
       WHERE settings."id" = 1),
      batch."createdById"
    )
  WHERE batch."status" IN ('enviado_depuracion', 'pendiente_aprobacion')
    AND COALESCE(
      (SELECT settings."treasuryBatchApprovalsEnabled"
       FROM "systemSettings" AS settings
       WHERE settings."id" = 1),
      false
    ) = false;

  UPDATE "treasuryPaymentBatches"
  SET
    "status" = 'aprobado',
    "approvalBypassed" = true,
    "approvedById" = NULL,
    "approvedAt" = COALESCE("approvedAt", now()),
    "updatedAt" = now()
  WHERE "status" IN ('enviado_depuracion', 'pendiente_aprobacion')
    AND COALESCE(
      (SELECT settings."treasuryBatchApprovalsEnabled"
       FROM "systemSettings" AS settings
       WHERE settings."id" = 1),
      false
    ) = false;
END $$;
