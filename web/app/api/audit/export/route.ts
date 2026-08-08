import { badRequest, isUuid, notFound } from "@/app/api/_lib/respond";
import { listAuditForExport } from "@/lib/server/audit";
import { requireReviewerForApi } from "@/lib/server/auth";
import { getRunDetail } from "@/lib/server/runs";
import { auditDetailLine, auditNote } from "@/lib/audit-detail";
import { shortRunId } from "@/lib/format";
import { auditActionSchema, type AuditEntry } from "@/types/resolution";

/**
 * GET /api/audit/export?runId=&action= — "Export log" in wireframe 1n.
 *
 * CSV only. The audit trail is a ledger with four fixed columns and one open
 * detail column; that is a spreadsheet, and a reviewer asking for the log is
 * about to put it next to something else in one.
 *
 * `detail` goes out twice: once flattened the way the console reads it, and once
 * as raw JSON. The flattened column is what a person wants; the raw column is
 * why the file is still evidence if the flattening ever loses something.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;

  const runId = params.get("runId") ?? undefined;
  if (runId !== undefined && !isUuid(runId)) return notFound("No such run.");

  const rawAction = params.get("action");
  const action = rawAction ? auditActionSchema.safeParse(rawAction) : null;
  if (rawAction && !action?.success) return badRequest("Unknown audit action.");

  const run = runId ? await getRunDetail(runId) : null;
  if (runId && !run) return notFound("No such run.");

  // Reading the trail is itself a thing a person did, so the file records who
  // pulled it — but it is a read, and reads do not append to an append-only log.
  const gate = await requireReviewerForApi();
  if (!gate.ok) return gate.response;

  const entries = await listAuditForExport({
    runId,
    action: action?.success ? action.data : undefined,
  });

  const scope = run ? `-run-${shortRunId(run.id).replace("·", "")}` : "";

  return new Response(auditToCsv(entries), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="canon-audit${scope}.csv"`,
      "cache-control": "no-store",
    },
  });
}

const COLUMNS = [
  "createdAt",
  "runId",
  "action",
  "actor",
  "resolutionId",
  "detail",
  "note",
  "detailJson",
] as const;

function auditToCsv(entries: AuditEntry[]): string {
  const lines = [COLUMNS.join(",")];

  for (const entry of entries) {
    lines.push(
      [
        entry.createdAt.toISOString(),
        entry.runId,
        entry.action,
        entry.actor,
        entry.resolutionId ?? "",
        auditDetailLine(entry) ?? "",
        auditNote(entry) ?? "",
        JSON.stringify(entry.detail),
      ]
        .map(csvCell)
        .join(","),
    );
  }

  return lines.join("\r\n") + "\r\n";
}

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
