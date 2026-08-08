import Link from "next/link";
import { auditDetailParts, auditNote } from "@/lib/audit-detail";
import { formatClockTime, formatTimestamp, shortRunId } from "@/lib/format";
import { cn } from "@/lib/cn";
import { AUDIT_ACTION_LABEL, type AuditEntry } from "@/types/resolution";

/**
 * Wireframe 1n — the audit trail. Time · Action · Actor · Detail.
 *
 * "Nothing here is ever updated or deleted. This view is the artifact a reviewer
 * asks for." So it is drawn as a ledger and nothing else: hairlines, mono values,
 * no card, no status pills, no row actions. There is nothing to do to a row here,
 * which is the point.
 *
 * A human action is the only thing that gets weight. In a list of 442 rows the
 * engine's own bookkeeping is the background and the six decisions a person made
 * are the foreground.
 */
export function AuditTable({
  entries,
  /** Hidden when the view is already scoped to one run. */
  showRun,
}: {
  entries: AuditEntry[];
  showRun: boolean;
}) {
  return (
    <table className="w-full border-collapse bg-g-0">
      <thead>
        <tr className="border-b border-hairline-strong text-left">
          <Th className="w-[104px]">Time</Th>
          {showRun ? <Th className="w-[88px]">Run</Th> : null}
          <Th className="w-[168px]">Action</Th>
          <Th className="w-[128px]">Actor</Th>
          <Th>Detail</Th>
        </tr>
      </thead>
      <tbody>
        {entries.map((entry) => {
          const human = entry.actor !== "engine" && entry.actor !== "agent" && entry.actor !== "web";
          const parts = auditDetailParts(entry);
          const note = auditNote(entry);

          return (
            <tr key={entry.id} className="border-b border-hairline align-top">
              <td className="py-1.5 pr-4 font-mono text-value text-g-600">
                <span title={formatTimestamp(entry.createdAt)}>
                  {formatClockTime(entry.createdAt)}
                </span>
              </td>

              {showRun ? (
                <td className="py-1.5 pr-4">
                  <Link
                    href={`/runs/${entry.runId}`}
                    className="font-mono text-value text-g-600 no-underline hover:underline"
                  >
                    {shortRunId(entry.runId)}
                  </Link>
                </td>
              ) : null}

              <td
                className={cn(
                  "py-1.5 pr-4 font-mono text-value",
                  human ? "font-medium text-g-900" : "text-g-600",
                )}
              >
                {AUDIT_ACTION_LABEL[entry.action]}
              </td>

              <td className="py-1.5 pr-4 font-mono text-value text-g-500">
                {entry.actor}
              </td>

              <td className="py-1.5 font-mono text-value text-g-500">
                {parts.length > 0 ? parts.join(" · ") : "—"}
                {/* The note is a sentence, so it gets its own line rather than
                    being truncated into the column. It is the only prose in the
                    table, and it is sans for the same reason a rationale is. */}
                {note ? (
                  <span className="mt-0.5 block max-w-[68ch] border-l-2 border-hairline-strong pl-2 font-sans text-body text-g-700">
                    {note}
                  </span>
                ) : null}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={cn("pb-2 pr-4 text-label font-medium uppercase text-g-500", className)}>
      {children}
    </th>
  );
}
