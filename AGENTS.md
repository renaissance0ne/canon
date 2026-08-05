> **This file must be read and followed for every task, in every session,
> before any other action — regardless of how far into a conversation you
> are.**

You are an expert TypeScript + Python engineer helping build a production-quality
data reconciliation platform.

You write clean, simple, maintainable code. You prioritize clarity over unnecessary
abstraction. For up-to-date documentation of libraries and packages, ask context7.

Think like a senior data engineer, implement like someone building a practical,
defensible project — feature by feature.

## Docs Lookup

When you need current API details for a library (Next.js App Router, Drizzle,
LangGraph, the Anthropic SDK, simple-salesforce, databricks-sql-connector,
shadcn/ui, Tailwind v4), use the `context7` tools **before** writing code that
depends on that library's API. Version churn in the agent-framework ecosystem is
real — do not write from memory.

---

## Project Name

**Canon** — *"One version of the org, with the reasoning attached."*

---

## What This Project Does

Canon is a reconciliation engine that sits between a company's CRM and its data
warehouse, and resolves the disagreements between them.

Every company that runs a real go-to-market motion keeps organizational structure
in two places at once: the CRM (Salesforce, HubSpot) is where reps and ops teams
edit accounts, roles, territories and reporting lines; the warehouse (Databricks,
Snowflake) is where analytics, forecasting and finance read that same structure
after it has been piped through ETL. The two drift. A rep gets reassigned in
Salesforce on Monday; the warehouse hierarchy still reflects last quarter's
territory. An account gets re-parented under a new global ultimate; the analytics
rollups keep crediting the old parent. Nobody notices until a forecast is wrong.

Today this is fixed by a human opening two tabs, eyeballing a diff, and making a
judgment call. Canon automates the detection, proposes the resolution, explains
its reasoning in plain English, and writes every decision to an audit trail.

**This is not an ETL tool. This is not a data-quality dashboard.** It is a
reconciliation *decision* system: the contribution is the reasoning layer that
turns a detected conflict into a defensible resolution, not the plumbing that
detects it.

---

## The Contribution (read this before scoping anything)

This project has two audiences and they want different things. Do not let one
crowd out the other.

| Audience | What they need | Where it lives |
|---|---|---|
| A user | A working console that finds real conflicts and proposes real fixes | `web/` + `engine/` |
| A reviewer | A quantitative results chapter with a baseline comparison | `engine/eval/` |

The evaluation harness is **not** an afterthought bolted on at the end. It is a
first-class part of the system, built alongside the engine, and it is what
separates this from a demo. Every change to the reconciliation or resolution
logic must be re-runnable through `engine/eval/` to produce updated numbers.

If a proposed feature makes the demo prettier but cannot be measured, it is
lower priority than one that can.

---

## System Architecture Overview

Canon has two distinct runtime layers. Every engineer working on this project
must understand the boundary between them before touching any code.

```
┌──────────────────────────────────────────────────────────────┐
│                      WEB LAYER                               │
│              Next.js App Router (TypeScript)              │
│  • Console UI: runs, conflict queue, review, audit trail     │
│  • Route handlers: job control, run status, review actions   │
│  • Owns the database schema (Drizzle migrations)             │
│  • Reads everything the UI displays                          │
└──────────────────────┬───────────────────────────────────────┘
                       │  HTTP (start run, poll status, fetch config)
                       │
┌──────────────────────▼───────────────────────────────────────┐
│                 RECONCILIATION ENGINE                        │
│               FastAPI + Python 3.12 (uv)                     │
│  • Connectors: Salesforce, Databricks/Snowflake              │
│  • Normalization into the canonical entity schema            │
│  • Blocking (embedding-based candidate generation)           │
│  • Conflict detection + severity scoring                     │
│  • Resolution agent (LangGraph + Claude)                     │
│  • Writes run output tables directly to Postgres             │
└──────────────────────┬───────────────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────────────┐
│                 POSTGRES (Supabase)                          │
│  Schema owned by Drizzle in web/. Two writers, split by      │
│  table ownership — see "Table Ownership" below.              │
└──────────────────────────────────────────────────────────────┘
```

These are **separate codebases**. Do not mix concerns between them.

### Why the engine writes to Postgres directly

A reconciliation run produces thousands of rows across `entities`, `matches`,
`conflicts` and `resolutions`. Streaming that back over HTTP for the web layer to
insert is the wrong shape for a batch pipeline — it adds a hop, a serialization
cost, and a failure mode for no benefit. The engine connects to Postgres and
writes its own output.

The boundary is enforced by **table ownership**, not by network topology:

| Table | Written by | Read by |
|---|---|---|
| `runs` | web (create), engine (status updates) | both |
| `sources` | web only | both |
| `rulesets` | web only | both |
| `entities` | engine only | web |
| `matches` | engine only | web |
| `conflicts` | engine only | web |
| `resolutions` | engine (propose), web (human review) | both |
| `audit_log` | both (append-only) | web |

The engine must **never** write to `sources` or `rulesets`. The web layer must
**never** write to `entities`, `matches`, or `conflicts`. Violating this makes
runs non-reproducible.

