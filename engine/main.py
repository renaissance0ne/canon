"""FastAPI app and run orchestration.

This module and db.py are the ONLY places side effects live. The pipeline
stages themselves are pure functions — that is what lets eval/harness.py run
the identical code path as production.

    uv run uvicorn main:app --reload --port 8000

The stage order and the status each stage advances to are the contract the
console polls against, and they are the same stages ``eval/harness.py`` runs.
If these two ever diverge, the benchmark stops describing the product.
"""

from __future__ import annotations

import logging
import os
import traceback
from datetime import UTC, datetime
from pathlib import Path
from uuid import UUID

from dotenv import load_dotenv
from fastapi import BackgroundTasks, FastAPI, HTTPException

import db
from agent.graph import (
    ModelProposer,
    ModelUsage,
    build_proposer,
    missing_key_message,
    resolve,
)
from agent.prompts import API_KEY_ENV, has_api_key, resolution_model
from connectors.base import Connector
from connectors.factory import build_connector
from credentials import (
    CredentialsMissingError,
    load_credentials,
    mark_verified,
    refresh_oauth_token,
)
from pipeline.blocking import candidates, score_candidates
from pipeline.credentials import requires_credentials
from pipeline.detect import detect_detailed
from pipeline.normalize import entity_uuid, normalize
from pipeline.schema import (
    AuditAction,
    CanonicalEntity,
    EntityType,
    ModelProvider,
    ProvidersResponse,
    ProviderStatus,
    Resolution,
    RunStats,
    RunStatusResponse,
    SourceKind,
    StartRunRequest,
    StartRunResponse,
    SurvivorshipRule,
)

load_dotenv()

logger = logging.getLogger("canon.engine")

app = FastAPI(title="Canon reconciliation engine", version="0.1.0")

#: Every entity type Canon reconciles, in a fixed order so two runs over one
#: dataset produce rows in the same order and are diffable.
ENTITY_TYPES: tuple[EntityType, ...] = ("account", "user", "role", "territory")

#: Every model family a run may name, in the order the console offers them.
MODEL_PROVIDERS: tuple[ModelProvider, ...] = ("claude", "gemini")

#: Where generated datasets live for sources of kind ``synthetic``.
#:
#: It is an engine setting rather than a field on ``sources.config`` because the
#: dataset is a file on the engine's own disk: the console has no way to know
#: what is there, and a path typed into a web form would be a path the web layer
#: cannot validate. Which *side* of the reconciliation a synthetic source serves
#: comes from its position in the run — source A is side "a" — so one directory
#: serves both halves without any per-source configuration at all.
SYNTHETIC_DATA_DIR_ENV = "CANON_SYNTHETIC_DATA_DIR"
DEFAULT_SYNTHETIC_DATA_DIR = "./data/run42"


@app.post("/runs", response_model=StartRunResponse)
async def start_run(body: StartRunRequest, background: BackgroundTasks) -> StartRunResponse:
    """Accept a run and return immediately; the console polls for status.

    Only ``runId`` crosses the wire. Sources and ruleset are read from Postgres
    so there is exactly one record of what a run executed.
    """
    background.add_task(execute_run, body.run_id)
    return StartRunResponse(run_id=body.run_id)


@app.get("/runs/{run_id}/status", response_model=RunStatusResponse)
async def run_status(run_id: UUID) -> RunStatusResponse:
    """Polled by the console while the run is not terminal.

    Served from Postgres rather than from in-process state. The run executes in
    a background task that any worker could be running, and a status that only
    one process knew would be wrong the moment the engine ran more than one.
    """
    current = db.read_run_status(run_id)
    if current is None:
        raise HTTPException(status_code=404, detail=f"No run {run_id}")

    status, stats, error = current
    return RunStatusResponse(run_id=run_id, status=status, stats=stats, error=error)


