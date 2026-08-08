import { cn } from "@/lib/cn";
import { formatRelative } from "@/lib/format";
import { ABSENT_FILL, AbsentValue, DiffValue } from "@/components/conflicts/diff-value";
import type { ConflictSide, QueueRow } from "@/types/queue";

/**
 * The two source columns and the spine between them.
 *
 * AGENTS.md § The signature element:
 *
 *   - a 1px vertical hairline spine splits the two sources, "the only structural
 *     line in the row, and it never moves — column widths are fixed at 50% so
 *     the eye can scan a stack of rows without re-anchoring"
 *   - values are left-aligned to the spine on both sides, so differing
 *     characters land in roughly the same optical position
 *   - at 768px the columns stack and the spine becomes a horizontal rule
 *
 * Used by the ledger row and by the focus pane, so both are anchored identically
 * and switching views does not move the values.
 */
export function ConflictSides({
  row,
  /** `lg` for the focus pane's hero diff, where there is room to breathe. */
  size = "default",
  className,
}: {
  row: QueueRow;
  size?: "default" | "lg";
  className?: string;
}) {
  return (
    <div
      className={cn(
        // Stacked below 768px; two fixed halves above it. The spine is the
        // right border of the first cell, so it cannot drift.
        "grid grid-cols-1 md:grid-cols-2",
        className,
      )}
    >
      <Side
        side={row.a}
        against={row.b}
        size={size}
        signals={row.matchSignals}
        className="border-b border-hairline-strong md:border-b-0 md:border-r"
      />
      <Side side={row.b} against={row.a} size={size} signals={row.matchSignals} />
    </div>
  );
}

function Side({
  side,
  against,
  size,
  signals,
  className,
}: {
  side: ConflictSide;
  against: ConflictSide;
  size: "default" | "lg";
  signals: QueueRow["matchSignals"];
  className?: string;
}) {
  // Emphasis is relative to the other side, and an absent side offers nothing to
  // compare against — so a lone value stays quiet rather than lighting up whole.
  const other = against.values[0] ?? "";

  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-1 px-3 py-2.5",
        !side.present && ABSENT_FILL,
        className,
      )}
    >
      <p className="text-label uppercase text-g-500">{side.sourceName}</p>

      {side.present ? (
        <div className="flex flex-col gap-0.5">
          {side.values.map((value, index) => (
            <DiffValue
              key={`${value}-${index}`}
              value={value}
              against={other}
              className={size === "lg" ? "text-[13px]" : undefined}
            />
          ))}
        </div>
      ) : (
        <AbsentValue />
      )}

      {provenance(side) ? (
        <p className="text-body text-g-500">{provenance(side)}</p>
      ) : null}

      {/* Why these two records were believed to be the same thing. Only shown on
          the side holding more than one — that is a duplicate, and "cosine 0.97 ·
          fuzzy 94" is the evidence a reviewer needs to agree they are the same
          company before agreeing that one system is double-counting it (1m). */}
      {side.values.length > 1 ? (
        <p className="font-mono text-[11px] leading-4 text-g-500">
          cosine {signals.cosine.toFixed(2)} · fuzzy {Math.round(signals.fuzzyRatio)}
          {signals.exactKey ? " · exact key" : ""}
        </p>
      ) : null}
    </div>
  );
}

/**
 * "modified 2d ago · by ops@" (wireframe 1j). Coarse on purpose — recency
 * survivorship cares about days, and a reviewer comparing 2 days against 61 does
 * not need the minutes.
 *
 * `lastModifiedBy` is only present when the source carries it, so this degrades
 * to the timestamp alone rather than inventing an actor.
 */
function provenance(side: ConflictSide): string {
  const parts: string[] = [];

  if (side.lastModifiedAt) parts.push(`modified ${formatRelative(side.lastModifiedAt)}`);
  else if (side.present) parts.push("no modified date");

  if (side.modifiedBy) parts.push(`by ${side.modifiedBy}`);

  return parts.join(" · ");
}