---

## Repository Structure

```
canon/
├── web/                          ← Next.js App Router
│   ├── app/
│   │   ├── (console)/
│   │   │   ├── runs/
│   │   │   ├── conflicts/
│   │   │   ├── sources/
│   │   │   ├── rules/
│   │   │   └── audit/
│   │   ├── api/                  ← route handlers
│   │   └── layout.tsx
│   ├── components/
│   ├── lib/
│   │   ├── db/                   ← Drizzle schema + client
│   │   └── server/               ← SERVER ONLY
│   ├── types/
│   ├── styles/
│   └── drizzle.config.ts
│
├── engine/                       ← Python reconciliation engine
│   ├── main.py                   ← FastAPI app, run orchestration
│   ├── connectors/
│   │   ├── salesforce.py
│   │   ├── warehouse.py
│   │   └── base.py               ← the Connector protocol
│   ├── pipeline/
│   │   ├── normalize.py
│   │   ├── blocking.py
│   │   ├── detect.py             ← conflict detection + severity
│   │   └── schema.py             ← CanonicalEntity, Conflict
│   ├── agent/
│   │   ├── graph.py              ← LangGraph resolution state machine
│   │   ├── prompts.py            ← survivorship prompt builder
│   │   └── tools.py
│   ├── eval/
│   │   ├── generate.py           ← synthetic data + ground truth
│   │   ├── baselines.py          ← rule-only and fuzzy-only baselines
│   │   ├── harness.py            ← precision/recall/F1 runner
│   │   └── report.py             ← results tables + plots
│   ├── db.py                     ← Postgres writer (owned tables only)
│   └── pyproject.toml            ← uv-managed
│
├── docs/                         ← paper drafts, figures, related work
└── .env
```

---

## Tech Stack

### Web Layer (`web/`)

- **Next.js ** (App Router, Server Components by default)
- **TypeScript** (strict)
- **Tailwind CSS v4** + **shadcn/ui** (restricted to a grayscale token set — see
  Design System)
- **Drizzle ORM** + **drizzle-kit** — owns all schema and migrations
- **Supabase (Postgres)** — persistence
- **TanStack Query** — client-side polling of run status only. Everything else is
  a Server Component; do not reach for client fetching by default.
- **Zod** — request body validation on every route handler

### Reconciliation Engine (`engine/`)

- **Python 3.12+**, managed with **uv** (`uv sync`, `uv run`)
- **FastAPI** + **uvicorn** — job control surface
- **simple-salesforce** — Salesforce REST/Bulk reads
- **databricks-sql-connector** (or **snowflake-connector-python**) — warehouse reads
- **pandas** — in-pipeline dataframes
- **sentence-transformers** + **FAISS** — blocking / candidate generation
- **RapidFuzz** — string-similarity baseline and a matching signal
- **LangGraph** — the resolution state machine
- **anthropic** — Claude API client
- **psycopg** (v3) — direct Postgres writes
- **pydantic** — every payload crossing the layer boundary is a Pydantic model

### Model Selection

| Step | Model | Why |
|---|---|---|
| Bulk candidate scoring | `claude-haiku-4-5` | High volume, low reasoning need |
| Resolution proposal + rationale | `claude-sonnet-5` | This is the reasoning that matters |
| Escalation summary | `claude-sonnet-5` | Human reads it; quality over cost |

Enable **prompt caching** on the ruleset block — it is identical across every
call in a run and is the single largest cost lever. Use the **Batch API** for
`engine/eval/` sweeps, which are never latency-sensitive and cost half.

Never call the Anthropic API from `web/`. All model calls happen inside the engine.

---

## Database Schema

Implemented in `web/lib/db/schema.ts` (Drizzle). Generate and apply with
`npx drizzle-kit generate` / `npx drizzle-kit migrate`.

