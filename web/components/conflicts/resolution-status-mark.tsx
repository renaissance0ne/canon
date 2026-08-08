import { cn } from "@/lib/cn";
import {
  RESOLUTION_STATUS_GLYPH,
  RESOLUTION_STATUS_LABEL,
  isHumanDecided,
  type ResolutionStatus,
} from "@/types/resolution";

/**
 * AGENTS.md § Encoding severity without color: "Resolution status uses shape
 * rather than fill" — fill is already spoken for by severity, and four shades of
 * gray doing two different jobs is how a grayscale interface stops working.
 *
 *   ◦ proposed · ● auto-applied · ■ escalated · ✓ approved · / rejected
 *   ■/ overridden
 *
 * Glyph plus word, always. Same rule as SeverityMark: the mark is learnable, the
 * word is legible on the first read.
 */
export function ResolutionStatusMark({
  status,
  className,
}: {
  /** Null before the resolve stage reaches this conflict. */
  status: ResolutionStatus | null;
  className?: string;
}) {
  if (status === null) {
    return (
      <span className={cn("font-mono text-value text-g-400", className)}>
        — unresolved
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex items-baseline gap-1.5 font-mono text-value",
        // A human's decision outranks the machine's on the same row, so it is
        // the one that gets full contrast.
        isHumanDecided(status) ? "text-g-900" : "text-g-500",
        className,
      )}
    >
      <span aria-hidden className="inline-block min-w-[1.5ch]">
        {RESOLUTION_STATUS_GLYPH[status]}
      </span>
      {RESOLUTION_STATUS_LABEL[status]}
    </span>
  );
}
