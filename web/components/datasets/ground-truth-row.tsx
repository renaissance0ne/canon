import Link from "next/link";
import { VerdictMark } from "@/components/datasets/verdict-mark";
import { cn } from "@/lib/cn";
import { ESCALATE, divergenceFieldLabel, type ManifestDivergence } from "@/types/dataset";
import type { ScoredDivergence } from "@/types/ground-truth";

/**
 * One injected divergence, as the manifest records it — and, when a run is
 * selected, what that run did about it.
 *
 * Same three-part grammar as the conflict diff row (AGENTS.md § The signature
 * element), because it is the same unit seen from the other end: header, a
 * 50/50 spine between the two sides, and the answer indented beneath under `→`.
 * The difference is which answer. On a conflict row the `→` is Canon's
 * proposal; here it is the ground truth, and the agent's proposal sits below it
 * where the two can be read against each other without moving the eye.
 *
 * It is a data surface: square, opaque, hairlines only.
 */
export function GroundTruthRow({
  divergence,
  scored,
  runId,
}: {
  divergence: ManifestDivergence;
  /** What the selected run did. Null when no run is selected. */
  scored: ScoredDivergence | null;
  runId: string | null;
}) {
  const ambiguous = divergence.expectedResolution === ESCALATE;

  return (
    <article className="border border-hairline bg-g-0">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-hairline px-3 py-2">
        <span className="text-label uppercase text-g-900">{divergence.conflictClass}</span>
        <span className="font-mono text-value text-g-600">
          {divergenceFieldLabel(divergence)}
        </span>
        <span className="ml-auto font-mono text-value text-g-500">{divergence.entityId}</span>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2">
        <Side
          label="Side A · CRM"
          value={divergence.sideAValue}
          truth={divergence.trueValue}
          className="border-b border-hairline-strong md:border-b-0 md:border-r"
        />
        <Side label="Side B · warehouse" value={divergence.sideBValue} truth={divergence.trueValue} />
      </div>

      <footer className="flex flex-col gap-2 border-t border-hairline bg-surface-sunken px-3 py-2.5">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="font-mono text-value text-g-500" aria-hidden>
            →
          </span>
          <span className="text-label uppercase text-g-500">Ground truth</span>
          {ambiguous ? (
            // The rows the whole benchmark turns on. A system is scored on
            // whether it hands these to a human rather than guessing, so the
            // manifest saying "no value is correct" is the news on this row.
            <span className="font-mono text-value font-medium text-g-900">
              escalate — no value is correct
            </span>
          ) : (
            <span className="font-mono text-value font-medium text-g-900">
              {divergence.expectedResolution}
            </span>
          )}
        </div>

        {scored ? (
          <AgentAnswer scored={scored} runId={runId} divergence={divergence} />
        ) : null}
      </footer>
    </article>
  );
}

/** The queue, narrowed to the handful of rows this divergence is among. */
function queueHref(runId: string, divergence: ManifestDivergence): string {
  const params = new URLSearchParams({
    runId,
    // Not the default "escalated": an auto-applied conflict is exactly the one
    // a reader clicks through from a wrong-value verdict.
    status: "all",
    conflictClass: divergence.conflictClass,
    field: divergence.field,
  });
  return `/conflicts?${params.toString()}`;
}

/**
 * One side's value, with the value that is actually correct marked.
 *
 * Emphasis rather than a label: the side holding the true value is the winning
 * half of the diff, and AGENTS.md gives the winning side weight 500 in mono.
 * A side the manifest has no value for is absent, not empty — the record does
 * not exist there — so it reads as `—` rather than as a blank cell.
 */
function Side({
  label,
  value,
  truth,
  className,
}: {
  label: string;
  value: string | null;
  truth: string | null;
  className?: string;
}) {
  const wins = value !== null && truth !== null && value === truth;

  return (
    <div className={cn("flex min-w-0 flex-col gap-1 px-3 py-2.5", className)}>
      <p className="text-label uppercase text-g-500">{label}</p>
      {value === null ? (
        <p className="font-mono text-value text-g-400">— absent</p>
      ) : (
        <p
          className={cn(
            "break-words font-mono text-value",
            wins ? "font-medium text-g-900" : "text-g-600",
          )}
        >
          {value}
        </p>
      )}
    </div>
  );
}

/** What the selected run proposed, and whether it matched. */
function AgentAnswer({
  scored,
  runId,
  divergence,
}: {
  scored: ScoredDivergence;
  runId: string | null;
  divergence: ManifestDivergence;
}) {
  return (
    <div className="flex flex-col gap-1.5 border-t border-hairline pt-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <VerdictMark verdict={scored.verdict} />

        {scored.proposedValue !== null ? (
          <span className="font-mono text-value text-g-700">
            proposed {scored.proposedValue}
            {scored.confidence !== null ? ` · ${scored.confidence.toFixed(2)}` : ""}
            {scored.appliedRuleId ? ` · ${scored.appliedRuleId}` : ""}
          </span>
        ) : null}

        {/* An override is the reviewer's answer, not the agent's — named
            separately so the verdict above is never read as scoring a human. */}
        {scored.overrideValue ? (
          <span className="font-mono text-value text-g-500">
            reviewer chose {scored.overrideValue}
          </span>
        ) : null}

        {/* The queue filtered down to this conflict's run, class and field —
            not a deep link to the row itself. `selected` is parsed by the queue
            but nothing there acts on it, so a link claiming to open one row
            would quietly open the first one instead. */}
        {scored.conflictId && runId ? (
          <Link href={queueHref(runId, divergence)} className="ml-auto font-mono text-value text-g-600">
            open in queue
          </Link>
        ) : null}
      </div>

      {/* The rationale is Canon speaking, so it is sans — the same split the
          conflict row uses to separate a source value from Canon's own words. */}
      {scored.rationale ? (
        <p className="max-w-[80ch] text-body text-g-600">{scored.rationale}</p>
      ) : null}
    </div>
  );
}
