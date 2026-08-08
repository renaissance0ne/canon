"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ConflictDenseTable } from "@/components/conflicts/conflict-dense-table";
import { ConflictDiffRow } from "@/components/conflicts/conflict-diff-row";
import { ConflictFocus } from "@/components/conflicts/conflict-focus";
import { useReview, type ReviewSubmit } from "@/components/conflicts/use-review";
import type { QueueRow, QueueView } from "@/types/queue";
import type { ReviewAction } from "@/types/resolution";

/**
 * The queue body: one of three views (1i ledger, 1j focus, 1k dense) over the
 * same rows, plus the keyboard layer.
 *
 * This is the only Client Component in the review path. The filters, the counts
 * and the rows themselves are server-rendered; what needs the browser is
 * selection, the review submit, and the keys.
 *
 * KEYS (AGENTS.md § Quality floor: "A reviewer working a queue of 400 should
 * never touch the mouse."):
 *
 *   j / k or ↓ / ↑   move
 *   a                approve
 *   o                override — opens the editor, focus lands in the field
 *   r                reject
 *   e or s           leave escalated and move on
 *   Escape           close the override editor
 *
 * `e` is the wireframe's own hint, and it means what it can mean: there is no
 * human "escalate" action, because the conflict is already escalated. Leaving it
 * alone and moving on is the decision that key expresses, so that is what it
 * does — rather than writing a review action the contract does not have.
 */
export function ConflictQueue({
  rows,
  view,
  sourceNames,
  total,
}: {
  rows: QueueRow[];
  view: QueueView;
  sourceNames: { a: string; b: string };
  total: number;
}) {
  const { submit, pendingId, decided } = useReview();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [overrideConflictId, setOverrideConflictId] = useState<string | null>(null);

  // Selection deliberately survives a refresh: after a decision the reviewer
  // stays where they were, and if the row left the filter the next conflict slides
  // under the cursor. A new page or filter resets it instead — the page gives this
  // component a `key` per query, so React remounts it rather than an effect
  // reaching in to reset state after the fact.
  const clamped = Math.min(selectedIndex, Math.max(0, rows.length - 1));
  const selected = rows[clamped];

  /** A submit bound to one conflict, so each view hands its rows a plain callback. */
  const submitFor = useCallback(
    (conflictId: string): ReviewSubmit =>
      (action: ReviewAction) =>
        submit(conflictId, action),
    [submit],
  );

  const move = useCallback(
    (delta: number) => {
      setOverrideConflictId(null);
      setSelectedIndex((current) =>
        Math.max(0, Math.min(rows.length - 1, current + delta)),
      );
    },
    [rows.length],
  );

  const setOverrideOpen = useCallback((conflictId: string, open: boolean) => {
    setOverrideConflictId(open ? conflictId : null);
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // Never steal a key from a field. The override editor and the note box are
      // both text inputs inside this same tree.
      if (isTyping(event.target)) {
        if (event.key === "Escape") setOverrideConflictId(null);
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (!selected) return;

      switch (event.key) {
        case "j":
        case "ArrowDown":
          event.preventDefault();
          move(1);
          break;
        case "k":
        case "ArrowUp":
          event.preventDefault();
          move(-1);
          break;
        case "a": {
          // Approving nothing is not a decision; when a rule said `escalate`
          // there is no proposed value and the reviewer has to choose a side.
          if (!selected.resolution?.proposedValue) return;
          event.preventDefault();
          void submit(selected.conflictId, { action: "approve" });
          break;
        }
        case "o":
          event.preventDefault();
          setOverrideConflictId(selected.conflictId);
          break;
        case "r":
          event.preventDefault();
          void submit(selected.conflictId, { action: "reject" });
          break;
        case "e":
        case "s":
          event.preventDefault();
          move(1);
          break;
        case "Escape":
          setOverrideConflictId(null);
          break;
        default:
          break;
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [move, selected, submit]);

  // The one animated moment: rows arrive in order of severity, 20ms apart. Capped
  // so a full page of 100 does not spend two seconds fading in — past the cap the
  // rest arrive together, which is honest: the ordering has already been read.
  const staggerIndex = useMemo(() => (index: number) => Math.min(index, 24), []);

  if (view === "focus") {
    return (
      <ConflictFocus
        rows={rows}
        total={total}
        selectedIndex={clamped}
        onSelect={setSelectedIndex}
        submit={submitFor}
        pendingId={pendingId}
        decided={decided}
        overrideConflictId={overrideConflictId}
        onOverrideOpenChange={setOverrideOpen}
      />
    );
  }

  if (view === "dense") {
    return (
      <ConflictDenseTable
        rows={rows}
        sourceNames={sourceNames}
        selectedIndex={clamped}
        onSelect={setSelectedIndex}
        submit={submitFor}
        pendingId={pendingId}
        decided={decided}
        overrideConflictId={overrideConflictId}
        onOverrideOpenChange={setOverrideOpen}
        staggerIndex={staggerIndex}
      />
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      {rows.map((row, index) => (
        <ConflictDiffRow
          key={row.conflictId}
          row={row}
          selected={index === clamped}
          onSelect={() => setSelectedIndex(index)}
          submit={submitFor(row.conflictId)}
          pending={pendingId === row.conflictId}
          decidedStatus={decided[row.conflictId]?.status ?? null}
          overrideOpen={overrideConflictId === row.conflictId}
          onOverrideOpenChange={(open) => setOverrideOpen(row.conflictId, open)}
          staggerIndex={staggerIndex(index)}
        />
      ))}
    </div>
  );
}

/** True when the event came from somewhere a keystroke means a character. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT" ||
    target.isContentEditable
  );
}

/**
 * The key legend under the queue. Rendered here rather than on the page so the
 * hints and the handler above can never disagree about what a key does.
 */
export function QueueKeyHints({ view }: { view: QueueView }) {
  const keys: readonly [string, string][] = [
    ["j / k", "move"],
    ["a", "approve"],
    ["o", "override"],
    ["r", "reject"],
    ["e", "leave escalated"],
  ];

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 font-mono text-[11px] text-g-500">
      {keys.map(([key, label]) => (
        <span key={key} className="inline-flex items-center gap-1.5">
          <kbd className="rounded-[2px] border border-hairline-strong px-1 py-0.5">
            {key}
          </kbd>
          {label}
        </span>
      ))}
      <span className="text-g-400">
        {view === "focus"
          ? "the list stays put — only the right pane changes"
          : "a reviewer working a queue of 400 should never touch the mouse"}
      </span>
    </div>
  );
}
