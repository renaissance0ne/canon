"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { patchJson } from "@/lib/api-client";
import type { ReviewAction, ResolutionStatus } from "@/types/resolution";

/**
 * Submitting one review decision (wireframes 1i–1l).
 *
 * Two things are worth explaining here.
 *
 * OPTIMISM, BOUNDED. The PATCH response carries the status the server actually
 * wrote, and that is what lands in `decided` — not a guess made before the
 * request. The row updates immediately from the server's own answer while
 * `router.refresh()` re-renders the page underneath. Nothing is ever shown as
 * approved because the click happened.
 *
 * NO OPTIMISTIC ROLLBACK NEEDED. A failed request updates nothing; the message
 * goes back to the caller and the row keeps the status it had.
 */
export type ReviewResult = { ok: true } | { ok: false; message: string };
export type ReviewSubmit = (action: ReviewAction) => Promise<ReviewResult>;

type PatchResponse = {
  conflictId: string;
  status: ResolutionStatus;
  reviewedBy: string;
};

export function useReview() {
  const router = useRouter();
  const [, startTransition] = useTransition();

  /** conflictId → what the server wrote, until the refresh brings it back. */
  const [decided, setDecided] = useState<
    Record<string, { status: ResolutionStatus; reviewedBy: string }>
  >({});
  const [pendingId, setPendingId] = useState<string | null>(null);

  const submit = useCallback(
    async (conflictId: string, action: ReviewAction): Promise<ReviewResult> => {
      setPendingId(conflictId);

      const result = await patchJson<PatchResponse>(
        `/api/conflicts/${conflictId}/resolution`,
        action,
      );

      setPendingId(null);

      if (!result.ok) return { ok: false, message: result.message };

      setDecided((current) => ({
        ...current,
        [conflictId]: {
          status: result.data.status,
          reviewedBy: result.data.reviewedBy,
        },
      }));

      // The queue is a Server Component: the counts, the filter chips and the
      // row's own status all come from the database, so the server is asked for
      // them again rather than recomputed here.
      startTransition(() => router.refresh());

      return { ok: true };
    },
    [router],
  );

  return { submit, pendingId, decided };
}

export type ReviewState = ReturnType<typeof useReview>;
