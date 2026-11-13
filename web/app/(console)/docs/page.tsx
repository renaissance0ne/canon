import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/console/page-header";
import { ResolutionStatusMark } from "@/components/conflicts/resolution-status-mark";
import {
  Code,
  CodeBlock,
  DocHeading,
  DocSection,
  DocTable,
  Kbd,
  Note,
  Prose,
  Step,
  Steps,
} from "@/components/docs/doc-blocks";
import { SeverityMark } from "@/components/severity-mark";
import {
  AUDIT_ACTION_HELP,
  CONFLICT_CLASS_HELP,
  INJECTION_HELP,
  NAME_MATCH_CONFIDENCE,
  QUEUE_VIEW_HELP,
  RESOLUTION_STATUS_HELP,
  SEVERITY_HELP,
  STAGE_HELP,
  STAT_HELP,
  STRATEGY_HELP,
  TERM_HELP,
  VERDICT_HELP,
} from "@/lib/glossary";
import { requireReviewer } from "@/lib/server/auth";
import { SEVERITY_ORDER, conflictClassSchema } from "@/types/conflict";
import { INJECTION_META, type InjectionRates } from "@/types/dataset";
import { VERDICT_LABEL, VERDICT_MARK, verdictSchema } from "@/types/ground-truth";
import { QUEUE_STATUS_LABEL, QUEUE_STATUS_PURPOSE, QUEUE_VIEWS, queueStatusFilterSchema } from "@/types/queue";
import {
  AUDIT_ACTIONS,
  AUDIT_ACTION_LABEL,
  resolutionStatusSchema,
} from "@/types/resolution";
import { ruleStrategySchema } from "@/types/rules";
import { AUTO_APPLY_GATE, RUN_STAGES, type RunStats } from "@/types/run";

export const metadata: Metadata = {
  title: "Docs · Canon",
  description: "How to use Canon: sources, datasets, rules, runs, review, audit and export.",
};

/**
 * The user guide — everything needed to operate the console, in the order a
 * new user meets it.
 *
 * Every definition on this page is read from lib/glossary.ts, the same module
 * the console's tooltips read. The guide and the hover text therefore cannot
 * disagree, and a threshold that moves in types/ moves here too.
 *
 * Gated like every other console screen. Nothing here is sensitive, but the
 * route group's layout signs a reader in, and a page that behaved differently
 * from its neighbours would be the one exception a reviewer has to remember.
 */

const CONTENTS = [
  { id: "overview", title: "What Canon does" },
  { id: "quick-start", title: "Quick start" },
  { id: "pipeline", title: "How a run works" },
  { id: "sources", title: "Sources" },
  { id: "datasets", title: "Synthetic datasets" },
  { id: "rules", title: "Rules" },
  { id: "runs", title: "Runs" },
  { id: "review", title: "Reviewing conflicts" },
  { id: "audit", title: "Audit trail" },
  { id: "export", title: "Export" },
  { id: "operating", title: "Running the platform" },
  { id: "troubleshooting", title: "Troubleshooting" },
  { id: "glossary", title: "Glossary" },
] as const;

const STAT_ORDER: readonly { key: keyof RunStats; label: string }[] = [
  { key: "entitiesA", label: "Entities A" },
  { key: "entitiesB", label: "Entities B" },
  { key: "candidatePairs", label: "Candidate pairs" },
  { key: "matches", label: "Matches" },
  { key: "conflicts", label: "Conflicts" },
  { key: "autoResolved", label: "Auto-applied" },
  { key: "escalated", label: "Escalated" },
  { key: "tokensUsed", label: "Tokens" },
  { key: "modelCalls", label: "Model calls" },
  { key: "modelErrors", label: "Model errors" },
  { key: "modelRateLimited", label: "Rate limited" },
];

const RATE_ORDER: readonly (keyof InjectionRates)[] = [
  "reparent",
  "staleAttribute",
  "nameVariant",
  "missingRecord",
  "duplicateRecord",
  "ambiguous",
];

const GATE_TEXT = `confidence ≥ ${AUTO_APPLY_GATE.confidenceThreshold.toFixed(2)} and severity ≤ ${AUTO_APPLY_GATE.maxSeverity}`;

