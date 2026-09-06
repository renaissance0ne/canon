import { parseJson } from "@/app/api/_lib/respond";
import { requireReviewerForApi } from "@/lib/server/auth";
import { createRulesetVersion, listRulesets } from "@/lib/server/rulesets";
import { createRulesetSchema } from "@/types/rules";

/**
 * Wireframe 1d — the survivorship policy.
 *
 * POST creates a NEW VERSION. There is no PATCH and there will not be one: a
 * run records the `rulesetId` it executed under, so mutable rules would make
 * every past run unreproducible and turn the audit trail into a lie. "Save as
 * v4" is the only way to change policy, and v3 stays readable forever.
 */

export async function GET() {
  const gate = await requireReviewerForApi();
  if (!gate.ok) return gate.response;
  return Response.json({ rulesets: await listRulesets(gate.reviewer.userId) });
}

export async function POST(request: Request) {
  const gate = await requireReviewerForApi();
  if (!gate.ok) return gate.response;

  const parsed = await parseJson(request, createRulesetSchema);
  if (!parsed.ok) return parsed.response;

  // Versions are numbered per owner and per name, so "Save as v4" means v4 of
  // THIS account's policy — not the fourth save anyone has ever made.
  const ruleset = await createRulesetVersion(parsed.data, gate.reviewer.userId);
  return Response.json({ ruleset }, { status: 201 });
}