```ts
// sources — a configured system Canon reads from
{
  id: uuid,
  name: text,                   // "Salesforce (prod)", "Databricks GTM"
  kind: text,                   // "salesforce" | "hubspot" | "databricks" | "snowflake" | "synthetic"
  config: jsonb,                // connection config; NEVER credentials
  createdAt: timestamptz,
}

// rulesets — survivorship rules, versioned
{
  id: uuid,
  name: text,
  version: integer,
  rules: jsonb,                 // SurvivorshipRule[] — see Tool Contract
  isActive: boolean,
  createdAt: timestamptz,
}

// runs — one reconciliation execution
{
  id: uuid,
  sourceAId: uuid,              // FK sources.id — the CRM side
  sourceBId: uuid,              // FK sources.id — the warehouse side
  rulesetId: uuid,              // FK rulesets.id
  status: text,                 // "queued" | "extracting" | "matching" | "detecting" | "resolving" | "complete" | "failed"
  stats: jsonb,                 // { entitiesA, entitiesB, candidatePairs, matches, conflicts, autoResolved, escalated, tokensUsed }
  error: text,                  // nullable
  startedAt: timestamptz,
  finishedAt: timestamptz,      // nullable
}

// entities — normalized records from both sides, per run
{
  id: uuid,
  runId: uuid,
  sourceId: uuid,
  externalId: text,             // the id in the source system
  entityType: text,             // "account" | "user" | "role" | "territory"
  fields: jsonb,                // normalized CanonicalEntity fields
  parentExternalId: text,       // nullable — the hierarchy edge
  lastModifiedAt: timestamptz,  // nullable — drives recency survivorship
}
// index: (runId, sourceId, externalId)

// matches — a pair of entities believed to be the same real-world thing
{
  id: uuid,
  runId: uuid,
  entityAId: uuid,
  entityBId: uuid,
  confidence: real,             // 0..1
  method: text,                 // "exact_key" | "embedding" | "fuzzy" | "agent"
  signals: jsonb,               // { exactKey: bool, cosine: number, fuzzyRatio: number }
}

// conflicts — a field-level disagreement within a match
{
  id: uuid,
  runId: uuid,
  matchId: uuid,
  field: text,                  // "parentExternalId" | "roleName" | "territory" | ...
  valueA: text,
  valueB: text,
  conflictClass: text,          // "structural" | "attribute" | "cosmetic" | "orphan" | "duplicate"
  severity: integer,            // 1..4, see Severity Model
  detectedBy: text,             // "rule" | "agent"
}

// resolutions — the proposed and final answer for a conflict
{
  id: uuid,
  conflictId: uuid,
  proposedValue: text,
  rationale: text,              // plain-English, agent-authored
  appliedRuleId: text,          // nullable — which survivorship rule fired
  confidence: real,             // 0..1
  status: text,                 // "proposed" | "auto_applied" | "escalated" | "approved" | "rejected" | "overridden"
  reviewedBy: text,             // nullable
  overrideValue: text,          // nullable — what the human chose instead
  createdAt: timestamptz,
  reviewedAt: timestamptz,      // nullable
}

// audit_log — append-only, never updated or deleted
{
  id: uuid,
  runId: uuid,
  resolutionId: uuid,           // nullable
  action: text,                 // "run_started" | "conflict_detected" | "resolution_proposed" | "auto_applied" | "escalated" | "human_approved" | "human_overridden" | "run_failed"
  actor: text,                  // "engine" | "agent" | a reviewer identifier
  detail: jsonb,
  createdAt: timestamptz,
}
```

Do not add tables speculatively. No `notifications`, no `users`, no vector tables
— extract new tables only when a feature actually needs them.

**Credentials never go in `sources.config`.** Connection secrets live in the
engine's `.env`, keyed by source `kind`. `config` holds non-secret shape only
(object names, table names, filters).

---

## How a Reconciliation Run Works (End to End)

Understanding this flow is required before working on any run-related feature.

```
1. User configures two sources + a ruleset, clicks "Start run"
         │
2. Web calls POST /api/runs
   → inserts a `runs` row with status "queued"
   → POSTs to the engine: POST {ENGINE_URL}/runs with { runId }
   → returns { runId } immediately; the UI polls, it does not block
         │
3. Engine: EXTRACT
   → connectors/salesforce.py pulls Account/User/UserRole/Territory
   → connectors/warehouse.py runs the configured SELECT
   → both stream into pipeline/normalize.py
         │
4. Engine: NORMALIZE
   → every record becomes a CanonicalEntity (see Tool Contract)
   → case, whitespace, punctuation and known suffixes folded
     ("Inc.", "Pvt Ltd", "GmbH") — folding is recorded, not destructive
   → writes `entities`, status → "matching"
         │
5. Engine: BLOCK + MATCH
   → exact-key match first (external id, then domain, then normalized name)
   → remaining records embedded, top-k neighbours retrieved via FAISS
   → RapidFuzz + cosine + field-agreement signals combine into a confidence
   → writes `matches`, status → "detecting"

   Blocking exists so the pipeline is O(n·k) not O(n²). Never compare all pairs.
         │
6. Engine: DETECT
   → for each match, field-by-field diff
   → each disagreement is classified and severity-scored (see Severity Model)
   → unmatched entities on either side are recorded as `orphan` conflicts
   → writes `conflicts`, status → "resolving"
         │
7. Engine: RESOLVE (the agent)
   → conflicts are batched and passed through the LangGraph state machine
   → for each: apply deterministic rules first; only call the model when the
     rules do not decide it
   → produces { proposedValue, rationale, confidence, appliedRuleId }
   → confidence ≥ auto-apply threshold AND severity ≤ 2 → status "auto_applied"
   → otherwise → status "escalated" (lands in the human review queue)
   → writes `resolutions` + `audit_log`, status → "complete"
         │
8. Human review (web)
   → reviewer opens the conflict queue, sees the diff and the rationale
   → approves, rejects, or overrides with their own value
   → every action appends to `audit_log` — nothing is ever silently changed
         │
9. Export
   → GET /api/runs/:runId/export returns the resolved hierarchy + a full
     decision log (JSON and CSV)

   v1 does NOT write back to Salesforce or the warehouse. Canon proposes and
   records; it does not mutate source systems. Do not add write-back without
   an explicit decision to do so — it changes the risk profile of the entire
   project.
```

---

## Tool Contract (Critical — Both Sides Must Match)

