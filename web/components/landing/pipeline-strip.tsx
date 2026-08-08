"use client";

import { motion, useReducedMotion } from "motion/react";

const STAGES = [
  { n: "01", title: "Extract", value: "connectors", body: "CRM and warehouse reads, side by side." },
  { n: "02", title: "Normalize", value: "CanonicalEntity", body: "Folding is recorded, never destructive." },
  { n: "03", title: "Match", value: "exact → FAISS top-k", body: "Blocked to O(n·k). Never all pairs." },
  { n: "04", title: "Detect", value: "severity 1–4", body: "Field diffs, orphans and duplicates." },
  { n: "05", title: "Resolve", value: "rules → agent", body: "The model is called only when rules do not decide." },
  { n: "06", title: "Validate", value: "observed values only", body: "A value neither source reported is rejected." },
] as const;

/** 20ms stagger, 120ms fade — the house entrance. */
export function PipelineStrip() {
  const reduced = useReducedMotion();

  return (
    <ol className="grid gap-px bg-hairline sm:grid-cols-2 lg:grid-cols-3">
      {STAGES.map((stage, i) => (
        <motion.li
          key={stage.n}
          // Constant initial — see MotionProvider. Only the stagger delay is
          // branched, and transition never reaches the server-rendered markup.
          initial={{ opacity: 0, y: 6 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.12, delay: reduced ? 0 : i * 0.02, ease: [0.2, 0, 0.2, 1] }}
          className="glass flex flex-col gap-1.5 border-0 px-6 py-6"
        >
          <div className="flex items-baseline justify-between gap-4">
            <span className="font-mono text-value text-g-500">{stage.n}</span>
            <span className="font-mono text-[11px] text-g-500">{stage.value}</span>
          </div>
          <h3 className="text-heading text-g-900">{stage.title}</h3>
          <p className="text-body text-g-600" style={{ textWrap: "pretty" }}>
            {stage.body}
          </p>
        </motion.li>
      ))}
    </ol>
  );
}
