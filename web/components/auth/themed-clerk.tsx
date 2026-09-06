"use client";

import { SignIn, SignUp, UserButton } from "@clerk/nextjs";
import { clerkAppearanceFor } from "@/lib/clerk-appearance";
import { useTheme } from "@/components/theme/theme-provider";

/**
 * Clerk's widgets, rendered under the current theme.
 *
 * The appearance is applied per widget rather than on the provider, and that is
 * forced rather than chosen. `<ClerkProvider>` from `@clerk/nextjs` is a server
 * component — it awaits the request to build `initialState` — so wrapping it in
 * a client component to feed it a theme would drop it to the client-only
 * variant and hand every page a frame of signed-out UI. Clerk merges the
 * provider's appearance with the widget's, widget wins, so passing it here
 * costs nothing and leaves the provider where it belongs.
 *
 * Clerk's colours are hex literals (see lib/clerk-appearance.ts), so they do not
 * follow `data-theme` on their own the way every Tailwind token does. These
 * three components are the entire set of Clerk render sites in the app; if a
 * fourth is added, it goes here too.
 */
function useClerkAppearance() {
  const { resolvedTheme } = useTheme();
  return clerkAppearanceFor(resolvedTheme);
}

export function ThemedUserButton() {
  const appearance = useClerkAppearance();
  return <UserButton appearance={appearance} />;
}

export function ThemedSignIn() {
  const appearance = useClerkAppearance();
  return <SignIn appearance={appearance} />;
}

export function ThemedSignUp() {
  const appearance = useClerkAppearance();
  return <SignUp appearance={appearance} />;
}
