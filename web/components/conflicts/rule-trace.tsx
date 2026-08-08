import { cn } from "@/lib/cn";
import { deriveRuleTrace } from "@/lib/rule-trace";
import type { QueueRow } from "@/types/queue";

/**
 * Wireframe 1j — the rule trace.
 *
 * ```
 * classify → parentExternalId/account → escalate
 * propose · skipped   validate · skipped
 * ```
 *
 * This is the most defensible thing on the screen. Deterministic-first is only
 * worth building if a reviewer can SEE which decisions needed a model and which
 * did not — otherwise "the agent handled it" and "a rule handled it" look
 * identical, and the whole cost argument is unverifiable from the console.
 *
 * Skipped nodes are rendered, not hidden. `propose · skipped` is the claim that
 * no model was called on this conflict, and it has to be visible to be worth
 * anything.
 */
export function RuleTrace({ row, className }: { row: QueueRow; className?: string }) {
  const steps = deriveRuleTrace(row);

  return (
    <div className={className}>
      <p className="text-label uppercase text-g-500">Rule trace</p>
      <ol className="mt-1 flex flex-col gap-0.5">
        {steps.map((step) => (
          <li
            key={step.node}
            className={cn(
              "font-mono text-value",
              step.ran ? "text-g-600" : "text-g-400",
            )}
          >
            {step.node}
            {step.ran ? (
              <>
                <span className="text-g-400"> · </span>
                <span className="text-g-900">{step.detail}</span>
              </>
            ) : (
              <span className="text-g-400"> · skipped</span>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
