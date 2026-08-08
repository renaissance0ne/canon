import Link from "next/link";
import { GetStartedHero } from "@/components/get-started/get-started-hero";
import { StepList } from "@/components/get-started/step-list";
import { SignOutControl } from "@/components/auth/sign-out-control";
import { countSourcesBySide } from "@/lib/server/sources";
import { requireReviewer } from "@/lib/server/auth";
import { Button } from "@/components/ui/button";

/**
 * Phase 0 — the four minutes before the first run. No rail: there is nothing
 * to navigate to yet. Server Component; the only client boundaries are the two
 * motion components and the sign-out control.
 */
export default async function GetStartedPage() {
  const [counts, reviewer] = await Promise.all([countSourcesBySide(), requireReviewer()]);
  const configured = counts.crm + counts.warehouse + counts.synthetic > 0;

  return (
    <div className="min-h-dvh bg-surface-sunken">
      <div className="mx-auto flex min-h-dvh max-w-[880px] flex-col justify-center px-8 py-20">
        {/* This screen has no rail, so it carries its own way out. Without it
            there is no sign-out anywhere on the page. */}
        <div className="mb-6 flex items-center gap-4">
          <span className="truncate font-mono text-[11px] leading-4 text-g-500">
            {reviewer.label}
          </span>
          <SignOutControl className="ml-auto" />
        </div>

        <GetStartedHero />

        <StepList
          className="mt-12"
          steps={[
            {
              n: "01",
              title: "Configure two sources",
              body: "One CRM side, one warehouse side. Credentials live in the engine environment — this record holds the non-secret shape only.",
              value: "sources ×2",
            },
            {
              n: "02",
              title: "Author a survivorship policy",
              body: "Field-level rules, evaluated most specific first. Rulesets are versioned rather than edited, so a past run stays reproducible.",
              value: "ruleset v1",
            },
            {
              n: "03",
              title: "Run, then review what escalated",
              body: "Rules decide what they can. The agent proposes the rest, and anything at severity 3 or above reaches you with its rationale attached.",
              value: "conf ≥ 0.85 ∧ sev ≤ 2",
            },
          ]}
        />

        <div className="mt-12 flex flex-wrap items-center gap-3 border-t border-hairline pt-8">
          <Button asChild size="lg">
            <Link href="/sources" className="no-underline">
              {configured ? "Continue to sources" : "Add your first source"}
            </Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link href="/sources?seed=synthetic" className="no-underline">
              Use synthetic dataset
            </Link>
          </Button>
          <p className="font-mono text-value text-g-500">seed 42 · 512 entities</p>
        </div>

        <p className="mt-6 max-w-[560px] border-l-2 border-g-900 pl-3 text-body text-g-600">
          Canon never writes back to Salesforce or the warehouse. It proposes,
          records every decision, and hands you a file.
        </p>
      </div>
    </div>
  );
}
