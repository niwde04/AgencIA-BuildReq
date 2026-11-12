/** Uses a fresh local database only. Never runs fixtures against DATABASE_URL. */
import { strict as assert } from "node:assert";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { Client } from "pg";
import * as schema from "../drizzle/schema";

const { generateDrizzleJson, generateMigration } = createRequire(
  import.meta.url
)("drizzle-kit/api") as typeof import("drizzle-kit/api");

async function main() {
  const source = process.env.USER_PROFILE_LOCAL_DATABASE_URL;
  if (
    !source ||
    !["localhost", "127.0.0.1", "[::1]"].includes(new URL(source).hostname)
  ) {
    throw new Error(
      "USER_PROFILE_LOCAL_DATABASE_URL debe apuntar a PostgreSQL local."
    );
  }
  const name = `buildreq_user_profile_test_${randomBytes(8).toString("hex")}`;
  const url = new URL(source);
  url.pathname = `/${name}`;
  const admin = new Client({ connectionString: source });
  const fixture = new Client({ connectionString: url.toString() });
  let created = false;
  let connected = false;
  let closeApplicationDatabase: (() => Promise<void>) | undefined;

  try {
    await admin.connect();
    await admin.query(`CREATE DATABASE "${name}"`);
    created = true;
    await fixture.connect();
    connected = true;
    for (const statement of await generateMigration(
      generateDrizzleJson({}),
      generateDrizzleJson(schema)
    )) {
      await fixture.query(statement);
    }
    await fixture.query(
      `ALTER TABLE users DROP COLUMN phone, DROP COLUMN "jobTitle", DROP COLUMN "identityNumber";
       ALTER TABLE users ENABLE ROW LEVEL SECURITY;
       INSERT INTO users ("openId", name, email, "buildreqRole")
       VALUES ('existing-profile', 'Usuario existente', 'existing@example.com', 'contable')`
    );
    const original = (await fixture.query("select * from users")).rows;
    const access = () =>
      fixture.query(
        "select relrowsecurity, relacl from pg_class where oid = 'users'::regclass"
      );
    const beforeAccess = (await access()).rows;
    const migration = readFileSync(
      new URL(
        "../drizzle/20261112000000_user_profile_fields.sql",
        import.meta.url
      ),
      "utf8"
    );
    await fixture.query(migration);
    await fixture.query(migration);
    assert.deepEqual((await access()).rows, beforeAccess);
    const migrated = (await fixture.query("select * from users")).rows;
    assert.deepEqual(
      migrated,
      original.map(row => ({
        ...row,
        phone: null,
        jobTitle: null,
        identityNumber: null,
      }))
    );

    process.env.DATABASE_URL = url.toString();
    const db = await import("../server/db");
    const applicationDatabase = await db.getDb();
    closeApplicationDatabase = async () => {
      await applicationDatabase?.$client.end();
    };
    const profile = {
      phone: "+504 0012-3456",
      jobTitle: "Supervisor",
      identityNumber: "0000123456789",
    };
    await db.upsertUser({
      openId: "new-profile",
      name: "Nuevo usuario",
      email: "new@example.com",
      buildreqRole: "contable",
      ...profile,
    });
    const saved = await db.getUserByOpenId("new-profile");
    assert.ok(saved);
    for (const field of ["phone", "jobTitle", "identityNumber"] as const) {
      assert.equal(saved[field], profile[field]);
    }
    await db.upsertUser({ openId: "new-profile", name: "Nombre actualizado" });
    await db.updateUserAdmin(saved.id, {
      name: "Nombre actualizado",
      email: saved.email!,
      buildreqRole: "contable",
      assignedProjectIds: [],
      isActive: true,
    });
    const preserved = await db.getUserById(saved.id);
    for (const field of ["phone", "jobTitle", "identityNumber"] as const) {
      assert.equal(preserved?.[field], profile[field]);
    }
    await db.updateUserAdmin(saved.id, {
      name: "Nombre actualizado",
      email: saved.email!,
      buildreqRole: "contable",
      assignedProjectIds: [],
      isActive: true,
      phone: null,
      jobTitle: null,
      identityNumber: null,
    });
    const cleared = await db.getUserById(saved.id);
    for (const field of ["phone", "jobTitle", "identityNumber"] as const) {
      assert.equal(cleared?.[field], null);
    }
    assert.deepEqual((await access()).rows, beforeAccess);
    console.log(
      "PostgreSQL: migración repetible, datos previos, RLS/permisos, persistencia, conservación y limpieza verificados."
    );
  } finally {
    await closeApplicationDatabase?.();
    if (connected) await fixture.end();
    if (created && /^buildreq_user_profile_test_[0-9a-f]{16}$/.test(name)) {
      await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
      console.log("Base temporal de usuarios eliminada.");
    }
    await admin.end();
  }
}

main().catch(error => {
  console.error("User profile database checks failed", {
    code: error.code,
    message: error.message,
  });
  process.exitCode = 1;
});
