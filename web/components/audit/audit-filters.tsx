import Link from "next/link";
import { cn } from "@/lib/cn";
import { formatCount } from "@/lib/format";
import {
  AUDIT_ACTIONS,
  AUDIT_ACTION_LABEL,
  type AuditAction,
} from "@/types/resolution";

/**
 * "Filter by action" in wireframe 1n, unfolded into the actions that actually
 * occurred rather than hidden behind a dropdown.
 *
 * Only actions with entries are offered. A filter that leads to an empty table
 * is a dead end, and the counts double as a summary of what the run did — which
 * is most of what a reader wants from this screen before they read a single row.
 */
export function AuditFilters({
  byAction,
  active,
  runId,
}: {
  byAction: Partial<Record<AuditAction, number>>;
  active: AuditAction | undefined;
  runId: string | undefined;
}) {
  function href(action: AuditAction | undefined): string {
    const params = new URLSearchParams();
    if (runId) params.set("runId", runId);
    if (action) params.set("action", action);
    const query = params.toString();
    return query ? `/audit?${query}` : "/audit";
  }

  const present = AUDIT_ACTIONS.filter((action) => (byAction[action] ?? 0) > 0);
  const total = present.reduce((sum, action) => sum + (byAction[action] ?? 0), 0);

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-hairline-strong pb-3">
      <Chip href={href(undefined)} active={active === undefined} count={total}>
        All actions
      </Chip>

      {present.map((action) => (
        <Chip
          key={action}
          href={href(action)}
          active={active === action}
          count={byAction[action] ?? 0}
        >
          {AUDIT_ACTION_LABEL[action]}
        </Chip>
      ))}
    </div>
  );
}

function Chip({
  href,
  active,
  count,
  children,
}: {
  href: string;
  active: boolean;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-[2px] border px-2 text-[11px] no-underline",
        "font-sans transition-colors duration-[80ms] ease-canon",
        active
          ? "border-g-900 bg-g-900 text-g-0"
          : "border-hairline-strong bg-g-0 text-g-700 hover:border-g-900 hover:text-g-900",
      )}
    >
      {children}
      <span className="font-mono tabular-nums">{formatCount(count)}</span>
    </Link>
  );
}
