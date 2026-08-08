"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { OverridePanel } from "@/components/conflicts/override-panel";
import { cn } from "@/lib/cn";
import { observedValues } from "@/lib/validate-value";
import { isHumanDecided } from "@/types/resolution";
import type { QueueRow } from "@/types/queue";
import type { ReviewSubmit } from "@/components/conflicts/use-review";

/**
 * Approve / override / reject (wireframes 1i, 1j, 1k, 1l).
 *
 * Two shapes, decided by whether anything was ever proposed:
 *
 *   a value was proposed   Approve · Override… · Reject
 *   nothing was proposed   Take <source A> · Take <source B> · Reject
 *
 * The second shape is the honest reading of 1j's "Approve Salesforce". When a
 * rule said `escalate`, no value exists to approve — choosing a side is a human
 * picking a value the system declined to pick, which IS an override and is
 * recorded as one. Labelling it "approve" would put a decision in the audit trail
 * under the wrong name.
 */
export function ReviewActions({
  row,
  submit,
  pending,
  /** Set while the override editor is open, so the row can grow to fit it. */
  overrideOpen,
  onOverrideOpenChange,
  className,
}: {
  row: QueueRow;
  submit: ReviewSubmit;
  pending: boolean;
  overrideOpen: boolean;
  onOverrideOpenChange: (open: boolean) => void;
  className?: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const { resolution } = row;

  // Nothing to review yet — the resolve stage has not reached this conflict.
  if (!resolution) {
    return (
      <p className={cn("text-body text-g-500", className)}>
        Not resolved yet. The run is still working through the queue.
      </p>
    );
  }

  const observed = observedValues(row);
  const hasProposal = resolution.proposedValue.length > 0;

  async function run(action: Parameters<ReviewSubmit>[0]) {
    setError(null);
    const result = await submit(action);
    if (!result.ok) setError(result.message);
    else onOverrideOpenChange(false);
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {overrideOpen ? (
        <OverridePanel
          row={row}
          pending={pending}
          onCancel={() => onOverrideOpenChange(false)}
          onSubmit={(overrideValue, note) =>
            run({ action: "override", overrideValue, note })
          }
        />
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {hasProposal ? (
            <Button size="sm" disabled={pending} onClick={() => run({ action: "approve" })}>
              Approve
            </Button>
          ) : (
            // One button per side. Fast, and each one names the system it takes
            // the value from, because that is the decision being made.
            observed.map((value, index) => {
              const side = row.a.values.includes(value) ? row.a : row.b;
              return (
                <Button
                  key={`${value}-${index}`}
                  size="sm"
                  variant={index === 0 ? "primary" : "outline"}
                  disabled={pending}
                  onClick={() => run({ action: "override", overrideValue: value })}
                >
                  Take {side.sourceName}
                </Button>
              );
            })
          )}

          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => onOverrideOpenChange(true)}
          >
            Override…
          </Button>

          <Button
            size="sm"
            variant="quiet"
            disabled={pending}
            onClick={() => run({ action: "reject" })}
          >
            Reject
          </Button>

          {/* Changing a decision is allowed and appends another audit row. Saying
              so is what stops it feeling like the row is stuck. */}
          {isHumanDecided(resolution.status) ? (
            <span className="font-mono text-value text-g-500">
              {resolution.reviewedBy ? `reviewed by ${resolution.reviewedBy}` : "reviewed"}
              {" · deciding again appends a new audit entry"}
            </span>
          ) : null}
        </div>
      )}

      {error ? (
        <p role="alert" className="border-l-2 border-g-900 pl-2 text-body text-g-900">
          {error}
        </p>
      ) : null}
    </div>
  );
}
