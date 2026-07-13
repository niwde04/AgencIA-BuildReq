alter table "purchaseOrders"
  add column if not exists "currency" varchar(3) not null default 'HNL',
  add column if not exists "exchangeRate" numeric(18, 8),
  add column if not exists "exchangeRateDate" date;

alter table "receipts"
  add column if not exists "currency" varchar(3) not null default 'HNL',
  add column if not exists "exchangeRate" numeric(18, 8),
  add column if not exists "exchangeRateDate" date;

alter table "invoices"
  add column if not exists "currency" varchar(3) not null default 'HNL',
  add column if not exists "exchangeRate" numeric(18, 8),
  add column if not exists "exchangeRateDate" date;

update "purchaseOrders"
set "currency" = 'HNL', "exchangeRate" = null, "exchangeRateDate" = null
where "currency" is null or "currency" not in ('HNL', 'USD');

update "receipts"
set "currency" = 'HNL', "exchangeRate" = null, "exchangeRateDate" = null
where "currency" is null or "currency" not in ('HNL', 'USD');

update "invoices"
set "currency" = 'HNL', "exchangeRate" = null, "exchangeRateDate" = null
where "currency" is null or "currency" not in ('HNL', 'USD');

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'po_currency_check'
      and conrelid = '"purchaseOrders"'::regclass
  ) then
    alter table "purchaseOrders"
      add constraint "po_currency_check"
      check ("currency" in ('HNL', 'USD'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'po_exchange_rate_check'
      and conrelid = '"purchaseOrders"'::regclass
  ) then
    alter table "purchaseOrders"
      add constraint "po_exchange_rate_check"
      check (
        ("currency" = 'HNL' and "exchangeRate" is null and "exchangeRateDate" is null)
        or
        ("currency" = 'USD' and "exchangeRate" > 0 and "exchangeRateDate" is not null)
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'receipt_currency_check'
      and conrelid = 'receipts'::regclass
  ) then
    alter table receipts
      add constraint "receipt_currency_check"
      check ("currency" in ('HNL', 'USD'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'receipt_exchange_rate_check'
      and conrelid = 'receipts'::regclass
  ) then
    alter table receipts
      add constraint "receipt_exchange_rate_check"
      check (
        ("currency" = 'HNL' and "exchangeRate" is null and "exchangeRateDate" is null)
        or
        ("currency" = 'USD' and "exchangeRate" > 0 and "exchangeRateDate" is not null)
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'invoice_currency_check'
      and conrelid = 'invoices'::regclass
  ) then
    alter table invoices
      add constraint "invoice_currency_check"
      check ("currency" in ('HNL', 'USD'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'invoice_exchange_rate_check'
      and conrelid = 'invoices'::regclass
  ) then
    alter table invoices
      add constraint "invoice_exchange_rate_check"
      check (
        ("currency" = 'HNL' and "exchangeRate" is null and "exchangeRateDate" is null)
        or
        ("currency" = 'USD' and "exchangeRate" > 0 and "exchangeRateDate" is not null)
      );
  end if;
end $$;
