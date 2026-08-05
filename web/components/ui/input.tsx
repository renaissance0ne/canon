import * as React from "react";
import { cn } from "@/lib/cn";

/** Values are mono everywhere, including while being typed. */
export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "h-9 w-full rounded-[2px] border border-hairline-strong bg-g-0 px-2.5",
        "font-mono text-value text-g-900 placeholder:text-g-400",
        "transition-colors duration-[80ms] ease-canon hover:border-g-500",
        "focus-visible:border-g-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-g-900",
        className,
      )}
      {...props}
    />
  );
}
