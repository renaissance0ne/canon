import { notFound } from "next/navigation";
import { PageHeader } from "@/components/console/page-header";
import { RunComplete } from "@/components/runs/run-complete";
import { RunFailure } from "@/components/runs/run-failure";
import { RunLive } from "@/components/runs/run-live";
import { listRunAudit } from "@/lib/server/audit";
import { getRunDetail, getSeverityBreakdown } from "@/lib/server/runs";
import { shortRunId } from "@/lib/format";
import { isUuid } from "@/lib/uuid";
import type { RunDetail } from "@/types/run";
import { requireReviewer } from "@/lib/server/auth";

/**
 * Wireframes 1f, 1g and 1h — the same route, three states.
 *
 * Status is the whole screen. Which of the three renders is decided on the
 * server from the run row, so a failed run is still a failed run after a
 * reload, in a new tab, or on someone else's machine. Only the in-flight state
 * is a client component, and only because it polls.
 */
export default async function RunPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  await requireReviewer();

  const { runId } = await params;
  if (!isUuid(runId)) notFound();

  const run = await getRunDetail(runId);
  if (!run) notFound();

  return (
    <>
      <PageHeader
        title={
          <>
            Run{" "}
            <span className="font-mono text-value text-g-600">
              {shortRunId(run.id)}
            </span>
          </>
        }
        meta={`${run.sourceAName} ↔ ${run.sourceBName} · ${run.rulesetName} v${run.rulesetVersion}`}
      />

      <div className="px-10 py-8">
        {run.status === "failed" ? (
          <RunFailure run={run} />
        ) : run.status === "complete" ? (
          <CompleteRun run={run} />
        ) : (
          <RunLive
            runId={run.id}
            startedAt={run.startedAt}
            initial={{
              runId: run.id,
              status: run.status,
              stats: run.stats,
              error: run.error,
            }}
          />
        )}
      </div>
    </>
  );
}

/**
 * The two extra reads a finished run needs. Kept out of the main body so the
 * in-flight path never pays for a severity aggregate over an empty table.
 */
async function CompleteRun({ run }: { run: RunDetail }) {
  const [breakdown, timeline] = await Promise.all([
    getSeverityBreakdown(run.id),
    listRunAudit(run.id),
  ]);

  return <RunComplete run={run} breakdown={breakdown} timeline={timeline} />;
}