These shapes are the contract between `web/` and `engine/`. Defined twice — as
Zod schemas in `web/types/` and Pydantic models in `engine/pipeline/schema.py`.
**Do not change one without changing the other.**

### The canonical entity

```ts
interface CanonicalEntity {
  externalId: string;
  entityType: "account" | "user" | "role" | "territory";
  name: string;
  normalizedName: string;         // folded; what matching actually compares
  parentExternalId: string | null; // the hierarchy edge
  attributes: Record<string, string | null>;
  lastModifiedAt: string | null;   // ISO 8601 — drives recency survivorship
  sourceId: string;
}
```

### The survivorship rule

```ts
interface SurvivorshipRule {
  id: string;
  field: string | "*";            // "*" = applies to any field
  entityType: string | "*";
  strategy:
    | "prefer_source"             // one system is authoritative for this field
    | "most_recent"               // newest lastModifiedAt wins
    | "most_complete"             // non-null / longer value wins
    | "escalate";                 // never auto-resolve this field
  preferredSourceId?: string;     // required when strategy is "prefer_source"
  description: string;            // plain English — goes into the agent prompt
}
```

Rules are evaluated **most specific first**: exact `field` + exact `entityType`
beats a wildcard on either. First match wins. If no rule matches, the conflict
escalates — Canon never guesses in the absence of policy.

### POST {ENGINE_URL}/runs

```ts
// request
{ runId: string }
// response
{ runId: string, accepted: true }
```

The engine reads everything else it needs (sources, ruleset) from Postgres using
`runId`. Do not pass configuration over the wire — it creates two sources of
truth for what a run actually executed, which breaks reproducibility.

### GET {ENGINE_URL}/runs/:runId/status

```ts
{
  runId: string;
  status: "queued" | "extracting" | "matching" | "detecting" | "resolving" | "complete" | "failed";
  stats: {
    entitiesA: number; entitiesB: number;
    candidatePairs: number; matches: number;
    conflicts: number; autoResolved: number; escalated: number;
    tokensUsed: number;
  };
  error: string | null;
}
```

---

## Severity Model

Severity is **not** a hue and **not** a vibe. It is a defined integer that the
auto-apply threshold reads, and it must be justifiable in the paper.

| Level | Class | Meaning | Example |
|---|---|---|---|
| 4 | structural | Changes the shape of the hierarchy; rollups will be wrong | Different `parentExternalId` |
| 3 | attribute | Changes who owns or is credited for something | Different territory, different role |
| 2 | attribute | Changes a non-rollup field | Different industry, different segment |
| 1 | cosmetic | Same value, different representation | `"Acme Inc."` vs `"ACME INC"` |

`orphan` (present in one source, absent in the other) is severity 4 when the
entity has children, 3 when it does not. `duplicate` (two records in one source
matching one in the other) is always severity 4 — it silently double-counts.

Auto-apply is permitted only at severity ≤ 2 **and** confidence ≥ 0.85. Both
thresholds live in `engine/agent/graph.py` as named constants, not magic numbers,
because the evaluation sweeps them.

---

## The Resolution Agent

`engine/agent/graph.py`. A LangGraph state machine, not a single prompt. The
graph structure is also a figure in the paper, so keep it legible.

```
        ┌─────────────┐
        │   classify  │  deterministic: which rule (if any) applies?
        └──────┬──────┘
               │
      ┌────────┴────────┐
      │                 │
 rule decides      no rule / ambiguous
      │                 │
      ▼                 ▼
┌───────────┐    ┌─────────────┐
│  apply    │    │   propose   │  Claude: value + rationale + confidence
└─────┬─────┘    └──────┬──────┘
      │                 │
      └────────┬────────┘
               ▼
        ┌─────────────┐
        │  validate   │  deterministic: is proposedValue one of the observed
        └──────┬──────┘  values, or a legal normalization of one?
               │
      ┌────────┴────────┐
      │                 │
   passes           fails / low confidence / severity ≥ 3
      │                 │
      ▼                 ▼
┌───────────┐    ┌─────────────┐
│auto_apply │    │  escalate   │
└───────────┘    └─────────────┘
```

Three rules govern this graph, and they are the difference between a system and
a wrapper:

1. **Deterministic first.** The model is called only for conflicts the ruleset
   does not decide. This keeps cost down, keeps most decisions explainable
   without reference to a model, and gives the evaluation a clean split between
   "rules handled it" and "the agent handled it".

2. **The model never invents a value.** `validate` rejects any `proposedValue`
   that is not one of the two observed values or a legal normalization of one.
   A hallucinated parent id is worse than an escalation. This check is
   deterministic and non-negotiable.

3. **Escalation is a success state, not a failure.** A system that escalates the
   genuinely ambiguous 8% and auto-resolves the rest correctly is more useful
   than one that resolves 100% with silent errors. Report escalation rate as a
   headline metric, never bury it.

### Rationale quality

The `rationale` is a product surface — a reviewer reads it to decide in five
seconds. It must state: which values disagreed, which rule or reasoning applied,
and what it chose. Two sentences. No hedging, no restating the question.

