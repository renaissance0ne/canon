import { badRequest, isUuid, notFound } from "@/app/api/_lib/respond";
import { requireReviewerForApi } from "@/lib/server/auth";
import {
  DEFAULT_EXPORT_SECTIONS,
  EXPORT_SECTIONS,
  buildRunExport,
  decisionsToCsv,
  isExportSection,
  type ExportSection,
} from "@/lib/server/export";
import { getRunDetail } from "@/lib/server/runs";
import { shortRunId } from "@/lib/format";

/**
 * GET /api/runs/:runId/export?format=json|csv&sections=… — wireframes 1g, 1o.
 *
 * JSON carries whichever sections were asked for; with none named it carries the
 * two that are the export — the resolved hierarchy and the full decision log.
 * CSV carries the decision log only, because two row shapes in one CSV is a file
 * nobody can pivot.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/runs/[runId]/export">) {
  const { runId } = await ctx.params;
  if (!isUuid(runId)) return notFound("No such run.");

  const params = new URL(request.url).searchParams;

  const format = params.get("format") ?? "json";
  if (format !== "json" && format !== "csv") {
    return badRequest("format must be json or csv.");
  }

  const sections = parseSections(params.get("sections"));
  if (sections === null) {
    return badRequest("sections must be a comma-separated list of hierarchy, decisions, orphans, stats.");
  }

  const run = await getRunDetail(runId);
  if (!run) return notFound("No such run.");

  // Recorded in the file itself. An export that circulates without saying who
  // pulled it and when is the kind of artefact this whole system exists to
  // replace.
  const gate = await requireReviewerForApi();
  if (!gate.ok) return gate.response;
  const reviewer = gate.reviewer;
  const payload = await buildRunExport(run, reviewer.label, sections);
  const filename = `canon-run-${shortRunId(run.id).replace("·", "")}`;

  if (format === "csv") {
    return new Response(decisionsToCsv(payload.decisions ?? []), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}-decisions.csv"`,
        "cache-control": "no-store",
      },
    });
  }

  return new Response(JSON.stringify(payload, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}.json"`,
      "cache-control": "no-store",
    },
  });
}

/**
 * `?sections=hierarchy,decisions`. Absent means the default two. An unknown name
 * is rejected rather than dropped: silently returning a file without the section
 * someone asked for is worse than saying no.
 *
 * Returns null when the list is invalid, so the caller can answer 400.
 */
function parseSections(raw: string | null): readonly ExportSection[] | null {
  if (raw === null) return DEFAULT_EXPORT_SECTIONS;

  const names = raw
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name.length > 0);

  if (names.length === 0) return null;
  if (!names.every(isExportSection)) return null;

  // De-duplicated, and in the canonical order rather than the order asked for, so
  // two links with the same sections produce byte-identical files.
  return EXPORT_SECTIONS.filter((section) => names.includes(section));
}
