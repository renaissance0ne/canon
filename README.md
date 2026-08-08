# Canon

*One version of the org, with the reasoning attached.*

Canon is a reconciliation engine that sits between a company's CRM and its data
warehouse and resolves the disagreements between them. It detects the drift,
proposes a resolution, explains its reasoning in plain English, and writes every
decision to an audit trail.

It is **not** an ETL tool and **not** a data-quality dashboard. The contribution
is the reasoning layer that turns a detected conflict into a defensible
resolution — not the plumbing that detects it.

Read [AGENTS.md](AGENTS.md) before touching any code. It is the specification.

## Layout

```
canon/
├── web/       Next.js App Router — console, route handlers, owns the schema
├── engine/    FastAPI + Python 3.12 — connectors, pipeline, agent, evaluation
└── docs/      paper drafts, figures, wireframes
```

These are **separate codebases** with separate dependency manifests. Do not mix
concerns between them.

Both write to the same Postgres, and the boundary is enforced by **table
ownership**, not by network topology:

| Table | Written by |
|---|---|
| `sources`, `rulesets` | web only |
| `runs` | web creates, engine updates status |
| `entities`, `matches`, `conflicts` | engine only |
| `resolutions` | engine proposes, web records human review |
| `audit_log` | both, append-only |

Violating that split makes runs non-reproducible.

## Access

The console is protected-first — `web/proxy.ts` requires a session for
everything except `/`, `/sign-in` and `/sign-up`. Auth exists to make the audit
trail mean something: `audit_log.actor` and `resolutions.reviewedBy` record who
approved a resolution, so that identity is always derived from the session
server-side and never accepted from a request body.

**Canon's tables are not on the Supabase Data API.** Supabase grants `anon` and
`authenticated` full access to anything created in `public`, and `anon` is the
role behind the browser-side publishable key — so PostgREST would expose every
table with no session at all, including DELETE and TRUNCATE on `audit_log`.
Migration `0001_lock_down_data_api.sql` revokes those grants, revokes them for
future tables, and enables RLS as defense in depth. Canon connects as
`postgres` (BYPASSRLS), so none of this is visible to the app.

If you add a table, verify it inherited the lockdown rather than assuming:

```sql
select count(*) from information_schema.role_table_grants
where table_schema = 'public' and grantee in ('anon', 'authenticated');  -- expect 0
```

## Running it

```bash
# Engine
cd engine
uv sync
uv run uvicorn main:app --reload --port 8000

# Generate a synthetic dataset + ground-truth manifest
uv run python -m eval.generate --seed 42 --accounts 500 --out ./data/run42

# Full evaluation sweep (all three systems, all metrics)
uv run python -m eval.harness --seed 42 --systems all --report
```

```bash
# Web
cd web
npm install
cp .env.example .env      # then fill in DATABASE_URL
npx drizzle-kit migrate
npm run dev
```

## Checks

Run these after every feature; fix everything before moving on.

```bash
cd web    && npm run lint && npm run typecheck
cd engine && uv run ruff check . && uv run mypy . --strict

# If detection or resolution logic changed, the numbers change too
cd engine && uv run python -m eval.harness --seed 42 --quick
```

## Status

| Phase | Scope | State |
|---|---|---|
| 1 | Drizzle schema + migrations | schema written, **not yet applied** |
| 1 | Synthetic generator (`engine/eval/generate.py`) | built |
| 1 | Synthetic connector | stub |
| 2 | Normalize, block/match, detect, baselines | stubs |
| 3 | Resolution agent | stubs; auto-apply gate constants set |
| 4 | Console | landing, auth, `/get-started`, `/sources` built |
| 5 | Real connectors | stubs |
| 6 | Results | not started |

The evaluation harness is not an afterthought — it is a first-class part of the
system and is what separates this from a demo. See AGENTS.md § Evaluation
Harness.
