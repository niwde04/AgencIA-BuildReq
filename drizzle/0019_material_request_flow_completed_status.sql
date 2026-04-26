ALTER TYPE "request_status" ADD VALUE IF NOT EXISTS 'flujo_completado';

UPDATE "materialRequests" mr
SET
  "status" = 'flujo_completado',
  "workflowStage" = 'bodega_proyecto',
  "closedAt" = NULL,
  "updatedAt" = now()
WHERE mr."status" IN ('en_proceso', 'cerrada')
  AND EXISTS (
    SELECT 1
    FROM "requestItems" ri
    WHERE ri."requestId" = mr."id"
      AND ri."approvalStatus" <> 'rechazada'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "requestItems" ri
    WHERE ri."requestId" = mr."id"
      AND ri."approvalStatus" <> 'rechazada'
      AND GREATEST(
        COALESCE(ri."deliveredQuantity", 0)::numeric,
        COALESCE(ri."dispatchedQuantity", 0)::numeric
      ) < COALESCE(ri."quantity", 0)::numeric
  )
  AND EXISTS (
    SELECT 1
    FROM "requestItems" ri
    WHERE ri."requestId" = mr."id"
      AND ri."approvalStatus" <> 'rechazada'
      AND COALESCE(ri."dispatchedQuantity", 0)::numeric < COALESCE(ri."quantity", 0)::numeric
  );

UPDATE "materialRequests" mr
SET
  "status" = 'cerrada',
  "workflowStage" = 'cerrada',
  "closedAt" = COALESCE(mr."closedAt", now()),
  "updatedAt" = now()
WHERE mr."status" IN ('en_proceso', 'flujo_completado')
  AND EXISTS (
    SELECT 1
    FROM "requestItems" ri
    WHERE ri."requestId" = mr."id"
      AND ri."approvalStatus" <> 'rechazada'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "requestItems" ri
    WHERE ri."requestId" = mr."id"
      AND ri."approvalStatus" <> 'rechazada'
      AND COALESCE(ri."dispatchedQuantity", 0)::numeric < COALESCE(ri."quantity", 0)::numeric
  );
