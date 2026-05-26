DO $$
BEGIN
  CREATE TYPE "supplier_contact_type" AS ENUM (
    'ventas',
    'compras',
    'cobros',
    'logistica',
    'administracion',
    'otro'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "supplierContacts" (
  "id" serial PRIMARY KEY,
  "supplierId" integer NOT NULL REFERENCES "suppliers"("id") ON DELETE CASCADE,
  "projectId" integer NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "contactType" "supplier_contact_type" DEFAULT 'ventas' NOT NULL,
  "branchName" varchar(255),
  "name" varchar(255) NOT NULL,
  "phone" varchar(80),
  "email" varchar(320),
  "address" text,
  "isActive" boolean DEFAULT true NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "sup_contact_supplier_project_idx"
ON "supplierContacts" ("supplierId", "projectId");

CREATE INDEX IF NOT EXISTS "sup_contact_active_idx"
ON "supplierContacts" ("isActive");