export default async function DocsPage() {
  await requireReviewer();

  return (
    <>
      <PageHeader title="Docs" meta="how to use Canon" />

      <div className="flex gap-12 px-10 py-8">
        {/* Contents. Sticky beside the article on wide screens; on narrow ones
            it sits at the top of the page as an ordinary list. */}
        <nav aria-label="Contents" className="hidden w-[200px] shrink-0 xl:block">
          <div className="sticky top-24">
            <ContentsList />
          </div>
        </nav>

        <article className="flex min-w-0 max-w-[880px] flex-1 flex-col gap-12">
          <div className="xl:hidden">
            <ContentsList />
          </div>

          <Overview />
          <QuickStart />
          <Pipeline />
          <Sources />
          <Datasets />
          <Rules />
          <Runs />
          <Review />
          <Audit />
          <Export />
          <Operating />
          <Troubleshooting />
          <Glossary />
        </article>
      </div>
    </>
  );
}

function ContentsList() {
  return (
    <>
      <p className="text-label uppercase text-g-500">Contents</p>
      <ol className="mt-3 flex flex-col gap-1.5">
        {CONTENTS.map((entry, index) => (
          <li key={entry.id} className="flex gap-2 text-body">
            <span className="w-5 shrink-0 font-mono text-value text-g-400">
              {String(index + 1).padStart(2, "0")}
            </span>
            <a href={`#${entry.id}`} className="text-g-700 no-underline hover:text-g-900 hover:underline">
              {entry.title}
            </a>
          </li>
        ))}
      </ol>
    </>
  );
}

// ── 1 · Overview ─────────────────────────────────────────────────────────────

function Overview() {
  return (
    <DocSection
      id="overview"
      title="What Canon does"
      lead="Canon finds where your CRM and your warehouse disagree about the shape of your organization, proposes a resolution for each disagreement, explains it, and records every decision."
    >
      <Prose>
        Every go-to-market organization keeps its structure in two places. Reps
        and ops edit accounts, owners, roles and territories in the CRM;
        analytics, forecasting and finance read the same structure from the
        warehouse after ETL. The two drift — a rep is reassigned in Salesforce
        on Monday and the warehouse still credits last quarter&rsquo;s territory.
        Canon reads both, pairs up the records that describe the same thing,
        and works out what to do about every difference.
      </Prose>
      <DocTable
        head={["Canon is", "Canon is not"]}
        rows={[
          ["A decision system: it proposes a value and says why", "An ETL tool — it moves no data between systems"],
          ["Deterministic first: rules decide before any model is asked", "A wrapper around a model prompt"],
          ["Honest about uncertainty: ambiguous cases go to a person", "A system that resolves everything and hides its mistakes"],
          ["Read-only toward your systems", "A write-back tool — it never edits Salesforce or the warehouse"],
        ]}
      />
      <Note>
        Canon proposes and records; it does not mutate source systems. What it
        produces is a resolved hierarchy and a decision log you can export and
        apply through your own process.
      </Note>
    </DocSection>
  );
}

// ── 2 · Quick start ──────────────────────────────────────────────────────────

function QuickStart() {
  return (
    <DocSection
      id="quick-start"
      title="Quick start"
      lead="The fastest path from an empty console to a reviewed run uses a synthetic dataset, so no credentials are needed."
    >
      <Steps>
        <Step n={1} title="Generate a dataset">
          <p>
            Go to <Link href="/sources/datasets">Sources → Datasets</Link>, give it
            a name such as <Code>demo</Code>, keep the default seed, accounts and
            rates, and choose <strong>Generate dataset</strong>. It takes about a
            second and produces both sides plus the ground truth.
          </p>
        </Step>
        <Step n={2} title="Add two synthetic sources">
          <p>
            Go to <Link href="/sources/new?kind=synthetic">Sources → Add source</Link>,
            choose kind <Code>Synthetic</Code> and your dataset, and save. Do it
            twice, for example <Code>Demo CRM</Code> and <Code>Demo warehouse</Code>.
            A run reads side A of the dataset from the first source and side B
            from the second, so you need two.
          </p>
        </Step>
        <Step n={3} title="Author a ruleset">
          <p>
            Go to <Link href="/rules">Rules</Link>. A sensible starting policy is{" "}
            <Code>most_recent</Code> for <Code>parentExternalId</Code>,{" "}
            <Code>name</Code>, <Code>territory</Code>, <Code>roleName</Code> and{" "}
            <Code>ownerId</Code>. Save it — every save creates a new version.
          </p>
        </Step>
        <Step n={4} title="Start a run">
          <p>
            Go to <Link href="/runs/new">Runs → New run</Link>. Pick the CRM-side
            source for A, the warehouse-side source for B, your ruleset and a
            model provider, then <strong>Start run</strong>. The run screen
            follows it through each stage live.
          </p>
        </Step>
        <Step n={5} title="Review what it escalated">
          <p>
            When the run completes, choose <strong>Review escalated</strong>. Work
            the queue with the keyboard — <Kbd>j</Kbd>/<Kbd>k</Kbd> to move,{" "}
            <Kbd>a</Kbd> to approve, <Kbd>o</Kbd> to override, <Kbd>r</Kbd> to
            reject. Every decision is written to the audit trail under your name.
          </p>
        </Step>
        <Step n={6} title="Check the score and export">
          <p>
            Open the dataset under Sources → Datasets to see the run scored
            against the ground truth, then use <strong>Export</strong> on the run
            for the resolved hierarchy and the decision log.
          </p>
        </Step>
      </Steps>
    </DocSection>
  );
}

