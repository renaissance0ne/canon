/**
 * Character-level diff emphasis for the conflict diff row.
 *
 * AGENTS.md § The signature element: "The differing characters within a value
 * get --g-900 at 500 weight while the shared prefix stays --g-500.
 * Character-level emphasis is doing the work a red/green diff would normally
 * do."
 *
 * Deliberately not a full diff algorithm. Two values in the same field of the
 * same record differ at the head, the tail, or the middle — `APAC` vs
 * `APAC-SOUTH`, `Acme Inc.` vs `ACME INC`, `ACC-4417` vs `ACC-2201`. A shared
 * prefix and a shared suffix around one differing span captures every one of
 * those, in O(n), with no dependency. A Myers diff would find more spans and
 * highlight less clearly.
 */

export type DiffSegments = {
  /** Shared with the other side — stays quiet. */
  prefix: string;
  /** Where the two values part company — this is what carries the weight. */
  middle: string;
  suffix: string;
};

/**
 * Split `value` against `other` into shared prefix, differing middle, shared
 * suffix. When the two are equal the whole value is prefix: nothing to
 * emphasize, which is exactly right for a cosmetic conflict whose values fold
 * to the same thing but are not byte-identical — there, the differing
 * characters ARE the conflict, so they still light up.
 */
export function diffSegments(value: string, other: string): DiffSegments {
  if (value === other) return { prefix: value, middle: "", suffix: "" };

  const max = Math.min(value.length, other.length);

  let prefix = 0;
  while (prefix < max && value[prefix] === other[prefix]) prefix++;

  let suffix = 0;
  while (
    suffix < max - prefix &&
    value[value.length - 1 - suffix] === other[other.length - 1 - suffix]
  ) {
    suffix++;
  }

  return {
    prefix: value.slice(0, prefix),
    middle: value.slice(prefix, value.length - suffix),
    suffix: value.slice(value.length - suffix),
  };
}
