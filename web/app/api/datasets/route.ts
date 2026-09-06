import { parseJson } from "@/app/api/_lib/respond";
import { requireReviewerForApi } from "@/lib/server/auth";
import {
  EngineUnreachableError,
  fetchEngineDatasets,
  generateEngineDataset,
} from "@/lib/server/engine";
import { generateDatasetSchema } from "@/types/dataset";

/**
 * Synthetic datasets — the console's path to `eval/generate.py`.
 *
 * This is a proxy, not an owner. A dataset is files on the engine's disk, not
 * rows in Postgres, so there is no table here and nothing to keep in sync: the
 * engine's `meta.json` is the single record of what a seed produced, exactly as
 * it is when the same generator is run from a shell.
 *
 * The browser never reaches the engine directly — `ENGINE_URL` is server-side
 * only — so this handler is also the authentication boundary for generating
 * one. Generation writes to disk, which is why it is gated the same way every
 * other write in this app is.
 */

export async function GET() {
  const gate = await requireReviewerForApi();
  if (!gate.ok) return gate.response;

  const datasets = await fetchEngineDatasets();

  if (datasets === null) {
    return Response.json(
      { error: "The engine did not answer. Datasets live on its disk, so it has to be running." },
      { status: 502 },
    );
  }

  return Response.json(datasets);
}

export async function POST(request: Request) {
  const gate = await requireReviewerForApi();
  if (!gate.ok) return gate.response;

  const parsed = await parseJson(request, generateDatasetSchema);
  if (!parsed.ok) return parsed.response;

  try {
    const result = await generateEngineDataset(parsed.data);

    // The engine's refusal and its status both pass through unchanged. A 409
    // means the name is taken, and the form turns that into an explicit
    // overwrite rather than a retry — silently replacing a dataset would make
    // every number already reported against it unreproducible.
    if (!result.ok) {
      return Response.json({ error: result.message }, { status: result.status });
    }

    return Response.json({ dataset: result.dataset }, { status: 201 });
  } catch (error) {
    if (error instanceof EngineUnreachableError) {
      return Response.json({ error: error.message }, { status: 502 });
    }
    throw error;
  }
}
