# Canon — reconciliation engine

Python 3.12+, managed with `uv`. FastAPI job-control surface; the pipeline
itself is a set of pure functions so `eval/harness.py` runs the identical code
path as production.

```bash
uv sync

# Job control surface
uv run uvicorn main:app --reload --port 8000

# Fresh synthetic dataset + ground-truth manifest
uv run python -m eval.generate --seed 42 --accounts 500 --out ./data/run42

# Full evaluation sweep (all three systems, all metrics)
uv run python -m eval.harness --seed 42 --systems all --report

# After any change to detection or resolution logic
uv run ruff check . && uv run mypy . --strict
uv run python -m eval.harness --seed 42 --quick
```

## Status

Scaffold only. The package tree, the tool contract (`pipeline/schema.py`) and
the table-ownership boundary (`db.py`) are in place; every pipeline stage raises
`NotImplementedError` with the AGENTS.md phase that builds it.

| Module | Phase | Built |
|---|---|---|
| `pipeline/schema.py` | — | ✅ contract, mirrors `web/types/` |
| `eval/generate.py` | 1 | stub |
| `connectors/synthetic.py` | 1 | stub |
| `db.py` | 1 | stub |
| `main.py` | 1 | routes wired, `execute_run` stub |
| `pipeline/normalize.py` | 2 | stub |
| `pipeline/blocking.py` | 2 | stub |
| `pipeline/detect.py` | 2 | stub |
| `eval/baselines.py` | 2 | stub |
| `agent/graph.py` | 3 | gate constants set, nodes stub |
| `agent/prompts.py` | 3 | model split + rationale contract set |
| `connectors/salesforce.py` | 5 | stub |
| `connectors/warehouse.py` | 5 | stub |
| `eval/harness.py` | 6 | metric shape set, runner stub |
| `eval/report.py` | 6 | grayscale palette set, writers stub |

Build in AGENTS.md order. `eval/generate.py` comes first — you cannot develop a
detector without knowing what it is supposed to detect.

## The boundary

The engine writes to Postgres directly. That boundary is enforced by **table
ownership**, not by network topology — see the docstring in `db.py`. The engine
must never write `sources` or `rulesets`.

Schema changes are made in `web/lib/db/schema.ts` and applied with
`drizzle-kit`. Nothing here migrates the database.
