-- Run inside the guarded renumbering transaction, after correcting balance ID 4.
-- This reserves the previously issued folio without creating another balance.
DO $$
DECLARE expression text;
BEGIN
  SELECT pg_get_expr(conbin, conrelid) INTO expression
  FROM pg_constraint
  WHERE conrelid='public."openingBalances"'::regclass
    AND conname='ob_no_retired_balance_number';
  IF expression IS NULL THEN
    ALTER TABLE public."openingBalances"
      ADD CONSTRAINT ob_no_retired_balance_number
      CHECK ("balanceNumber" <> 'SI-024-00000001') NOT VALID;
  ELSIF regexp_replace(replace(expression, '::text', ''), '[()[:space:]]', '', 'g')
        <> '"balanceNumber"<>''SI-024-00000001''' THEN
    RAISE EXCEPTION 'La reserva del folio anterior tiene una definición inesperada';
  END IF;
END $$;
ALTER TABLE public."openingBalances"
  VALIDATE CONSTRAINT ob_no_retired_balance_number;