@app.get("/health")
async def health() -> dict[str, str]:
    """Liveness for the console's engine check. Deliberately touches nothing."""
    return {"status": "ok"}


@app.get("/providers", response_model=ProvidersResponse)
async def providers() -> ProvidersResponse:
    """Which model families this engine can actually call.

    Read by the new-run screen so it can default to a provider that will work
    and say plainly why the other one will not. It reports the PRESENCE of a
    key, never the key — the same rule that governs `readStatus` for source
    credentials. All model calls still happen here; the console learns only
    whether one is possible.
    """
    return ProvidersResponse(
        providers=[
            ProviderStatus(
                provider=provider,
                model=resolution_model(provider),
                configured=has_api_key(provider),
            )
            for provider in MODEL_PROVIDERS
        ]
    )


def execute_run(run_id: UUID) -> RunStats:
    """extract → normalize → block/match → detect → resolve.

    Each stage writes its own output and advances ``runs.status``, so a run that
    fails halfway leaves a readable trail rather than an empty row.

    Every failure path ends in the same place: the run is marked ``failed`` with
    the reason, and ``run_failed`` is appended to the audit log. A background
    task that raised and left the row at ``queued`` would leave the console
    polling a status that never changes — which is indistinguishable, from the
    outside, from a run that is merely slow.
    """
    stats = RunStats()

    try:
        config = db.load_run_config(run_id)
        rules = db.load_ruleset(config.ruleset_id)
        labels = (
            db.load_source_name(config.source_a_id),
            db.load_source_name(config.source_b_id),
        )
        provider = config.model_provider

        db.append_audit(
            run_id,
            "run_started",
            actor="engine",
            detail={
                "sourceAId": str(config.source_a_id),
                "sourceBId": str(config.source_b_id),
                "rulesetId": str(config.ruleset_id),
                "rules": len(rules),
                # Which model family answered is part of what this run executed.
                # Reading it out of the audit trail must not require joining
                # back to a row that a later migration could default away.
                "modelProvider": provider,
                "model": resolution_model(provider),
            },
        )

        # ── extract + normalize ──────────────────────────────────────────────
        db.update_run_status(run_id, "extracting", stats=stats)

        side_a = _extract_side(config.source_a_id, side="a")
        side_b = _extract_side(config.source_b_id, side="b")

        stats = stats.model_copy(
            update={"entities_a": len(side_a), "entities_b": len(side_b)}
        )
        db.write_entities(run_id, [*side_a, *side_b])

        # ── block + match ────────────────────────────────────────────────────
        db.update_run_status(run_id, "matching", stats=stats)

        found = candidates(side_a, side_b, run_id=run_id)
        matches = score_candidates(found, run_id=run_id)
        stats = stats.model_copy(
            update={"candidate_pairs": len(found), "matches": len(matches)}
        )
        db.write_matches(run_id, matches)

        # ── detect ───────────────────────────────────────────────────────────
        db.update_run_status(run_id, "detecting", stats=stats)

        entities = {
            entity_uuid(entity, run_id): entity for entity in [*side_a, *side_b]
        }
        detection = detect_detailed(matches, entities, run_id=run_id)

        # Orphans have no counterpart, so they have no real match — but the
        # schema requires one and the console reaches both entity rows through
        # it. These self-referential rows are written before the conflicts that
        # reference them, or the foreign key fails.
        db.write_matches(run_id, detection.orphan_matches)
        db.write_conflicts(run_id, detection.conflicts)

        stats = stats.model_copy(update={"conflicts": len(detection.conflicts)})
        db.append_audit_many(
            run_id,
            [
                (
                    "conflict_detected",
                    "engine",
                    {
                        "conflictId": str(conflict.id),
                        "field": conflict.field,
                        "class": conflict.conflict_class,
                        "severity": conflict.severity,
                    },
                    None,
                )
                for conflict in detection.conflicts
            ],
        )

        # ── resolve ──────────────────────────────────────────────────────────
        db.update_run_status(run_id, "resolving", stats=stats)

        proposer = _build_proposer(run_id, rules, provider)
        resolutions = resolve(
            detection.conflicts,
            rules,
            origins=detection.origins,
            proposer=proposer,
            labels=labels,
        )
        db.write_resolutions(resolutions)

        auto_applied = sum(1 for r in resolutions if r.status == "auto_applied")
        escalated = sum(1 for r in resolutions if r.status == "escalated")
        usage = proposer.usage if proposer else None
        stats = stats.model_copy(
            update={
                "auto_resolved": auto_applied,
                "escalated": escalated,
                "tokens_used": usage.total_tokens if usage else 0,
                "model_calls": usage.calls if usage else 0,
                "model_errors": usage.errors if usage else 0,
                "model_rate_limited": usage.rate_limited if usage else 0,
            }
        )

        _audit_resolutions(run_id, resolutions)
        _audit_degradation(run_id, provider, usage)

        db.update_run_status(run_id, "complete", stats=stats)
        return stats

    except Exception as error:  # noqa: BLE001 — every failure must reach the row
        _fail(run_id, stats, error)
        return stats


