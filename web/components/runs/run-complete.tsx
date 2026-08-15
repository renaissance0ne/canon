import Link from "next/link";
import { Button } from "@/components/ui/button";
import { RunDegradedNote } from "@/components/runs/run-degraded-note";
import { RunTimeline } from "@/components/runs/run-timeline";
import { SeverityHistogram } from "@/components/runs/severity-histogram";
import { StatGrid } from "@/components/runs/stat-grid";
import { formatCount, formatElapsed } from "@/lib/format";
import type { SeverityBreakdown } from "@/types/conflict";
import type { AuditEntry } from "@/types/resolution";
import { isRunDegraded, trustworthyEscalations, type RunDetail } from "@/types/run";

/**
 * Wireframe 1g — severity is the handoff into review.
 *
 * A completed run is not a success screen. The number that matters on it is
 * `escalated`: the conflicts Canon would not decide on its own, which are now
 * a person's problem. So that number gets the primary button and the histogram
 * above it says how much of it is structural.
 *
 * Escalation is a success state, not a failure (AGENTS.md § The Resolution
 * Agent), which is why it is reported here rather than buried.
 */
export function RunComplete({
  run,
  breakdown,
  timeline,
}: {
  run: RunDetail;
  breakdown: SeverityBreakdown;
  timeline: AuditEntry[];
}) {
  const duration = run.finishedAt
    ? formatElapsed(run.finishedAt.getTime() - run.startedAt.getTime())
    : null;

  const escalated = run.stats.escalated;
  // The button promises work. When calls failed it must promise the work that
  // actually exists, or it sends a reviewer at a queue mostly made of conflicts
  // nobody ever got an answer for.
  const degraded = isRunDegraded(run.stats);
  const reviewable = degraded ? trustworthyEscalations(run.stats) : escalated;

  return (
    <div className="flex max-w-[640px] flex-col gap-7">
      <p className="font-mono text-value text-g-600">
        <span className="font-medium text-g-900">complete</span>
        {duration ? ` · ${duration}` : null}
        {degraded ? <span className="text-g-900"> · degraded</span> : null}
      </p>

      <RunDegradedNote run={run} />

      <StatGrid stats={run.stats} status={run.status} variant="summary" />

      <SeverityHistogram breakdown={breakdown} stagger />

      <div className="border-t border-hairline pt-5">
        <p className="text-label uppercase text-g-500">Timeline</p>
        <div className="mt-2.5">
          <RunTimeline entries={timeline} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {escalated > 0 ? (
          <Button asChild>
            <Link
              href={`/conflicts?runId=${run.id}&status=escalated`}
              className="no-underline"
            >
              Review {formatCount(reviewable)} escalated
              {degraded ? ` · ${formatCount(escalated - reviewable)} unanswered` : null}
            </Link>
          </Button>
        ) : (
          <Button asChild variant="outline">
            <Link href={`/conflicts?runId=${run.id}`} className="no-underline">
              Open {formatCount(run.stats.conflicts)} conflicts
            </Link>
          </Button>
        )}

        {/* One button, not two links. Which sections and which format is a
            decision with consequences (wireframe 1o), and it belongs on a screen
            that can say what is in the file before it is downloaded. */}
        <Button asChild variant="outline">
          <Link href={`/runs/${run.id}/export`} className="no-underline">
            Export
          </Link>
        </Button>

        <Button asChild variant="quiet">
          <Link href={`/audit?runId=${run.id}`} className="no-underline">
            Audit trail
          </Link>
        </Button>
      </div>

      <p className="max-w-[520px] text-body text-g-500">
        Canon does not write back. The export is the resolved hierarchy and every
        decision behind it — nothing changed in {run.sourceAName} or{" "}
        {run.sourceBName}.
      </p>
    </div>
  );
}
