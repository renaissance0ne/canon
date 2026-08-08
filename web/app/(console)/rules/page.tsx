import { PageHeader } from "@/components/console/page-header";
import { RulesetEditor } from "@/components/rules/ruleset-editor";
import { listRulesets } from "@/lib/server/rulesets";
import { listSources } from "@/lib/server/sources";
import { formatTimestamp } from "@/lib/format";
import { requireReviewer } from "@/lib/server/auth";

/**
 * Wireframe 1d — survivorship policy.
 *
 * Server Component; the editor below is the only client boundary. The version
 * history is rendered here rather than hidden behind a menu because it is the
 * evidence that rulesets are append-only: every version a run could cite is on
 * the page, readable, forever.
 */
export default async function RulesPage() {
  await requireReviewer();

  const [rulesets, sources] = await Promise.all([listRulesets(), listSources()]);
  const active = rulesets.find((ruleset) => ruleset.isActive) ?? null;
  const history = rulesets.filter((ruleset) => ruleset.id !== active?.id);

  return (
    <>
      <PageHeader
        title="Rules"
        meta={active ? `${active.name} · v${active.version}` : "no policy yet"}
      />

      <div className="flex flex-col gap-12 px-10 py-8">
        <RulesetEditor active={active} sources={sources} />

        {history.length > 0 ? (
          <section>
            <h2 className="text-label uppercase text-g-500">Earlier versions</h2>
            <table className="mt-3 w-full max-w-[720px] border-collapse bg-g-0">
              <tbody>
                {history.map((ruleset) => (
                  <tr key={ruleset.id} className="h-9 border-b border-hairline">
                    <td className="pr-4 font-mono text-value text-g-900">
                      v{ruleset.version}
                    </td>
                    <td className="pr-4 font-mono text-value text-g-600">{ruleset.name}</td>
                    <td className="pr-4 font-mono text-value text-g-500">
                      {ruleset.rules.length} rules
                    </td>
                    <td className="font-mono text-value text-g-500">
                      {formatTimestamp(ruleset.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 max-w-[560px] text-body text-g-500">
              Kept, not archived. A run records the ruleset id it executed under,
              so any of these can still be read back exactly as it ran.
            </p>
          </section>
        ) : null}
      </div>
    </>
  );
}
