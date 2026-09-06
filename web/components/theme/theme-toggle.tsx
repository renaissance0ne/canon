"use client";

import { cn } from "@/lib/cn";
import { useTheme } from "@/components/theme/theme-provider";

/* Two glyphs, drawn here rather than imported. currentColor only, like
   canon-mark.tsx — the switch is the one interactive element that has to read
   correctly sitting on ink and on paper in the same second. */

function SunGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={12}
      height={12}
      aria-hidden="true"
      className={cn("block", className)}
    >
      <circle cx="8" cy="8" r="3" fill="currentColor" />
      <g stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
        <path d="M8 1.4V3" />
        <path d="M8 13v1.6" />
        <path d="M1.4 8H3" />
        <path d="M13 8h1.6" />
        <path d="m3.34 3.34 1.12 1.12" />
        <path d="m11.54 11.54 1.12 1.12" />
        <path d="m12.66 3.34-1.12 1.12" />
        <path d="m4.46 11.54-1.12 1.12" />
      </g>
    </svg>
  );
}

function MoonGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={12}
      height={12}
      aria-hidden="true"
      className={cn("block", className)}
    >
      <path
        d="M13.2 9.9A5.6 5.6 0 0 1 6.1 2.8a5.8 5.8 0 1 0 7.1 7.1Z"
        fill="currentColor"
      />
    </svg>
  );
}

/**
 * Light ⇄ dark. A 2px-radius control, hairline track, solid --ink thumb — the
 * same vocabulary as every other interactive element here, and no hue.
 *
 * The thumb's position is driven by the `data-theme` attribute on <html>, not
 * by React state. That is what lets the server render one markup for both
 * themes: the attribute is already correct before hydration (the inline script
 * in app/layout.tsx sets it), so the switch is never briefly on the wrong side.
 * React owns only `aria-checked`, which settles a frame later and is invisible.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, toggle } = useTheme();
  const isDark = resolvedTheme === "dark";

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isDark}
      aria-label="Dark theme"
      title={isDark ? "Switch to light theme" : "Switch to dark theme"}
      onClick={toggle}
      className={cn(
        "relative inline-flex h-[22px] w-[44px] shrink-0 items-center",
        "rounded-[2px] border border-hairline-strong bg-g-0",
        "transition-colors duration-[80ms] ease-canon hover:border-g-500",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-g-900",
        className,
      )}
    >
      {/* The half the thumb is not covering. --g-400 is the decorative step,
          which is exactly what these are: the thumb carries the live glyph. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-0 flex w-1/2 items-center justify-center text-g-400"
      >
        <SunGlyph />
      </span>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 right-0 flex w-1/2 items-center justify-center text-g-400"
      >
        <MoonGlyph />
      </span>

      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute left-[2px] top-[2px] flex h-4 w-4 items-center justify-center",
          "rounded-[2px] bg-ink text-g-0",
          "transition-transform duration-[120ms] ease-canon",
          "[[data-theme=dark]_&]:translate-x-[22px]",
        )}
      >
        <SunGlyph className="[[data-theme=dark]_&]:hidden" />
        <MoonGlyph className="hidden [[data-theme=dark]_&]:block" />
      </span>
    </button>
  );
}
