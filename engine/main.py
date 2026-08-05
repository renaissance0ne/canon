"""FastAPI app and run orchestration.

This module and db.py are the ONLY places side effects live. The pipeline
stages themselves are pure functions — that is what lets eval/harness.py run
the identical code path as production.

    uv run uvicorn main:app --reload --port 8000
"""

from __future__ import annotations

from uuid import UUID

from dotenv import load_dotenv
from fastapi import BackgroundTasks, FastAPI, HTTPException

from pipeline.schema import (
    RunStats,
    RunStatusResponse,
    StartRunRequest,
    StartRunResponse,
)

# Credentials are keyed by source `kind` and live here only — never in
# sources.config, never in the web layer, never in a client bundle.
load_dotenv()

app = FastAPI(title="Canon reconciliation engine", version="0.1.0")


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
    """Polled by the console while the run is not terminal."""
    raise HTTPException(status_code=501, detail="Phase 1 — see AGENTS.md § Feature List")


def execute_run(run_id: UUID) -> RunStats:
    """extract → normalize → block/match → detect → resolve.

    Each stage writes its own output and advances ``runs.status``, so a run that
    fails halfway leaves a readable trail rather than an empty row.
    """
    raise NotImplementedError("Phase 1 — see AGENTS.md § How a Reconciliation Run Works")