// ── 3 · Pipeline ─────────────────────────────────────────────────────────────

function Pipeline() {
  return (
    <DocSection
      id="pipeline"
      title="How a run works"
      lead="A run moves forward through six stages. The run screen shows which one it is in; a failed run marks the stage it stopped in."
    >
      <DocTable
        head={["Stage", "What happens"]}
        rows={RUN_STAGES.map((stage) => [<Code key={stage}>{stage}</Code>, STAGE_HELP[stage]])}
      />

      <DocHeading>Matching</DocHeading>
      <Prose>
        Canon never compares every record with every other. It finds candidate
        pairs in three passes, cheapest first: the same external id on both
        sides; then the same normalized name; then, for whatever is left, the
        nearest neighbours by name embedding. Names are normalized before any
        comparison — case, spacing, punctuation, accents, ampersands and legal
        suffixes such as Inc., GmbH or Pvt Ltd are folded — and the original
        spelling is kept, so a cosmetic difference is still reported.
      </Prose>
      <Prose>
        A shared external id is identity and always matches. Any other pair has
        to earn it: name similarity (a fuzzy ratio and an embedding cosine) and{" "}
        <em>field agreement</em> — the share of fields both records populate,
        such as parent, territory, owner and segment, that agree — combine into a
        confidence that must reach {NAME_MATCH_CONFIDENCE}. Two names that differ
        in an identifying number (“Store 101” and “Store 102”) are never matched,
        however much else agrees.
      </Prose>

      <DocHeading>Detection</DocHeading>
      <Prose>
        Every matched pair is compared field by field. Each difference becomes a
        conflict with a class and a severity (see{" "}
        <a href="#review">Reviewing conflicts</a>). A record with no counterpart
        becomes an orphan; two records on one side matching one on the other
        become a duplicate.
      </Prose>

      <DocHeading>Resolution</DocHeading>
      <CodeBlock label="The resolution graph">{`classify ──rule decides──▶ apply ────┐
    │                                 ├─▶ validate ─┬─ passes the gate ─▶ auto_apply
    └──no rule decides──────▶ propose ┘             └─ otherwise ─────────▶ escalate`}</CodeBlock>
      <Prose>
        For each conflict Canon first looks for a survivorship rule. If one
        decides, its value is applied. Only if none does is the model asked to
        choose — and it may only choose one of the two observed values, or
        decline. Every proposed value, from a rule or the model, is then
        validated: anything that is not an observed value or a legal
        normalization of one is rejected. Finally the auto-apply gate decides:{" "}
        {GATE_TEXT} is applied automatically; everything else is escalated to a
        reviewer.
      </Prose>
    </DocSection>
  );
}

// ── 4 · Sources ──────────────────────────────────────────────────────────────

