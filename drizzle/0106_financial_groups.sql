CREATE TABLE IF NOT EXISTS "financialGroups" (
  "financialGroupCode" varchar(20) PRIMARY KEY,
  "financialGroupDescription" varchar(500) NOT NULL,
  "codN2" varchar(20) NOT NULL,
  "nivel2" varchar(255) NOT NULL,
  "isActive" boolean DEFAULT true NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "financial_group_description_idx"
ON "financialGroups" USING btree ("financialGroupDescription");

CREATE INDEX IF NOT EXISTS "financial_group_cod_n2_idx"
ON "financialGroups" USING btree ("codN2");

CREATE INDEX IF NOT EXISTS "financial_group_active_idx"
ON "financialGroups" USING btree ("isActive");

ALTER TABLE "sapCatalog"
ADD COLUMN IF NOT EXISTS "financialGroupCode" varchar(20);

DO $$
BEGIN
  ALTER TABLE "sapCatalog"
  ADD CONSTRAINT "sapCatalog_financialGroupCode_financialGroups_code_fk"
  FOREIGN KEY ("financialGroupCode")
  REFERENCES "financialGroups"("financialGroupCode")
  ON UPDATE CASCADE
  ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "sap_cat_financial_group_idx"
ON "sapCatalog" USING btree ("financialGroupCode");

INSERT INTO "financialGroups" (
  "financialGroupCode",
  "financialGroupDescription",
  "codN2",
  "nivel2",
  "isActive"
)
VALUES
  ('02010501', '02010501-Mano de obra-Equipo de seguridad personal y uniformes', '0201', 'Mano de obra', true),
  ('02019901', '02019901-Mano de obra-Alimentación', '0201', 'Mano de obra', true),
  ('02019903', '02019903-Mano de obra-Seguros y servicios médicos y medicamentos', '0201', 'Mano de obra', true),
  ('02020201', '02020201-Maquinaria-Repuestos maquinaria', '0202', 'Maquinaria', true),
  ('02020301', '02020301-Maquinaria-Diesel', '0202', 'Maquinaria', true),
  ('02020302', '02020302-Maquinaria-Gasolina', '0202', 'Maquinaria', true),
  ('02020402', '02020402-Maquinaria-Maquinaria', '0202', 'Maquinaria', true),
  ('02020502', '02020502-Maquinaria-Maquinaria', '0202', 'Maquinaria', true),
  ('02020901', '02020901-Maquinaria-Equipos menores consumibles', '0202', 'Maquinaria', true),
  ('02021001', '02021001-Maquinaria-Materiales taller metalmecánica', '0202', 'Maquinaria', true),
  ('02029901', '02029901-Maquinaria-Otros varios', '0202', 'Maquinaria', true),
  ('02030103', '02030103-Materiales e insumos-Válvulas y accesorios', '0203', 'Materiales e insumos', true),
  ('02030105', '02030105-Materiales e insumos-Asfalto (AC-30, Emulsiones)', '0203', 'Materiales e insumos', true),
  ('02030106', '02030106-Materiales e insumos-Acero', '0203', 'Materiales e insumos', true),
  ('02030108', '02030108-Materiales e insumos-Cemento', '0203', 'Materiales e insumos', true),
  ('02030109', '02030109-Materiales e insumos-Cal (Hidratada, Natural)', '0203', 'Materiales e insumos', true),
  ('02030111', '02030111-Materiales e insumos-Aditivos Varios', '0203', 'Materiales e insumos', true),
  ('02030112', '02030112-Materiales e insumos-Diesel  para fabricación de asfalto', '0203', 'Materiales e insumos', true),
  ('02030199', '02030199-Materiales e insumos-Materiales generales de fabricación', '0203', 'Materiales e insumos', true),
  ('02030202', '02030202-Materiales e insumos-Pintura acrílica', '0203', 'Materiales e insumos', true),
  ('02030299', '02030299-Materiales e insumos-Materiales generales de señalización', '0203', 'Materiales e insumos', true),
  ('03050501', '03050501-Servicios generales-Suministros de oficina', '0305', 'Servicios generales', true),
  ('03050901', '03050901-Servicios generales-Suministros de aseo', '0305', 'Servicios generales', true)
ON CONFLICT ("financialGroupCode") DO UPDATE SET
  "financialGroupDescription" = EXCLUDED."financialGroupDescription",
  "codN2" = EXCLUDED."codN2",
  "nivel2" = EXCLUDED."nivel2",
  "updatedAt" = now();
