import { PageHeader } from "@/components/console/page-header";
import { SourcesEmptyState } from "@/components/sources/sources-empty-state";
import { SourceTable } from "@/components/sources/source-table";
import { Button } from "@/components/ui/button";
import { listSources } from "@/lib/server/sources";
import Link from "next/link";

/** Wireframe 1b. Empty state is the first run; the table is every run after. */
export default async function SourcesPage() {
  const sources = await listSources();

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

      <div className="px-10 py-8">
        {sources.length === 0 ? (
          <SourcesEmptyState />
        ) : (
          <SourceTable sources={sources} />
        )}
      </div>
    </>
  );
}
