import { VERDICT_LABEL, type RunScorecard, type Verdict } from "@/types/ground-truth";
import { cn } from "@/lib/cn";

/**
 * A run measured against the manifest.
 *
 * Detection and resolution are reported apart because they fail differently: a
 * divergence the run never raised a conflict for is a detector miss, and one it
 * raised and answered wrongly is an agent error. One accuracy number over both
 * would hide which of the two a change actually moved.
 *
 * `False auto-applies` is deliberately first among the resolution counts —
 * AGENTS.md § Evaluation Harness calls it the metric that matters most
 * operationally and says to report it prominently rather than bury it.
 */
const RESOLUTION_ORDER: readonly Verdict[] = [
  "false_auto_apply",
  "correct",
  "correct_escalation",
  "over_escalation",
  "missed",
  "unresolved",
  "rejected",
];

export function RunScorecardGrid({
  scorecard,
  className,
}: {
  scorecard: RunScorecard;
  className?: string;
}) {
  const recall = scorecard.expected === 0 ? 0 : scorecard.detected / scorecard.expected;

  return (
    <div className={cn("flex flex-col gap-5", className)}>
      <dl className="grid grid-cols-2 border-t border-hairline-strong sm:grid-cols-4">
        <Stat label="Injected" value={scorecard.expected} />
        <Stat
          label="Detected"
          value={scorecard.detected}
          note={`${(recall * 100).toFixed(1)}% recall`}
        />
        <Stat label="Not detected" value={scorecard.byVerdict.missed} />
        <Stat
          label="Not in ground truth"
          value={scorecard.notInTruth}
          note="conflicts with no manifest entry"
        />
      </dl>

      <dl className="grid grid-cols-2 border-t border-hairline-strong sm:grid-cols-4">
        {RESOLUTION_ORDER.filter((verdict) => verdict !== "missed").map((verdict) => (
          <Stat
            key={verdict}
            label={VERDICT_LABEL[verdict]}
            value={scorecard.byVerdict[verdict]}
            emphasis={verdict === "false_auto_apply"}
          />
        ))}
      </dl>
    </div>
  );
}

function Stat({
  label,
  value,
  note,
  emphasis = false,
}: {
  label: string;
  value: number;
  note?: string;
  emphasis?: boolean;
}) {
  return (
    <div className="border-b border-hairline py-2.5 pr-4">
      <dt className="text-label uppercase text-g-500">{label}</dt>
      <dd
        className={cn(
          "mt-1 font-mono text-[20px] leading-6 text-g-900",
          emphasis && "font-medium",
        )}
      >
        {value.toLocaleString()}
      </dd>
      {note ? <p className="mt-0.5 font-mono text-value text-g-500">{note}</p> : null}
    </div>
  );
}