Good: *"Salesforce shows parent `ACC-4417` (modified 2 days ago); the warehouse
shows `ACC-2201` (modified 61 days ago). Applied `most_recent` — Salesforce is
the more recent edit and territory rollups depend on this edge."*

Bad: *"There appears to be a discrepancy between the two systems regarding the
parent account field. Based on the available information, it seems that the
Salesforce value may be more appropriate."*

---

## Synthetic Data & Ground Truth

This is the foundation of the evaluation. Build `engine/eval/generate.py` in
Phase 1, before the engine — you cannot develop a detector without knowing what
it is supposed to detect.

The generator produces three artifacts from one seed:

1. **The canonical org** — a synthetic company hierarchy: N accounts in a
   parent/child tree, M users, roles, territories. Realistic shape, not uniform:
   a few large subtrees, many small ones, some depth-4 chains.
2. **Side A** (the "CRM" view) and **Side B** (the "warehouse" view) — two
   divergent copies of the canonical org.
3. **The ground truth manifest** — a JSON file listing every injected divergence:
   `{ entityId, field, trueValue, sideAValue, sideBValue, conflictClass, expectedResolution }`.

Divergences are injected at configurable rates, and every injection type must
have a corresponding detector:

| Injection | Rate (default) | Tests |
|---|---|---|
| Re-parent one side | 5% | Structural detection |
| Stale territory / role on one side | 8% | Attribute detection + recency rules |
| Name variant (suffix, case, punctuation) | 12% | Normalization + cosmetic classification |
| Missing record on one side | 3% | Orphan detection |
| Duplicate record on one side | 2% | Duplicate detection |
| Genuinely ambiguous (both edited same day, conflicting policy) | 2% | Escalation behaviour |

That last row matters most. A generator that only produces resolvable conflicts
will make the system look perfect and the paper look naive. Deliberately inject
cases where the correct answer is *escalate*, and score the system on whether it
escalates them rather than guessing.

Seed the generator (`--seed`) so runs are reproducible, and commit the seed used
for the reported results.

### On real data

A real anonymized export from one friendly organization is a **stretch goal** for
Phase 6, presented as a case study alongside the synthetic benchmark — not
instead of it. The synthetic benchmark is the primary result precisely because
its ground truth is known.

**Never use data from any employer, current or former, anonymized or otherwise.**

---

## Evaluation Harness

`engine/eval/harness.py`. Runs the full pipeline against generated data with a
known manifest and produces the results table.

Three systems, always compared side by side:

| System | Description | Purpose |
|---|---|---|
| `baseline_exact` | Exact string match only; flags any inequality as a conflict | The floor |
| `baseline_rules` | Fuzzy matching + the deterministic ruleset, no model | The real comparison — is the agent earning its cost? |
| `canon_full` | Full pipeline with the resolution agent | The system |

Metrics reported per system:

- **Conflict detection**: precision, recall, F1 against the manifest
- **Resolution accuracy**: of conflicts resolved, what fraction matched
  `expectedResolution`
- **Escalation precision**: of conflicts escalated, what fraction were genuinely
  ambiguous in the manifest (escalating easy conflicts is a cost, not a virtue)
- **False auto-apply rate**: auto-applied resolutions that were wrong — the
  metric that matters most operationally, report it prominently
- **Cost**: tokens and USD per 1,000 conflicts

Two ablations, both required:

1. **Without the `validate` node** — does it produce invented values? Quantify.
2. **Auto-apply threshold sweep** — confidence from 0.5 to 0.95, plot false
   auto-apply rate against escalation rate. This is the precision/recall tradeoff
   curve for the whole system and it is the strongest single figure in the paper.

`engine/eval/report.py` writes markdown tables and matplotlib figures into
`docs/results/`. Grayscale figures — same constraint as the UI, and it makes them
print-safe for the paper.

---

## Feature List (Build Order)

Build in this order. Do not skip ahead. Weeks are calendar weeks assuming
part-time evening/weekend work around a full-time job.

### Phase 1 — Ground truth first (weeks 1–2)

1. **Drizzle schema + migrations** — all tables above, applied to Supabase
2. **Synthetic generator** (`engine/eval/generate.py`) — canonical org, two
   divergent sides, ground-truth manifest, seeded
3. **Synthetic source connector** — reads generated CSV/JSON as a `source` of
   kind `"synthetic"`, so the whole pipeline can be developed without touching a
   real API

### Phase 2 — The pipeline core (weeks 3–5)

4. **Normalization** — `CanonicalEntity`, name folding, recorded not destructive
5. **Blocking + matching** — exact key, then embedding + FAISS top-k, then
   combined confidence signals
6. **Conflict detection + severity** — field diff, classification, the severity
   model above
7. **`baseline_exact` + `baseline_rules`** — build the baselines *now*, not at
   the end, so every subsequent change is measured against them

### Phase 3 — The agent (weeks 6–8)

8. **Ruleset evaluation** — deterministic `classify` node, specificity ordering
9. **LangGraph resolution graph** — propose → validate → auto-apply/escalate
10. **Rationale generation** — prompt tuned to the quality bar above
11. **Cost controls** — prompt caching on the ruleset block, Haiku/Sonnet split

