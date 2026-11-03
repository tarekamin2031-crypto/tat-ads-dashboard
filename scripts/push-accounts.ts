import { createClient } from "@libsql/client";
import { db, ensureSchema } from "../lib/db";

// Copies the clients you added locally (with their hashed passwords and logos) into the
// online database, so they don't have to be added again. Run with DATABASE_URL and
// DATABASE_AUTH_TOKEN pointing at the online (Turso) database.
async function main() {
  if ((process.env.DATABASE_URL ?? "file:local.db").startsWith("file:")) {
    throw new Error("DATABASE_URL must point at the online database (libsql://...), not a local file.");
  }
  await ensureSchema();

  const local = createClient({ url: "file:local.db" });
  const { rows } = await local.execute("SELECT * FROM accounts");
  for (const r of rows) {
    await db.execute({
      sql: `INSERT OR REPLACE INTO accounts (slug, name, ad_account_id, currency, timezone, password_hash, logo)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [r.slug, r.name, r.ad_account_id, r.currency, r.timezone, r.password_hash, r.logo] as never,
    });
    console.log(`copied ${r.name}`);
  }
  console.log(`${rows.length} clients copied. Now run the sync to pull their data.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
