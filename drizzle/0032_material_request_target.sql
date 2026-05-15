DO $$
BEGIN
  CREATE TYPE "material_request_target_type" AS ENUM ('subproyecto', 'activo_fijo');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
