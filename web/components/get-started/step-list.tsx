"use client";

import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/cn";

export type Step = { n: string; title: string; body: string; value: string };

/** 20ms stagger, 120ms fade — the house entrance, borrowed once for onboarding. */
export function StepList({
  steps,
  className,
}: {
  steps: Step[];
  className?: string;
}) {
  const reduced = useReducedMotion();

  return (
    <ol className={cn("grid gap-px bg-hairline sm:grid-cols-3", className)}>
      {steps.map((step, i) => (
        <motion.li
          key={step.n}
          initial={{ opacity: 0, y: reduced ? 0 : 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            duration: 0.12,
            delay: reduced ? 0 : 0.06 + i * 0.02,
            ease: [0.2, 0, 0.2, 1],
          }}
          className="glass flex flex-col gap-2 border-0 px-6 py-6"
        >
          <div className="flex items-baseline justify-between">
            <span className="font-mono text-value text-g-500">{step.n}</span>
            <span className="font-mono text-[11px] text-g-500">{step.value}</span>
          </div>
          <h2 className="text-heading text-g-900" style={{ textWrap: "pretty" }}>
            {step.title}
          </h2>
          <p className="text-body text-g-600" style={{ textWrap: "pretty" }}>
            {step.body}
          </p>
        </motion.li>
      ))}
    </ol>
  );
}
