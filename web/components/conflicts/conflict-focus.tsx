"use client";

import { useEffect, useRef } from "react";
import { SeverityMark } from "@/components/severity-mark";
import { ConflictSides } from "@/components/conflicts/conflict-sides";
import { ResolutionStatusMark } from "@/components/conflicts/resolution-status-mark";
import { ReviewActions } from "@/components/conflicts/review-actions";
import { RuleTrace } from "@/components/conflicts/rule-trace";
import { cn } from "@/lib/cn";
import { formatConfidence } from "@/lib/format";
import { SEVERITY_LABEL } from "@/types/conflict";
import { conflictFieldLabel, severityReason, type QueueRow } from "@/types/queue";
import type { ResolutionStatus } from "@/types/resolution";
import type { ReviewSubmit } from "@/components/conflicts/use-review";

/**
 * Wireframe 1j — list on the left, one hero diff on the right.
 *
 * "list stays put. only the right pane changes — no re-anchoring between
 * conflicts." That is the argument for this view: a reviewer working 61
 * escalations reads the same three positions 61 times instead of hunting down a
 * scrolling page, which is what makes a keyboard-only pass possible.
 *
 * The list scrolls independently and the selected row is kept in view, so j/k
 * never walks the selection off screen.
 */
export function ConflictFocus({
  rows,
  selectedIndex,
  onSelect,
  submit,
  pendingId,
  decided,
  overrideConflictId,
  onOverrideOpenChange,
  total,
}: {
  rows: QueueRow[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  submit: (conflictId: string) => ReviewSubmit;
  pendingId: string | null;
  decided: Record<string, { status: ResolutionStatus; reviewedBy: string }>;
  overrideConflictId: string | null;
  onOverrideOpenChange: (conflictId: string, open: boolean) => void;
  total: number;
}) {
  const row = rows[selectedIndex];

  return (
    <div className="grid grid-cols-1 border border-hairline bg-g-0 md:grid-cols-[258px_1fr]">
      <nav
        aria-label="Conflicts"
        className="max-h-[560px] overflow-y-auto border-b border-hairline-strong md:border-b-0 md:border-r"
      >
        <ol>
          {rows.map((candidate, index) => (
            <ListRow
              key={candidate.conflictId}
              row={candidate}
              index={index}
              selected={index === selectedIndex}
              status={decided[candidate.conflictId]?.status ?? candidate.resolution?.status ?? null}
              onSelect={() => onSelect(index)}
            />
          ))}
        </ol>
      </nav>

      {row ? (
        <FocusPane
          row={row}
          position={selectedIndex + 1}
          total={total}
          submit={submit(row.conflictId)}
          pending={pendingId === row.conflictId}
          decidedStatus={decided[row.conflictId]?.status ?? null}
          overrideOpen={overrideConflictId === row.conflictId}
          onOverrideOpenChange={(open) => onOverrideOpenChange(row.conflictId, open)}
        />
      ) : (
        <p className="p-4 text-body text-g-500">Nothing selected.</p>
      )}
    </div>
  );
}

function ListRow({
  row,
  index,
  selected,
  status,
  onSelect,
}: {
  row: QueueRow;
  index: number;
  selected: boolean;
  status: ResolutionStatus | null;
  onSelect: () => void;
}) {
  const ref = useRef<HTMLLIElement>(null);

  // Keep the keyboard target visible. `nearest` rather than `center` so a mouse
  // click does not yank the list around under the pointer.
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  return (
    <li ref={ref} className="border-b border-hairline last:border-b-0">
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? "true" : undefined}
        className={cn(
          "flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors duration-[80ms] ease-canon",
          selected ? "bg-ink text-g-0" : "hover:bg-g-100",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "shrink-0 font-mono text-[10px] leading-none tracking-[0.06em]",
            selected ? "text-g-0" : row.severity >= 3 ? "text-g-900" : "text-g-500",
          )}
        >
          {"█".repeat(row.severity)}
          {"░".repeat(4 - row.severity)}
        </span>

        <span className="min-w-0 flex-1">
          <span
            className={cn(
              "block text-label uppercase",
              selected ? "text-g-0" : "text-g-500",
            )}
          >
            {/* The class, not the severity word: in a list of escalations the
                interesting distinction is orphan vs duplicate vs structural. */}
            {row.conflictClass}
          </span>
          <span
            className={cn(
              "block truncate font-mono text-value",
              selected ? "text-g-0" : "text-g-900",
            )}
          >
            {row.externalId}
            {/* The field only earns list space when it is the disagreement. For
                an orphan or a duplicate the whole record is. */}
            {row.conflictClass === "orphan" || row.conflictClass === "duplicate"
              ? ""
              : ` · ${row.field}`}
          </span>
        </span>

        {selected ? (
          <span aria-hidden className="shrink-0 font-mono text-value text-g-300">
            ▸
          </span>
        ) : null}

        <span className="sr-only">
          {SEVERITY_LABEL[row.severity]}, {status ?? "unresolved"}, conflict {index + 1}
        </span>
      </button>
    </li>
  );
}

function FocusPane({
  row,
  position,
  total,
  submit,
  pending,
  decidedStatus,
  overrideOpen,
  onOverrideOpenChange,
}: {
  row: QueueRow;
  position: number;
  total: number;
  submit: ReviewSubmit;
  pending: boolean;
  decidedStatus: ResolutionStatus | null;
  overrideOpen: boolean;
  onOverrideOpenChange: (open: boolean) => void;
}) {
  const status = decidedStatus ?? row.resolution?.status ?? null;
  const { resolution } = row;

  return (
    <div className="flex min-w-0 flex-col gap-3 p-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <SeverityMark severity={row.severity} />
        <span className="font-mono text-value text-g-600">{conflictFieldLabel(row)}</span>
        <span className="ml-auto font-mono text-value text-g-500">
          {position} of {total}
        </span>
      </div>

      <p className="font-mono text-value text-g-500">
        {row.externalId} · {row.entityName}
        {row.childCount > 0
          ? ` · ${row.childCount} ${row.childCount === 1 ? "child" : "children"}`
          : ""}
      </p>

      {/* The hero diff. Same component as the ledger row, so switching views does
          not move a single value. */}
      <ConflictSides
        row={row}
        size="lg"
        className="border-y border-hairline-strong"
      />

      <p className="font-mono text-value text-g-500">
        severity {row.severity} — {severityReason(row)}
      </p>

      <RuleTrace row={row} />

      {resolution ? (
        <div className="border-l-2 border-g-900 pl-3">
          <p className="text-label uppercase text-g-500">Rationale</p>
          <p className="mt-0.5 max-w-[62ch] text-body text-g-700">
            {resolution.rationale || "No rationale was recorded."}
          </p>
          <p className="mt-1 font-mono text-value text-g-500">
            {resolution.appliedRuleStrategy ?? resolution.appliedRuleId ?? "no rule"}
            {resolution.proposedValue
              ? ` · ${resolution.proposedValue} · ${formatConfidence(resolution.confidence)}`
              : " · no value proposed"}
          </p>
        </div>
      ) : null}

      <div className="mt-auto flex flex-col gap-2 border-t border-hairline pt-3">
        <ResolutionStatusMark status={status} />
        <ReviewActions
          row={row}
          submit={submit}
          pending={pending}
          overrideOpen={overrideOpen}
          onOverrideOpenChange={onOverrideOpenChange}
        />
      </div>
    </div>
  );
}
