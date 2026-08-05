import { SOURCE_KIND_LABEL, SOURCE_KIND_SIDE, type Source } from "@/types/source";

/**
 * Data surface: opaque, square, hairlines only. Not a card, not glass — the
 * hairlines are the structure. 36px rows (dense table).
 */
export function SourceTable({ sources }: { sources: Source[] }) {
  return (
    <table className="w-full border-collapse bg-g-0">
      <thead>
        <tr className="border-b border-hairline-strong text-left">
          <th className="pb-2 pr-4 text-label font-medium uppercase text-g-500">Name</th>
          <th className="pb-2 pr-4 text-label font-medium uppercase text-g-500">Kind</th>
          <th className="pb-2 pr-4 text-label font-medium uppercase text-g-500">Side</th>
          <th className="pb-2 text-label font-medium uppercase text-g-500">Objects</th>
        </tr>
      </thead>
      <tbody>
        {sources.map((source) => (
          <tr key={source.id} className="h-9 border-b border-hairline">
            <td className="pr-4 font-mono text-value text-g-900">{source.name}</td>
            <td className="pr-4 font-mono text-value text-g-600">
              {SOURCE_KIND_LABEL[source.kind]}
            </td>
            <td className="pr-4 font-mono text-value text-g-600">
              {SOURCE_KIND_SIDE[source.kind]}
            </td>
            <td className="font-mono text-value text-g-500">
              {source.config.objects.join(", ")}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
