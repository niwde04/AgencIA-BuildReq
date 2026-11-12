import "dotenv/config";
import { readFileSync } from "node:fs";
import { Client } from "pg";

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const target = new URL(process.env.DATABASE_URL);
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 10_000,
  });

  try {
    await client.connect();
    await client.query(
      readFileSync(
        new URL(
          "../drizzle/20261112000000_user_profile_fields.sql",
          import.meta.url
        ),
        "utf8"
      )
    );
    const result = await client.query(
      `select column_name, data_type, character_maximum_length, is_nullable
       from information_schema.columns
       where table_schema = 'public' and table_name = 'users'
         and column_name in ('phone', 'jobTitle', 'identityNumber')
       order by column_name`
    );
    const expectedLengths: Record<string, number> = {
      phone: 50,
      jobTitle: 150,
      identityNumber: 50,
    };
    if (
      result.rowCount !== 3 ||
      result.rows.some(
        column =>
          column.data_type !== "character varying" ||
          column.character_maximum_length !==
            expectedLengths[column.column_name] ||
          column.is_nullable !== "YES"
      )
    ) {
      throw new Error(
        "Los campos de perfil no coinciden con los tipos, longitudes o nulabilidad esperados."
      );
    }
    console.log(
      JSON.stringify(
        {
          migration: "20261112000000_user_profile_fields",
          host: target.hostname,
          database: target.pathname.slice(1),
          columns: result.rows,
        },
        null,
        2
      )
    );
  } finally {
    await client.end();
  }
}

main().catch(error => {
  console.error("User profile migration failed", {
    code: error.code,
    message: error.message,
  });
  process.exitCode = 1;
});
