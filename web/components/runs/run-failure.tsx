"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { RunStageBar } from "@/components/runs/run-stage-bar";
import { postJson } from "@/lib/api-client";
import { failedStage, type RunDetail } from "@/types/run";

/**
 * Wireframe 1h — failure is a state, not a toast. It is written to the run row,
 * so it survives a reload, a new tab and a different machine.
 *
 * No partial output is kept. A run that died halfway would otherwise leave
 * entities and matches behind that no conflict ever referenced, and a later
 * reader would have no way to tell them from a complete run's output.
 */
export function RunFailure({ run }: { run: RunDetail }) {
  const router = useRouter();
  const [starting, setStarting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  /**
   * Re-run means the SAME two sources and the SAME ruleset version — not "the
   * current active policy". A re-run that quietly switched policy would not be
   * a retry, it would be a different experiment with the same name.
   */
  async function rerun() {
    setMessage(null);
    setStarting(true);

    const result = await postJson<{ runId: string }>("/api/runs", {
      sourceAId: run.sourceAId,
      sourceBId: run.sourceBId,
      rulesetId: run.rulesetId,
    });

    if (!result.ok) {
      setStarting(false);
      setMessage(result.message);
      return;
    }

    router.push(`/runs/${result.data.runId}`);
    router.refresh();
  }

  return (
    <div className="flex max-w-[560px] flex-col gap-5">
      <RunStageBar status="failed" diedAt={failedStage(run.error)} />

      <div className="border border-g-900 bg-surface-sunken px-4 py-3">
        <p className="text-label uppercase text-g-500">Error</p>
        <pre className="mt-1.5 whitespace-pre-wrap break-words font-mono text-value text-g-700">
          {run.error ?? "The engine reported a failure without a message."}
        </pre>
      </div>

      <p className="text-body text-g-600">
        No partial output is kept. The failure is recorded and the run is
        re-runnable against{" "}
        <span className="font-mono text-value text-g-900">
          {run.rulesetName} v{run.rulesetVersion}
        </span>
        , the same policy version this one used.
      </p>

      {message ? (
        <p role="alert" className="border border-g-900 bg-surface-sunken px-3 py-2 text-body text-g-900">
          {message}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={rerun} disabled={starting} type="button">
          {starting ? "Starting…" : "Re-run"}
        </Button>
        <Button asChild variant="outline">
          <Link href={`/audit?runId=${run.id}`} className="no-underline">
            Open audit entry
          </Link>
        </Button>
      </div>
    </div>
  );
}
