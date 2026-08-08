"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import { Button } from "@/components/ui/button";
import { GlassPanel } from "@/components/glass-panel";
import { DiffRowSpecimen } from "@/components/landing/diff-row-specimen";
import { StrokeText } from "@/components/visual/stroke-text";
import { TextType } from "@/components/visual/text-type";

/** The fields Canon actually opens conflicts on, in the order detect.py checks. */
const CONFLICT_FIELDS = [
  "parentExternalId",
  "territory",
  "roleName",
  "ownerId",
  "segment",
] as const;

export function LandingHero() {
  const reduced = useReducedMotion();
  const ease = [0.2, 0, 0.2, 1] as const;

  return (
    <section className="mx-auto max-w-[1120px] px-8 pb-28 pt-16">
      {/* `initial` is constant on purpose — it is what the server renders, so
          branching it on useReducedMotion() guarantees a hydration mismatch.
          MotionProvider drops the y-transform for reduced-motion users; only
          the transition below, which never reaches the markup, is branched. */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.12, ease }}
      >
        <GlassPanel weight="strong" className="px-10 py-14">
          <p className="text-label uppercase text-g-500">
            Reconciliation for organizational structure
          </p>

          {/* "twice" is outlined because there literally are two copies and one
              of them is a hollow echo of the other. The typography is making
              the argument the paragraph below spells out. */}
          <h1
            className="mt-6 max-w-[760px] text-[clamp(34px,5.2vw,56px)] font-medium leading-[1.04] tracking-[-0.03em] text-g-900"
            style={{ textWrap: "balance" }}
          >
            Your org chart exists <StrokeText width={1.4}>twice</StrokeText>, and
            the two copies disagree.
          </h1>

          <p className="mt-6 max-w-[600px] text-body text-g-600" style={{ textWrap: "pretty" }}>
            Reps and ops teams edit accounts, roles, territories and reporting
            lines in the CRM. The warehouse holds its own version of the same
            structure. Canon reads both, finds every disagreement, proposes a
            resolution with its reasoning attached, and escalates the ones a
            human should decide.
          </p>

          {/* Mono, because these are field names off a real conflict row — not
              marketing copy dressed up as one. AGENTS.md § Type. */}
          <p className="mt-8 flex flex-wrap items-baseline gap-x-2 font-mono text-value text-g-500">
            <span>conflict.field</span>
            <span aria-hidden="true">=</span>
            <TextType phrases={CONFLICT_FIELDS} className="text-g-900" />
          </p>

          <div className="mt-9 flex flex-wrap items-center gap-3">
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
            <p className="font-mono text-value text-g-500">
              or run the synthetic dataset · seed 42
            </p>
          </div>
        </GlassPanel>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.12, delay: reduced ? 0 : 0.08, ease }}
        className="mt-10"
      >
        <p className="mb-3 text-label uppercase text-g-500">
          One conflict, as Canon renders it
        </p>
        <DiffRowSpecimen />
      </motion.div>
    </section>
  );
}