function Sources() {
  return (
    <DocSection
      id="sources"
      title="Sources"
      lead="A source is a system Canon reads. A run always pairs one CRM-side source (A) with one warehouse-side source (B)."
    >
      <DocTable
        head={["Kind", "Side", "Status"]}
        rows={[
          [<Code key="s">synthetic</Code>, "either", "Reads a generated dataset from the engine's disk. No credentials."],
          [<Code key="sf">salesforce</Code>, "CRM (A)", "Reads Account, User, UserRole and Territory. Connect with OAuth or stored credentials."],
          [<Code key="db">databricks</Code>, "warehouse (B)", "Runs the configured SELECT over SQL warehouse tables."],
          [<Code key="sn">snowflake</Code>, "warehouse (B)", "Runs the configured SELECT."],
          [<Code key="hs">hubspot</Code>, "CRM (A)", "Credentials can be stored, but no connector is implemented yet — a run against it fails at extract."],
        ]}
      />
      <DocHeading>Adding a source</DocHeading>
      <Prose>
        Under <Link href="/sources/new">Sources → Add source</Link>, give it a
        name and kind. The config field describes <em>what</em> to read — object
        or table names and an optional filter — and nothing else. It must never
        hold a password or token.
      </Prose>
      <DocHeading>Connecting credentials</DocHeading>
      <Prose>
        Any kind other than synthetic needs credentials before a run can read it;
        until then it shows as <Code>not connected</Code> and the run form will
        not start with it. After saving, Canon opens the connect screen. OAuth is
        offered first wherever a platform supports it, because Canon then holds a
        scoped, expiring, revocable grant rather than a reusable password.
        Credentials are encrypted before they are stored, bound to that one
        source, and never shown again on any screen — the console only ever says
        which ones exist.
      </Prose>
    </DocSection>
  );
}

// ── 5 · Datasets ─────────────────────────────────────────────────────────────

function Datasets() {
  return (
    <DocSection
      id="datasets"
      title="Synthetic datasets"
      lead="A synthetic dataset is a generated organization, two divergent copies of it, and a manifest of every difference that was injected — the answer key a run can be scored against."
    >
      <Prose>
        Generate one under <Link href="/sources/datasets">Sources → Datasets</Link>.
        The same seed, accounts and rates always produce the same bytes, so a
        result can be reproduced by anyone with the seed. A name is a directory
        on the engine: letters, digits, dot, dash or underscore. Generating over
        an existing name asks first.
      </Prose>
      <DocTable
        head={["Injection", "Default", "What it does"]}
        rows={RATE_ORDER.map((key) => [
          INJECTION_META[key].label,
          <span key={key} className="font-mono text-value">
            {DEFAULT_RATE_LABEL[key]}
          </span>,
          INJECTION_HELP[key],
        ])}
      />
      <Prose>
        Rates are fractions of all generated records and must sum to at most
        100%: one record carries at most one divergence.
      </Prose>

      <DocHeading>Scoring a run against the ground truth</DocHeading>
      <Prose>
        Open a dataset to browse its manifest — what each side holds, what is
        actually true, and which cases are ambiguous on purpose — and to see any
        run that read it scored conflict by conflict. A conflict is matched to
        the manifest on the entity and the field.
      </Prose>
      <DocTable
        head={["Verdict", "Meaning"]}
        rows={verdictSchema.options.map((verdict) => [
          <span key={verdict} className="font-mono text-value">
            {VERDICT_MARK[verdict]} {VERDICT_LABEL[verdict]}
          </span>,
          VERDICT_HELP[verdict],
        ])}
      />
      <Note>
        Scoring always judges the agent&rsquo;s proposed value, never a
        reviewer&rsquo;s override: a human correcting a proposal does not make the
        proposal right.
      </Note>
    </DocSection>
  );
}

const DEFAULT_RATE_LABEL: Record<keyof InjectionRates, string> = {
  reparent: "5%",
  staleAttribute: "8%",
  nameVariant: "12%",
  missingRecord: "3%",
  duplicateRecord: "2%",
  ambiguous: "2%",
};

// ── 6 · Rules ────────────────────────────────────────────────────────────────

