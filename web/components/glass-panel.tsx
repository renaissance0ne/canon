import { cn } from "@/lib/cn";

type GlassPanelProps = React.ComponentProps<"div"> & {
  /** "strong" for anything a user reads through — dialogs, focused panels. */
  weight?: "default" | "strong";
};

/**
 * The single glass primitive. Floating chrome only — never wrap a table, a
 * queue or a conflict diff row in this. Data surfaces are opaque and square.
 */
export function GlassPanel({
  weight = "default",
  className,
  ...props
}: GlassPanelProps) {
  return (
    <div
      className={cn(
        weight === "strong" ? "glass-strong" : "glass",
        "rounded-[2px]",
        className,
      )}
      {...props}
    />
  );
}
