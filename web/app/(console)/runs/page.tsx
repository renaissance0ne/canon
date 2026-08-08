import Link from "next/link";
import { PageHeader } from "@/components/console/page-header";
import { RunTable } from "@/components/runs/run-table";
import { Button } from "@/components/ui/button";
import { listRuns } from "@/lib/server/runs";
import { formatCount } from "@/lib/format";

/** The console's home. A run is the unit of work, so this is the unit of history. */
export default async function RunsPage() {
  const runs = await listRuns();

  return (
    <>
      <PageHeader
        title="Runs"
        meta={runs.length > 0 ? `${formatCount(runs.length)} recorded` : undefined}
        actions={
          <Button asChild size="sm">
            <Link href="/runs/new" className="no-underline">
              New run
            </Link>
          </Button>
        }
      />

      <div className="px-10 py-8">
        {runs.length === 0 ? (
          <div className="max-w-[560px] border border-dashed border-hairline-strong bg-surface p-6">
            <p className="text-label uppercase text-g-500">No runs yet</p>
            <p className="mt-3 max-w-[440px] text-body text-g-600">
              A run reads both systems, matches them, and hands you whatever it
              could not decide on its own. Nothing is written back — the two
              source systems are read-only to Canon.
            </p>
            <div className="mt-6">
              <Button asChild>
                <Link href="/runs/new" className="no-underline">
                  Start the first run
                </Link>
              </Button>
            </div>
          </div>
        ) : (
          <RunTable runs={runs} />
        )}
      </div>
    </>
  );
}
