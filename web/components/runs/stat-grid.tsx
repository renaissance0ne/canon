import { cn } from "@/lib/cn";
import { formatCount } from "@/lib/format";
import { isStatKnown, type RunStats, type RunStatus } from "@/types/run";

/** Label and order for every headline number a run produces. */
const FULL: readonly { key: keyof RunStats; label: string }[] = [
  { key: "entitiesA", label: "Entities A" },
  { key: "entitiesB", label: "Entities B" },
  { key: "candidatePairs", label: "Candidate pairs" },
  { key: "matches", label: "Matches" },
  { key: "conflicts", label: "Conflicts" },
  { key: "autoResolved", label: "Auto-applied" },
  { key: "escalated", label: "Escalated" },
  { key: "tokensUsed", label: "Tokens" },
];

/** What a finished run is actually judged on (wireframe 1g). */
const SUMMARY_KEYS: readonly (keyof RunStats)[] = [
  "matches",
  "conflicts",
  "autoResolved",
  "escalated",
];

/**
 * Wireframes 1f and 1g. Four columns, hairlines only, no card.
 *
 * A number that its stage has not produced yet renders as an em dash rather
 * than as zero — "0 matches" and "matching has not run" are different facts,
 * and this grid is read mid-pipeline.
 */
export function StatGrid({
  stats,
  status,
  variant = "full",
  className,
}: {
  stats: RunStats;
  status: RunStatus;
  variant?: "full" | "summary";
  className?: string;
}) {
  const items = variant === "summary" ? FULL.filter((s) => SUMMARY_KEYS.includes(s.key)) : FULL;

  return (
    <dl
      className={cn(
        "grid grid-cols-2 border-t border-hairline-strong sm:grid-cols-4",
        className,
      )}
    >
      {items.map(({ key, label }, index) => {
        const known = isStatKnown(key, status);
        return (
          <div
            key={key}
            className={cn(
              "py-2.5 pr-4",
              // Second row onward gets its own hairline, matching the wireframe's
              // 4×2 grid. Nothing separates the columns: the labels do that.
              index >= 4 && "border-t border-hairline",
            )}
          >
            <dt className="text-label uppercase text-g-500">{label}</dt>
            <dd
              className={cn(
                "mt-0.5 font-mono text-value",
                known ? "font-medium text-g-900" : "text-g-400",
              )}
            >
              {known ? formatCount(stats[key]) : "—"}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
