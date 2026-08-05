import { cn } from "@/lib/cn";
import { SEVERITY_LABEL, type Severity } from "@/types/conflict";

/**
 * AGENTS.md § Encoding severity without color. Four levels, separated by fill
 * density and weight, and NEVER rendered without the word — the mark alone is
 * never the only signal.
 *
 * `Severity` and its labels are the shared contract; they live in types/.
 */
const MARK: Record<Severity, string> = {
  4: "████",
  3: "███░",
  2: "██░░",
  1: "█░░░",
};

const TREATMENT: Record<Severity, string> = {
  4: "bg-ink text-g-0 font-medium",
  3: "border border-g-900 text-g-900 font-medium",
  2: "border border-g-300 text-g-700",
  1: "text-g-500",
};

export function SeverityMark({
  severity,
  className,
}: {
  severity: Severity;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span
        className={cn(
          "px-1 py-0.5 font-mono text-[10px] leading-none tracking-[0.06em]",
          TREATMENT[severity],
        )}
      >
        {MARK[severity]}
      </span>
      <span className="text-label uppercase text-g-900">{SEVERITY_LABEL[severity]}</span>
    </span>
  );
}
