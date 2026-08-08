"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useReducedMotion } from "motion/react";
import { cn } from "@/lib/cn";

/* "Is this the client yet?", without a setState-in-effect. The store never
   changes, so subscribe is a no-op; the whole mechanism is the server snapshot
   returning false while the client snapshot returns true. */
const NEVER_CHANGES = () => () => {};
const onClient = () => true;
const onServer = () => false;

type TextTypeProps = {
  /** Phrases to cycle. The longest one sizes the reserved box. */
  phrases: readonly string[];
  /** ms per character while typing. */
  typeSpeed?: number;
  /** ms per character while deleting. Deleting reads better faster than typing. */
  deleteSpeed?: number;
  /** ms to hold a completed phrase before deleting it. */
  holdMs?: number;
  className?: string;
};

type Phase = "typing" | "holding" | "deleting";

/**
 * A typewriter that cycles a set of phrases.
 *
 * Used on the landing page for the field names Canon actually finds conflicts
 * in, so it is mono — these are data values, and AGENTS.md § Type is not
 * suspended because something is animating.
 *
 * Three things keep it honest:
 *
 * - It starts fully typed, holding the first phrase, and the caret only appears
 *   after mount. The server and the first client paint therefore render exactly
 *   the same characters. `useReducedMotion()` cannot be read during SSR without
 *   producing a hydration mismatch, so nothing branches on it before mount.
 * - The box is sized to the longest phrase up front, so a cycle never reflows
 *   the line it sits on.
 * - The animated span is hidden from assistive technology in favour of a static
 *   list, so a screen reader is not read one character at a time.
 */
export function TextType({
  phrases,
  typeSpeed = 62,
  deleteSpeed = 28,
  holdMs = 1900,
  className,
}: TextTypeProps) {
  const reduced = useReducedMotion();
  const mounted = useSyncExternalStore(NEVER_CHANGES, onClient, onServer);
  const [index, setIndex] = useState(0);
  // Start complete rather than empty: this is the state the server renders, and
  // beginning mid-hold means the cycle joins seamlessly instead of popping.
  const [count, setCount] = useState(phrases[0]?.length ?? 0);
  const [phase, setPhase] = useState<Phase>("holding");

  const phrase = phrases[index] ?? "";

  useEffect(() => {
    if (!mounted || reduced) return;

    const delay =
      phase === "holding" ? holdMs : phase === "typing" ? typeSpeed : deleteSpeed;

    const timer = setTimeout(() => {
      if (phase === "typing") {
        if (count < phrase.length) setCount(count + 1);
        else setPhase("holding");
        return;
      }
      if (phase === "holding") {
        setPhase("deleting");
        return;
      }
      if (count > 0) setCount(count - 1);
      else {
        setIndex((i) => (i + 1) % phrases.length);
        setPhase("typing");
      }
    }, delay);

    return () => clearTimeout(timer);
  }, [
    mounted,
    reduced,
    phase,
    count,
    phrase.length,
    phrases.length,
    typeSpeed,
    deleteSpeed,
    holdMs,
  ]);

  // Reserve the width of the longest phrase so the line never reflows as the
  // text grows and shrinks. `ch` is exact here because the span is mono.
  const widest = phrases.reduce((a, b) => (b.length > a.length ? b : a), "");
  const animating = mounted && !reduced;

  return (
    <span className={cn("inline-flex items-baseline", className)}>
      <span
        aria-hidden="true"
        className="relative inline-block whitespace-pre"
        style={{ minWidth: `${widest.length}ch` }}
      >
        {phrase.slice(0, count)}
        {animating ? (
          <span className="caret-blink ml-px inline-block h-[1em] w-[0.5ch] translate-y-[0.12em] bg-g-900 align-baseline" />
        ) : null}
      </span>
      <span className="sr-only">{phrases.join(", ")}</span>
    </span>
  );
}
