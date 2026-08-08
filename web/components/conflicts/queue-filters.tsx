import Link from "next/link";
import { cn } from "@/lib/cn";
import { formatCount } from "@/lib/format";
import { SEVERITY_LABEL, SEVERITY_ORDER, type Severity } from "@/types/conflict";
import {
  QUEUE_STATUS_LABEL,
  QUEUE_VIEWS,
  queueStatusFilterSchema,
  type QueueCounts,
  type QueueQuery,
} from "@/types/queue";

/**
 * Wireframe 1i's filter bar: three status chips, four severity marks, and the
 * view switch.
 *
 * Every control is a LINK, not a button. Filters live in the URL, so a reviewer
 * can send someone "the 41 structural ones in this run" — which is how half of
 * these conflicts actually get resolved. It also means this whole bar is a
 * Server Component with no state to get out of sync with what is on screen.
 */
export function QueueFilters({
  query,
  counts,
  runId,
}: {
  query: QueueQuery;
  counts: QueueCounts;
  runId: string;
}) {
  /** A link to this queue with one thing changed. Page resets: a new filter's page 3 is nobody's page 3. */
  function href(changes: Partial<Record<string, string | undefined>>): string {
    const params = new URLSearchParams({
      runId,
      status: query.status,
      view: query.view,
    });
    if (query.severities.length > 0) params.set("sev", query.severities.join(","));
    if (query.conflictClass) params.set("conflictClass", query.conflictClass);
    if (query.field) params.set("field", query.field);

    for (const [key, value] of Object.entries(changes)) {
      if (value === undefined) params.delete(key);
      else params.set(key, value);
    }

    return `/conflicts?${params.toString()}`;
  }

  const statusCount: Record<string, number> = {
    escalated: counts.escalated,
    auto_applied: counts.autoApplied,
    all: counts.all,
  };

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-hairline-strong pb-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {queueStatusFilterSchema.options.map((status) => {
          const active = query.status === status;
          return (
            <Link
              key={status}
              href={href({ status, page: undefined })}
              aria-current={active ? "true" : undefined}
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded-[2px] border px-2 text-[11px] no-underline",
                "font-sans transition-colors duration-[80ms] ease-canon",
                active
                  ? "border-g-900 bg-g-900 text-g-0"
                  : "border-hairline-strong bg-g-0 text-g-700 hover:border-g-900 hover:text-g-900",
              )}
            >
              {QUEUE_STATUS_LABEL[status]}
              <span className="font-mono tabular-nums">
                {formatCount(statusCount[status] ?? 0)}
              </span>
            </Link>
          );
        })}
      </div>

      <span aria-hidden className="h-4 w-px bg-hairline-strong" />

      {/* Severity is multi-select: a reviewer works "structural and ownership"
          in one pass, and the marks are the fastest way to say that. */}
      <div className="flex flex-wrap items-center gap-1.5">
        {SEVERITY_ORDER.map((severity) => (
          <SeverityChip
            key={severity}
            severity={severity}
            count={counts.bySeverity[severity]}
            active={query.severities.includes(severity)}
            href={href({ sev: toggleSeverity(query.severities, severity), page: undefined })}
          />
        ))}
      </div>

      <div className="ml-auto flex flex-wrap items-center gap-1.5">
        <span className="text-label uppercase text-g-500">View</span>
        {QUEUE_VIEWS.map(({ view, label, hint }) => {
          const active = query.view === view;
          return (
            <Link
              key={view}
              href={href({ view, page: undefined })}
              title={hint}
              aria-current={active ? "true" : undefined}
              className={cn(
                "inline-flex h-7 items-center rounded-[2px] border px-2 text-[11px] no-underline",
                "font-sans transition-colors duration-[80ms] ease-canon",
                active
                  ? "border-g-900 text-g-900"
                  : "border-transparent text-g-500 hover:text-g-900",
              )}
            >
              {label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function SeverityChip({
  severity,
  count,
  active,
  href,
}: {
  severity: Severity;
  count: number;
  active: boolean;
  href: string;
}) {
  return (
    <Link
      href={href}
      aria-pressed={active}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-[2px] border px-1.5 no-underline",
        "transition-colors duration-[80ms] ease-canon",
        active ? "border-g-900 bg-g-100" : "border-hairline hover:border-hairline-strong",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "font-mono text-[10px] leading-none tracking-[0.06em]",
          severity >= 3 ? "text-g-900" : "text-g-500",
        )}
      >
        {"█".repeat(severity)}
        {"░".repeat(4 - severity)}
      </span>
      <span className="font-mono text-[11px] tabular-nums text-g-600">
        {formatCount(count)}
      </span>
      {/* The mark is never the only signal — the word is here for a screen reader
          even where the chip has no room to print it. */}
      <span className="sr-only">
        {SEVERITY_LABEL[severity]} severity {severity}
        {active ? ", filtering" : ""}
      </span>
    </Link>
  );
}

/** Adding or removing one level. Empty means "no severity filter", not "none". */
function toggleSeverity(current: Severity[], severity: Severity): string | undefined {
  const next = current.includes(severity)
    ? current.filter((level) => level !== severity)
    : [...current, severity];

  return next.length > 0 ? next.sort((a, b) => b - a).join(",") : undefined;
}
