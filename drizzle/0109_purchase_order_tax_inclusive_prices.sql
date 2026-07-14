alter table "purchaseOrders"
  add column if not exists "pricesIncludeTax" boolean not null default false;

alter table "receipts"
  add column if not exists "pricesIncludeTax" boolean not null default false;

alter table "invoices"
  add column if not exists "pricesIncludeTax" boolean not null default false;
