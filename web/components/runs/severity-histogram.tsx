import { cn } from "@/lib/cn";
import { formatCount } from "@/lib/format";
import {
  SEVERITY_HISTOGRAM_LABEL,
  SEVERITY_ORDER,
  type SeverityBreakdown,
  type Severity,
} from "@/types/conflict";

/**
 * Wireframe 1g — severity is the handoff into review.
 *
 * This is the one place a run's output is shown as a shape rather than a
 * number, and the shape is the point: a run with 41 structural conflicts and a
 * run with 4 need different amounts of a reviewer's evening.
 *
 * Bars are grayscale and ordered by severity, so weight and position agree —
 * the darkest bar is always the one at the top and always the one that breaks
 * rollups. Every bar carries its mark and its word; the fill alone never
 * carries the level.
 */
const BAR_FILL: Record<Severity, string> = {
  4: "bg-g-900",
  3: "bg-g-700",
  2: "bg-g-400",
  1: "bg-g-300",
};

const MARK: Record<Severity, string> = {
  4: "████",
  3: "███░",
  2: "██░░",
  1: "█░░░",
};

export function SeverityHistogram({
  breakdown,
  /** The one animated moment: rows arrive in order of severity, 20ms apart. */
  stagger = false,
  className,
}: {
  breakdown: SeverityBreakdown;
  stagger?: boolean;
  className?: string;
}) {
  const total = SEVERITY_ORDER.reduce((sum, level) => sum + breakdown[level], 0);
  // Scaled to the largest bar, not to the total: at a realistic distribution
  // the cosmetic row would otherwise be a stub and the comparison would be lost.
  const peak = Math.max(1, ...SEVERITY_ORDER.map((level) => breakdown[level]));

  return (
    <div className={className}>
      <p className="text-label uppercase text-g-500">By severity</p>

      {total === 0 ? (
        <p className="mt-2 font-mono text-value text-g-400">
          — no conflicts detected
        </p>
      ) : (
        <ul className="mt-2.5 flex flex-col gap-1.5">
          {SEVERITY_ORDER.map((level, index) => {
            const value = breakdown[level];
            return (
              <li
                key={level}
                className={cn("flex items-center gap-3", stagger && "stagger-in")}
                style={stagger ? ({ "--stagger-index": index } as React.CSSProperties) : undefined}
              >
                <span
                  aria-hidden
                  className={cn(
                    "w-[38px] shrink-0 font-mono text-[10px] leading-none tracking-[0.06em]",
                    level >= 3 ? "text-g-900" : "text-g-500",
                  )}
                >
                  {MARK[level]}
                </span>
                <span
                  className={cn(
                    "w-[88px] shrink-0 text-label uppercase",
                    level >= 3 ? "font-semibold text-g-900" : "text-g-500",
                  )}
                >
                  {SEVERITY_HISTOGRAM_LABEL[level]}
                </span>
                {/* Fixed-width track so the bars share a baseline and the eye
                    can compare them without measuring from the label. */}
                <span className="h-[9px] min-w-0 flex-1 max-w-[220px]">
                  <span
                    className={cn("block h-full", BAR_FILL[level])}
                    style={{ width: `${Math.max(value > 0 ? 3 : 0, (value / peak) * 100)}%` }}
                  />
                </span>
                <span className="w-12 shrink-0 text-right font-mono text-value text-g-900">
                  {formatCount(value)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
