-- Commit these enum additions before applying the reversal schema.
ALTER TYPE "treasury_item_status"
  ADD VALUE IF NOT EXISTS 'revertida';

ALTER TYPE "attachment_category"
  ADD VALUE IF NOT EXISTS 'comprobante_reversion_pago';