function Rules() {
  return (
    <DocSection
      id="rules"
      title="Rules"
      lead="A ruleset is the survivorship policy: for a given field and entity type, which value wins. Rules decide before any model is asked."
    >
      <DocTable
        head={["Strategy", "How it decides"]}
        rows={ruleStrategySchema.options.map((strategy) => [
          <Code key={strategy}>{strategy}</Code>,
          STRATEGY_HELP[strategy],
        ])}
      />
      <DocHeading>Which rule applies</DocHeading>
      <Prose>{TERM_HELP.specificity.text}</Prose>
      <DocTable
        head={["Field", "Entity", "Specificity"]}
        rows={[
          [<Code key="1">territory</Code>, <Code key="1e">account</Code>, "most specific — tried first"],
          [<Code key="2">territory</Code>, <Code key="2e">*</Code>, "second"],
          [<Code key="3">*</Code>, <Code key="3e">account</Code>, "third"],
          [<Code key="4">*</Code>, <Code key="4e">*</Code>, "catch-all — tried last"],
        ]}
      />
      <Prose>
        Ties keep the order you wrote them in. The editor shows rules in
        evaluation order, so a rule that can never fire sits visibly at the
        bottom. A <Code>*</Code>/<Code>*</Code> rule with <Code>most_complete</Code>{" "}
        is a common fallback; leave it out if you would rather every uncovered
        field reach the model or a reviewer.
      </Prose>
      <DocHeading>Versions</DocHeading>
      <Prose>
        Rulesets are never edited in place. <strong>Save</strong> creates the next
        version and makes it active; earlier versions stay listed and readable.
        A run records the exact version it executed, so its decisions can always
        be explained against the policy that produced them.
      </Prose>
      <Note>
        Without a rule, a conflict is not guessed at: the model is asked if one is
        configured, and otherwise it escalates. A blanket{" "}
        <Code>prefer_source</Code> on everything would “resolve” genuinely
        ambiguous cases too — the escalation metrics are there to show that cost.
      </Note>
    </DocSection>
  );
}

// ── 7 · Runs ─────────────────────────────────────────────────────────────────

function Runs() {
  return (
    <DocSection
      id="runs"
      title="Runs"
      lead="A run is one reconciliation of two sources under one ruleset version and one model provider. All three are recorded on it."
    >
      <DocHeading>Starting a run</DocHeading>
      <DocTable
        head={["Choice", "What to know"]}
        rows={[
          ["Source A · CRM", TERM_HELP.sourceA.text],
          ["Source B · warehouse", TERM_HELP.sourceB.text],
          ["Ruleset", TERM_HELP.ruleset.text],
          ["Resolution model", TERM_HELP.modelProvider.text],
          ["Auto-apply gate", TERM_HELP.autoApplyGate.text],
        ]}
      />
      <Prose>
        The form explains anything that would stop a run — a source with no
        credentials, the same source on both sides, a provider the engine has no
        key for — before you press start. A missing model key is a warning, not
        a block: the run still resolves everything the rules decide.
      </Prose>

      <DocHeading>Reading a run</DocHeading>
      <Prose>
        The run screen polls while the run is in flight and shows each number as
        soon as the stage that produces it has finished; a dash means
        “not computed yet”, not zero.
      </Prose>
      <DocTable
        head={["Number", "Meaning"]}
        rows={STAT_ORDER.map(({ key, label }) => [label, STAT_HELP[key]])}
      />

      <DocHeading>Degraded and failed runs</DocHeading>
      <Prose>
        A <strong>degraded</strong> run completed, but some of its model calls
        returned no answer, so those conflicts escalated without a judgement. The
        run screen says how many and subtracts them for you: escalated minus
        unanswered is the part of the queue that reflects the agent. When the
        cause would fail every call — a rejected key, an empty credit balance —
        Canon stops asking after the first failure.
      </Prose>
      <Prose>
        A <strong>failed</strong> run stopped with an error. The message is shown
        on the run screen and names the stage, and everything computed before it
        stopped is kept.
      </Prose>
    </DocSection>
  );
}

// ── 8 · Review ───────────────────────────────────────────────────────────────

