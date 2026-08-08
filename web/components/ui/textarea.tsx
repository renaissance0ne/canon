import * as React from "react";
import { cn } from "@/lib/cn";

/** Mono, like every other value. The config field is JSON and reads as code. */
export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        "w-full rounded-[2px] border border-hairline-strong bg-g-0 px-2.5 py-2",
        "font-mono text-value leading-relaxed text-g-900 placeholder:text-g-400",
        "transition-colors duration-[80ms] ease-canon hover:border-g-500",
        "focus-visible:border-g-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-g-900",
        className,
      )}
      spellCheck={false}
      {...props}
    />
  );
}
