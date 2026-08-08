"use client";

import { SeverityMark } from "@/components/severity-mark";
import { ConflictSides } from "@/components/conflicts/conflict-sides";
import { RationaleBlock } from "@/components/conflicts/rationale-block";
import { ResolutionStatusMark } from "@/components/conflicts/resolution-status-mark";
import { ReviewActions } from "@/components/conflicts/review-actions";
import { cn } from "@/lib/cn";
import { conflictFieldLabel, severityReason, type QueueRow } from "@/types/queue";
import type { ResolutionStatus } from "@/types/resolution";
import type { ReviewSubmit } from "@/components/conflicts/use-review";

/**
 * Wireframe 1i — the stacked ledger row, and 1m — the same row with one side
 * missing. One component, because they are the same unit: an orphan is not a
 * different kind of conflict, it is a conflict where one side has nothing to say.
 *
 * Three parts, top to bottom (AGENTS.md § The signature element):
 *
 *   header    severity mark + word, the field, the entity it belongs to
 *   spine     the two sources, 50/50, one hairline between them
 *   proposal  indented under the diff, introduced by →, rationale in sans
 *
 * Square, opaque, hairlines only. A diff row is a data surface, so it is never
 * glass, never rounded and never raised by a shadow.
 */
export function ConflictDiffRow({
  row,
  submit,
  pending,
  /** The status the server just wrote, before the page refresh lands. */
  decidedStatus,
  selected,
  overrideOpen,
  onOverrideOpenChange,
  onSelect,
  staggerIndex,
}: {
  row: QueueRow;
  submit: ReviewSubmit;
  pending: boolean;
  decidedStatus: ResolutionStatus | null;
  selected: boolean;
  overrideOpen: boolean;
  onOverrideOpenChange: (open: boolean) => void;
  onSelect: () => void;
  staggerIndex: number;
}) {
  const status = decidedStatus ?? row.resolution?.status ?? null;

  return (
    <article
      // Clicking anywhere in the row makes it the keyboard target, so j/k and
      // the mouse never disagree about which conflict is "current".
      onMouseDown={onSelect}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "stagger-in bg-g-0 transition-colors duration-[80ms] ease-canon",
        // Selection is a 2px left mark and a stronger frame — no fill, because
        // fill is severity's job on this row.
        selected
          ? "border border-g-900 border-l-2"
          : "border border-hairline hover:border-hairline-strong",
      )}
      style={{ "--stagger-index": staggerIndex } as React.CSSProperties}
    >
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-hairline px-3 py-2">
        <SeverityMark severity={row.severity} />
        <span className="font-mono text-value text-g-600">
          {conflictFieldLabel(row)}
        </span>
        <span className="ml-auto font-mono text-value text-g-500">
          {row.externalId} · {row.entityName}
        </span>
      </header>

      <ConflictSides row={row} />

      <footer className="flex flex-col gap-2 border-t border-hairline bg-surface-sunken px-3 py-2.5">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          {row.resolution ? (
            <RationaleBlock
              resolution={
                // The status the server just wrote wins over the one this page was
                // rendered with, so an approved row does not read as escalated for
                // the second it takes the refresh to arrive.
                decidedStatus ? { ...row.resolution, status: decidedStatus } : row.resolution
              }
              className="min-w-0 flex-1"
            />
          ) : (
            <p className="min-w-0 flex-1 text-body text-g-500">
              Detected, not yet resolved.
            </p>
          )}

          <ResolutionStatusMark status={status} className="shrink-0" />
        </div>

        {/* Why this is a 4 and not a 2. Shown for the two whole-record classes
            and for anything still unresolved, where it is the news; on an
            ordinary field diff the mark and the field name already say it. */}
        {explainSeverity(row) ? (
          <p className="font-mono text-value text-g-500">
            severity {row.severity} — {severityReason(row)}
          </p>
        ) : null}

        {/* At rest, an auto-applied row is information, not a question — 1i shows
            controls only on the row asking for a decision. Selecting a row brings
            them back, so an auto-applied decision can always be overridden. */}
        {actionable(status) || selected ? (
          <ReviewActions
            row={row}
            submit={submit}
            pending={pending}
            overrideOpen={overrideOpen}
            onOverrideOpenChange={onOverrideOpenChange}
          />
        ) : null}
      </footer>
    </article>
  );
}

/**
 * A conflict still waiting on a decision. `escalated` is the queue's whole
 * reason for existing; `proposed` means the resolve stage produced a value but
 * the gate has not filed it yet, which is also a person's problem.
 */
function actionable(status: ResolutionStatus | null): boolean {
  return status === "escalated" || status === "proposed" || status === null;
}

/** Where the severity number is itself the news rather than a restatement. */
function explainSeverity(row: QueueRow): boolean {
  return (
    row.conflictClass === "orphan" ||
    row.conflictClass === "duplicate" ||
    row.resolution === null
  );
}
