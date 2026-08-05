import { defineConfig } from "drizzle-kit";

/**
 * Drizzle owns the schema for BOTH layers. The engine reads and writes the
 * same Postgres but never migrates it — `npx drizzle-kit generate` and
 * `npx drizzle-kit migrate` are run from web/ only.
 */
/**
 * Migrations run over a SESSION-mode connection, not the transaction pooler the
 * app uses at runtime: drizzle-kit issues DDL and introspection with prepared
 * statements, and Supavisor transaction mode (port 6543) cannot serve those.
 * Falls back to DATABASE_URL so a direct-connection setup still works unchanged.
 */
const migrationUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;

if (!migrationUrl) {
  throw new Error("Set MIGRATION_DATABASE_URL (or DATABASE_URL) in web/.env before migrating.");
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: migrationUrl },
  strict: true,
  verbose: true,
});
