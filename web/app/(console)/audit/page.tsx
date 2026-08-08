import Link from "next/link";
import { PageHeader } from "@/components/console/page-header";
import { AuditFilters } from "@/components/audit/audit-filters";
import { AuditTable } from "@/components/audit/audit-table";
import { Button } from "@/components/ui/button";
import { AUDIT_PAGE_SIZE, getAuditPage } from "@/lib/server/audit";
import { getRunDetail } from "@/lib/server/runs";
import { formatCount, shortRunId } from "@/lib/format";
import { isUuid } from "@/lib/uuid";
import { auditActionSchema, type AuditAction } from "@/types/resolution";
import { requireReviewer } from "@/lib/server/auth";

/**
 * Wireframe 1n — the audit trail, append-only.
 *
 * This screen is the deliverable. Canon's claim is not "we resolved 218
 * conflicts", it is "here is every decision and who made it", and this is the
 * page that either substantiates that or does not. Which is why it reads as a
 * ledger, why the export sits next to it, and why there is not one control here
 * that changes a row.
 *
 * Scoped to a run when asked (`?runId=`), otherwise the whole install newest
 * first.
 */
export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireReviewer();

  const params = await searchParams;

  const runId = firstUuid(params.runId);
  const action = firstAction(params.action);
  const page = firstPage(params.page);

  const [run, audit] = await Promise.all([
    runId ? getRunDetail(runId) : Promise.resolve(null),
    getAuditPage({ runId, action, page }),
  ]);

  const exportParams = new URLSearchParams();
  if (runId) exportParams.set("runId", runId);
  if (action) exportParams.set("action", action);

  return (
    <>
      <PageHeader
        title="Audit"
        meta={
          run
            ? `run ${shortRunId(run.id)} · ${formatCount(audit.total)} entries`
            : `${formatCount(audit.total)} entries`
        }
        actions={
          <>
            {run ? (
              <Button asChild size="sm" variant="quiet">
                <Link href="/audit" className="no-underline">
                  All runs
                </Link>
              </Button>
            ) : null}
            <Button asChild size="sm" variant="outline">
              <a
                href={`/api/audit/export?${exportParams.toString()}`}
                className="no-underline"
              >
                Export log
              </a>
            </Button>
          </>
        }
      />

      <div className="flex flex-col gap-4 px-10 py-8">
        <p className="max-w-[640px] text-body text-g-500">
          Nothing here is ever updated or deleted, by either layer. The engine
          appends what the pipeline did; the console appends what a person did.
          {run
            ? ` This is ${run.sourceAName} against ${run.sourceBName} under ${run.rulesetName} v${run.rulesetVersion}.`
            : ""}
        </p>

        <AuditFilters byAction={audit.byAction} active={action} runId={runId} />

        {audit.entries.length === 0 ? (
          <p className="max-w-[560px] border border-dashed border-hairline-strong bg-surface p-6 text-body text-g-600">
            No entries yet. The first one is written the moment a run starts.
          </p>
        ) : (
          <>
            <AuditTable entries={audit.entries} showRun={!run} />

            {audit.pageCount > 1 ? (
              <div className="flex items-center gap-2 border-t border-hairline pt-3 font-mono text-value text-g-500">
                <span>
                  page {audit.page} of {audit.pageCount} · {AUDIT_PAGE_SIZE} per page
                </span>
                {audit.page > 1 ? (
                  <Button asChild size="sm" variant="quiet">
                    <Link
                      href={pageHref(runId, action, audit.page - 1)}
                      className="no-underline"
                    >
                      Newer
                    </Link>
                  </Button>
                ) : null}
                {audit.page < audit.pageCount ? (
                  <Button asChild size="sm" variant="quiet">
                    <Link
                      href={pageHref(runId, action, audit.page + 1)}
                      className="no-underline"
                    >
                      Older
                    </Link>
                  </Button>
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </div>
    </>
  );
}

/**
 * "Newer" and "Older", not "Previous" and "Next". The trail is ordered in time
 * and a pager that says "next" on a reverse-chronological list is ambiguous
 * exactly when someone is trying to find a specific moment in it.
 */
function pageHref(
  runId: string | undefined,
  action: AuditAction | undefined,
  page: number,
): string {
  const params = new URLSearchParams();
  if (runId) params.set("runId", runId);
  if (action) params.set("action", action);
  params.set("page", String(page));
  return `/audit?${params.toString()}`;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function firstUuid(value: string | string[] | undefined): string | undefined {
  const raw = first(value);
  return raw && isUuid(raw) ? raw : undefined;
}

function firstAction(value: string | string[] | undefined): AuditAction | undefined {
  const raw = first(value);
  if (!raw) return undefined;
  const parsed = auditActionSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

function firstPage(value: string | string[] | undefined): number {
  const raw = Number(first(value));
  return Number.isInteger(raw) && raw > 0 ? raw : 1;
}
