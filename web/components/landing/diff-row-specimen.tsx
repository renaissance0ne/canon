import { SeverityMark } from "@/components/severity-mark";

/**
 * The signature element, rendered on the landing page as the product's own
 * proof. AGENTS.md § The signature element: a data surface — opaque, square,
 * hairlines only. Deliberately NOT glass: the contrast between translucent
 * chrome and this row is the point.
 *
 * Character-level emphasis does the work a red/green diff would normally do:
 * the shared prefix stays --g-500, the differing tail goes --g-900 at 500.
 */
export function DiffRowSpecimen() {
  return (
    <figure className="m-0 border border-hairline-strong bg-g-0">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-hairline px-4 py-3">
        <SeverityMark severity={3} />
        <span className="font-mono text-value text-g-600">territory</span>
        <span className="ml-auto font-mono text-value text-g-500">
          ACC-4417 · Northwind Traders
        </span>
      </div>

      {/* The spine: one 1px vertical hairline, fixed 50/50, never moves. It
          becomes a horizontal rule below 768px and the labels stay. */}
      <div className="grid grid-cols-1 md:grid-cols-2">
        <div className="border-b border-hairline px-4 py-3 md:border-b-0 md:border-r">
          <p className="text-label uppercase text-g-500">Salesforce (prod)</p>
          <p className="mt-1 font-mono text-value">
            <span className="text-g-500">APAC</span>
            <span className="font-medium text-g-900">-SOUTH</span>
          </p>
          <p className="mt-0.5 text-body text-g-500">modified 2d ago</p>
        </div>
        <div className="px-4 py-3">
          <p className="text-label uppercase text-g-500">Databricks GTM</p>
          <p className="mt-1 font-mono text-value text-g-500">APAC</p>
          <p className="mt-0.5 text-body text-g-500">modified 61d ago</p>
        </div>
      </div>

      {/* The proposal sits beneath, indented, introduced by → — the grammar of
          a commit message under a diff hunk. */}
      <figcaption className="border-t border-hairline bg-surface-sunken px-4 py-3">
        <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
          <p className="font-mono text-value">
            <span className="text-g-500">→ </span>
            <span className="font-medium text-g-900">APAC-SOUTH</span>
          </p>
          <p className="font-mono text-value text-g-500">most_recent · 0.91</p>
          <p className="ml-auto font-mono text-value text-g-500">● auto-applied</p>
        </div>
        <p className="mt-1.5 max-w-[560px] text-body text-g-600">
          Salesforce shows APAC-SOUTH, modified 2 days ago; the warehouse still
          shows APAC from 61 days ago. Applied most_recent.
        </p>
      </figcaption>
    </figure>
  );
}
