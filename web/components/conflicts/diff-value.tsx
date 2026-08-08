import { cn } from "@/lib/cn";
import { diffSegments } from "@/lib/diff-chars";

/**
 * One value from one source system, with the characters that differ from the
 * other side carrying the weight.
 *
 * AGENTS.md § The signature element: "The differing characters within a value
 * get --g-900 at 500 weight while the shared prefix stays --g-500.
 * Character-level emphasis is doing the work a red/green diff would normally
 * do." That is the whole reason this component exists instead of a `<span>`.
 *
 * Always mono: this is a value from a source system, not Canon talking.
 */
export function DiffValue({
  value,
  /** The other side's value. Emphasis is relative to it, so both sides pass it. */
  against,
  className,
}: {
  value: string;
  against: string;
  className?: string;
}) {
  const { prefix, middle, suffix } = diffSegments(value, against);

  return (
    <span className={cn("font-mono text-value break-all text-g-500", className)}>
      {prefix}
      {middle ? <span className="font-medium text-g-900">{middle}</span> : null}
      {suffix}
    </span>
  );
}

/**
 * The side with no record on it (wireframe 1m).
 *
 * Hatched rather than blank, and it says what is missing in words. "the spine
 * survives an empty side — hatching, not a blank cell, so a missing value never
 * reads as a rendering bug." A grayscale interface has no red to signal
 * "nothing here", so absence has to be drawn.
 */
export function AbsentValue({ className }: { className?: string }) {
  return (
    <span className={cn("font-mono text-value text-g-400", className)}>
      ∅ not present
    </span>
  );
}

/**
 * The repeating hatch a missing side is filled with. Two grays at 45°, no hue,
 * no gradient — it reads as "deliberately empty" at any zoom.
 */
export const ABSENT_FILL =
  "bg-[repeating-linear-gradient(135deg,var(--color-g-50)_0_5px,var(--color-g-0)_5px_10px)]";