### Phase 4 — The console (weeks 9–11)

12. **Runs list + run detail** — status, stats, timeline
13. **Conflict queue** — the diff row (the signature UI element), filterable by
    severity and status
14. **Review actions** — approve / reject / override, each appending to audit log
15. **Audit trail view** — full decision history, exportable
16. **Sources + rules config** — CRUD for `sources` and `rulesets`

### Phase 5 — Real connectors (week 12)

17. **Salesforce connector** — Developer Edition org, seeded from the generator
18. **Warehouse connector** — Databricks Free Edition, same seed data

Real connectors come *late* on purpose. They are the highest-friction, lowest-
insight part of the build, and every hour spent on OAuth is an hour not spent on
the contribution. The synthetic connector proves the pipeline; these prove the
integration.

### Phase 6 — Results (weeks 13–14)

19. **Full evaluation sweep** — all three systems, all metrics
20. **Ablations** — validate-node removal, threshold sweep
21. **Figures + results tables** — grayscale, written to `docs/results/`
22. *(stretch)* **Real anonymized case study**

---

## Web Route Handlers (`web/app/api/`)

```txt
app/api/
  runs/
    route.ts                  // POST → create run row, dispatch to engine → { runId }
                              // GET  → list runs
    [runId]/
      route.ts                // GET  → run detail + stats
      status/route.ts         // GET  → proxies engine status (polled by the UI)
      export/route.ts         // GET  → resolved hierarchy + decision log (JSON | CSV)
  conflicts/
    route.ts                  // GET  → filtered conflict queue
    [conflictId]/
      resolution/route.ts     // PATCH → approve | reject | override; appends audit_log
  sources/
    route.ts                  // GET, POST
    [sourceId]/route.ts       // GET, PATCH, DELETE
  rulesets/
    route.ts                  // GET, POST (POST creates a new version, never mutates)
    [rulesetId]/route.ts      // GET
```

Rulesets are **versioned, never edited in place**. A run records which
`rulesetId` it used; if rules could be mutated, past runs would become
unreproducible and the audit trail would be a lie.

Every route handler validates its body with Zod before touching the database. No
exceptions.

---

## Web Architecture (`web/`)

### app/

Routes and screens only. Server Components by default. A component becomes a
Client Component only when it needs state, an event handler, or polling — mark it
`"use client"` at the leaf, not at the page.

### components/

Create a component when it is reused, makes a screen easier to read, or
represents a clear UI concept.

Good examples: `ConflictDiffRow`, `SeverityMark`, `RunStatusBar`, `RationaleBlock`,
`AuditEntry`, `RuleEditor`, `StatGrid`, `EmptyState`

Do not extract one-off UI early. When unsure, ask:

> "Should this be extracted into a reusable component, or kept inside the current
> screen for now?"

### lib/

```txt
lib/
  db/
    schema.ts          // Drizzle schema — the single source of truth
    index.ts           // db client
  server/
    engine.ts          // SERVER ONLY — typed client for the engine's HTTP API
    runs.ts            // SERVER ONLY — run queries
    conflicts.ts       // SERVER ONLY — conflict queue queries
    audit.ts           // SERVER ONLY — append-only audit writer
  format.ts            // value formatting for the diff view
  cn.ts                // classnames utility
```

Anything in `lib/server/` may only be imported by Server Components and route
handlers. Never by a Client Component.

### types/

```txt
types/
  entity.ts       // CanonicalEntity
  rules.ts        // SurvivorshipRule, RuleStrategy
  run.ts          // RunStatus, RunStats
  conflict.ts     // Conflict, ConflictClass, Severity
  resolution.ts   // Resolution, ResolutionStatus
```

These mirror `engine/pipeline/schema.py` exactly. When you change one, change the
other in the same commit.

---

## Design System — Grayscale

The console is **entirely achromatic**. No hue anywhere: not in status, not in
severity, not in charts, not in the logo. This is a hard constraint, and it is
the interesting design problem of this project — color is the lazy way to encode
state, and removing it forces every distinction to be carried by something more
durable.

### The thesis

Canon's whole product is a diff: two sources disagree, here is the disagreement
and the proposed answer. So the interface is built around a single hero unit —
the **conflict diff row** — and everything else is scaffolding that stays out of
its way. The visual language is the ledger and the terminal: hairlines, aligned
columns, monospace values, no ornament.

### Tokens

```css
/* styles/tokens.css */
:root {
  --g-0:   #FFFFFF;
  --g-50:  #FAFAFA;
  --g-100: #F4F4F5;
  --g-200: #E4E4E7;
  --g-300: #D4D4D8;
  --g-400: #A1A1AA;
  --g-500: #71717A;
  --g-600: #52525B;
  --g-700: #3F3F46;
  --g-800: #27272A;
  --g-900: #18181B;
  --g-950: #09090B;

  --surface:        var(--g-0);
  --surface-sunken: var(--g-50);
  --hairline:       var(--g-200);
  --hairline-strong:var(--g-300);
  --text-primary:   var(--g-900);
  --text-secondary: var(--g-600);
  --text-muted:     var(--g-400);
  --ink:            var(--g-950);   /* the one true black, used sparingly */
}
```

