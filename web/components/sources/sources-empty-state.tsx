"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import { Button } from "@/components/ui/button";
import { GlassPanel } from "@/components/glass-panel";

/**
 * Wireframe 1b. The synthetic path is the real onboarding: the full pipeline
 * runs end to end before anyone touches OAuth, so the first thing a new
 * operator sees working is the product, not a credentials form.
 */
export function SourcesEmptyState() {
  const reduced = useReducedMotion();

  return (
    <motion.div
      initial={{ opacity: 0, y: reduced ? 0 : 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.12, ease: [0.2, 0, 0.2, 1] }}
    >
      <GlassPanel weight="strong" className="max-w-[720px] p-8">
        <p className="text-label uppercase text-g-500">No sources yet</p>

        <h2 className="mt-4 max-w-[520px] text-heading text-g-900" style={{ textWrap: "pretty" }}>
          Canon reads two systems and reconciles them.
        </h2>
        <p className="mt-2 max-w-[520px] text-body text-g-600" style={{ textWrap: "pretty" }}>
          Configure one CRM side and one warehouse side to start. Credentials
          stay in the engine environment, keyed by kind — nothing secret is
          stored on a source record.
        </p>

        <div className="mt-7 grid gap-px border border-dashed border-hairline-strong bg-hairline sm:grid-cols-2">
          <div className="bg-g-50/60 px-5 py-4">
            <p className="text-label uppercase text-g-500">Source A · CRM</p>
            <p className="mt-1 font-mono text-value text-g-500">salesforce · hubspot</p>
          </div>
          <div className="bg-g-50/60 px-5 py-4">
            <p className="text-label uppercase text-g-500">Source B · warehouse</p>
            <p className="mt-1 font-mono text-value text-g-500">databricks · snowflake</p>
          </div>
        </div>

        <div className="mt-7 flex flex-wrap items-center gap-3">
          <Button asChild>
            {/* Wireframe 1c lands here. */}
            <Link href="/sources/new" className="no-underline">
              Add source
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/sources/new?kind=synthetic" className="no-underline">
              Use synthetic dataset
            </Link>
          </Button>
          <p className="font-mono text-value text-g-500">seed 42</p>
        </div>
      </GlassPanel>
    </motion.div>
  );
}