# ── stages ───────────────────────────────────────────────────────────────────


def _extract_side(source_id: UUID, *, side: str) -> list[CanonicalEntity]:
    """One source, extracted and normalized into canonical entities.

    ``source_id`` is carried onto every entity as its ``source_id`` because that
    is what ``detect`` uses to tell the two halves apart and what the entities
    table stores — the connector itself has no idea which row it came from.
    """
    kind, config = db.load_source(source_id)
    connector = _build(source_id, kind, config, side=side)

    entities: list[CanonicalEntity] = []
    for entity_type in ENTITY_TYPES:
        entities.extend(
            normalize(
                connector.extract(entity_type),
                entity_type=entity_type,
                source_id=str(source_id),
            )
        )

    return entities


def _build(
    source_id: UUID, kind: str, config: dict[str, object], *, side: str
) -> Connector:
    """Construct one side's connector, loading credentials only if it needs them.

    A synthetic source never reaches ``load_credentials``: it has none stored,
    and asking for them would turn the one source kind that works without
    configuration into one that fails without it.
    """
    source_kind = _source_kind(kind)
    credentials = None

    if requires_credentials(source_kind):
        credentials = load_credentials(source_id, source_kind)
        # Checked before the first extract, not after it: an expired grant
        # discovered three stages in has already written entities, and a 401
        # from a provider reads like a connector bug rather than a token that
        # needs reconnecting.
        credentials = refresh_oauth_token(credentials)
        mark_verified(source_id, datetime.now(UTC))

    return build_connector(
        kind=source_kind,
        config=config,
        credentials=credentials,
        side=side,
        data_dir=_synthetic_data_dir() if source_kind == "synthetic" else None,
    )


def _build_proposer(
    run_id: UUID, rules: list[SurvivorshipRule], provider: ModelProvider
) -> ModelProposer | None:
    """The agent for the provider this run named, when the engine has a key.

    ``None`` rather than a raise when no key is configured: the deterministic
    half of the pipeline is fully useful on its own, and a run that resolves
    what the rules decide and escalates the rest is a correct run. The absence
    is recorded in the audit trail rather than inferred from the numbers —
    otherwise a run that degraded because a key expired is indistinguishable
    from one that simply had no work for the agent.

    It does NOT silently fall back to the other provider. A run that asked for
    Gemini and got Claude would put a false statement on the row, and every
    number produced under it would be attributed to the wrong model.
    """
    proposer = build_proposer(rules, provider=provider)
    if proposer.available:
        return proposer

    logger.warning("run %s: %s", run_id, missing_key_message(provider))
    db.append_audit(
        run_id,
        "run_started",
        actor="engine",
        detail={
            "modelProvider": provider,
            "agentAvailable": False,
            "reason": f"{API_KEY_ENV[provider]} is not set",
        },
    )
    return None


