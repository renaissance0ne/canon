"""Survivorship prompt construction.

The ruleset block is IDENTICAL across every call in a run, so it is the cache
prefix — prompt caching on it is the single largest cost lever in the system.
Anything that varies per conflict must come after it, or the cache never hits.
"""

from __future__ import annotations

from pipeline.schema import Conflict, SurvivorshipRule, rule_specificity

# AGENTS.md § Model Selection. Bulk scoring is high-volume and low-reasoning;
# the resolution rationale is the reasoning that actually matters.
MODEL_BULK = "claude-haiku-4-5"
MODEL_RESOLUTION = "claude-sonnet-5"
MODEL_ESCALATION_SUMMARY = "claude-sonnet-5"

#: The rationale is a product surface — a reviewer decides from it in five
#: seconds. State which values disagreed, which rule or reasoning applied, and
#: what was chosen. Two sentences. No hedging, no restating the question.
RATIONALE_CONTRACT = """\
Write two sentences. Name both values and which source each came from, then \
name the rule or reasoning you applied and what you chose. Do not hedge, do not \
restate the question, and do not describe the disagreement in the abstract."""

#: The model's only output channel. A forced tool call rather than free text
#: because `validate` has to compare `proposed_value` against the two observed
#: values exactly — a value wrapped in prose cannot be checked, and a check that
#: cannot run is not a check.
SUBMIT_RESOLUTION_TOOL: dict[str, object] = {
    "name": "submit_resolution",
    "description": "Submit the resolution for the conflict described in the user turn.",
    "input_schema": {
        "type": "object",
        "properties": {
            "proposed_value": {
                "type": "string",
                "description": (
                    "Exactly one of the two observed values, or a legal normalization "
                    "of one (case, whitespace, punctuation, or a corporate-suffix fold). "
                    "Never a third value. Empty string if neither side should win and "
                    "the conflict must go to a human."
                ),
            },
            "confidence": {
                "type": "number",
                "description": (
                    "Calibrated probability in 0..1 that proposed_value is correct. "
                    "Do not inflate it to clear a threshold."
                ),
            },
            "rationale": {
                "type": "string",
                "description": "Two sentences, per the rationale contract in the system prompt.",
            },
            "applied_rule_id": {
                "type": ["string", "null"],
                "description": "The survivorship rule that guided the decision, or null.",
            },
        },
        "required": ["proposed_value", "confidence", "rationale", "applied_rule_id"],
    },
}


def build_ruleset_block(rules: list[SurvivorshipRule]) -> str:
    """The cached prefix. Must be byte-identical across a run.

    Rules are emitted most specific first — the same order ``select_rule``
    evaluates them in — so the model reads the policy in the order it actually
    applies rather than having to reconstruct precedence from prose.
    """
    ordered = sorted(rules, key=rule_specificity, reverse=True)

    lines = [
        "You are Canon's conflict resolution agent.",
        "",
        "Canon reconciles an organization's CRM hierarchy against its data warehouse",
        "hierarchy. You are called only for conflicts the deterministic survivorship",
        "ruleset could not already decide. Do not re-derive rule logic; if a rule is",
        "quoted to you, apply it.",
        "",
        "## Survivorship policy",
        "",
        "Evaluated most specific first; first match wins. A conflict no rule covers is",
        "not yours to guess at — say so and let it escalate.",
        "",
    ]

    if ordered:
        for rule in ordered:
            preferred = (
                f", preferred source {rule.preferred_source_id}"
                if rule.preferred_source_id
                else ""
            )
            lines.append(
                f"- `{rule.id}` — field `{rule.field}`, entity `{rule.entity_type}`, "
                f"strategy `{rule.strategy}`{preferred}. {rule.description}"
            )
    else:
        lines.append("- (no rules configured)")

    lines += [
        "",
        "## Hard constraints",
        "",
        "1. `proposed_value` MUST be exactly one of the two observed values, or a legal",
        "   normalization of one (case, whitespace, punctuation, or a corporate-suffix",
        "   fold such as \"Inc.\" / \"Pvt Ltd\" / \"GmbH\"). Never invent a third value,",
        "   never merge the two, never infer one from outside context. A validator",
        "   rejects anything else, and a hallucinated parent id is worse than an",
        "   escalation.",
        "2. `confidence` is an honest estimate of correctness, not a number chosen to",
        "   clear a threshold. Gating happens downstream; your job is calibration.",
        "3. If the conflict is genuinely ambiguous — both sides edited at the same time,",
        "   no rule applies, or the values alone cannot settle it — return an empty",
        "   `proposed_value`, a low confidence, and say plainly why. Escalation is a",
        "   correct outcome, not a failure to avoid.",
        "",
        "## Rationale",
        "",
        RATIONALE_CONTRACT,
        "",
        "Good: \"Salesforce shows parent ACC-4417 (modified 2 days ago); the warehouse",
        "shows ACC-2201 (modified 61 days ago). Applied most_recent — Salesforce is the",
        "more recent edit and territory rollups depend on this edge.\"",
        "",
        "Bad: \"There appears to be a discrepancy between the two systems regarding the",
        "parent account field. Based on the available information, it seems that the",
        "Salesforce value may be more appropriate.\"",
        "",
        "Severity 4 conflicts change hierarchy rollups. Say so when that is the field in",
        "question.",
        "",
        "Answer only by calling `submit_resolution`.",
    ]

    return "\n".join(lines)


def build_conflict_block(
    conflict: Conflict,
    *,
    entity_type: str = "unknown",
    entity_external_id: str = "unknown",
    source_a_label: str = "source A",
    source_b_label: str = "source B",
    last_modified_a: str | None = None,
    last_modified_b: str | None = None,
) -> str:
    """The per-call suffix. Everything that varies lives here.

    Kept strictly after the ruleset block: a single token of per-conflict text
    ahead of the cached prefix invalidates the cache for the whole run, which is
    the difference between paying for the ruleset once and paying for it on
    every one of several hundred calls.
    """
    return "\n".join(
        [
            f"Entity: {entity_external_id} ({entity_type})",
            f"Field: {conflict.field}",
            f"Class: {conflict.conflict_class}, severity {conflict.severity}",
            "",
            f"{source_a_label}: {conflict.value_a!r}",
            f"  last modified: {last_modified_a or 'unknown'}",
            f"{source_b_label}: {conflict.value_b!r}",
            f"  last modified: {last_modified_b or 'unknown'}",
            "",
            "Call submit_resolution.",
        ]
    )
