"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { QueryProvider } from "@/components/query-provider";
import { RunProgressBar, RunStageBar } from "@/components/runs/run-stage-bar";
import { StatGrid } from "@/components/runs/stat-grid";
import { formatElapsed } from "@/lib/format";
import {
  engineRunStatusSchema,
  isTerminalRunStatus,
  type EngineRunStatus,
} from "@/types/run";

/** Fast enough to feel live, slow enough that a 10-minute run is 300 requests. */
const POLL_INTERVAL_MS = 2_000;

type Props = {
  runId: string;
  startedAt: Date;
  initial: EngineRunStatus;
};

/**
 * Wireframe 1f — the only polled surface in the app. Everything else is a
 * server render.
 *
 * When the run reaches a terminal state this component stops polling and asks
 * the server to re-render the page, which hands over to the complete (1g) or
 * failed (1h) view. The finished states are deliberately NOT drawn here: they
 * need the severity breakdown and the audit trail, both of which are database
 * reads that belong on the server.
 */
export function RunLive(props: Props) {
  return (
    <QueryProvider>
      <RunProgress {...props} />
    </QueryProvider>
  );
}

function RunProgress({ runId, startedAt, initial }: Props) {
  const router = useRouter();

  const { data, isError } = useQuery({
    queryKey: ["run-status", runId],
    queryFn: async (): Promise<EngineRunStatus> => {
      const response = await fetch(`/api/runs/${runId}/status`, { cache: "no-store" });
      if (!response.ok) throw new Error(`Status request failed (${response.status}).`);
      // Parsed, not trusted: this is the tool contract, and a shape change
      // should surface here rather than as a blank stat three renders later.
      return engineRunStatusSchema.parse(await response.json());
    },
    initialData: initial,
    refetchInterval: (query) =>
      query.state.data && isTerminalRunStatus(query.state.data.status)
        ? false
        : POLL_INTERVAL_MS,
  });

  const terminal = isTerminalRunStatus(data.status);

  // Hand back to the server the moment the run finishes. router.refresh()
  // re-renders the Server Component above with the run's real output.
  useEffect(() => {
    if (terminal) router.refresh();
  }, [terminal, router]);

  return (
    <div className="flex max-w-[640px] flex-col gap-5">
      <div className="flex items-baseline justify-between gap-4">
        <RunStageBar status={data.status} />
        <Elapsed startedAt={startedAt} running={!terminal} />
      </div>

      <RunProgressBar status={data.status} />

      <StatGrid stats={data.stats} status={data.status} />

      <p className="text-body text-g-500">
        {isError
          ? "Status is stale — the engine is not answering. The run continues; this screen will catch up."
          : "Polled every two seconds. Leaving this page does not stop the run."}
      </p>
    </div>
  );
}

/**
 * A live clock. The only ticking thing in the console.
 *
 * Starts null and fills in after mount rather than reading the clock during
 * render: the server and the browser would compute different values a moment
 * apart, and React would report that as a hydration mismatch. The slot keeps
 * its width so nothing shifts when the first tick lands.
 */
function Elapsed({ startedAt, running }: { startedAt: Date; running: boolean }) {
  const [elapsed, setElapsed] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => setElapsed(Date.now() - startedAt.getTime());
    tick();
    if (!running) return;

    const id = setInterval(tick, 1_000);
    return () => clearInterval(id);
  }, [running, startedAt]);

  return (
    <p className="shrink-0 font-mono text-value tabular-nums text-g-500">
      <span className="inline-block min-w-[5ch] text-right">
        {elapsed === null ? "—" : formatElapsed(elapsed)}
      </span>{" "}
      elapsed
    </p>
  );
}
