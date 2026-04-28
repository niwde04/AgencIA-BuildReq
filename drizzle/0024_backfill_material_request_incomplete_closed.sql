UPDATE "requestItems" AS ri
SET
  "status" = 'completo',
  "updatedAt" = NOW()
WHERE
  ri."status" <> 'completo'
  AND COALESCE(
    (
      SELECT SUM(
        LEAST(
          tri."quantity",
          COALESCE(tri."receivedQuantity", 0) +
            COALESCE(tri."returnedToOriginQuantity", 0)
        )
      )
      FROM "transferRequestItems" AS tri
      WHERE
        tri."materialRequestItemId" = ri."id"
        AND (
          tri."receiptClosed" = TRUE
          OR COALESCE(tri."returnedToOriginQuantity", 0) > 0
        )
    ),
    0
  ) >= ri."quantity";

UPDATE "materialRequests" AS mr
SET
  "status" = 'cerrada_incompleta',
  "workflowStage" = 'cerrada',
  "closedAt" = COALESCE(mr."closedAt", NOW()),
  "updatedAt" = NOW()
WHERE
  mr."status" IN ('en_proceso', 'flujo_completado')
  AND EXISTS (
    SELECT 1
    FROM "requestItems" AS ri
    INNER JOIN "transferRequestItems" AS tri
      ON tri."materialRequestItemId" = ri."id"
    WHERE
      ri."requestId" = mr."id"
      AND COALESCE(tri."returnedToOriginQuantity", 0) > 0
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "requestItems" AS ri
    WHERE
      ri."requestId" = mr."id"
      AND ri."approvalStatus" <> 'rechazada'
      AND NOT (
        COALESCE(ri."dispatchedQuantity", 0) >= ri."quantity"
        OR COALESCE(
          (
            SELECT SUM(
              LEAST(
                tri."quantity",
                COALESCE(tri."receivedQuantity", 0) +
                  COALESCE(tri."returnedToOriginQuantity", 0)
              )
            )
            FROM "transferRequestItems" AS tri
            WHERE
              tri."materialRequestItemId" = ri."id"
              AND (
                tri."receiptClosed" = TRUE
                OR COALESCE(tri."returnedToOriginQuantity", 0) > 0
              )
          ),
          0
        ) >= ri."quantity"
      )
  );
