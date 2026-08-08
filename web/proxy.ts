import { clerkMiddleware } from "@clerk/nextjs/server";

/**
 * Session context only. This file does not decide who may see what.
 *
 * It used to: a `createRouteMatcher` list named the three public routes and
 * everything else got `auth.protect()`. Clerk deprecated that pattern because
 * middleware matches on paths, and a path pattern can diverge from how Next.js
 * actually resolves a request — so a resource can be reachable while the
 * matcher believes it is covered. Canon is an internal tool whose console
 * renders a company's full org chart and whose review actions mutate the audit
 * trail, so "probably covered" is not a good enough guarantee.
 *
 * Authentication now happens on the resource that reads the data:
 * `requireReviewer()` in lib/server/auth.ts, called by every protected page and
 * route handler. See the coverage note there.
 *
 * `clerkMiddleware()` and the matcher below both stay — they are what make
 * `auth()` resolvable downstream.
 *
 * Next.js 16 reads this as `proxy.ts`; it was `middleware.ts` through 15.
 */
export default clerkMiddleware();

export const config = {
  matcher: [
    // Everything except static assets and _next internals.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Route handlers need session context too — they read run output and write reviews.
    "/(api|trpc)(.*)",
  ],
};
