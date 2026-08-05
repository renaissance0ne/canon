"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

/**
 * shadcn/ui button, restricted to the grayscale token set. No color variants —
 * there is no "destructive" red in this system; a destructive action is ink
 * plus a word.
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[2px] font-sans font-medium transition-[opacity,border-color,background-color] duration-[80ms] ease-canon disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-g-900",
  {
    variants: {
      variant: {
        primary: "bg-g-900 text-g-0 hover:bg-g-800",
        outline: "border border-g-900 bg-transparent text-g-900 hover:bg-g-100",
        quiet: "border border-hairline bg-g-0 text-g-700 hover:border-g-900 hover:text-g-900",
        ghost: "text-g-600 hover:text-g-900",
      },
      size: {
        sm: "h-8 px-2.5 text-[11px] tracking-[0.02em]",
        md: "h-9 px-3.5 text-[13px]",
        lg: "h-11 px-5 text-[13px]",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />
  );
}

export { buttonVariants };
