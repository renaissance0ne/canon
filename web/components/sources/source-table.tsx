import Link from "next/link";
import { SOURCE_KIND_LABEL, SOURCE_KIND_SIDE, type Source } from "@/types/source";
import { AUTH_METHOD_LABEL, requiresCredentials, type CredentialStatus } from "@/types/credentials";

/**
 * Data surface: opaque, square, hairlines only. Not a card, not glass — the
 * hairlines are the structure. 36px rows (dense table).
 */
export function SourceTable({
  sources,
  credentials,
  now,
}: {
  sources: Source[];
  /** Redacted status by source id. Key names and dates only — never a value. */
  credentials: Map<string, CredentialStatus>;
  /**
   * When "now" is, passed in rather than read here. Reading the clock during
   * render makes the output depend on when React happened to run, which is the
   * one thing a render must not do — and it is what would decide whether a row
   * reads `expired`.
   */
  now: number;
}) {
  return (
    <table className="w-full border-collapse bg-g-0">
      <thead>
        <tr className="border-b border-hairline-strong text-left">
          <th className="pb-2 pr-4 text-label font-medium uppercase text-g-500">Name</th>
          <th className="pb-2 pr-4 text-label font-medium uppercase text-g-500">Kind</th>
          <th className="pb-2 pr-4 text-label font-medium uppercase text-g-500">Side</th>
          <th className="pb-2 pr-4 text-label font-medium uppercase text-g-500">Objects</th>
          <th className="pb-2 text-label font-medium uppercase text-g-500">Credential</th>
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
            <td className="pr-4 font-mono text-value text-g-500">
              {source.config.objects.join(", ")}
            </td>
            <td className="font-mono text-value">
              <CredentialCell
                source={source}
                credential={credentials.get(source.id) ?? null}
                now={now}
              />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Connected · expired · not connected, with no color to say which.
 *
 * The distinction is carried by the glyph plus the word, the same rule
 * SeverityMark and the resolution statuses follow: `●` connected, `■` expired
 * and needing attention, `◦` nothing stored. A reader scanning a list of
 * sources has to be able to find the broken one by eye.
 */
function CredentialCell({
  source,
  credential,
  now,
}: {
  source: Source;
  credential: CredentialStatus | null;
  now: number;
}) {
  if (!requiresCredentials(source.kind)) {
    return <span className="text-g-400">— not required</span>;
  }

  if (!credential) {
    return (
      <Link href={`/sources/${source.id}/connect`} className="text-g-900">
        ◦ connect
      </Link>
    );
  }

  const expired = credential.expiresAt !== null && credential.expiresAt.getTime() <= now;

  return (
    <Link href={`/sources/${source.id}/connect`} className="text-g-900">
      {expired ? "■ expired" : "●"} {AUTH_METHOD_LABEL[credential.method].toLowerCase()}
    </Link>
  );
}
