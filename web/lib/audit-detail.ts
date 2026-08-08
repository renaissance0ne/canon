import { formatConfidence, formatCount } from "@/lib/format";
import type { AuditAction, AuditEntry } from "@/types/resolution";

/**
 * `audit_log.detail` → the Detail column (wireframe 1n) and the run timeline
 * (1g).
 *
 * `detail` is open jsonb by design: the engine attaches what a stage knows and
 * the web layer attaches what a reviewer did, and neither should have to
 * migrate a column to record one more fact. The cost of that is this file — a
 * reader that knows the keys it can render and IGNORES THE REST, rather than
 * dumping whatever happened to be attached into a table cell.
 *
 * Shared by both surfaces so a decision reads the same on the run screen as it
 * does in the audit trail. Not server-only: the audit table renders on the
 * server, but the review controls show the same line back optimistically.
 */

/** A `detail` value worth rendering, once it has been narrowed. */
type Detail = Record<string, unknown>;

function str(detail: Detail, key: string): string | null {
  const value = detail[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function num(detail: Detail, key: string): number | null {
  const value = detail[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Whether a count is "N conflicts" or "N resolutions" depends on what happened,
 * and a bare number in a column of bare numbers is unreadable.
 */
const COUNT_NOUN: Partial<Record<AuditAction, string>> = {
  conflict_detected: "conflicts",
  resolution_proposed: "resolutions",
  auto_applied: "resolutions",
  escalated: "resolutions",
};

/**
 * The parts of one entry, in reading order: what it was about, what changed,
 * why, then how much. Returns an empty array when `detail` holds nothing this
 * function recognises — the caller renders no suffix rather than a stray dot.
 */
export function auditDetailParts(entry: AuditEntry): string[] {
  const detail = entry.detail as Detail;
  const parts: string[] = [];

  // What it was about. `ACC-4417 · parentExternalId`
  const externalId = str(detail, "externalId");
  const field = str(detail, "field");
  if (externalId) parts.push(externalId);
  if (field) parts.push(field);

  // What changed. `ACC-4417 → ACC-2201` — both values, because the proposal is
  // not deleted when a human overrides it (wireframe 1l).
  const from = str(detail, "proposedValue");
  const to = str(detail, "chosenValue");
  if (from && to && from !== to) parts.push(`${from} → ${to}`);
  else if (to) parts.push(to);
  else if (from) parts.push(from);

  // Why. The rule that fired, then the confidence behind it.
  const rule = str(detail, "appliedRuleStrategy") ?? str(detail, "appliedRuleId");
  if (rule) parts.push(rule);

  const confidence = num(detail, "confidence");
  if (confidence !== null) parts.push(formatConfidence(confidence));

  const severity = num(detail, "severity");
  if (severity !== null) parts.push(`sev ${severity}`);

  // How much.
  const count = num(detail, "count");
  if (count !== null) {
    const noun = COUNT_NOUN[entry.action];
    parts.push(noun ? `${formatCount(count)} ${noun}` : formatCount(count));
  }

  const tokens = num(detail, "tokensUsed");
  if (tokens !== null) parts.push(`${formatCount(tokens)} tokens`);

  // Provenance. Which policy version, and which generated dataset.
  const version = num(detail, "rulesetVersion");
  if (version !== null) parts.push(`ruleset v${version}`);

  const seed = num(detail, "seed");
  if (seed !== null) parts.push(`seed ${seed}`);

  // What went wrong, and where.
  const stage = str(detail, "stage");
  if (stage) parts.push(`stage ${stage}`);

  const error = str(detail, "error");
  if (error) parts.push(error);

  // The note itself is not inlined: it is a sentence, and this is a column.
  // Saying it exists is what a reader needs to decide whether to open the row.
  if (str(detail, "note")) parts.push("note attached");

  // A status the reviewer changed away from. `was auto-applied` explains why an
  // approved conflict has an agent's proposal on it.
  const previous = str(detail, "previousStatus");
  if (previous) parts.push(`was ${previous.replace("_", "-")}`);

  return parts;
}

/** The same thing as one line, for the run timeline. */
export function auditDetailLine(entry: AuditEntry): string | null {
  const parts = auditDetailParts(entry);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** The full note, for the places that have room for a sentence. */
export function auditNote(entry: AuditEntry): string | null {
  return str(entry.detail as Detail, "note");
}
