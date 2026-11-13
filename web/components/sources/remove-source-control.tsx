"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { deleteJson } from "@/lib/api-client";

type RemoveResult = { outcome: "deleted" } | { outcome: "archived"; runs: number };

/**
 * Remove one source, with the consequence stated before it happens.
 *
 * Two outcomes, decided by history rather than by the reviewer: a source no run
 * has read is deleted; one that runs have read is archived, because those runs
 * and their audit trail must stay readable. The prompt says which BEFORE the
 * confirm, using the run count the server already knows — finding out after
 * the click that "delete" meant "archive" would be the console saying one thing
 * and doing another.
 *
 * Two steps, never one: removing is the only destructive control on this
 * screen, and it sits in a row of links a reviewer tabs through quickly.
 */
export function RemoveSourceControl({
  sourceId,
  sourceName,
  runCount,
}: {
  sourceId: string;
  sourceName: string;
  runCount: number;
}) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "confirming" | "pending">("idle");
  const [error, setError] = useState<string | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  const archive = runCount > 0;

  // Keyboard users land on the decision, not back at the start of the row.
  useEffect(() => {
    if (state === "confirming") confirmRef.current?.focus();
  }, [state]);

  async function confirm() {
    setState("pending");
    setError(null);

    const result = await deleteJson<RemoveResult>(`/api/sources/${sourceId}`);
    if (!result.ok) {
      setState("confirming");
      setError(result.message);
      return;
    }

    const notice =
      result.data.outcome === "deleted"
        ? `Deleted ${sourceName}.`
        : `Archived ${sourceName}. ${result.data.runs} ${
            result.data.runs === 1 ? "run still names it" : "runs still name it"
          }, and their audit trail is unchanged.`;
    router.push(`/sources?notice=${encodeURIComponent(notice)}`);
    router.refresh();
  }

  if (state === "idle") {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setState("confirming")}
        aria-label={`Remove ${sourceName}`}
      >
        Remove
      </Button>
    );
  }

  const pending = state === "pending";

  return (
    <div
      role="group"
      aria-label={`Remove ${sourceName}`}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !pending) setState("idle");
      }}
      className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1 py-1"
    >
      <span className="text-body text-g-700">
        {archive
          ? `Archive? ${runCount} ${runCount === 1 ? "run keeps" : "runs keep"} it in history.`
          : "Delete permanently?"}
      </span>
      <Button
        ref={confirmRef}
        type="button"
        variant="outline"
        size="sm"
        onClick={() => void confirm()}
        disabled={pending}
      >
        {pending ? "Removing…" : archive ? "Archive" : "Delete"}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setState("idle")}
        disabled={pending}
      >
        Cancel
      </Button>
      {error ? (
        <span role="alert" className="w-full text-right text-body text-g-900">
          {error}
        </span>
      ) : null}
    </div>
  );
}
