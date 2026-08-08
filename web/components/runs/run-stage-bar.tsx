import { cn } from "@/lib/cn";
import { RUN_STAGES, runStageIndex, type RunStage, type RunStatus } from "@/types/run";

/**
 * Wireframes 1f and 1h. The pipeline as a line of words, because six named
 * stages carry more than a spinner does: a run that has been "matching" for
 * four minutes is a different situation from one that has been "extracting" for
 * four minutes, and only one of them is worth interrupting.
 *
 * With no colour available, position does the work: everything behind the
 * current stage is g-500 (done), the current stage is inverted ink, everything
 * ahead is g-400 (not reached). A failed run marks the stage it died in and
 * greys the rest — the run did not reach them and never will.
 */
export function RunStageBar({
  status,
  /** For a failed run: the stage it died in, when the error says. */
  diedAt,
  className,
}: {
  status: RunStatus;
  diedAt?: RunStage | null;
  className?: string;
}) {
  const failed = status === "failed";
  const currentIndex = failed
    ? diedAt
      ? runStageIndex(diedAt)
      : -1
    : runStageIndex(status);

  return (
    <div className={cn("flex flex-wrap items-center gap-x-1.5 gap-y-1", className)}>
      {RUN_STAGES.map((stage, index) => {
        const current = index === currentIndex;
        const reached = index < currentIndex;

        return (
          <span key={stage} className="flex items-center gap-1.5">
            {index > 0 ? (
              <span aria-hidden className="font-mono text-value text-g-400">
                ·
              </span>
            ) : null}
            <span
              className={cn(
                "font-mono text-value",
                current && "bg-ink px-1.5 py-0.5 font-medium text-g-0",
                reached && "text-g-500",
                // Unreached on a failed run is fainter than unreached on a live
                // one: a live run is still going to get there.
                !current && !reached && (failed ? "text-g-300" : "text-g-400"),
              )}
            >
              {stage}
            </span>
          </span>
        );
      })}

      {failed ? (
        <span className="ml-1 font-mono text-value font-medium text-g-900">· failed</span>
      ) : null}
    </div>
  );
}

/**
 * The same position as a bar. Deliberately not a percentage of work done —
 * stages are not equal in length — it is "how far along the pipeline", which is
 * the only claim the engine can actually support.
 */
export function RunProgressBar({ status }: { status: RunStatus }) {
  const index = Math.max(0, runStageIndex(status));
  const fraction = index / (RUN_STAGES.length - 1);

  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={RUN_STAGES.length - 1}
      aria-valuenow={index}
      aria-valuetext={status}
      className="h-[7px] w-full bg-hairline"
    >
      <div
        className="h-full bg-ink transition-[width] duration-300 ease-canon"
        style={{ width: `${Math.round(fraction * 100)}%` }}
      />
    </div>
  );
}
