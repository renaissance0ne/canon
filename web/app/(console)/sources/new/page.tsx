import { PageHeader } from "@/components/console/page-header";
import { AddSourceForm } from "@/components/sources/add-source-form";
import { sourceKindSchema, type SourceKind } from "@/types/source";
import { requireReviewer } from "@/lib/server/auth";

/**
 * Wireframe 1c. `?kind=synthetic` is how the empty state's second button lands
 * here — the synthetic path is the real onboarding, so it deserves a link that
 * arrives pre-filled rather than a note telling you which option to pick.
 */
export default async function NewSourcePage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string }>;
}) {
  await requireReviewer();

  const { kind } = await searchParams;
  const parsed = sourceKindSchema.safeParse(kind);
  const defaultKind: SourceKind = parsed.success ? parsed.data : "salesforce";

  return (
    <>
      <PageHeader title="Add source" meta="POST /api/sources" />
      <div className="px-10 py-8">
        <AddSourceForm defaultKind={defaultKind} />
      </div>
    </>
  );
}
