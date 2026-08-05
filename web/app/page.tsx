import Link from "next/link";
import { LandingNav } from "@/components/landing/landing-nav";
import { LandingHero } from "@/components/landing/landing-hero";
import { LandingSection } from "@/components/landing/landing-section";
import { PipelineStrip } from "@/components/landing/pipeline-strip";
import { SeverityLegend } from "@/components/landing/severity-legend";
import { AuditSpecimen } from "@/components/landing/audit-specimen";
import { GlassPanel } from "@/components/glass-panel";
import { Button } from "@/components/ui/button";
import { CanonLockup } from "@/components/canon-mark";

const BOUNDARIES = [
  {
    title: "It does not write back",
    body: "Canon never edits Salesforce or the warehouse. It proposes, records, and hands you a file. Write-back changes the risk profile of the whole system.",
  },
  {
    title: "It does not merge duplicates",
    body: "Two CRM records matching one warehouse record is reported, with the evidence. Merging is a source-system decision.",
  },
  {
    title: "It does not invent values",
    body: "The validate step rejects any resolution neither source actually reported — including the model's.",
  },
  {
    title: "It does not edit history",
    body: "Rulesets are versioned rather than edited, and the audit log is append-only, so a run from six weeks ago still reproduces.",
  },
];

export default function LandingPage() {
  return (
    <div className="field-grid min-h-dvh">
      <LandingNav />
      <LandingHero />

      <LandingSection
        id="how"
        eyebrow="How it works"
        title="Six stages, and the model only runs in one of them."
        lede="Deterministic rules resolve what they can. The agent is asked only about the conflicts rules leave open, and its answer is checked against what the sources actually reported before anything is applied."
      >
        <PipelineStrip />
        <GlassPanel className="mt-px flex flex-wrap items-baseline gap-x-6 gap-y-2 border-0 px-6 py-5">
          <p className="text-label uppercase text-g-500">Auto-apply gate</p>
          <p className="font-mono text-value text-g-900">
            confidence ≥ 0.85 AND severity ≤ 2
          </p>
          <p className="max-w-[520px] text-body text-g-600">
            Everything else escalates to a person. The threshold is a named
            constant the evaluation harness sweeps — not a setting buried in the
            console.
          </p>
        </GlassPanel>
      </LandingSection>

      <LandingSection
        id="severity"
        eyebrow="Severity without color"
        title="Four levels, carried by density and a word."
        lede="The console is entirely achromatic. Color is the lazy way to encode state, and removing it forces every distinction onto something more durable: fill density, weight, shape, and always a label. A mark never appears without its word."
      >
        <SeverityLegend />
      </LandingSection>

      <LandingSection
        id="audit"
        eyebrow="Audit"
        title="Every decision, and who made it."
        lede="Engine, agent and human actions land in the same append-only log. This view is the artifact a reviewer asks for when they want to know why a territory changed."
      >
        <AuditSpecimen />
      </LandingSection>

      <LandingSection
        eyebrow="Boundaries"
        title="What Canon deliberately will not do."
        lede="The scope is narrow on purpose. Each of these is a decision, not a missing feature."
      >
        <div className="grid gap-px bg-hairline sm:grid-cols-2">
          {BOUNDARIES.map((item) => (
            <div key={item.title} className="glass border-0 px-6 py-6">
              <h3 className="text-heading text-g-900">{item.title}</h3>
              <p className="mt-2 text-body text-g-600" style={{ textWrap: "pretty" }}>
                {item.body}
              </p>
            </div>
          ))}
        </div>
      </LandingSection>

      <section className="mx-auto max-w-[1120px] px-8 pb-24">
        <GlassPanel weight="strong" className="flex flex-wrap items-center gap-6 px-10 py-10">
          <div>
            <h2 className="max-w-[480px] text-display text-g-900" style={{ textWrap: "pretty" }}>
              Reconcile your first two sources.
            </h2>
            <p className="mt-2 max-w-[440px] text-body text-g-600">
              Or run the synthetic dataset and watch the whole pipeline work
              before you touch a credential.
            </p>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-3">
            <Button asChild size="lg">
              <Link href="/get-started" className="no-underline">
                Get started
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href="/sign-up" className="no-underline">
                Sign up
              </Link>
            </Button>
          </div>
        </GlassPanel>
      </section>

      <footer className="border-t border-hairline">
        <div className="mx-auto flex max-w-[1120px] flex-wrap items-center gap-6 px-8 py-8">
          <CanonLockup size={16} />
          <p className="font-mono text-value text-g-500">single-tenant · no write-back</p>
          <Link href="/get-started" className="ml-auto text-label uppercase text-g-500 no-underline hover:text-g-900">
            Get started
          </Link>
        </div>
      </footer>
    </div>
  );
}
