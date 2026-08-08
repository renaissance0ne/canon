import { cn } from "@/lib/cn";

type GradualBlurProps = {
  /** Which edge the blur is anchored to and strongest at. */
  position?: "top" | "bottom";
  /** Height of the blurred strip. Any CSS length. */
  height?: string;
  /** Blur in px at the anchored edge. Each layer gets a share of this. */
  strength?: number;
  /** More layers means a smoother ramp and more compositing work. 6 is plenty. */
  layers?: number;
  /**
   * Concentrate the blur near the edge instead of ramping linearly. Reads as a
   * sharper dissolve; useful under a sticky header where content should stay
   * legible until the last moment.
   */
  exponential?: boolean;
  className?: string;
};

/**
 * A progressive blur at one edge of a container, so content dissolves into the
 * surface instead of being cut by a hard line.
 *
 * Built as N abutting bands, each masked to its own slice and carrying more
 * blur than the one before it. At six layers the steps are not resolvable.
 *
 * This is chrome, never a data surface — AGENTS.md § Glass layer. Do not put
 * one of these over a conflict queue or a diff row.
 */
export function GradualBlur({
  position = "bottom",
  height = "128px",
  strength = 8,
  layers = 6,
  exponential = false,
  className,
}: GradualBlurProps) {
  // "to top" puts 0% at the bottom edge, which is where the blur is anchored
  // for position="bottom". Flipping the direction flips the whole ramp.
  const direction = position === "bottom" ? "to top" : "to bottom";
  const step = 100 / layers;

  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute inset-x-0 z-10",
        position === "bottom" ? "bottom-0" : "top-0",
        className,
      )}
      style={{ height }}
    >
      {Array.from({ length: layers }, (_, i) => {
        const from = step * i;
        const to = step * (i + 1);
        // A half-step shoulder on each side so neighbouring bands cross-fade
        // rather than butt together with a visible seam.
        const shoulder = step * 0.5;

        // Band 0 sits on the anchored edge and carries the full strength; each
        // band further in carries less, so the ramp fades toward the content.
        const progress = (layers - i) / layers;
        const blur = strength * (exponential ? progress * progress : progress);

        return (
          <div
            key={i}
            className="gradual-blur-layer"
            style={
              {
                "--layer-blur": `${blur.toFixed(2)}px`,
                "--layer-mask": `linear-gradient(${direction},
                  transparent ${Math.max(0, from - shoulder)}%,
                  #000 ${from}%,
                  #000 ${to}%,
                  transparent ${Math.min(100, to + shoulder)}%)`,
              } as React.CSSProperties
            }
          />
        );
      })}
    </div>
  );
}