function Review() {
  return (
    <DocSection
      id="review"
      title="Reviewing conflicts"
      lead="The conflict queue is where a person decides what Canon would not. It opens on the escalated pile, highest severity first."
    >
      <DocHeading id="severity">Severity</DocHeading>
      <Prose>
        Severity is a defined integer the auto-apply gate reads, shown by fill
        density and always with its word.
      </Prose>
      <DocTable
        head={["Mark", "Meaning"]}
        rows={SEVERITY_ORDER.map((severity) => [
          <SeverityMark key={severity} severity={severity} />,
          SEVERITY_HELP[severity],
        ])}
      />

      <DocHeading>Conflict classes</DocHeading>
      <DocTable
        head={["Class", "Meaning"]}
        rows={conflictClassSchema.options.map((conflictClass) => [
          <Code key={conflictClass}>{conflictClass}</Code>,
          CONFLICT_CLASS_HELP[conflictClass],
        ])}
      />

      <DocHeading>Resolution status</DocHeading>
      <Prose>Status is shown by shape, so it never competes with severity&rsquo;s fill.</Prose>
      <DocTable
        head={["Status", "Meaning"]}
        rows={resolutionStatusSchema.options.map((status) => [
          <ResolutionStatusMark key={status} status={status} />,
          RESOLUTION_STATUS_HELP[status],
        ])}
      />

      <DocHeading>Reading a conflict</DocHeading>
      <Prose>
        Each conflict is a diff: source A on the left, source B on the right,
        split by a fixed hairline so values line up row after row. The characters
        that differ are set heavier than the shared part. Underneath, after{" "}
        <Code>→</Code>, is the proposed value with the rule or strategy that chose
        it and its confidence, then the rationale — two sentences naming both
        values, the reasoning, and the choice. The focus view adds the{" "}
        <em>rule trace</em>, which shows whether a rule decided or the model was
        asked. Duplicates also show the match evidence: cosine, fuzzy ratio and
        field agreement.
      </Prose>

      <DocHeading>Piles, filters and views</DocHeading>
      <DocTable
        head={["Pile", "What it is for"]}
        rows={queueStatusFilterSchema.options.map((status) => [
          QUEUE_STATUS_LABEL[status],
          QUEUE_STATUS_PURPOSE[status],
        ])}
      />
      <Prose>
        Severity chips filter by level and combine — select structural and
        attribute 3 to work everything that affects rollups or ownership. Every
        filter lives in the URL, so a filtered queue can be shared as a link.
      </Prose>
      <DocTable
        head={["View", "Best for"]}
        rows={QUEUE_VIEWS.map(({ view, label }) => [label, QUEUE_VIEW_HELP[view]])}
      />

      <DocHeading id="keyboard">Keyboard</DocHeading>
      <Prose>The queue is built to be worked without the mouse. Keys are ignored while you are typing in a field.</Prose>
      <DocTable
        head={["Key", "Action"]}
        rows={[
          [<span key="jk"><Kbd>j</Kbd> / <Kbd>k</Kbd> or <Kbd>↓</Kbd> / <Kbd>↑</Kbd></span>, "Move to the next or previous conflict."],
          [<Kbd key="a">a</Kbd>, "Approve the proposed value. Does nothing when no value was proposed — choose a side instead."],
          [<Kbd key="o">o</Kbd>, "Open the override editor to choose or enter a value."],
          [<Kbd key="r">r</Kbd>, "Reject the proposal."],
          [<span key="e"><Kbd>e</Kbd> or <Kbd>s</Kbd></span>, "Leave it escalated and move on."],
          [<Kbd key="esc">Esc</Kbd>, "Close the override editor, or any open tooltip."],
        ]}
      />

      <DocHeading>Review actions</DocHeading>
      <DocTable
        head={["Action", "Effect", "Audit entry"]}
        rows={[
          ["Approve", "Accepts the proposed value.", <Code key="a">human_approved</Code>],
          ["Override…", "Records a value you choose. Taking one side when nothing was proposed is an override too.", <Code key="o">human_overridden</Code>],
          ["Reject", "Throws the proposal out without choosing a value.", <Code key="r">human_rejected</Code>],
        ]}
      />
      <Prose>
        Auto-applied conflicts are already decided, so they offer only Override
        and Reject: the pile is there to spot-check, because a wrong auto-apply is
        the one error nothing else catches. A decision can be revisited; each
        revisit appends another audit entry rather than replacing the last.
      </Prose>
    </DocSection>
  );
}

// ── 9 · Audit ────────────────────────────────────────────────────────────────

