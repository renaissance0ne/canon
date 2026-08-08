import Link from "next/link";
import { PageHeader } from "@/components/console/page-header";
import { ConflictQueue, QueueKeyHints } from "@/components/conflicts/conflict-queue";
import { QueueFilters } from "@/components/conflicts/queue-filters";
import { Button } from "@/components/ui/button";
import { loadQueue } from "@/lib/server/conflicts";
import { formatCount, shortRunId } from "@/lib/format";
import { QUEUE_PAGE_SIZE, queueQuerySchema, type QueueQuery } from "@/types/queue";
import { requireReviewer } from "@/lib/server/auth";

/**
 * Wireframes 1i, 1j, 1k — the conflict queue, in three directions, plus the
 * states it has to hold (1l override, 1m orphan and duplicate).
 *
 * All three views are kept. They are not variations on a theme: a 12-row queue
 * and a 400-row queue want different shapes, and each wireframe's own annotation
 * names the trade it makes —
 *
 *   1i  "honest to the spec. cost: ~150px per conflict"
 *   1j  "list stays put. only the right pane changes"
 *   1k  "400 conflicts stay scannable … weaker: values are not spine-aligned"
 *
 * Which one a reviewer wants is their call, so it is a link in the filter bar and
 * it lives in the URL with everything else.
 *
 * Server-rendered, deliberately. This is the screen a reviewer works for an hour;
 * it arrives with data in it, and only the selection and the review submit need
 * the browser.
 */
export default async function ConflictsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireReviewer();

  const params = await searchParams;
  const query = parseQuery(params);
  const load = await loadQueue(query);

  if (load.state === "no-runs") {
    return (
      <>
        <PageHeader title="Conflicts" />
        <div className="px-10 py-8">
          <div className="max-w-[560px] border border-dashed border-hairline-strong bg-surface p-6">
            <p className="text-label uppercase text-g-500">Nothing to review</p>
            <p className="mt-3 text-body text-g-600">
              A conflict is a field two systems disagree about. None exist yet
              because no run has finished detecting any — start one and the
              queue fills itself.
            </p>
            <div className="mt-6">
              <Button asChild>
                <Link href="/runs/new" className="no-underline">
                  New run
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </>
    );
  }

  const { run, page } = load;
  const { rows, counts, total, pageCount } = page;

  return (
    <>
      <PageHeader
        title="Conflicts"
        meta={`${formatCount(total)} of ${formatCount(counts.all)} · run ${shortRunId(run.id)}`}
        actions={
          <>
            <Button asChild size="sm" variant="quiet">
              <Link href={`/runs/${run.id}`} className="no-underline">
                Run detail
              </Link>
            </Button>
            <Button asChild size="sm" variant="quiet">
              <Link href={`/audit?runId=${run.id}`} className="no-underline">
                Audit
              </Link>
            </Button>
          </>
        }
      />

      <div className="flex flex-col gap-4 px-10 py-8">
        <QueueFilters query={query} counts={counts} runId={run.id} />

        {rows.length === 0 ? (
          <p className="max-w-[560px] border border-dashed border-hairline-strong bg-surface p-6 text-body text-g-600">
            No conflicts match this filter. Nothing is hidden — the counts on the
            chips above are what the run actually produced.
          </p>
        ) : (
          <>
            {/* Keyed by the query, so a new page or filter remounts the queue
                with its selection at the top — but a refresh after a review does
                not, and the reviewer keeps their place. */}
            <ConflictQueue
              key={queueKey(run.id, query)}
              rows={rows}
              view={query.view}
              total={total}
              sourceNames={{ a: run.sourceAName, b: run.sourceBName }}
            />

            <div className="flex flex-wrap items-center justify-between gap-4 border-t border-hairline pt-3">
              <QueueKeyHints view={query.view} />
              <Pager query={query} runId={run.id} page={page.page} pageCount={pageCount} />
            </div>
          </>
        )}
      </div>
    </>
  );
}

/** Everything that should reset the reviewer's position, and nothing that should not. */
function queueKey(runId: string, query: QueueQuery): string {
  return [
    runId,
    query.status,
    query.view,
    query.page,
    query.severities.join(""),
    query.conflictClass ?? "",
    query.field ?? "",
  ].join("|");
}

/**
 * `?sev=4,3` and friends. Anything unparseable falls back to the default rather
 * than erroring: a filter typed by hand into the address bar should land you on
 * the escalated queue, not on a 400.
 */
function parseQuery(params: Record<string, string | string[] | undefined>): QueueQuery {
  const first = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const parsed = queueQuerySchema.safeParse({
    runId: first("runId"),
    status: first("status"),
    severities: first("sev"),
    conflictClass: first("conflictClass"),
    field: first("field"),
    view: first("view"),
    page: first("page"),
    selected: first("selected"),
  });

  // Every field is optional or defaulted, so the empty parse cannot fail.
  return parsed.success ? parsed.data : queueQuerySchema.parse({});
}

/**
 * Pages of 100. Keyboard navigation is bounded to the page on screen, which is
 * why the boundary is stated rather than implied — j at the last row doing
 * nothing should be a fact the reviewer already knows.
 */
function Pager({
  query,
  runId,
  page,
  pageCount,
}: {
  query: QueueQuery;
  runId: string;
  page: number;
  pageCount: number;
}) {
  if (pageCount <= 1) return null;

  function href(nextPage: number): string {
    const params = new URLSearchParams({
      runId,
      status: query.status,
      view: query.view,
      page: String(nextPage),
    });
    if (query.severities.length > 0) params.set("sev", query.severities.join(","));
    if (query.conflictClass) params.set("conflictClass", query.conflictClass);
    if (query.field) params.set("field", query.field);
    return `/conflicts?${params.toString()}`;
  }

  return (
    <div className="flex items-center gap-2 font-mono text-value text-g-500">
      <span>
        page {page} of {pageCount} · {QUEUE_PAGE_SIZE} per page
      </span>

      {/* A link that does not exist is not rendered as a disabled button: there
          is no href for "before page 1", and a control that looks clickable and
          is not costs a reviewer a keystroke every time. */}
      {page > 1 ? (
        <Button asChild size="sm" variant="quiet">
          <Link href={href(page - 1)} className="no-underline">
            Previous
          </Link>
        </Button>
      ) : null}

      {page < pageCount ? (
        <Button asChild size="sm" variant="quiet">
          <Link href={href(page + 1)} className="no-underline">
            Next
          </Link>
        </Button>
      ) : null}
    </div>
  );
}
