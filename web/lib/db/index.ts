import "server-only";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * The db client. SERVER ONLY — DATABASE_URL must never reach a client bundle,
 * so this module is `server-only` and is imported exclusively by Server
 * Components and route handlers.
 *
 * Connected lazily, on first query rather than on import: `next build`
 * evaluates every server module while collecting page data, and a build must
 * not require a live database. A missing DATABASE_URL fails at the call site,
 * where the message is actionable.
 */
type CanonDb = PostgresJsDatabase<typeof schema>;

/**
 * Next.js reloads modules on every HMR pass in dev, so the connection is
 * cached on globalThis — otherwise each reload opens another pooler client.
 */
const globalForDb = globalThis as unknown as {
  canonSql?: ReturnType<typeof postgres>;
  canonDb?: CanonDb;
};

export function getDb(): CanonDb {
  if (globalForDb.canonDb) return globalForDb.canonDb;

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Add it to web/.env — server-side only, never NEXT_PUBLIC_.",
    );
  }

  // Supabase's transaction pooler does not support prepared statements.
  const sql = globalForDb.canonSql ?? postgres(url, { prepare: false });
  const db = drizzle(sql, { schema });

  globalForDb.canonSql = sql;
  globalForDb.canonDb = db;
  return db;
}

export { schema };
