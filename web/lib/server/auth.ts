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
 * Throws when there is no session. Routes are already protected by proxy.ts, so
 * reaching this without a session means the matcher and the handler disagree —
 * which should fail loudly rather than write an anonymous row to audit_log.
 */
export async function requireReviewer(): Promise<Reviewer> {
  const { isAuthenticated, userId } = await auth();

  if (!isAuthenticated || !userId) {
    throw new Error("No authenticated reviewer — this route should be covered by proxy.ts.");
  }

  const user = await currentUser();
  return { userId, label: reviewerLabel(user, userId) };
}

/** For pages that render differently when signed out rather than redirecting. */
export async function getReviewer(): Promise<Reviewer | null> {
  const { isAuthenticated } = await auth();
  return isAuthenticated ? requireReviewer() : null;
}
