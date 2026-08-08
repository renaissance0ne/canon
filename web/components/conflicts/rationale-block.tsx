import { cn } from "@/lib/cn";
import { formatConfidence } from "@/lib/format";
import type { QueueResolution } from "@/types/queue";

/**
 * The proposed resolution, under the diff.
 *
 * AGENTS.md § The signature element: the proposal "sits beneath, indented,
 * introduced by → — the visual grammar of a commit message under a diff hunk.
 * The rationale is sans, because it is Canon speaking, not a source system."
 *
 * That split is load-bearing. The value on the arrow is mono because it came out
 * of a source system; the sentence under it is sans because it did not.
 */
export function RationaleBlock({
  resolution,
  className,
}: {
  resolution: QueueResolution;
  className?: string;
}) {
  const chosen =
    resolution.status === "overridden" && resolution.overrideValue
      ? resolution.overrideValue
      : resolution.proposedValue;

  // A rule that says `escalate` produces no value at all. Saying "escalated"
  // where the value would go is more honest than an empty arrow, and it is what
  // the reviewer is being asked to act on.
  const headline = chosen.length > 0 ? chosen : "escalated";

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-mono text-value text-g-500">
          →{" "}
          <span className="font-medium text-g-900">{headline}</span>
        </span>

        <span className="font-mono text-value text-g-500">
          {resolution.appliedRuleStrategy ?? resolution.appliedRuleId ?? "no rule"}
          {resolution.proposedValue.length > 0
            ? ` · ${formatConfidence(resolution.confidence)}`
            : null}
        </span>
      </div>

      {resolution.rationale ? (
        <p className="max-w-[62ch] text-body text-g-700">{resolution.rationale}</p>
      ) : null}

      {/* The proposal is not deleted when a human disagrees with it. Both values
          and the reviewer stay on the record (wireframe 1l). */}
      {resolution.status === "overridden" && resolution.overrideValue ? (
        <p className="font-mono text-value text-g-500">
          proposed {resolution.proposedValue || "nothing"} → chose{" "}
          <span className="font-medium text-g-900">{resolution.overrideValue}</span>
        </p>
      ) : null}
    </div>
  );
}
