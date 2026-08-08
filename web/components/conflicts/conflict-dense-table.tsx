"use client";

import { Fragment } from "react";
import { ResolutionStatusMark } from "@/components/conflicts/resolution-status-mark";
import { ReviewActions } from "@/components/conflicts/review-actions";
import { DiffValue } from "@/components/conflicts/diff-value";
import { cn } from "@/lib/cn";
import { formatConfidence } from "@/lib/format";
import { SEVERITY_LABEL } from "@/types/conflict";
import { conflictFieldLabel, type QueueRow } from "@/types/queue";
import type { ResolutionStatus } from "@/types/resolution";
import type { ReviewSubmit } from "@/components/conflicts/use-review";

/**
 * Wireframe 1k — 36px rows, expand in place.
 *
 * "400 conflicts stay scannable, and the diff still reads left-to-right. weaker:
 * values are not spine-aligned." Both halves of that annotation are true, and
 * they are why this is one of three views rather than the only one: this is the
 * view for triage, the ledger is the view for reading.
 *
 * Sorted by severity then confidence — the same order the server returns, said
 * out loud in the header so a reader does not have to infer it.
 */

/** Eight columns, fixed. Values are mono, so a fixed grid keeps them aligned. */
const GRID = "grid grid-cols-[52px_96px_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_84px_52px_84px]";

export function ConflictDenseTable({
  rows,
  sourceNames,
  selectedIndex,
  onSelect,
  submit,
  pendingId,
  decided,
  overrideConflictId,
  onOverrideOpenChange,
  staggerIndex,
}: {
  rows: QueueRow[];
  sourceNames: { a: string; b: string };
  selectedIndex: number;
  onSelect: (index: number) => void;
  submit: (conflictId: string) => ReviewSubmit;
  pendingId: string | null;
  decided: Record<string, { status: ResolutionStatus; reviewedBy: string }>;
  overrideConflictId: string | null;
  onOverrideOpenChange: (conflictId: string, open: boolean) => void;
  staggerIndex: (index: number) => number;
}) {
  return (
    <div className="bg-g-0">
      <div className={cn(GRID, "border-b border-hairline-strong px-3 pb-2")}>
        <Th>Sev</Th>
        <Th>Field</Th>
        <Th>{sourceNames.a}</Th>
        <Th>{sourceNames.b}</Th>
        <Th>Proposed</Th>
        <Th>Rule</Th>
        <Th className="text-right">Conf</Th>
        <Th>Status</Th>
      </div>

      {rows.map((row, index) => {
        const expanded = index === selectedIndex;
        const status = decided[row.conflictId]?.status ?? row.resolution?.status ?? null;

        return (
          <Fragment key={row.conflictId}>
            <button
              type="button"
              onClick={() => onSelect(index)}
              aria-expanded={expanded}
              className={cn(
                GRID,
                "stagger-in w-full items-center border-b border-hairline px-3 text-left transition-colors duration-[80ms] ease-canon",
                // 36px in dense tables (AGENTS.md § Layout).
                "min-h-9",
                expanded ? "bg-surface-sunken" : "hover:bg-g-50",
              )}
              style={{ "--stagger-index": staggerIndex(index) } as React.CSSProperties}
            >
              <span
                aria-hidden
                className={cn(
                  "justify-self-start px-1 py-0.5 font-mono text-[10px] leading-none tracking-[0.06em]",
                  SEVERITY_CELL[row.severity],
                )}
              >
                {"█".repeat(row.severity)}
                {"░".repeat(4 - row.severity)}
              </span>
              <span className="sr-only">{SEVERITY_LABEL[row.severity]}</span>

              <Cell className="pr-2 text-g-600">{conflictFieldLabel(row)}</Cell>

              <Cell className="pr-2">
                {row.a.present ? (
                  <DiffValue value={row.a.values[0] ?? ""} against={row.b.values[0] ?? ""} />
                ) : (
                  <span className="text-g-400">∅</span>
                )}
              </Cell>

              <Cell className="pr-2">
                {row.b.present ? (
                  <DiffValue value={row.b.values[0] ?? ""} against={row.a.values[0] ?? ""} />
                ) : (
                  <span className="text-g-400">∅</span>
                )}
              </Cell>

              <Cell className="pr-2 font-medium text-g-900">
                {appliedOrProposed(row) ?? <span className="text-g-400">—</span>}
              </Cell>

              <Cell className="truncate pr-2 text-g-500">
                {row.resolution?.appliedRuleStrategy ??
                  row.resolution?.appliedRuleId ??
                  "—"}
              </Cell>

              <Cell className="pr-2 text-right tabular-nums">
                {row.resolution && row.resolution.proposedValue
                  ? formatConfidence(row.resolution.confidence)
                  : "—"}
              </Cell>

              <ResolutionStatusMark status={status} />
            </button>

            {/* Expand in place: the row grows downward rather than opening a
                panel, so the reader's position in a 400-row list is never lost. */}
            {expanded ? (
              <div className="border-b border-hairline bg-surface-sunken px-3 pb-3 pt-1">
                <div className="flex flex-col gap-2 pl-[52px]">
                  <p className="max-w-[62ch] text-body text-g-700">
                    {row.resolution?.rationale || "No resolution has been proposed yet."}
                  </p>

                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <ReviewActions
                      row={row}
                      submit={submit(row.conflictId)}
                      pending={pendingId === row.conflictId}
                      overrideOpen={overrideConflictId === row.conflictId}
                      onOverrideOpenChange={(open) =>
                        onOverrideOpenChange(row.conflictId, open)
                      }
                    />
                    <span className="font-mono text-value text-g-500">
                      {row.externalId} · {row.entityName}
                    </span>
                  </div>
                </div>
              </div>
            ) : null}
          </Fragment>
        );
      })}
    </div>
  );
}

/** The severity cell's treatment, same four steps as SeverityMark. */
const SEVERITY_CELL: Record<1 | 2 | 3 | 4, string> = {
  4: "bg-ink text-g-0 font-medium",
  3: "border border-g-900 text-g-900 font-medium",
  2: "border border-g-300 text-g-700",
  1: "text-g-500",
};

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("truncate pr-2 text-label uppercase text-g-500", className)}>
      {children}
    </span>
  );
}

function Cell({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("min-w-0 truncate font-mono text-value text-g-900", className)}>
      {children}
    </span>
  );
}

/** What stands, or what was proposed. Null when neither — nothing was applied. */
function appliedOrProposed(row: QueueRow): string | null {
  const { resolution } = row;
  if (!resolution) return null;
  if (resolution.status === "overridden") return resolution.overrideValue;
  return resolution.proposedValue || null;
}
