import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

/**
 * Protected-first. Canon is an internal tool: the console renders a company's
 * full org chart, territories and reporting lines, and its review actions
 * mutate the audit trail. Anything not named here requires a session.
 *
 * Next.js 16 reads this as `proxy.ts`; it was `middleware.ts` through 15.
 */
const isPublicRoute = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) await auth.protect();
});

export const config = {
  matcher: [
    // Everything except static assets and _next internals.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Route handlers are protected too — they read run output and write reviews.
    "/(api|trpc)(.*)",
  ],
};
