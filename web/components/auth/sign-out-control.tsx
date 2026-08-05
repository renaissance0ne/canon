"use client";

import { SignOutButton } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

/**
 * Sign out, as Canon's own button rather than Clerk's.
 *
 * `SignOutButton` clones its child and attaches the handler, so the control
 * keeps the grayscale variants, the 2px radius and the focus ring from
 * components/ui/button.tsx instead of bringing a second button style into the
 * interface.
 *
 * Redirects to `/` — the only public route — so signing out never lands on a
 * protected page and bounces through the sign-in redirect.
 */
export function SignOutControl({
  full = false,
  className,
}: {
  /** Fill the container. Used in the 240px rail; inline elsewhere. */
  full?: boolean;
  className?: string;
}) {
  return (
    <SignOutButton redirectUrl="/">
      <Button
        variant="quiet"
        size="sm"
        className={cn(full && "w-full justify-center", className)}
      >
        Sign out
      </Button>
    </SignOutButton>
  );
}