function Audit() {
  return (
    <DocSection
      id="audit"
      title="Audit trail"
      lead="Every action by the engine, the agent or a reviewer is appended to the audit log. Nothing in it is ever edited or deleted."
    >
      <Prose>
        Open <Link href="/audit">Audit</Link> for the whole history, or follow{" "}
        <strong>Audit trail</strong> from a run to scope it. Filter by action;
        each chip shows how many entries it holds. <strong>Export log</strong>{" "}
        downloads the current view as CSV.
      </Prose>
      <DocTable
        head={["Action", "Recorded when"]}
        rows={AUDIT_ACTIONS.map((action) => [
          <Code key={action}>{AUDIT_ACTION_LABEL[action]}</Code>,
          AUDIT_ACTION_HELP[action],
        ])}
      />
      <Prose>
        The actor is <Code>engine</Code> for rule decisions, <Code>agent</Code> for
        the model&rsquo;s, and your signed-in identity for review actions — which
        is why the console requires sign-in.
      </Prose>
    </DocSection>
  );
}

// ── 10 · Export ──────────────────────────────────────────────────────────────

function Export() {
  return (
    <DocSection
      id="export"
      title="Export"
      lead="A finished run exports its resolved hierarchy and the full decision log, so the outcome can be applied through your own change process."
    >
      <DocTable
        head={["Section", "Contents", "Formats"]}
        rows={[
          ["Resolved hierarchy", "The organization as it looks once Canon's decisions are applied.", "JSON"],
          ["Decision log", "Every conflict, its proposal, rationale, status and any review.", "JSON, CSV"],
          ["Unmatched / orphans", "Records present on only one side.", "JSON"],
          ["Run stats", "The run's headline numbers and token usage.", "JSON"],
        ]}
      />
      <Prose>
        Choose <strong>Export</strong> on a completed run, pick the sections and
        a format, and download. The same file is available from{" "}
        <Code>GET /api/runs/:runId/export?format=json|csv&amp;sections=…</Code>.
      </Prose>
    </DocSection>
  );
}

// ── 11 · Operating ───────────────────────────────────────────────────────────

function Operating() {
  return (
    <DocSection
      id="operating"
      title="Running the platform"
      lead="Canon is two services and one database: the web console (Next.js), the reconciliation engine (Python), and Postgres."
    >
      <CodeBlock label="Engine">{`cd engine
uv sync
uv run uvicorn main:app --reload --port 8000`}</CodeBlock>
      <CodeBlock label="Web console">{`cd web
npm install
npx drizzle-kit migrate
npm run dev`}</CodeBlock>
      <CodeBlock label="A dataset from the command line — the same function the console calls">{`cd engine
uv run python -m eval.generate --seed 42 --accounts 500 --out ./data/run42`}</CodeBlock>

      <DocHeading>Engine settings · engine/.env</DocHeading>
      <DocTable
        head={["Variable", "Purpose"]}
        rows={[
          [<Code key="1">DATABASE_URL</Code>, "The Postgres the web console uses. The engine writes only its own run output."],
          [<Code key="2">ANTHROPIC_API_KEY</Code>, "Enables Claude as a resolution model. Never set in the web console."],
          [<Code key="3">GEMINI_API_KEY</Code>, "Enables Gemini as a resolution model."],
          [<Code key="3a">AZURE_OPENAI_ENDPOINT · AZURE_OPENAI_API_KEY</Code>, "Together, enable Azure OpenAI (gpt-4.1-mini) as a resolution model. The endpoint is the resource address the Azure portal shows."],
          [<Code key="4">CANON_CLAUDE_MODEL · CANON_GEMINI_MODEL · AZURE_OPENAI_DEPLOYMENT</Code>, "Optional overrides for the pinned resolution models. On Azure the request names a deployment; name it after the model and version it serves."],
          [<Code key="5">CANON_MODEL_CONCURRENCY</Code>, "Conflicts sent to the model at once (default 4, max 16). The first rate limit drops a run to one at a time."],
          [<Code key="6">CANON_CREDENTIAL_KEY</Code>, "Decrypts stored source credentials. Must be identical in engine/.env and web/.env."],
          [<Code key="7">CANON_DATASET_ROOT</Code>, "Where generated datasets live (default ./data)."],
          [<Code key="8">CANON_SYNTHETIC_DATA_DIR</Code>, "The dataset a synthetic source reads when it names none."],
        ]}
      />
      <DocHeading>Console settings · web/.env</DocHeading>
      <DocTable
        head={["Variable", "Purpose"]}
        rows={[
          [<Code key="1">DATABASE_URL · MIGRATION_DATABASE_URL</Code>, "Postgres through the transaction pooler, and through session mode for migrations."],
          [<Code key="2">ENGINE_URL</Code>, "Where the console reaches the engine."],
          [<Code key="3">CLERK_SECRET_KEY · NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY</Code>, "Sign-in. Review actions are recorded under the signed-in identity."],
          [<Code key="4">CANON_CREDENTIAL_KEY</Code>, "Encrypts source credentials before they are stored."],
          [<Code key="5">*_OAUTH_CLIENT_ID · *_OAUTH_CLIENT_SECRET</Code>, "Canon's own OAuth app registrations, per platform."],
        ]}
      />

      <DocHeading>Evaluation</DocHeading>
      <Prose>
        The evaluation harness runs the full pipeline against a dataset&rsquo;s
        ground truth and compares three systems: <Code>baseline_exact</Code>{" "}
        (exact matching only), <Code>baseline_rules</Code> (the full pipeline with
        no model) and <Code>canon_full</Code> (with the agent). It reports
        detection precision and recall, resolution accuracy, escalation
        precision, the false auto-apply rate and cost per thousand conflicts,
        and writes tables and figures to <Code>docs/results/</Code>.
      </Prose>
      <CodeBlock>{`cd engine
uv run python -m eval.harness --seed 42 --provider azure_openai --systems all --report
uv run python -m eval.harness --seed 42 --quick      # the post-change check
uv run python -m eval.harness --seed 42 --no-model   # deterministic path only`}</CodeBlock>
    </DocSection>
  );
}

