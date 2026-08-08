"use client";

import { useRef } from "react";
import { cn } from "@/lib/cn";

type SpotlightCardProps = React.ComponentProps<"div"> & {
  /** Radius of the pool in px. */
  radius?: number;
};

/**
 * A card that lights under the pointer.
 *
 * Achromatic, as everything here is: the pool lifts the card's --g-50 toward
 * --g-0 rather than tinting it, and the hairline steps from --g-200 to --g-300.
 * It reads as illumination because the card is darker than white to begin with,
 * not because a hue arrived.
 *
 * The effect is decoration on top of content that is fully legible without it —
 * no information is carried by the light. Pointer-only by design; there is
 * nothing here for a keyboard to miss.
 */
export function SpotlightCard({
  radius = 260,
  className,
  children,
  ...props
}: SpotlightCardProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  return (
    <div
      ref={ref}
      onPointerMove={(event) => {
        // Coarse pointers report a position on tap, which would strand the pool
        // wherever the last touch landed. Skip them.
        if (event.pointerType !== "mouse") return;
        const el = ref.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        el.style.setProperty("--spotlight-x", `${event.clientX - rect.left}px`);
        el.style.setProperty("--spotlight-y", `${event.clientY - rect.top}px`);
        el.style.setProperty("--spotlight-opacity", "1");
      }}
      onPointerLeave={() => {
        ref.current?.style.setProperty("--spotlight-opacity", "0");
      }}
      className={cn(
        // --g-100 at rest, not --g-50. The pool lifts to --g-0, and against a
        // --g-50 card that is a five-value difference nobody can see. Sinking
        // the card one step is what buys the effect enough range to register
        // without reaching for a hue.
        "group relative isolate overflow-hidden border border-hairline bg-g-100",
        "transition-colors duration-[80ms] ease-canon hover:border-hairline-strong",
        className,
      )}
      style={{ "--spotlight-radius": `${radius}px` } as React.CSSProperties}
      {...props}
    >
      <div
        aria-hidden="true"
        className="spotlight-pool pointer-events-none absolute inset-0 -z-10 opacity-[var(--spotlight-opacity,0)] transition-opacity duration-200 ease-canon"
      />
      {children}
    </div>
  );
}
