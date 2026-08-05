import { cn } from "@/lib/cn";

/** Uppercase eyebrow / column header. Sans, because it is chrome, not data. */
export function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      className={cn("font-sans text-label uppercase text-g-500", className)}
      {...props}
    />
  );
}