// ── 12 · Troubleshooting ─────────────────────────────────────────────────────

const TROUBLE: readonly [string, React.ReactNode][] = [
  [
    "The run form will not start.",
    "It names the reason under the sources. Most often a source is not connected — open it from Sources and connect it — or both sides are the same source. A synthetic run needs two synthetic sources.",
  ],
  [
    "“No API key” for a model provider.",
    "Set ANTHROPIC_API_KEY or GEMINI_API_KEY in engine/.env and restart the engine. Until then the run resolves only what rules decide and escalates the rest.",
  ],
  [
    "The run completed but says degraded.",
    "Some model calls returned no answer. The note on the run names the first error. A rate limit clears by re-running with more headroom or a lower CANON_MODEL_CONCURRENCY; a rejected key or empty balance needs fixing first.",
  ],
  [
    "A synthetic run failed at extract with “dataset … is not on the engine's disk”.",
    "The source names a dataset the engine does not have. Generate it under Sources → Datasets, or edit the source to point at one that exists.",
  ],
  [
    "Almost everything escalated.",
    "Expected for severity 3 and 4 — ownership and structure are never auto-applied. Otherwise check the ruleset covers the fields that disagree, and that a model key is configured for the fields it does not.",
  ],
  [
    "The run is stuck on queued.",
    "The console could not reach the engine, or the engine is not running. Check ENGINE_URL and that the engine responds on /health.",
  ],
];

function Troubleshooting() {
  return (
    <DocSection id="troubleshooting" title="Troubleshooting">
      <dl className="flex max-w-[760px] flex-col border-t border-hairline">
        {TROUBLE.map(([question, answer]) => (
          <div key={question} className="border-b border-hairline py-3">
            <dt className="text-body font-medium text-g-900">{question}</dt>
            <dd className="mt-1 text-body text-g-700">{answer}</dd>
          </div>
        ))}
      </dl>
    </DocSection>
  );
}

// ── 13 · Glossary ────────────────────────────────────────────────────────────

function Glossary() {
  const entries = Object.values(TERM_HELP).sort((a, b) => a.term.localeCompare(b.term));

  return (
    <DocSection
      id="glossary"
      title="Glossary"
      lead="The same definitions the console shows when you hover or focus a dotted term or a ? mark."
    >
      <dl className="grid max-w-[880px] grid-cols-1 border-t border-hairline md:grid-cols-[220px_1fr]">
        {entries.map((entry) => (
          <div key={entry.term} className="contents">
            <dt className="border-b border-hairline py-2.5 pr-4 text-body font-medium text-g-900">
              {entry.term}
            </dt>
            <dd className="border-b border-hairline py-2.5 text-body text-g-700 md:pl-0">
              {entry.text}
            </dd>
          </div>
        ))}
      </dl>
    </DocSection>
  );
}
