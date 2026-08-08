"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { formatCount } from "@/lib/format";

/**
 * Wireframe 1o — the export, and the deliberate stopping point.
 *
 * Four sections, two ticked. The checkbox marks are shape, not fill (■ / □),
 * consistent with resolution status: this interface has no color to spend on
 * "on" and "off".
 *
 * The estimate is labelled `≈` because it is one — a real byte count means
 * serialising the file to measure it, which is the download. Saying "≈1.4 MB"
 * and being wrong by a fifth is more useful than saying nothing.
 */

export type ExportSectionName = "hierarchy" | "decisions" | "orphans" | "stats";

type SectionSpec = {
  name: ExportSectionName;
  label: string;
  /** What the row counts, in words. "487 entities", not "487". */
  unit: string;
  /** In the CSV, or JSON only. */
  csv: boolean;
};

const SECTIONS: readonly SectionSpec[] = [
  { name: "hierarchy", label: "resolved hierarchy", unit: "entities", csv: false },
  { name: "decisions", label: "decision log", unit: "conflicts", csv: true },
  { name: "orphans", label: "unmatched / orphans", unit: "records", csv: false },
  { name: "stats", label: "run stats + tokens", unit: "run", csv: false },
];

export function ExportPanel({
  runId,
  counts,
  bytesPerSection,
}: {
  runId: string;
  counts: Record<ExportSectionName, number>;
  /** Estimated bytes for each section, computed server-side from real row counts. */
  bytesPerSection: Record<ExportSectionName, number>;
}) {
  // The two that are the export: what the org looks like, and why it looks that
  // way. The other two are additions, so they start off.
  const [selected, setSelected] = useState<Set<ExportSectionName>>(
    new Set<ExportSectionName>(["hierarchy", "decisions"]),
  );
  const [format, setFormat] = useState<"json" | "csv">("json");

  function toggle(name: ExportSectionName) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  const ordered = SECTIONS.filter((section) => selected.has(section.name));

  const bytes = useMemo(
    () =>
      ordered
        // CSV carries the decision log only, so the estimate has to say that too.
        .filter((section) => format === "json" || section.csv)
        .reduce((total, section) => total + bytesPerSection[section.name], 0),
    [ordered, format, bytesPerSection],
  );

  const href =
    ordered.length > 0
      ? `/api/runs/${runId}/export?format=${format}&sections=${ordered
          .map((section) => section.name)
          .join(",")}`
      : null;

  const csvDropsSections = format === "csv" && ordered.some((section) => !section.csv);

  return (
    <div className="flex max-w-[440px] flex-col gap-4">
      <ul className="flex flex-col gap-1.5">
        {SECTIONS.map((section) => {
          const on = selected.has(section.name);
          return (
            <li key={section.name}>
              <button
                type="button"
                role="checkbox"
                aria-checked={on}
                onClick={() => toggle(section.name)}
                className="flex w-full items-baseline gap-2 text-left font-mono text-value text-g-600 hover:text-g-900"
              >
                <span aria-hidden className={cn("w-3", on ? "text-g-900" : "text-g-400")}>
                  {on ? "■" : "□"}
                </span>
                <span className={on ? "text-g-900" : undefined}>{section.label}</span>
                <span className="ml-auto shrink-0 tabular-nums text-g-500">
                  {section.name === "stats"
                    ? "1 run"
                    : `${formatCount(counts[section.name])} ${section.unit}`}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <div className="flex items-center gap-2 border-t border-hairline pt-3">
        <Button
          size="sm"
          variant={format === "json" ? "primary" : "quiet"}
          onClick={() => setFormat("json")}
        >
          JSON
        </Button>
        <Button
          size="sm"
          variant={format === "csv" ? "primary" : "quiet"}
          onClick={() => setFormat("csv")}
        >
          CSV
        </Button>

        <span className="ml-auto font-mono text-value tabular-nums text-g-500">
          ≈ {formatBytes(bytes)}
        </span>
      </div>

      {csvDropsSections ? (
        <p className="border-l-2 border-g-900 pl-3 text-body text-g-700">
          CSV carries the decision log only. Two row shapes in one CSV is a file
          nobody can pivot — take JSON for the hierarchy, the orphans and the
          stats.
        </p>
      ) : null}

      {href ? (
        <Button asChild>
          <a href={href} className="no-underline">
            Download {format.toUpperCase()}
          </a>
        </Button>
      ) : (
        <Button disabled>Select at least one section</Button>
      )}
    </div>
  );
}

/** `1.4 MB`. Decimal, because that is what a file manager shows. */
function formatBytes(bytes: number): string {
  if (bytes < 1_000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(0)} kB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}
