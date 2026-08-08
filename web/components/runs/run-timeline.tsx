import { auditDetailLine } from "@/lib/audit-detail";
import { formatClockTime } from "@/lib/format";
import { AUDIT_ACTION_LABEL, type AuditEntry } from "@/types/resolution";

/**
 * Wireframe 1g — the run's own audit entries, oldest first.
 *
 * Read straight out of `audit_log`, which is append-only: nothing on this list
 * can be edited or removed after the fact, by either layer. That is the whole
 * reason it is worth showing on the run screen rather than summarising it.
 */
export function RunTimeline({ entries }: { entries: AuditEntry[] }) {
  if (entries.length === 0) {
    return <p className="font-mono text-value text-g-400">— nothing recorded yet</p>;
  }

  return (
    <ol className="flex flex-col gap-1">
      {entries.map((entry) => {
        // Shared with the audit trail (1n), so a decision reads the same on
        // both screens.
        const detail = auditDetailLine(entry);

        return (
          <li key={entry.id} className="font-mono text-value text-g-600">
            <span className="text-g-500">{formatClockTime(entry.createdAt)}</span>
            <span className="text-g-400"> · </span>
            <span className="text-g-900">{AUDIT_ACTION_LABEL[entry.action]}</span>
            <span className="text-g-400"> · </span>
            <span className="text-g-500">{entry.actor}</span>
            {detail ? (
              <>
                <span className="text-g-400"> · </span>
                <span className="text-g-500">{detail}</span>
              </>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
