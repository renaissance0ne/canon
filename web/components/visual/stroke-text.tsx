import { cn } from "@/lib/cn";

type StrokeTextProps = {
  children: React.ReactNode;
  /** Stroke thickness in px. Scale it with the type size, not with the layout. */
  width?: number;
  className?: string;
};

/**
 * Outlined display type. The counterpart to the app's solid --g-900 headings:
 * same word, no fill, so a phrase can carry two weights of emphasis without
 * reaching for a second colour.
 *
 * The stroke is --g-500 rather than the lighter greys it is tempting to use.
 * #71717A on --g-0 clears 4.5:1, so an outlined word is still real text a
 * reader can rely on — AGENTS.md § Quality floor. Do not lighten it.
 */
export function StrokeText({ children, width = 1, className }: StrokeTextProps) {
  return (
    <span
      className={cn("[paint-order:stroke_fill]", className)}
      style={{
        WebkitTextStrokeWidth: `${width}px`,
        WebkitTextStrokeColor: "var(--color-g-500)",
        WebkitTextFillColor: "transparent",
      }}
    >
      {children}
    </span>
  );
}
