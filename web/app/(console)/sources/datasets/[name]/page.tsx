import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/console/page-header";
import { DatasetFilters, type DatasetQuery } from "@/components/datasets/dataset-filters";
import { GroundTruthRow } from "@/components/datasets/ground-truth-row";
import { RunScorecardGrid } from "@/components/datasets/run-scorecard";
import { Button } from "@/components/ui/button";
import { requireReviewer } from "@/lib/server/auth";
import { fetchEngineDataset, fetchEngineDatasets } from "@/lib/server/engine";
import {
  fetchFullManifest,
  runsUsingDataset,
  scoreRun,
  type GroundTruthScoring,
} from "@/lib/server/ground-truth";
import { INJECTION_META, type InjectionRates } from "@/types/dataset";

/** Diff rows are tall. Twenty-five is a screenful of them, not a wall. */
const PAGE_SIZE = 25;

/**
 * One dataset: what was injected, and what a run did about it.
 *
 * This is the screen that makes a synthetic dataset checkable rather than
 * merely counted. The manifest says, per divergence, what each side holds, what
 * the canonical org actually says, and which cases are ambiguous on purpose.
 * Select a run and each row also carries what the agent proposed and whether it
 * was right — the same comparison `engine/eval/harness.py` reports in aggregate,
 * made legible one row at a time.
 *
 * The manifest comes from the engine's disk; the run's decisions come from
 * Postgres. Neither is written here.
 */
export default async function DatasetDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ name: string }>;
  searchParams: Promise<{
    class?: string;
    expected?: string;
    run?: string;
    page?: string;
  }>;
}) {
  const reviewer = await requireReviewer();
  const [{ name }, search] = await Promise.all([params, searchParams]);

  const query: DatasetQuery = {
    conflictClass: search.class ?? null,
    expected: search.expected === "escalate" || search.expected === "resolvable"
      ? search.expected
      : null,
    runId: search.run ?? null,
    page: Math.max(1, Number(search.page) || 1),
  };

  const detail = await fetchEngineDataset(name, {
    limit: PAGE_SIZE,
    offset: (query.page - 1) * PAGE_SIZE,
    conflictClass: query.conflictClass ?? undefined,
    expected: query.expected ?? undefined,
  });

  // No dataset, or no engine. Either way there is nothing on this screen, and
  // the list it came from is one click away.
  if (detail === null) notFound();

  const catalog = await fetchEngineDatasets();
  const runs = await runsUsingDataset(reviewer.userId, name, catalog?.fallback ?? null);

  // Scoring reads the WHOLE manifest, not this page of it: recall is measured
  // against every injected divergence, and a scorecard over one page would
  // silently be a scorecard of one page.
  let scoring: GroundTruthScoring | null = null;
  if (query.runId && runs.some((run) => run.id === query.runId)) {
    const manifest = await fetchFullManifest(name);
    if (manifest) scoring = await scoreRun(query.runId, reviewer.userId, manifest);
  }

  const pages = Math.max(1, Math.ceil(detail.total / PAGE_SIZE));

  return (
    <>
      <PageHeader
        title={<span className="font-mono">{detail.dataset.name}</span>}
        meta={`seed ${detail.dataset.seed} · ${detail.dataset.accounts.toLocaleString()} accounts`}
        actions={
          <Button asChild variant="quiet" size="sm">
            <Link href="/sources/datasets" className="no-underline">
              All datasets
            </Link>
          </Button>
        }
      />

      <div className="flex flex-col gap-8 px-10 py-8">
        <Composition dataset={detail.dataset} />

        {scoring ? (
          <section className="flex flex-col gap-3">
            <div>
              <h2 className="text-heading text-g-900">
                Run {query.runId?.slice(0, 8)} against ground truth
              </h2>
              <p className="mt-1 max-w-[640px] text-body text-g-600">
                Detection and resolution are counted apart. A divergence the run never
                raised a conflict for is a detector miss; one it raised and answered
                wrongly is an agent error.
              </p>
            </div>
            <RunScorecardGrid scorecard={scoring.scorecard} />
          </section>
        ) : null}

        <section className="flex flex-col gap-4">
          <h2 className="text-heading text-g-900">Injected divergences</h2>

          <DatasetFilters name={name} query={query} runs={runs} total={detail.total} />

          {detail.divergences.length === 0 ? (
            <p className="max-w-[640px] border-l-2 border-g-900 pl-3 text-body text-g-600">
              Nothing in the manifest matches this filter.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {detail.divergences.map((divergence) => (
                <GroundTruthRow
                  key={`${divergence.entityId}:${divergence.field}`}
                  divergence={divergence}
                  scored={
                    scoring?.byKey.get(`${divergence.entityId} ${divergence.field}`) ?? null
                  }
                  runId={query.runId}
                />
              ))}
            </div>
          )}

          <Pager name={name} query={query} pages={pages} />
        </section>
      </div>
    </>
  );
}

