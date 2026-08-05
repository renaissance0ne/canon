"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import { Button } from "@/components/ui/button";
import { GlassPanel } from "@/components/glass-panel";
import { DiffRowSpecimen } from "@/components/landing/diff-row-specimen";

export function LandingHero() {
  const reduced = useReducedMotion();
  const rise = reduced ? 0 : 8;
  const ease = [0.2, 0, 0.2, 1] as const;

  return (
    <section className="mx-auto max-w-[1120px] px-8 pb-24 pt-20">
      <motion.div
        initial={{ opacity: 0, y: rise }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.12, ease }}
      >
        <GlassPanel weight="strong" className="px-10 py-12">
          <p className="text-label uppercase text-g-500">
            Reconciliation for organizational structure
          </p>

          <h1
            className="mt-6 max-w-[720px] text-[44px] font-medium leading-[1.05] tracking-[-0.03em] text-g-900"
            style={{ textWrap: "pretty" }}
          >
            Your org chart exists twice, and the two copies disagree.
          </h1>

          <p className="mt-5 max-w-[600px] text-body text-g-600" style={{ textWrap: "pretty" }}>
            Reps and ops teams edit accounts, roles, territories and reporting
            lines in the CRM. The warehouse holds its own version of the same
            structure. Canon reads both, finds every disagreement, proposes a
            resolution with its reasoning attached, and escalates the ones a
            human should decide.
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
        initial={{ opacity: 0, y: reduced ? 0 : 6 }}
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
