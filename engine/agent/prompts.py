"""Survivorship prompt construction.

The ruleset block is IDENTICAL across every call in a run, so it is the cache
prefix — prompt caching on it is the single largest cost lever in the system.
Anything that varies per conflict must come after it, or the cache never hits.
"""

from __future__ import annotations

from pipeline.schema import Conflict, SurvivorshipRule

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


def build_ruleset_block(rules: list[SurvivorshipRule]) -> str:
    """The cached prefix. Must be byte-identical across a run."""
    raise NotImplementedError("Phase 3 — see AGENTS.md § Feature List")


def build_conflict_block(conflict: Conflict) -> str:
    """The per-call suffix. Everything that varies lives here."""
    raise NotImplementedError("Phase 3 — see AGENTS.md § Feature List")
