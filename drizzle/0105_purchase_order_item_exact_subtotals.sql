alter table "purchaseOrderItems"
  add column if not exists "subtotal" numeric(14, 4),
  add column if not exists "purchaseQuantity" numeric(12, 4),
  add column if not exists "purchaseUnit" varchar(50),
  add column if not exists "purchaseUnitPrice" numeric(14, 4),
  add column if not exists "unitConversionFactor" numeric(14, 6);

update "purchaseOrderItems"
set "subtotal" = round(
  (coalesce("quantity", 0)::numeric * coalesce("unitPrice", 0)::numeric),
  4
)
where "subtotal" is null;

alter table "purchaseOrderItems"
  alter column "subtotal" set default '0.0000',
  alter column "subtotal" set not null,
  alter column "unitPrice" type numeric(16, 8)
    using coalesce("unitPrice", 0)::numeric(16, 8),
  alter column "unitPrice" set default '0.00000000';

alter table "receiptItems"
  alter column "unitPrice" type numeric(16, 8)
    using coalesce("unitPrice", 0)::numeric(16, 8),
  alter column "unitPrice" set default '0.00000000';

alter table "invoiceItems"
  alter column "unitPrice" type numeric(16, 8)
    using coalesce("unitPrice", 0)::numeric(16, 8),
  alter column "unitPrice" set default '0.00000000';
