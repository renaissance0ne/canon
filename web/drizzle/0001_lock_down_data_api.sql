-- Take Canon's tables out of the Supabase Data API.
--
-- Migration 0000 created eight tables in `public`. Supabase's default
-- privileges grant `anon` and `authenticated` full SELECT/INSERT/UPDATE/
-- DELETE/TRUNCATE on anything created there, and RLS is off unless asked for.
-- `anon` is the role behind the publishable key, which ships to the browser by
-- design — so those tables were reachable, and writable, over PostgREST by
-- anyone holding a key that is not a secret.
--
-- That would have made two things in AGENTS.md untrue:
--   * `audit_log` is "append-only, never updated or deleted" — `anon` held
--     DELETE and TRUNCATE on it.
--   * the console's session requirement — the REST endpoint has no session.
--
-- Canon has no legitimate PostgREST access path at all: it connects as
-- `postgres` over a connection string and uses Drizzle. So the fix is to
-- revoke rather than to write RLS policies. RLS is then enabled on top as
-- defense in depth — `postgres` has BYPASSRLS, `anon` and `authenticated` do
-- not, so this is invisible to the app and total for everyone else.

-- 1. Existing tables.
REVOKE ALL ON ALL TABLES IN SCHEMA "public" FROM "anon", "authenticated";
--> statement-breakpoint

-- 2. Future tables. Without this, the next `drizzle-kit generate` re-opens the
--    hole for whatever table it adds.
ALTER DEFAULT PRIVILEGES IN SCHEMA "public" REVOKE ALL ON TABLES FROM "anon", "authenticated";
--> statement-breakpoint

-- 3. Defense in depth. No policies are created, so with RLS on and no grants,
--    a non-BYPASSRLS role can read nothing even if a grant is restored later.
ALTER TABLE "sources" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "rulesets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "entities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "matches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "conflicts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "resolutions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;
