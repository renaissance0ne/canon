import Link from "next/link";
import { cn } from "@/lib/cn";
import { manifestDivergenceSchema } from "@/types/dataset";
import type { RunDetail } from "@/types/run";

const CLASSES = manifestDivergenceSchema.shape.conflictClass.options;

export type DatasetQuery = {
  conflictClass: string | null;
  expected: "escalate" | "resolvable" | null;
  runId: string | null;
  page: number;
};

/**
 * The ground-truth filter bar.
 *
 * Every control is a LINK, like the conflict queue's. Filters live in the URL,
 * so "the ambiguous ones this run got wrong" is a thing you can send someone,
 * and the whole bar stays a Server Component with no state to drift from what
 * is on screen.
 */
export function DatasetFilters({
  name,
  query,
  runs,
  total,
}: {
  name: string;
  query: DatasetQuery;
  /** Runs this account has executed against this dataset, newest first. */
  runs: RunDetail[];
  total: number;
}) {
  function href(changes: Record<string, string | undefined>): string {
    const params = new URLSearchParams();
    if (query.conflictClass) params.set("class", query.conflictClass);
    if (query.expected) params.set("expected", query.expected);
    if (query.runId) params.set("run", query.runId);
    if (query.page > 1) params.set("page", String(query.page));

    for (const [key, value] of Object.entries(changes)) {
      if (value === undefined) params.delete(key);
      else params.set(key, value);
    }

    const search = params.toString();
    return `/sources/datasets/${encodeURIComponent(name)}${search ? `?${search}` : ""}`;
  }

  return (
    <div className="flex flex-col gap-3 border-b border-hairline-strong pb-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-label uppercase text-g-500">Class</span>
        <Chip href={href({ class: undefined, page: undefined })} active={!query.conflictClass}>
          all
        </Chip>
        {CLASSES.map((option) => (
          <Chip
            key={option}
            href={href({ class: option, page: undefined })}
            active={query.conflictClass === option}
          >
            {option}
          </Chip>
        ))}

        <span className="ml-2 text-label uppercase text-g-500">Answer</span>
        <Chip href={href({ expected: undefined, page: undefined })} active={!query.expected}>
          any
        </Chip>
        {/* The split the benchmark turns on: cases with a correct value, and
            cases where the only correct action is to hand it to a human. */}
        <Chip
          href={href({ expected: "resolvable", page: undefined })}
          active={query.expected === "resolvable"}
        >
          resolvable
        </Chip>
        <Chip
          href={href({ expected: "escalate", page: undefined })}
          active={query.expected === "escalate"}
        >
          escalate
        </Chip>

        <span className="ml-auto font-mono text-value text-g-500">
          {total.toLocaleString()} matching
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-label uppercase text-g-500">Score against run</span>
        {runs.length === 0 ? (
          <span className="font-mono text-value text-g-500">
            no runs have used this dataset yet
          </span>
        ) : (
          <>
            <Chip href={href({ run: undefined, page: undefined })} active={!query.runId}>
              none
            </Chip>
            {runs.slice(0, 6).map((run) => (
              <Chip key={run.id} href={href({ run: run.id })} active={query.runId === run.id}>
                {run.id.slice(0, 8)} · {run.modelProvider}
              </Chip>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function Chip({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={cn(
        "inline-flex h-7 items-center rounded-[2px] border px-2 font-mono text-[11px] no-underline",
        "transition-colors duration-[80ms] ease-canon",
        active
          ? "border-g-900 font-medium text-g-900"
          : "border-hairline text-g-600 hover:border-g-500 hover:text-g-900",
      )}
    >
      {children}
    </Link>
  );
}
