import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/console/page-header";
import { ExportPanel } from "@/components/runs/export-panel";
import { Button } from "@/components/ui/button";
import { estimateExportBytes, getExportSizing } from "@/lib/server/export";
import { getRunDetail } from "@/lib/server/runs";
import { shortRunId } from "@/lib/format";
import { isUuid } from "@/lib/uuid";

/**
 * Wireframe 1o — export, the end of the flow.
 *
 * "Canon does not write back to Salesforce or the warehouse. It proposes,
 * records, and hands you a file." That sentence is on this screen because this is
 * where someone would look for a "push to Salesforce" button, and its absence
 * has to be a stated decision rather than a missing feature.
 *
 * The section counts are read server-side so the panel opens with real numbers in
 * it. A reviewer about to hand a file to finance should know what is in it before
 * they download it.
 */
export default async function RunExportPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;
  if (!isUuid(runId)) notFound();

  const run = await getRunDetail(runId);
  if (!run) notFound();

  const sizing = await getExportSizing(run);

  return (
    <>
      <PageHeader
        title={
          <>
            Export run{" "}
            <span className="font-mono text-value text-g-600">{shortRunId(run.id)}</span>
          </>
        }
        meta={`${run.sourceAName} ↔ ${run.sourceBName} · ${run.rulesetName} v${run.rulesetVersion}`}
        actions={
          <Button asChild size="sm" variant="quiet">
            <Link href={`/runs/${run.id}`} className="no-underline">
              Back to run
            </Link>
          </Button>
        }
      />

      <div className="flex flex-col gap-7 px-10 py-8">
        <ExportPanel
          runId={run.id}
          counts={{
            hierarchy: sizing.hierarchy,
            decisions: sizing.decisions,
            orphans: sizing.orphans,
            stats: sizing.stats,
          }}
          bytesPerSection={{
            hierarchy: estimateExportBytes(sizing, ["hierarchy"]),
            decisions: estimateExportBytes(sizing, ["decisions"]),
            orphans: estimateExportBytes(sizing, ["orphans"]),
            stats: estimateExportBytes(sizing, ["stats"]),
          }}
        />

        <div className="max-w-[440px] border-l-2 border-g-900 pl-3">
          <p className="text-body text-g-700">
            Canon does not write back to {run.sourceAName} or {run.sourceBName}. It
            proposes, records, and hands you a file — write-back changes the risk
            profile of the whole system, so it is not a setting.
          </p>
        </div>

        <p className="max-w-[560px] text-body text-g-500">
          Every file records who pulled it and when. The decision log carries the
          rationale and the reviewer for each conflict, so the hierarchy can be
          defended line by line rather than taken on trust.
          {run.status !== "complete" ? (
            <>
              {" "}
              This run is <span className="font-mono">{run.status}</span> — the export
              holds what it has produced so far, not a finished answer.
            </>
          ) : null}
        </p>
      </div>
    </>
  );
}
