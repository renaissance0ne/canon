import { PageHeader } from "@/components/console/page-header";
import { SourcesEmptyState } from "@/components/sources/sources-empty-state";
import { SourceTable } from "@/components/sources/source-table";
import { Button } from "@/components/ui/button";
import { listSources } from "@/lib/server/sources";
import { listCredentialStatuses } from "@/lib/server/credentials";
import Link from "next/link";
import { requireReviewer } from "@/lib/server/auth";

/**
 * Wireframe 1b. Empty state is the first run; the table is every run after.
 *
 * `?error=` and `?notice=` arrive from /api/oauth/:kind/callback, which
 * redirects here on success rather than rendering a page of its own.
 */
export default async function SourcesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  await requireReviewer();

  // Redacted status per source — method, expiry and which key names exist. No
  // value is read here because no read path returns one. `now` comes back with
  // it so the table can render expiry without reading a clock during render.
  const [sources, { bySourceId: credentials, now }, { error, notice }] = await Promise.all([
    listSources(),
    listCredentialStatuses(),
    searchParams,
  ]);

  return (
    <>
      <PageHeader
        title="Sources"
        meta={sources.length > 0 ? sources.length + " configured" : undefined}
        actions={
          sources.length > 0 ? (
            <Button asChild size="sm">
              <Link href="/sources/new" className="no-underline">
                Add source
              </Link>
            </Button>
          ) : null
        }
      />

      <div className="flex flex-col gap-6 px-10 py-8">
        {error ? (
          <p
            role="alert"
            className="max-w-[640px] border border-g-900 bg-surface-sunken px-3 py-2 text-body text-g-900"
          >
            {error}
          </p>
        ) : null}

        {notice ? (
          <p className="max-w-[640px] border-l-2 border-g-900 pl-3 text-body text-g-600">{notice}</p>
        ) : null}

        {sources.length === 0 ? (
          <SourcesEmptyState />
        ) : (
          <SourceTable sources={sources} credentials={credentials} now={now} />
        )}
      </div>
    </>
  );
}
