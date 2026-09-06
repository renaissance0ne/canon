import { cn } from "@/lib/cn";
import { VERDICT_LABEL, VERDICT_MARK, type Verdict } from "@/types/ground-truth";

/**
 * What the agent did about one injected divergence, and whether it was right.
 *
 * Same rule as SeverityMark: the glyph is never the only signal, so the word
 * always travels with it. There is no color to lean on, so the distinction is
 * carried by shape plus weight — a filled frame for the two verdicts the system
 * should want, a hairline for the ones it should not, and nothing at all for
 * rows where the agent never got a turn.
 */
const TREATMENT: Record<Verdict, string> = {
  correct: "border border-g-900 text-g-900 font-medium",
  correct_escalation: "border border-g-900 text-g-900 font-medium",
  false_auto_apply: "bg-ink text-g-0 font-medium",
  over_escalation: "border border-g-300 text-g-700",
  unresolved: "text-g-500",
  rejected: "border border-g-300 text-g-700",
  missed: "bg-ink text-g-0 font-medium",
};

export function VerdictMark({
  verdict,
  className,
}: {
  verdict: Verdict;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span
        className={cn(
          "inline-flex h-[18px] w-[18px] items-center justify-center font-mono text-[11px] leading-none",
          TREATMENT[verdict],
        )}
        aria-hidden
      >
        {VERDICT_MARK[verdict]}
      </span>
      <span className="text-label uppercase text-g-900">{VERDICT_LABEL[verdict]}</span>
    </span>
  );
}
