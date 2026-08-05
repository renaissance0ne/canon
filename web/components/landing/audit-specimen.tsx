const ENTRIES = [
  { t: "18:02:11", action: "run_started", actor: "engine", detail: "ruleset v3 · seed 42" },
  { t: "18:04:47", action: "conflict_detected", actor: "engine", detail: "ACC-4417 · parentExternalId · sev 4" },
  { t: "18:08:42", action: "resolution_proposed", actor: "agent", detail: "APAC-SOUTH · most_recent · 0.91" },
  { t: "18:08:42", action: "auto_applied", actor: "agent", detail: "157 resolutions · sev ≤ 2" },
  { t: "18:22:04", action: "human_overridden", actor: "j.rao", detail: "ACC-4417 → ACC-2201 · note attached" },
] as const;

/** Append-only. Nothing here is ever updated or deleted. */
export function AuditSpecimen() {
  return (
    <table className="w-full border-collapse bg-g-0">
      <thead>
        <tr className="border-b border-hairline-strong text-left">
          <th className="pb-2 pr-6 text-label font-medium uppercase text-g-500">Time</th>
          <th className="pb-2 pr-6 text-label font-medium uppercase text-g-500">Action</th>
          <th className="pb-2 pr-6 text-label font-medium uppercase text-g-500">Actor</th>
          <th className="pb-2 text-label font-medium uppercase text-g-500">Detail</th>
        </tr>
      </thead>
      <tbody>
        {ENTRIES.map((entry) => (
          <tr key={entry.t + entry.action} className="h-9 border-b border-hairline">
            <td className="pr-6 font-mono text-value text-g-900">{entry.t}</td>
            <td className="pr-6 font-mono text-value text-g-900">{entry.action}</td>
            <td className="pr-6 font-mono text-value text-g-500">{entry.actor}</td>
            <td className="font-mono text-value text-g-500">{entry.detail}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
