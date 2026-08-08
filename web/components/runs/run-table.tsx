import Link from "next/link";
import { cn } from "@/lib/cn";
import { formatCount, formatElapsed, formatTimestamp, shortRunId } from "@/lib/format";
import { isTerminalRunStatus, isStatKnown, type RunDetail } from "@/types/run";

/**
 * Data surface: opaque, square, hairlines only. 36px rows.
 *
 * Status is a word, not a dot. Four of the seven statuses mean "still going"
 * and a reader has to know which one — a shared "in progress" indicator would
 * throw away the only information the row carries about how far it got.
 */
export function RunTable({ runs }: { runs: RunDetail[] }) {
  return (
    <table className="w-full border-collapse bg-g-0">
      <thead>
        <tr className="border-b border-hairline-strong text-left">
          <Th>Run</Th>
          <Th>Status</Th>
          <Th>Sources</Th>
          <Th>Ruleset</Th>
          <Th className="text-right">Conflicts</Th>
          <Th className="text-right">Escalated</Th>
          <Th>Started</Th>
          <Th className="text-right">Duration</Th>
        </tr>
      </thead>
      <tbody>
        {runs.map((run) => (
          <tr key={run.id} className="h-9 border-b border-hairline">
            <td className="pr-4">
              <Link
                href={`/runs/${run.id}`}
                className="font-mono text-value text-g-900 no-underline hover:underline"
              >
                {shortRunId(run.id)}
              </Link>
            </td>
            <td className="pr-4">
              <span
                className={cn(
                  "font-mono text-value",
                  run.status === "failed" && "font-medium text-g-900",
                  run.status === "complete" && "text-g-600",
                  !isTerminalRunStatus(run.status) && "text-g-900",
                )}
              >
                {run.status}
              </span>
            </td>
            <td className="pr-4 font-mono text-value text-g-600">
              {run.sourceAName} ↔ {run.sourceBName}
            </td>
            <td className="pr-4 font-mono text-value text-g-500">
              {run.rulesetName} v{run.rulesetVersion}
            </td>
            <Num>{isStatKnown("conflicts", run.status) ? formatCount(run.stats.conflicts) : "—"}</Num>
            <Num emphasis>
              {isStatKnown("escalated", run.status) ? formatCount(run.stats.escalated) : "—"}
            </Num>
            <td className="pr-4 font-mono text-value text-g-500">
              {formatTimestamp(run.startedAt)}
            </td>
            <Num>
              {run.finishedAt
                ? formatElapsed(run.finishedAt.getTime() - run.startedAt.getTime())
                : "—"}
            </Num>
          </tr>
        ))}
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

function Num({ children, emphasis }: { children: React.ReactNode; emphasis?: boolean }) {
  return (
    <td
      className={cn(
        "pr-4 text-right font-mono text-value tabular-nums",
        emphasis ? "text-g-900" : "text-g-600",
      )}
    >
      {children}
    </td>
  );
}