/**
 * What the seed produced. The rates are shown as they were requested, because
 * a dataset is only reproducible if the parameters that made it travel with it.
 */
function Composition({
  dataset,
}: {
  dataset: {
    entitiesA: number;
    entitiesB: number;
    divergences: number;
    escalations: number;
    generatorVersion: number;
    rates: InjectionRates;
    byClass: Record<string, number>;
  };
}) {
  const rateKeys = Object.keys(dataset.rates) as (keyof InjectionRates)[];

  return (
    <section className="flex flex-col gap-5">
      <dl className="grid grid-cols-2 border-t border-hairline-strong sm:grid-cols-4">
        <Stat label="Records · side A" value={dataset.entitiesA.toLocaleString()} />
        <Stat label="Records · side B" value={dataset.entitiesB.toLocaleString()} />
        <Stat label="Divergences" value={dataset.divergences.toLocaleString()} />
        <Stat
          label="Expected to escalate"
          value={dataset.escalations.toLocaleString()}
          note="no value is correct"
        />
      </dl>

      <div className="grid gap-x-8 gap-y-1 sm:grid-cols-2">
        {rateKeys.map((key) => (
          <div key={key} className="flex items-baseline gap-3 border-b border-hairline py-1.5">
            <span className="flex-1 text-body text-g-700">{INJECTION_META[key].label}</span>
            <span className="font-mono text-value text-g-500">
              tests {INJECTION_META[key].tests}
            </span>
            <span className="w-12 text-right font-mono text-value text-g-900">
              {(dataset.rates[key] * 100).toFixed(1)}%
            </span>
          </div>
        ))}
      </div>

      <p className="font-mono text-value text-g-500">
        generator v{dataset.generatorVersion} ·{" "}
        {Object.entries(dataset.byClass)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([className, count]) => `${className} ${count}`)
          .join(" · ")}
      </p>
    </section>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="border-b border-hairline py-2.5 pr-4">
      <dt className="text-label uppercase text-g-500">{label}</dt>
      <dd className="mt-1 font-mono text-[20px] leading-6 text-g-900">{value}</dd>
      {note ? <p className="mt-0.5 font-mono text-value text-g-500">{note}</p> : null}
    </div>
  );
}

function Pager({
  name,
  query,
  pages,
}: {
  name: string;
  query: DatasetQuery;
  pages: number;
}) {
  if (pages <= 1) return null;

  function href(page: number): string {
    const params = new URLSearchParams();
    if (query.conflictClass) params.set("class", query.conflictClass);
    if (query.expected) params.set("expected", query.expected);
    if (query.runId) params.set("run", query.runId);
    if (page > 1) params.set("page", String(page));
    const search = params.toString();
    return `/sources/datasets/${encodeURIComponent(name)}${search ? `?${search}` : ""}`;
  }

  return (
    <div className="flex items-center gap-3 border-t border-hairline pt-3">
      {query.page > 1 ? (
        <Button asChild variant="quiet" size="sm">
          <Link href={href(query.page - 1)} className="no-underline">
            Previous
          </Link>
        </Button>
      ) : null}
      <span className="font-mono text-value text-g-500">
        page {query.page} of {pages}
      </span>
      {query.page < pages ? (
        <Button asChild variant="quiet" size="sm">
          <Link href={href(query.page + 1)} className="no-underline">
            Next
          </Link>
        </Button>
      ) : null}
    </div>
  );
}
