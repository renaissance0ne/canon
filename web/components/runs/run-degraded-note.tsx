import { formatCount } from "@/lib/format";
import {
  MODEL_PROVIDER_LABEL,
  isRunDegraded,
  trustworthyEscalations,
  type RunDetail,
} from "@/types/run";

/**
 * A run completed, but not all of it is the agent's answer.
 *
 * A failed model call escalates. That is deliberate — an outage must never
 * quietly change what the system decides — but it means `escalated` silently
 * mixes two different facts: conflicts the agent judged genuinely ambiguous,
 * and conflicts nobody ever got an answer for. A reviewer opening a queue of
 * 151 has no way to know that 117 of them are missing answers rather than hard
 * decisions, and would work them as if they were.
 *
 * The evaluation harness has always said this out loud ("these numbers are NOT
 * the agent's"). This is the console saying the same thing, because a degraded
 * run that renders as a clean one is the single most misleading state the
 * product can be in.
 *
 * Not an error state: the run is complete and everything the rules decided is
 * sound. It is a caveat on ONE number, and it says exactly which.
 */
export function RunDegradedNote({ run }: { run: RunDetail }) {
  if (!isRunDegraded(run.stats)) return null;

  const { modelErrors, modelRateLimited, escalated } = run.stats;
  const genuine = trustworthyEscalations(run.stats);
  const attempted = modelErrors + run.stats.modelCalls;

  return (
    <div className="border-l-2 border-g-900 bg-surface-sunken px-4 py-3">
      <p className="text-label uppercase text-g-900">Degraded · escalations are not all judgements</p>

      <p className="mt-2 max-w-[520px] text-body text-g-700">
        {formatCount(modelErrors)} of {formatCount(attempted)}{" "}
        {MODEL_PROVIDER_LABEL[run.modelProvider]} calls failed and escalated
        instead of answering. Those conflicts carry no opinion — the agent was
        never asked successfully.
      </p>

      {/* The arithmetic, spelled out. A reviewer about to open the queue needs
          to know how much of it is real work before they start, not after. */}
      <p className="mt-2 font-mono text-value text-g-900">
        {formatCount(escalated)} escalated − {formatCount(modelErrors)} unanswered ={" "}
        <span className="font-medium">{formatCount(genuine)}</span> the agent
        actually escalated
      </p>

      {modelRateLimited > 0 ? (
        <p className="mt-2 max-w-[520px] text-body text-g-500">
          {formatCount(modelRateLimited)} requests were throttled and retried,
          which is also where the run&rsquo;s wall-clock went. A rate limit is a
          quota, not a defect — re-running with more headroom will answer these.
        </p>
      ) : null}

      <p className="mt-2 max-w-[520px] text-body text-g-500">
        Rules resolved what they cover regardless, and nothing here is wrong —
        only incomplete. The audit trail records the cause under{" "}
        <span className="font-mono text-value">run degraded</span>.
      </p>
    </div>
  );
}
