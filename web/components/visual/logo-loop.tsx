"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

export type LoopMark = {
  /** The wordmark as it should read. Rendered, not fetched — no remote assets. */
  label: string;
  /** What Canon does with it. Sits under the mark in the label style. */
  role: string;
};

type LogoLoopProps = {
  marks: readonly LoopMark[];
  /** Pixels per second. Constant regardless of how many marks are in the strip. */
  speed?: number;
  /** Fade the strip into the surface at both ends. */
  fadeOut?: boolean;
  /** Stop the strip while the pointer is over it, so a name can be read. */
  pauseOnHover?: boolean;
  className?: string;
};

/**
 * An infinite marquee of the systems Canon reads from.
 *
 * Two identical tracks translate by exactly -50% of the pair's width, so the
 * seam always lands on a duplicate and the loop is invisible. Duration comes
 * from the measured width rather than a guess, which is what keeps the speed
 * constant when marks are added or the viewport changes.
 *
 * The strip is decorative: it is aria-hidden, and a plain list of the same
 * names is exposed to assistive technology instead.
 */
export function LogoLoop({
  marks,
  speed = 44,
  fadeOut = true,
  pauseOnHover = true,
  className,
}: LogoLoopProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [duration, setDuration] = useState(40);
  const [paused, setPaused] = useState(false);

  const measure = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    // scrollWidth spans both copies; one cycle covers half of it.
    const distance = track.scrollWidth / 2;
    if (distance > 0) setDuration(distance / speed);
  }, [speed]);

  useEffect(() => {
    measure();
    const observer = new ResizeObserver(measure);
    if (trackRef.current) observer.observe(trackRef.current);
    return () => observer.disconnect();
  }, [measure]);

  const sequence = [...marks, ...marks];

  // Masked rather than overlaid with a matching-colour gradient: the strip sits
  // over the wave field, and anything painted at the edges would read as a flat
  // grey block against it. A mask fades the marks themselves.
  const edgeFade = fadeOut
    ? {
        maskImage:
          "linear-gradient(to right, transparent, #000 6rem, #000 calc(100% - 6rem), transparent)",
        WebkitMaskImage:
          "linear-gradient(to right, transparent, #000 6rem, #000 calc(100% - 6rem), transparent)",
      }
    : undefined;

  return (
    <div
      className={cn("relative overflow-hidden", className)}
      style={edgeFade}
      onPointerEnter={pauseOnHover ? () => setPaused(true) : undefined}
      onPointerLeave={pauseOnHover ? () => setPaused(false) : undefined}
    >
      <div
        ref={trackRef}
        aria-hidden="true"
        className="logo-loop-track flex w-max"
        style={
          {
            "--loop-duration": `${duration}s`,
            "--loop-play-state": paused ? "paused" : "running",
          } as React.CSSProperties
        }
      >
        {sequence.map((mark, i) => (
          <div
            key={`${mark.label}-${i}`}
            className="flex shrink-0 flex-col justify-center border-r border-hairline px-8 py-4"
          >
            <span className="font-mono text-value text-g-600">{mark.label}</span>
            <span className="mt-0.5 text-label uppercase text-g-400">{mark.role}</span>
          </div>
        ))}
      </div>

      {/* The strip is a picture of a list. Give assistive tech the list. */}
      <ul className="sr-only">
        {marks.map((mark) => (
          <li key={mark.label}>
            {mark.label} — {mark.role}
          </li>
        ))}
      </ul>

    </div>
  );
}