def _audit_resolutions(run_id: UUID, resolutions: list[Resolution]) -> None:
    """One audit row per decision, pointing at the resolution it describes.

    The resolution ids are read back because the database generates them — an
    audit entry that could not name the row it is about would be a log line, not
    an audit trail.
    """
    resolution_ids = db.resolution_ids_for_run(run_id)

    entries: list[tuple[AuditAction, str, dict[str, object], UUID | None]] = []
    for resolution in resolutions:
        action: AuditAction = (
            "auto_applied" if resolution.status == "auto_applied" else "escalated"
        )
        entries.append(
            (
                action,
                "agent" if resolution.applied_rule_id is None else "engine",
                {
                    "conflictId": str(resolution.conflict_id),
                    "proposedValue": resolution.proposed_value,
                    "confidence": resolution.confidence,
                    "appliedRuleId": resolution.applied_rule_id,
                },
                resolution_ids.get(resolution.conflict_id),
            )
        )

    db.append_audit_many(run_id, entries)


def _audit_degradation(
    run_id: UUID, provider: ModelProvider, usage: ModelUsage | None
) -> None:
    """Record that this run's escalations are not all the agent's judgement.

    Only when calls actually failed. A run whose agent answered everything it
    was asked writes nothing here, so the presence of this entry is itself the
    signal — a reader scanning the trail should not have to compare two numbers
    to notice that a run was degraded.

    The first error travels with it. "116 calls failed" is a symptom; whether
    the cause was a quota, an expired key or an outage is what determines
    whether re-running fixes anything.
    """
    if usage is None or usage.errors == 0:
        return

    logger.warning(
        "run %s degraded: %d of %d model calls failed (provider=%s): %s",
        run_id,
        usage.errors,
        usage.errors + usage.calls,
        provider,
        usage.first_error,
    )
    db.append_audit(
        run_id,
        "run_degraded",
        actor="engine",
        detail={
            "modelProvider": provider,
            "modelCalls": usage.calls,
            "modelErrors": usage.errors,
            "modelRateLimited": usage.rate_limited,
            "firstError": usage.first_error,
        },
    )


def _fail(run_id: UUID, stats: RunStats, error: Exception) -> None:
    """Terminal failure: mark the row, record why, and never swallow it.

    The message is what a reviewer reads on the run detail screen, so it is the
    exception's own text rather than a generic one. The traceback goes to the
    engine's log, where an operator can find it, and not into the database,
    where it would be a stack trace in a product surface.
    """
    message = f"{type(error).__name__}: {error}"
    logger.error("run %s failed: %s\n%s", run_id, message, traceback.format_exc())

    try:
        db.update_run_status(run_id, "failed", stats=stats, error=message)
        db.append_audit(
            run_id, "run_failed", actor="engine", detail={"error": message}
        )
    except Exception:  # noqa: BLE001 — the database is the thing that just broke
        logger.exception("could not record the failure of run %s", run_id)


# ── helpers ──────────────────────────────────────────────────────────────────


def _source_kind(kind: str) -> SourceKind:
    allowed: tuple[SourceKind, ...] = (
        "salesforce",
        "hubspot",
        "databricks",
        "snowflake",
        "synthetic",
    )
    if kind not in allowed:
        raise ValueError(f"Unknown source kind {kind!r}.")
    return kind


def _synthetic_data_dir() -> Path:
    path = Path(os.environ.get(SYNTHETIC_DATA_DIR_ENV, DEFAULT_SYNTHETIC_DATA_DIR))
    if not path.is_dir():
        raise CredentialsMissingError(
            f"{SYNTHETIC_DATA_DIR_ENV} points at {path}, which does not exist. "
            f"Generate a dataset first: uv run python -m eval.generate --seed 42 "
            f"--accounts 500 --out {path}"
        )
    return path
