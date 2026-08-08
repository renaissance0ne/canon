import { isUuid, notFound } from "@/app/api/_lib/respond";
import { fetchEngineStatus } from "@/lib/server/engine";
import { getRun } from "@/lib/server/runs";
import { isTerminalRunStatus, type EngineRunStatus } from "@/types/run";

/**
 * GET /api/runs/:runId/status — the only polled surface in the console.
 *
 * Proxied rather than called from the browser: ENGINE_URL is server-side and
 * the engine has no session of its own.
 *
 * The engine is the freshest source of status, but it is NOT the system of
 * record — it advances `runs.status` in Postgres as each stage completes. So
 * this route prefers the engine and falls back to the row, which means a
 * restarted or briefly unreachable engine degrades a live run to a slightly
 * stale number instead of an error banner. A terminal run skips the engine
 * entirely; there is nothing left for it to say.
 */
export async function GET(_request: Request, ctx: RouteContext<"/api/runs/[runId]/status">) {
  const { runId } = await ctx.params;
  if (!isUuid(runId)) return notFound("No such run.");

  const run = await getRun(runId);
  if (!run) return notFound("No such run.");

  const fromRow: EngineRunStatus = {
    runId: run.id,
    status: run.status,
    stats: run.stats,
    error: run.error,
  };

  if (isTerminalRunStatus(run.status)) return json(fromRow);

  const live = await fetchEngineStatus(runId);
  return json(live ?? fromRow);
}

function json(status: EngineRunStatus): Response {
  return Response.json(status, {
    // Polled. A cached status is a status that never changes.
    headers: { "cache-control": "no-store" },
  });
}