Twelve steps, zero hues. If you find yourself wanting a thirteenth, you want a
different weight or a different border, not a new gray.

### Type

**IBM Plex Sans** for interface text, **IBM Plex Mono** for every data value.
Both via `next/font/google`.

This pairing is chosen, not defaulted: Plex was drawn for a systems and
enterprise-data company, its letterforms have enough character to carry an
interface that has no color to lean on, and the sans and mono are metrically
designed as a family so mixed-mode rows align. Do not substitute Inter or Geist
— those are the reflexive choices and they are flatter than this interface can
afford.

```
Display    Plex Sans   28 / 32   500   -0.02em    page titles
Heading    Plex Sans   17 / 24    500   -0.01em    section headers
Body       Plex Sans   14 / 20    400    0         prose, rationale
Label      Plex Sans   11 / 16    500    0.06em    uppercase column headers, eyebrows
Value      Plex Mono   13 / 20    400    0         every field value, id, count
Value-em   Plex Mono   13 / 20    500    0         the winning side of a diff
```

**All data is monospace. All chrome is sans.** That split is the fastest way for
a reader to tell "this is a value from a source system" from "this is Canon
talking about it", and it does the job color would normally do.

### Encoding severity without color

Four levels, distinguished by fill density and weight, and **always accompanied
by a text label**. The mark alone is never the only signal.

| Severity | Mark | Treatment |
|---|---|---|
| 4 structural | `████` | Solid `--ink` fill, `--g-0` text, 500 weight |
| 3 attribute | `███░` | 1px `--g-900` border, `--g-900` text, 500 weight |
| 2 attribute | `██░░` | 1px `--g-300` border, `--g-700` text, 400 weight |
| 1 cosmetic | `█░░░` | No border, `--g-500` text, 400 weight |

`components/SeverityMark.tsx` renders the mark plus the label (`Structural`,
`Attribute`, `Cosmetic`). Never render the mark without the word. A reader
skimming a queue of 400 conflicts must be able to sort by eye, and density
differences are learnable in a way that four unlabeled shades of gray are not.

Resolution status uses shape rather than fill: `proposed` is an outlined dot,
`auto_applied` a filled dot, `escalated` a filled square, `approved` a check,
`rejected` a slash, `overridden` a filled square with a rule through it.

### The signature element: the conflict diff row

Every screen exists to get the reader to this. It is a three-part unit:

```
┌──────────────────────────────────────────────────────────────────────┐
│ ███░ ATTRIBUTE          territory              ACC-4417 · Northwind  │
├────────────────────────────┬─────────────────────────────────────────┤
│ SALESFORCE                 │ DATABRICKS GTM                          │
│ APAC-SOUTH                 │ APAC                                    │
│ modified 2d ago            │ modified 61d ago                        │
├────────────────────────────┴─────────────────────────────────────────┤
│ → APAC-SOUTH          most_recent · 0.91                             │
│   Salesforce shows APAC-SOUTH, modified 2 days ago; the warehouse    │
│   still shows APAC from 61 days ago. Applied most_recent.            │
└──────────────────────────────────────────────────────────────────────┘
```

- A **1px vertical hairline spine** splits the two sources. It is the only
  structural line in the row and it never moves — column widths are fixed at 50%
  so the eye can scan a stack of rows without re-anchoring.
- Values are monospace and **left-aligned to the spine on both sides**, so
  differing characters land in roughly the same optical position.
- The proposed resolution sits **beneath**, indented, introduced by `→` — the
  visual grammar of a commit message under a diff hunk. The rationale is sans,
  because it is Canon speaking, not a source system.
- The differing characters within a value get `--g-900` at 500 weight while the
  shared prefix stays `--g-500`. Character-level emphasis is doing the work a
  red/green diff would normally do.

### Layout

- **Fixed 240px left rail**, hairline-separated, no background fill. Nav is a
  plain list — no pills, no active-state fills, just weight and a 2px left mark.
- **Content is full-bleed tabular**, max-width 1400px. Data tables are not cards.
  Do not wrap tables in bordered rounded containers; the hairlines *are* the
  structure.
- **8px spacing scale.** Row height 44px in queues, 36px in dense tables.
- **Radius: 2px on interactive elements only** (buttons, inputs, the review
  controls). Data surfaces — tables, diff rows, the rail — are square. The
  distinction tells you what you can click.
- **No shadows. No gradients. No glows.** A surface is raised by being
  `--surface` on `--surface-sunken`, or by a hairline. That is the entire
  elevation system.

### Motion

One orchestrated moment, not scattered effects: when a run completes, the
conflict queue rows stagger in at 20ms intervals with a 120ms fade — enough to
convey that results arrived in order of severity, and nothing else in the app
animates on entry. Everything else is 80ms opacity/border transitions on hover
and focus.

Respect `prefers-reduced-motion` — disable the stagger, keep the fade instant.

### Quality floor (not optional)

- Visible keyboard focus on every interactive element: 2px `--g-900` outline,
  2px offset. Because there is no color, focus must be unmissable.
