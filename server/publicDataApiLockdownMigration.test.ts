import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("public Data API lockdown migration", () => {
  const migration = readFileSync(
    new URL("../drizzle/0134_lock_down_public_data_api.sql", import.meta.url),
    "utf8"
  );

  it("removes direct Data API access from current public objects", () => {
    expect(migration).toContain(
      "REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public"
    );
    expect(migration).toContain(
      "REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public"
    );
    expect(migration).toContain(
      "REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public"
    );
    expect(migration).toMatch(/FROM PUBLIC, anon, authenticated/g);
    expect(migration).not.toMatch(/FROM[^;]*service_role/i);
  });

  it("removes legacy automatic grants from future postgres objects", () => {
    for (const objectType of ["TABLES", "SEQUENCES"]) {
      expect(migration).toContain(
        `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public\n  REVOKE ALL PRIVILEGES ON ${objectType}`
      );
    }
    expect(migration).toContain(
      "ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public\n  REVOKE EXECUTE ON FUNCTIONS"
    );
  });

  it("enables but does not force RLS on every existing public table", () => {
    expect(migration).toContain("relation.relkind IN ('r', 'p')");
    expect(migration).toContain(
      "'ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY'"
    );
    expect(migration).not.toMatch(/FORCE ROW LEVEL SECURITY/i);
    expect(migration).not.toMatch(/CREATE POLICY/i);
  });

  it("keeps future public tables fail-closed with a private event trigger", () => {
    expect(migration).toContain("CREATE SCHEMA IF NOT EXISTS private");
    expect(migration).toContain(
      "CREATE OR REPLACE FUNCTION private.buildreq_enable_rls_on_new_public_tables()"
    );
    expect(migration).toContain("SECURITY DEFINER");
    expect(migration).toContain("SET search_path = pg_catalog");
    expect(migration).toContain(
      "CREATE EVENT TRIGGER buildreq_ensure_public_table_rls"
    );
    expect(migration).toContain(
      "'ALTER TABLE IF EXISTS %s ENABLE ROW LEVEL SECURITY'"
    );
    expect(migration).toContain(
      "'REVOKE ALL PRIVILEGES ON TABLE %s FROM PUBLIC, anon, authenticated'"
    );
  });

  it("runs atomically", () => {
    expect(migration.trimStart().startsWith("BEGIN;")).toBe(true);
    expect(migration.trimEnd().endsWith("COMMIT;")).toBe(true);
  });
});
