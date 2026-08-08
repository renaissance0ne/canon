import "server-only";
import { auth, currentUser } from "@clerk/nextjs/server";
import { reviewerLabel } from "@/lib/reviewer-label";

/**
 * Reviewer identity, resolved server-side.
 *
 * This is the point of adding auth at all. AGENTS.md § audit_log defines
 * `actor` as `"engine" | "agent" | a reviewer identifier`, and the audit trail
 * exists to answer "who approved this?" — so the identifier can never be a
 * string the client supplied. `reviewActionSchema` deliberately has no
 * `reviewedBy` field; it comes from here instead.
 */
export type Reviewer = {
  /** Stable key. Survives an email or username change. */
  userId: string;
  /**
   * What the audit view renders — AGENTS.md's own example actor is `j.rao`,
   * not an opaque id. Both are returned so the readable form never has to be
   * reverse-engineered from the stable one.
   */
  label: string;
};

/**
 * The authentication boundary. Every protected page and route handler calls
 * this, and nothing is protected by anything else.
 *
 * It used to assume proxy.ts had already checked the path, and merely threw if
 * that assumption broke. It no longer assumes: `auth.protect()` is the check.
 * Clerk deprecated `createRouteMatcher` precisely because middleware matches on
 * paths, and a path pattern can diverge from how Next.js actually resolves a
 * request — leaving a protected resource reachable while the matcher believes
 * it is covered. Checking here instead means the gate sits on the resource that
 * reads the data, where it cannot be routed around.
 *
 * `auth.protect()` redirects to sign-in from a Server Component and responds
 * 404 from a route handler, so callers never have to branch on context.
 *
 * Do not weaken this back into an assertion: the identifier it returns is what
 * lands in `audit_log.actor`, and an anonymous row there is a lie about who
 * approved a resolution.
 */
export async function requireReviewer(): Promise<Reviewer> {
  await auth.protect();

  const { userId } = await auth();

  if (!userId) {
    // protect() has already guaranteed a session; a missing userId after it
    // means Clerk changed shape underneath us. Fail rather than continue.
    throw new Error("Authenticated session carried no userId.");
  }

  const user = await currentUser();
  return { userId, label: reviewerLabel(user, userId) };
}

/**
 * The route-handler counterpart to `requireReviewer`.
 *
 * Route handlers must not use `requireReviewer` directly. `auth.protect()`
 * answers a signed-out request with a 307 to the sign-in page, which is right
 * for a screen and wrong for JSON: a `fetch` follows the redirect, receives an
 * HTML document, and `res.json()` fails with a parse error that names neither
 * the route nor the real cause. The polled status endpoint would report a
 * syntax error where it means "signed out".
 *
 * Returns a 401 instead, in the same `{ ok, response }` shape as `parseJson`,
 * so a handler gates and parses the same way:
 *
 *     const gate = await requireReviewerForApi();
 *     if (!gate.ok) return gate.response;
 */
export type ReviewerGate =
  | { ok: true; reviewer: Reviewer }
  | { ok: false; response: Response };

export async function requireReviewerForApi(): Promise<ReviewerGate> {
  const { isAuthenticated, userId } = await auth();

  if (!isAuthenticated || !userId) {
    return {
      ok: false,
      response: Response.json({ error: "Authentication required." }, { status: 401 }),
    };
  }

  const user = await currentUser();
  return { ok: true, reviewer: { userId, label: reviewerLabel(user, userId) } };
}

/**
 * For pages that render differently when signed out rather than redirecting.
 *
 * The `isAuthenticated` check is load-bearing, not a shortcut: `requireReviewer`
 * now calls `auth.protect()`, so calling it on a signed-out request would
 * redirect instead of returning null and quietly turn every caller into a
 * protected route. Do not collapse this into a bare `requireReviewer()` call.
 */
export async function getReviewer(): Promise<Reviewer | null> {
  const { isAuthenticated } = await auth();
  return isAuthenticated ? requireReviewer() : null;
}
