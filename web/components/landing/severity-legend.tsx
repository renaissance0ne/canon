import { SeverityMark } from "@/components/severity-mark";
import type { Severity } from "@/types/conflict";

const ROWS: { severity: Severity; what: string; policy: string }[] = [
  { severity: 4, what: "Hierarchy edges, orphans with children, duplicates", policy: "Always escalated. Re-parenting changes what rollups mean." },
  { severity: 3, what: "Fields that drive routing — territory, role, owner", policy: "Escalated. A rule may propose, a human decides." },
  { severity: 2, what: "Descriptive fields — segment, industry, region label", policy: "Auto-applied at confidence ≥ 0.85." },
  { severity: 1, what: "Case, punctuation, legal suffix", policy: "Auto-applied. Normalization already agrees." },
];

/** Data surface: opaque, square, hairlines. 44px rows. */
export function SeverityLegend() {
  return (
    <table className="w-full border-collapse bg-g-0">
      <thead>
        <tr className="border-b border-hairline-strong text-left">
          <th className="pb-2 pr-6 text-label font-medium uppercase text-g-500">Severity</th>
          <th className="pb-2 pr-6 text-label font-medium uppercase text-g-500">What lands here</th>
          <th className="pb-2 text-label font-medium uppercase text-g-500">Policy</th>
        </tr>
      </thead>
      <tbody>
        {ROWS.map((row) => (
          <tr key={row.severity} className="border-b border-hairline align-top">
            <td className="py-3 pr-6 whitespace-nowrap">
              <SeverityMark severity={row.severity} />
            </td>
            <td className="py-3 pr-6 text-body text-g-900">{row.what}</td>
            <td className="py-3 text-body text-g-600">{row.policy}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
