CREATE TABLE "source_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"method" text NOT NULL,
	"public_values" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ciphertext" text NOT NULL,
	"iv" text NOT NULL,
	"auth_tag" text NOT NULL,
	"key_version" integer DEFAULT 1 NOT NULL,
	"expires_at" timestamp with time zone,
	"scope" text,
	"connected_by" text NOT NULL,
	"last_verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "source_credentials" ADD CONSTRAINT "source_credentials_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "source_credentials_source_idx" ON "source_credentials" USING btree ("source_id");--> statement-breakpoint

-- Everything below is hand-written, and it is the reason this table is safe to
-- add at all. Migration 0001 took Canon's tables out of the Supabase Data API
-- and set ALTER DEFAULT PRIVILEGES so new tables inherit that. This table holds
-- the only ciphertext in the system, so it does not inherit anything on trust:
-- the revoke is restated explicitly and RLS is turned on with no policies, the
-- same shape 0001 used.
--
-- `anon` is the role behind the publishable key, which ships to the browser by
-- design. It must not be able to see so much as a row count here.
REVOKE ALL ON TABLE "source_credentials" FROM "anon", "authenticated";--> statement-breakpoint
ALTER TABLE "source_credentials" ENABLE ROW LEVEL SECURITY;

-- Deliberately NOT `FORCE ROW LEVEL SECURITY`. It would extend RLS to the table
-- owner, and with no policies defined the failure mode is a silent empty read
-- rather than an error — a run would report "no credentials configured" for a
-- source that has them. The revoke above is what actually closes the hole;
-- FORCE would only add a way to lock Canon out of its own table.