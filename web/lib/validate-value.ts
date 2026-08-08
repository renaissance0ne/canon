/**
 * The `validate` rule, on the web side.
 *
 * AGENTS.md § The Resolution Agent, rule 2: a proposed value must be one of the
 * two observed values or a legal normalization of one. A hallucinated parent id
 * is worse than an escalation.
 *
 * That rule is usually described as a guard on the model, but it is really a
 * guard on the WRITE — and the web layer has its own write path: a human
 * override (wireframe 1l). A reviewer typing `ACC-2202` into the override box
 * would put a value in the resolved hierarchy that neither source system ever
 * held, which is the exact failure the engine's validate node exists to prevent.
 * So the same check runs here, deterministically, before the update.
 *
 * Mirrors engine/agent/graph.py::validate and engine/pipeline/normalize.py's
 * folding. These two must stay in lockstep: a value one layer accepts and the
 * other rejects makes a run's own output unreproducible. Not server-only — the
 * override editor runs it as you type, for the message; the route handler runs
 * it again for the truth.
 */

/**
 * Folded off the tail of a name before comparison. Mirrors
 * engine/pipeline/normalize.py::LEGAL_SUFFIXES exactly — same list, same order
 * irrelevance, same "recorded, never discarded" contract.
 */
export const LEGAL_SUFFIXES: readonly string[] = [
  "inc",
  "llc",
  "ltd",
  "limited",
  "corp",
  "corporation",
  "co",
  "gmbh",
  "pvt",
  "pvt ltd",
  "plc",
  "sa",
  "bv",
  "ag",
];

/**
 * Case, whitespace, punctuation and legal-suffix folding. Deterministic and
 * total: the same input always folds the same way, in every layer, or matching
 * stops being reproducible.
 *
 * Punctuation is dropped rather than replaced with a space, so `ACME-INC` and
 * `ACME INC` both fold to `acme`. Suffixes are stripped repeatedly, because
 * "Trellis Labs Pvt Ltd" carries two of them.
 */
export function foldValue(value: string): string {
  let folded = value
    .normalize("NFKD")
    .toLowerCase()
    // Punctuation and symbols out; letters, numbers and separators stay.
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Longest suffix first, so "pvt ltd" is not consumed as "ltd" and left with a
  // dangling "pvt".
  const suffixes = [...LEGAL_SUFFIXES].sort((a, b) => b.length - a.length);

  let stripped = true;
  while (stripped) {
    stripped = false;
    for (const suffix of suffixes) {
      if (folded === suffix) break; // The whole value IS the suffix — keep it.
      if (folded.endsWith(` ${suffix}`)) {
        folded = folded.slice(0, -(suffix.length + 1)).trim();
        stripped = true;
        break;
      }
    }
  }

  return folded;
}

export type ValueCheck =
  | { ok: true; /** The observed value this one folds onto. */ matches: string }
  | { ok: false; reason: string };

/**
 * True only when `candidate` is one of the observed values or a legal
 * normalization of one. Everything else is an invented value.
 *
 * `observed` is a list rather than two arguments because a `duplicate` conflict
 * has two values on one side, and an orphan has none on the other — an absent
 * side contributes nothing to choose from, which is correct: there is no value
 * there to survive.
 */
export function checkObservedValue(candidate: string, observed: string[]): ValueCheck {
  const trimmed = candidate.trim();
  if (trimmed.length === 0) return { ok: false, reason: "A value is required." };

  const real = observed.filter((value) => value.trim().length > 0);
  if (real.length === 0) {
    return {
      ok: false,
      reason: "Neither side holds a value, so there is nothing to choose from.",
    };
  }

  const exact = real.find((value) => value === trimmed);
  if (exact !== undefined) return { ok: true, matches: exact };

  const folded = foldValue(trimmed);
  const equivalent = real.find((value) => foldValue(value) === folded);
  if (equivalent !== undefined) return { ok: true, matches: equivalent };

  return {
    ok: false,
    reason: `Must be one of the observed values (${real.join(" or ")}) or a legal normalization of one.`,
  };
}

/** The two sides' values, flattened — what an override may choose from. */
export function observedValues(row: {
  a: { values: string[] };
  b: { values: string[] };
}): string[] {
  return [...row.a.values, ...row.b.values].filter((value) => value.trim().length > 0);
}
