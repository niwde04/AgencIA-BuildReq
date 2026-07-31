ALTER TYPE "treasury_payment_kind"
  ADD VALUE IF NOT EXISTS 'quality_retention_release';

ALTER TYPE "treasury_payment_source_type"
  ADD VALUE IF NOT EXISTS 'quality_retention_release';

ALTER TYPE "attachment_entity_type"
  ADD VALUE IF NOT EXISTS 'quality_retention_release';
