"use client";

import { motion, useReducedMotion } from "motion/react";
import { CanonMark } from "@/components/canon-mark";
import { GlassPanel } from "@/components/glass-panel";

/**
 * 120ms fade with a small rise — the same entrance the conflict queue uses,
 * without the stagger. Nothing else on this page animates.
 */
export function GetStartedHero() {
  const reduced = useReducedMotion();
  const rise = reduced ? 0 : 8;

  return (
    <motion.div
      initial={{ opacity: 0, y: rise }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.12, ease: [0.2, 0, 0.2, 1] }}
    >
      <GlassPanel weight="strong" className="px-9 py-8">
        <div className="flex items-center gap-3 text-g-900">
          <CanonMark size={26} />
          <span className="text-label uppercase text-g-500">Get started</span>
        </div>

        <h1 className="mt-6 max-w-[620px] text-display text-g-900" style={{ textWrap: "pretty" }}>
          Two systems of record, one answer.
        </h1>

        <p className="mt-3 max-w-[560px] text-body text-g-600" style={{ textWrap: "pretty" }}>
          Your CRM and your warehouse both claim to hold the org chart, and they
          disagree — on parents, territories, roles, and on which records are the
          same company. Canon finds the disagreements, proposes a resolution for
          each one, and escalates what a human should decide.
        </p>

        <dl className="mt-8 grid grid-cols-3 gap-px border-t border-hairline pt-5">
          <div>
            <dt className="text-label uppercase text-g-500">Matching</dt>
            <dd className="font-mono text-value text-g-900">exact → FAISS top-k</dd>
          </div>
          <div>
            <dt className="text-label uppercase text-g-500">Severity</dt>
            <dd className="font-mono text-value text-g-900">4 levels · labelled</dd>
          </div>
          <div>
            <dt className="text-label uppercase text-g-500">Audit</dt>
            <dd className="font-mono text-value text-g-900">append-only</dd>
          </div>
        </dl>
      </GlassPanel>
    </motion.div>
  );
}
