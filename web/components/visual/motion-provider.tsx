"use client";

import { MotionConfig } from "motion/react";

/**
 * `reducedMotion="user"` makes Motion drop transform and layout animations for
 * anyone who has asked for less motion, leaving opacity alone.
 *
 * This exists so no component has to branch its `initial` prop on
 * `useReducedMotion()`. That hook cannot be read during SSR — the server has no
 * media query to consult, so it resolves one way there and the other way on a
 * reduced-motion client, and the two renders disagree. Setting the policy once
 * in context removes the branch, and with it the mismatch.
 *
 * Transition timing may still be branched on the hook: `transition` never
 * reaches the server-rendered markup, only `initial` does.
 */
export function MotionProvider({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
