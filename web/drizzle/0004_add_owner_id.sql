-- Ownership. Until this migration, `sources`, `rulesets` and `runs` had no
-- owner, so every signed-in account read every row: a brand-new sign-up landed
-- on someone else's runs, conflicts and audit trail. Authentication was in
-- place; scoping was not, and the two are not the same thing.
--
-- The column is added with a DEFAULT so existing rows can be backfilled in one
-- statement, then the default is DROPPED. Leaving it would make an insert that
-- forgets to stamp an owner succeed silently, which is precisely the failure
-- this migration exists to close.
--
-- Existing rows are backfilled to '' — a value no Clerk user id can take, since
-- they are all `user_...`. So legacy data is owned by nobody and visible to
-- nobody, rather than being handed to whichever account signs in next. To claim
-- it for a real account, find the id in the Clerk dashboard (Users → the user →
-- the `user_...` id) and run:
--
--   UPDATE sources  SET owner_id = 'user_XXXX' WHERE owner_id = '';
--   UPDATE rulesets SET owner_id = 'user_XXXX' WHERE owner_id = '';
--   UPDATE runs     SET owner_id = 'user_XXXX' WHERE owner_id = '';
--
-- Nothing else needs claiming: entities, matches, conflicts, resolutions and
-- audit_log reach their owner through `run_id`, and source_credentials through
-- `source_id`.

ALTER TABLE "sources" ADD COLUMN "owner_id" text NOT NULL DEFAULT '';--> statement-breakpoint
ALTER TABLE "sources" ALTER COLUMN "owner_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "rulesets" ADD COLUMN "owner_id" text NOT NULL DEFAULT '';--> statement-breakpoint
ALTER TABLE "rulesets" ALTER COLUMN "owner_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "owner_id" text NOT NULL DEFAULT '';--> statement-breakpoint
ALTER TABLE "runs" ALTER COLUMN "owner_id" DROP DEFAULT;--> statement-breakpoint
CREATE INDEX "sources_owner_created_idx" ON "sources" USING btree ("owner_id","created_at");--> statement-breakpoint
CREATE INDEX "rulesets_owner_name_idx" ON "rulesets" USING btree ("owner_id","name");--> statement-breakpoint
CREATE INDEX "runs_owner_started_idx" ON "runs" USING btree ("owner_id","started_at");
