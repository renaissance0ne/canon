import Link from "next/link";
import { PageHeader } from "@/components/console/page-header";
import { NewRunForm } from "@/components/runs/new-run-form";
import { Button } from "@/components/ui/button";
import { findConfiguredSourceIds } from "@/lib/server/credentials";
import { listRulesets } from "@/lib/server/rulesets";
import { listSources } from "@/lib/server/sources";
import { SOURCE_KIND_SIDE, requiresCredentialsForKind } from "@/types/source";
import { requireReviewer } from "@/lib/server/auth";

/** Wireframe 1e. Server Component; the form below is the only client boundary. */
export default async function NewRunPage() {
  await requireReviewer();

  const [sources, rulesets] = await Promise.all([listSources(), listRulesets()]);

  // Which sources could actually run today. The form needs this to explain a
  // disabled button: "not connected" is the single most common reason a run
  // cannot start, and discovering it only after clicking — as a server error —
  // is the same silent-failure shape the run pipeline was just fixed for.
  const configured = await findConfiguredSourceIds(
    sources.filter((s) => requiresCredentialsForKind(s.kind)).map((s) => s.id),
  );
  const connectedIds = sources
    .filter((s) => !requiresCredentialsForKind(s.kind) || configured.has(s.id))
    .map((s) => s.id);

  const hasCrm = sources.some((s) => SOURCE_KIND_SIDE[s.kind] !== "warehouse");
  const hasWarehouse = sources.some((s) => SOURCE_KIND_SIDE[s.kind] !== "crm");
  const canRun = hasCrm && hasWarehouse && sources.length >= 2 && rulesets.length > 0;

  return (
    <>
      <PageHeader title="New run" meta="POST /api/runs" />

      <div className="px-10 py-8">
        {canRun ? (
          <NewRunForm
            sources={sources}
            rulesets={rulesets}
            connectedIds={connectedIds}
          />
        ) : (
          <Prerequisites
            needsSources={!(hasCrm && hasWarehouse && sources.length >= 2)}
            needsRuleset={rulesets.length === 0}
          />
        )}
      </div>
    </>
  );
}

/**
 * A run needs two sides and a policy. Saying which one is missing beats a
 * disabled button with no explanation next to it.
 */
function Prerequisites({
  needsSources,
  needsRuleset,
}: {
  needsSources: boolean;
  needsRuleset: boolean;
}) {
  return (
    <div className="max-w-[560px] border border-dashed border-hairline-strong bg-surface p-6">
      <p className="text-label uppercase text-g-500">Not ready to run</p>
      <ul className="mt-4 flex flex-col gap-3">
        {needsSources ? (
          <li className="text-body text-g-600">
            Canon reconciles two systems. Configure one CRM side and one
            warehouse side — the synthetic dataset counts as either.
          </li>
        ) : null}
        {needsRuleset ? (
          <li className="text-body text-g-600">
            Author a survivorship policy. Without rules every conflict escalates,
            because Canon never guesses in the absence of policy.
          </li>
        ) : null}
      </ul>
      <div className="mt-6 flex flex-wrap gap-2">
        {needsSources ? (
          <Button asChild>
            <Link href="/sources/new" className="no-underline">
              Add source
            </Link>
          </Button>
        ) : null}
        {needsRuleset ? (
          <Button asChild variant={needsSources ? "outline" : "primary"}>
            <Link href="/rules" className="no-underline">
              Author a ruleset
            </Link>
          </Button>
        ) : null}
      </div>
    </div>
  );
}
