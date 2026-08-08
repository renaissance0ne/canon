import * as React from "react";
import { cn } from "@/lib/cn";

/**
 * A native <select>, restyled. Not a custom listbox: a reviewer working a queue
 * is keyboard-first, and the platform control already does type-ahead, arrow
 * keys and mobile pickers correctly. The only thing borrowed from the wireframe
 * is the ▾ — drawn as a character rather than an SVG, because everything else
 * on the row is already type.
 */
export function Select({
  className,
  children,
  ...props
}: React.ComponentProps<"select">) {
  return (
    <div className="relative">
      <select
        className={cn(
          "h-9 w-full appearance-none rounded-[2px] border border-hairline-strong bg-g-0 pl-2.5 pr-8",
          "font-mono text-value text-g-900",
          "transition-colors duration-[80ms] ease-canon hover:border-g-500",
          "focus-visible:border-g-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-g-900",
          "disabled:cursor-not-allowed disabled:text-g-400",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <span
        aria-hidden
        className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 font-mono text-value leading-none text-g-400"
      >
        ▾
      </span>
    </div>
  );
}
