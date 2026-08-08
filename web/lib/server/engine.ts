import "server-only";
import {
  engineRunStatusSchema,
  engineStartRunResponseSchema,
  type EngineRunStatus,
} from "@/types/run";

/**
 * SERVER ONLY — the typed client for the reconciliation engine's HTTP API.
 *
 * The browser never talks to the engine. `ENGINE_URL` is deliberately not
 * `NEXT_PUBLIC_`: the engine has no auth of its own and starting a run is a
 * write, so the only path to it runs through this app's own route handlers,
 * which are session-protected by proxy.ts.
 */

/** The engine is a separate process. It being down is a normal Tuesday. */
export class EngineUnreachableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "EngineUnreachableError";
  }
}

function engineUrl(): string {
  const url = process.env.ENGINE_URL;
  if (!url) {
    throw new EngineUnreachableError(
      "ENGINE_URL is not set. Add it to web/.env — server-side only, never NEXT_PUBLIC_.",
    );
  }
  return url.replace(/\/+$/, "");
}

/** Dispatch is fast — it queues a background task and returns. */
const DISPATCH_TIMEOUT_MS = 8_000;
/** Status is polled, so a slow engine must not hold a request handler open. */
const STATUS_TIMEOUT_MS = 4_000;

/**
 * POST {ENGINE_URL}/runs — hand the engine a run id and nothing else.
 *
 * Configuration is never passed over the wire. The engine reads sources and
 * ruleset from Postgres using `runId`, so there is exactly one record of what a
 * run executed; two would make a run unreproducible the moment they disagreed.
 *
 * Throws EngineUnreachableError on any failure. The caller is expected to
 * record that on the run row rather than swallow it — a run stuck in `queued`
 * with nothing behind it is the worst outcome of the three.
 */
export async function startRun(runId: string): Promise<void> {
  let response: Response;

  try {
    response = await fetch(`${engineUrl()}/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runId }),
      signal: AbortSignal.timeout(DISPATCH_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (cause) {
    throw new EngineUnreachableError(
      `Engine did not accept the run: ${describe(cause)}`,
      { cause },
    );
  }

  if (!response.ok) {
    throw new EngineUnreachableError(
      `Engine rejected the run with ${response.status}: ${await readBody(response)}`,
    );
  }

  // The response is part of the tool contract, so it is parsed rather than
  // assumed. An engine that answers 200 with the wrong shape is a contract
  // break, and it should surface here and not three screens later.
  const parsed = engineStartRunResponseSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) {
    throw new EngineUnreachableError(
      "Engine accepted the run but returned an unexpected body — check the tool contract in AGENTS.md.",
    );
  }
}

/**
 * GET {ENGINE_URL}/runs/:runId/status — the live view of a run in flight.
 *
 * Returns null instead of throwing when the engine cannot answer. The engine is
 * not the system of record for run status: it writes status to Postgres as it
 * advances, so the caller can always fall back to the row. Polling is the one
 * place in Canon where a stale-but-durable answer beats an error.
 */
export async function fetchEngineStatus(runId: string): Promise<EngineRunStatus | null> {
  try {
    const response = await fetch(`${engineUrl()}/runs/${runId}/status`, {
      signal: AbortSignal.timeout(STATUS_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!response.ok) return null;

    const parsed = engineRunStatusSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function describe(cause: unknown): string {
  if (cause instanceof Error) {
    return cause.name === "TimeoutError"
      ? `no response within ${DISPATCH_TIMEOUT_MS / 1000}s`
      : cause.message;
  }
  return String(cause);
}

async function readBody(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  return text.slice(0, 300) || "(empty body)";
}
