import Link from "next/link";
import { PageHeader } from "@/components/console/page-header";
import { DatasetTable } from "@/components/sources/dataset-table";
import { GenerateDatasetForm } from "@/components/sources/generate-dataset-form";
import { Button } from "@/components/ui/button";
import { requireReviewer } from "@/lib/server/auth";
import { fetchEngineDatasets } from "@/lib/server/engine";

/**
 * Synthetic datasets — the console's path to `engine/eval/generate.py`.
 *
 * The synthetic dataset is the source kind the whole pipeline is developed and
 * evaluated against, and until now the only way to produce one was a shell on
 * the engine host. That put the first thing a new operator needs behind the one
 * thing they are least likely to have.
 *
 * The list is read from the engine at render, not from Postgres: a dataset is
 * files on the engine's disk, and a table here would be a second record of what
 * a seed produced that could disagree with `meta.json`.
 */
export default async function DatasetsPage() {
  await requireReviewer();

  const catalog = await fetchEngineDatasets();
  const datasets = catalog?.datasets ?? [];

  return (
    <>
      <PageHeader
        title="Datasets"
        meta={datasets.length > 0 ? `${datasets.length} on the engine` : undefined}
        actions={
          <Button asChild variant="quiet" size="sm">
            <Link href="/sources" className="no-underline">
              Sources
            </Link>
          </Button>
        }
      />

      <div className="flex flex-col gap-8 px-10 py-8">
        <p className="max-w-[640px] text-body text-g-600">
          A synthetic dataset is one seeded canonical org, split into a CRM view and a warehouse
          view, plus the manifest of every divergence injected between them. It is generated
          offline on the engine — no source system is contacted and no credential is read — and it
          is the ground truth every reported number is measured against.
        </p>

        {catalog === null ? (
          <p
            role="alert"
            className="max-w-[640px] border border-g-900 bg-surface-sunken px-3 py-2 text-body text-g-900"
          >
            The engine did not answer. Datasets live on its disk, so it has to be running before
            one can be listed or generated.
          </p>
        ) : datasets.length > 0 ? (
          <DatasetTable datasets={datasets} fallback={catalog.fallback} />
        ) : (
          <p className="max-w-[640px] border-l-2 border-g-900 pl-3 text-body text-g-600">
            Nothing generated yet. The defaults below are the rates in AGENTS.md — seed 42 with 500
            accounts is the dataset the reported results cite.
          </p>
        )}

        <div className="border-t border-hairline pt-8">
          <h2 className="text-heading text-g-900">Generate</h2>
          <p className="mt-1 max-w-[640px] text-body text-g-600">
            Same function as{" "}
            <span className="font-mono text-value text-g-700">
              uv run python -m eval.generate
            </span>
            . Commit the seed you report results from.
          </p>

          <div className="mt-6">
            <GenerateDatasetForm existing={datasets.map((dataset) => dataset.name)} />
          </div>
        </div>
      </div>
    </>
  );
}
