import { PageHeader } from "@/components/console/page-header";
import { AddSourceForm } from "@/components/sources/add-source-form";
import { sourceKindSchema, type SourceKind } from "@/types/source";
import { requireReviewer } from "@/lib/server/auth";
import { fetchEngineDatasets } from "@/lib/server/engine";

/**
 * Wireframe 1c. `?kind=synthetic` is how the empty state's second button lands
 * here — the synthetic path is the real onboarding, so it deserves a link that
 * arrives pre-filled rather than a note telling you which option to pick.
 *
 * The dataset names are read here rather than fetched by the form, so a
 * synthetic source is configured by picking from what is actually on the
 * engine's disk. The engine being down is not an error on this screen: the list
 * comes back empty and the form says where to generate one.
 */
export default async function NewSourcePage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string }>;
}) {
  await requireReviewer();

  const [{ kind }, catalog] = await Promise.all([searchParams, fetchEngineDatasets()]);
  const parsed = sourceKindSchema.safeParse(kind);
  const defaultKind: SourceKind = parsed.success ? parsed.data : "salesforce";

  return (
    <>
      <PageHeader title="Add source" meta="POST /api/sources" />
      <div className="px-10 py-8">
        <AddSourceForm
          defaultKind={defaultKind}
          datasets={catalog?.datasets.map((dataset) => dataset.name) ?? []}
          fallbackDataset={catalog?.fallback ?? null}
        />
      </div>
    </>
  );
}
