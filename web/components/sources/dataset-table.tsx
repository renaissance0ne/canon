import Link from "next/link";
import type { DatasetSummary } from "@/types/dataset";

/**
 * What is on the engine's disk. Data surface: opaque, square, hairlines only,
 * 36px rows — not a card.
 *
 * The columns are chosen for the one question a reader actually has here:
 * is this dataset worth running against? Seed and accounts say what it is;
 * divergences and escalations say what it can score. A dataset with zero
 * escalations makes a guessing system look identical to a correct one, so the
 * count is a column rather than a detail behind a click.
 */
export function DatasetTable({
  datasets,
  fallback,
}: {
  datasets: DatasetSummary[];
  /** What a synthetic source reads when its config names no dataset. */
  fallback: string | null;
}) {
  return (
    <table className="w-full border-collapse bg-g-0">
      <thead>
        <tr className="border-b border-hairline-strong text-left">
          <Th>Name</Th>
          <Th>Seed</Th>
          <Th className="text-right">Accounts</Th>
          <Th className="text-right">Side A</Th>
          <Th className="text-right">Side B</Th>
          <Th className="text-right">Divergences</Th>
          <Th className="text-right">Escalate</Th>
          <Th>Classes</Th>
        </tr>
      </thead>
      <tbody>
        {datasets.map((dataset) => (
          <tr key={dataset.name} className="h-9 border-b border-hairline">
            <td className="pr-4 font-mono text-value text-g-900">
              {/* Straight to the manifest. The counts in this row are a summary
                  of it, and the reason to open a dataset is to check them. */}
              <Link
                href={`/sources/datasets/${encodeURIComponent(dataset.name)}`}
                className="text-g-900"
              >
                {dataset.name}
              </Link>
              {dataset.name === fallback ? (
                // Which dataset a source with no `dataset` in its config will
                // actually read. Otherwise it is only knowable from an env var
                // nobody browsing the console can see.
                <span className="ml-2 text-label uppercase text-g-500">default</span>
              ) : null}
            </td>
            <td className="pr-4 font-mono text-value text-g-600">{dataset.seed}</td>
            <Td>{dataset.accounts.toLocaleString()}</Td>
            <Td>{dataset.entitiesA.toLocaleString()}</Td>
            <Td>{dataset.entitiesB.toLocaleString()}</Td>
            <Td>{dataset.divergences.toLocaleString()}</Td>
            <Td>{dataset.escalations.toLocaleString()}</Td>
            <td className="font-mono text-value text-g-500">{classes(dataset)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** `structural 32 · attribute 65 · …` — the manifest's own breakdown. */
function classes(dataset: DatasetSummary): string {
  return Object.entries(dataset.byClass)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, count]) => `${name} ${count}`)
    .join(" · ");
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={`pb-2 pr-4 text-label font-medium uppercase text-g-500 ${className ?? ""}`}>
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="pr-4 text-right font-mono text-value text-g-600">{children}</td>;
}
