-- El flujo queda conservado en código e historial, pero temporalmente
-- deshabilitado. Los documentos que aún esperaban una decisión regresan a
-- borrador para que el proceso operativo pueda continuar sin aprobación.

UPDATE "purchaseRequests"
SET
  "status" = 'pendiente',
  "approvalStatus" = NULL,
  "rejectionReason" = NULL,
  "updatedAt" = now()
WHERE
  ("status" = 'en_revision' AND "approvalStatus" = 'pendiente')
  OR ("status" = 'rechazada' AND "approvalStatus" = 'rechazada');

UPDATE "purchaseOrders"
SET
  "status" = 'borrador',
  "approvalStatus" = NULL,
  "updatedAt" = now()
WHERE
  ("status" = 'pendiente_aprobacion' AND "approvalStatus" = 'pendiente')
  OR ("status" = 'rechazada' AND "approvalStatus" = 'rechazada');

-- Las decisiones ya aprobadas y todos los documentos finalizados se
-- conservan sin cambios. El historial append-only tampoco se modifica.