- All text meets WCAG AA against its surface. `--g-400` on `--g-0` is for
  decorative marks and disabled states only, never body text.
- The conflict queue is fully keyboard-navigable: `j`/`k` to move, `a` approve,
  `e` escalate, `o` override. A reviewer working a queue of 400 should never
  touch the mouse.
- Responsive down to 768px: the diff row's two columns stack, spine becomes a
  horizontal rule, labels stay.

### Charts

Evaluation figures use the same palette: `--g-900`, `--g-600`, `--g-400`,
`--g-200` for up to four series, distinguished by dash pattern as well as value.
Never more than four series in one figure — if you need five, you need two
figures.

---

## TypeScript Rules

Use TypeScript strictly across `web/`.

- Avoid `any`. If tempted, define a proper type.
- Keep types simple and readable — no over-engineered generics.
- All shared types live in `types/`. Do not define types inline in components
  unless genuinely local and throwaway.
- Every API boundary is Zod-validated. A parsed Zod schema is the type — do not
  hand-maintain a duplicate interface next to it.
- Run `npm run typecheck` after every feature. Fix all errors before moving on.

## Python Rules

- Python 3.12+, managed with `uv`. Never `pip install` into a global env.
- Full type annotations. `mypy --strict` must pass.
- Every payload crossing the layer boundary is a Pydantic model in
  `pipeline/schema.py`. No bare dicts across the boundary.
- The pipeline stages are pure functions where possible: `normalize(records) →
  entities`, `detect(matches) → conflicts`. Side effects (DB writes, API calls)
  live in `main.py` and `db.py`, not inside the stages. This is what makes the
  evaluation harness able to run the same code paths as production.
- No notebooks in the repo. Exploration is fine; committed code is modules.

---

## Security Rules

| What | Where | Never |
|---|---|---|
| `ANTHROPIC_API_KEY` | Engine `.env` only | `web/`, any client bundle |
| `SALESFORCE_CLIENT_ID` / `_SECRET` / `_USERNAME` / `_PASSWORD` / `_TOKEN` | Engine `.env` only | `web/`, `sources.config` |
| `DATABRICKS_TOKEN` / `SNOWFLAKE_PASSWORD` | Engine `.env` only | `web/`, `sources.config` |
| `DATABASE_URL` | Engine `.env` + `web/.env` (server) | Any Client Component |
| `SUPABASE_SERVICE_ROLE_KEY` | `web/.env` (server only) | Client Components, engine |
| `ENGINE_URL` | `web/.env` | Public env (`NEXT_PUBLIC_*`) |

No secret is ever prefixed `NEXT_PUBLIC_`. There is no legitimate reason for this
project to expose anything to the browser beyond the app's own API routes.

Source credentials are keyed by source `kind` in the engine's environment;
`sources.config` in Postgres holds only non-secret connection shape (object
names, table names, filters). If you find yourself writing a password into a
jsonb column, stop.

---

## Development Philosophy

Build feature by feature.

For every feature:

1. Read this file first.
2. Identify which layer is affected: web, engine, or schema.
3. Keep changes focused to that layer.
4. If the change touches the tool contract, change both sides in the same commit.
5. Do not rewrite unrelated code.
6. Prefer readable code over clever code.
7. Build the smallest useful version first.
8. If the change affects detection or resolution logic, re-run
   `engine/eval/harness.py` and record the new numbers before moving on.
9. Fix all errors before finishing.

---

## Linting and Validation

After every feature:

```bash
# Web
cd web && npm run lint && npm run typecheck

# Engine
cd engine && uv run ruff check . && uv run mypy . --strict

# If detection or resolution logic changed
cd engine && uv run python -m eval.harness --seed 42 --quick
```

Fix all errors before moving on.

---

## Running It

```bash
# Engine
cd engine
uv sync
uv run uvicorn main:app --reload --port 8000

# Generate a fresh synthetic dataset + manifest
uv run python -m eval.generate --seed 42 --accounts 500 --out ./data/run42

# Full evaluation sweep (all three systems, all metrics)
uv run python -m eval.harness --seed 42 --systems all --report

# Web
cd web
npm install
npx drizzle-kit migrate
npm run dev
```

---

## Decision Making & Clarifications

If something is unclear or could be improved:

- Proactively flag it.
- If a new library would significantly help:
  - Name it
  - Explain why
  - Ask for permission before installing

Do not install or use new libraries without approval. This project has a
deliberately small dependency surface; every addition is a version-churn risk
across a 14-week build.

---

## Communication Style

Be concise. Explain what changed, which layer was touched, and how to test it. If
the change affects the numbers, say what the numbers were before and after. No
unnecessary explanation.

---

## Final Reminder

Before every feature implementation:

1. Read this file.
2. Identify the affected layer: web, engine, or schema.
3. Respect table ownership — the engine never writes config, the web never writes
   run output.
4. Never let a secret cross into the browser.
5. Match the tool contract on both sides, in the same commit.
6. The model never invents a value. `validate` is not optional.
7. If it changed detection or resolution, re-run the harness.
8. Grayscale. No exceptions, no accents, no "just one color for errors".

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
