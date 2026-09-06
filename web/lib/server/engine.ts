import "server-only";
import {
  datasetDetailSchema,
  datasetSummarySchema,
  engineDatasetsSchema,
  type DatasetDetail,
  type DatasetSummary,
  type EngineDatasets,
  type GenerateDataset,
} from "@/types/dataset";
import {
  engineProvidersSchema,
  engineRunStatusSchema,
  engineStartRunResponseSchema,
  type EngineProvider,
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
/** Read once while rendering the new-run form. It must never stall the page. */
const PROVIDERS_TIMEOUT_MS = 3_000;
/** Listing reads meta.json and the manifest per dataset — disk, not network. */
const DATASETS_TIMEOUT_MS = 5_000;
/**
 * Generation is synchronous and CPU-bound on the engine: ~0.1s at 500 accounts
 * and ~8s at the 20,000 ceiling the schema allows. The timeout is sized for the
 * ceiling with room to spare, because a request that gives up while the
 * generator is still writing leaves a half-written dataset behind and tells the
 * operator nothing about it.
 */
const GENERATE_TIMEOUT_MS = 60_000;

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
      `Engine did not accept the run: ${describe(cause, DISPATCH_TIMEOUT_MS)}`,
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

/**
 * GET {ENGINE_URL}/providers — which model families the engine can call.
 *
 * Returns null when the engine cannot answer, exactly as `fetchEngineStatus`
 * does. The run form then offers every provider unannotated rather than
 * refusing to render: a console that hides a working option because a health
 * probe timed out is worse than one that lets a run start and reports honestly
 * if the key turns out to be missing.
 *
 * The response carries only which key NAMES are set, never a key — the same
 * rule that governs every credential read path in this app.
 */
export async function fetchEngineProviders(): Promise<EngineProvider[] | null> {
  try {
    const response = await fetch(`${engineUrl()}/providers`, {
      signal: AbortSignal.timeout(PROVIDERS_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!response.ok) return null;

    const parsed = engineProvidersSchema.safeParse(await response.json());
    return parsed.success ? parsed.data.providers : null;
  } catch {
    return null;
  }
}

/** The timeout is passed in so the message names the one that actually elapsed. */
function describe(cause: unknown, timeoutMs: number): string {
  if (cause instanceof Error) {
    return cause.name === "TimeoutError"
      ? `no response within ${timeoutMs / 1000}s`
      : cause.message;
  }
  return String(cause);
}

async function readBody(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  return text.slice(0, 300) || "(empty body)";
}

/**
 * GET {ENGINE_URL}/datasets — the synthetic datasets on the engine's disk.
 *
 * Returns null when the engine cannot answer, the same as the other reads here.
 * The dataset picker then falls back to a plain text field: a console that
 * refuses to let you configure a source because a listing timed out is worse
 * than one that lets you type the name you already know.
 */
export async function fetchEngineDatasets(): Promise<EngineDatasets | null> {
  try {
    const response = await fetch(`${engineUrl()}/datasets`, {
      signal: AbortSignal.timeout(DATASETS_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!response.ok) return null;

    const parsed = engineDatasetsSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * GET {ENGINE_URL}/datasets/:name — a dataset and a page of its manifest.
 *
 * Returns null when the engine cannot answer OR when it does not have that
 * dataset. The screen says the same thing either way — there is nothing here to
 * show — and distinguishing them would mean rendering a 404 differently from a
 * timeout for no decision the reader could act on differently.
 */
export async function fetchEngineDataset(
  name: string,
  options: {
    limit?: number;
    offset?: number;
    conflictClass?: string;
    expected?: string;
  } = {},
): Promise<DatasetDetail | null> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(options)) {
    if (value !== undefined && value !== "") query.set(key, String(value));
  }

  try {
    const response = await fetch(
      `${engineUrl()}/datasets/${encodeURIComponent(name)}?${query}`,
      { signal: AbortSignal.timeout(DATASETS_TIMEOUT_MS), cache: "no-store" },
    );
    if (!response.ok) return null;

    const parsed = datasetDetailSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** A generation that the engine refused, with the reason it gave. */
export type GenerateFailure = { ok: false; status: number; message: string };

/**
 * POST {ENGINE_URL}/datasets — generate a dataset from a seed and rates.
 *
 * The engine's own message is passed through rather than replaced. Its two
 * refusals are both things the operator has to act on and neither is
 * guessable from a status code alone: a name that is taken (409, and the fix
 * is a different name or an explicit overwrite) and rates that cannot fit the
 * population (400).
 *
 * Throws EngineUnreachableError when there was no answer at all, which is a
 * different problem with a different fix and should not be rendered as a
 * rejected request.
 */
export async function generateEngineDataset(
  body: GenerateDataset,
): Promise<{ ok: true; dataset: DatasetSummary } | GenerateFailure> {
  let response: Response;

  try {
    response = await fetch(`${engineUrl()}/datasets`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(GENERATE_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (cause) {
    throw new EngineUnreachableError(
      `Engine did not generate the dataset: ${describe(cause, GENERATE_TIMEOUT_MS)}`,
      { cause },
    );
  }

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    return { ok: false, status: response.status, message: detail(payload, response.status) };
  }

  const parsed = datasetSummarySchema.safeParse(payload);
  if (!parsed.success) {
    throw new EngineUnreachableError(
      "Engine generated the dataset but returned an unexpected body — check the tool contract in AGENTS.md.",
    );
  }

  return { ok: true, dataset: parsed.data };
}

/**
 * FastAPI puts the message in `detail` — a string for a raised HTTPException,
 * a list of issues when its own validation rejected the body. Both are read,
 * because the second is what a contract drift between the two schemas looks
 * like and a bare "422" would say nothing about which field.
 */
function detail(payload: unknown, status: number): string {
  const body = payload as { detail?: unknown } | null;

  if (typeof body?.detail === "string" && body.detail) return body.detail;

  if (Array.isArray(body?.detail)) {
    const issues = body.detail
      .map((issue) => {
        const { loc, msg } = (issue ?? {}) as { loc?: unknown[]; msg?: unknown };
        const field = Array.isArray(loc) ? loc.slice(1).join(".") : "";
        return [field, msg].filter((part) => typeof part === "string" && part).join(": ");
      })
      .filter(Boolean);

    if (issues.length > 0) return `Engine rejected the request — ${issues.join("; ")}`;
  }

  return `Engine rejected the request (${status}).`;
}
