/**
 * How a reviewer is named, in one place.
 *
 * The rail shows who you are signed in as; `audit_log.actor` records who
 * approved a resolution. If those two ever disagree, the console is telling a
 * reviewer something the permanent record does not say — so both sides derive
 * the label here rather than each doing their own `??` chain.
 *
 * AGENTS.md's own audit example uses `j.rao`, not an opaque id, which is why
 * username wins over email and the user id is only a fallback.
 *
 * Typed structurally: the server (`User`) and the client (`UserResource`) are
 * different Clerk types that happen to share these two fields.
 */
export function reviewerLabel(
  user: {
    username?: string | null;
    primaryEmailAddress?: { emailAddress?: string | null } | null;
  } | null,
  fallback: string,
): string {
  return user?.username ?? user?.primaryEmailAddress?.emailAddress ?? fallback;
}
