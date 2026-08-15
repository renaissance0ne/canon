"use client";

import { useCallback, useId, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Field, fieldAria } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { postJson } from "@/lib/api-client";
import {
  AUTO_APPLY_GATE,
  MODEL_PROVIDERS,
  MODEL_PROVIDER_LABEL,
  type EngineProvider,
  type ModelProvider,
} from "@/types/run";
import { SOURCE_KIND_LABEL, SOURCE_KIND_SIDE, type Source } from "@/types/source";
import type { Ruleset } from "@/types/rules";

type Props = {
  sources: Source[];
  rulesets: Ruleset[];
  /**
   * Sources a run could read right now — synthetic ones, plus any real source
   * whose credentials are stored. Passed in rather than derived here because
   * only the server may look at `source_credentials`.
   */
  connectedIds: string[];
  /**
   * What the engine reports it can call, or null when it could not be reached.
   * Null means "offer everything unannotated" — a health probe that timed out
   * is not evidence that a provider is unusable.
   */
  engineProviders: EngineProvider[] | null;
};

/**
 * Wireframe 1e — the only configuration decision a run takes.
 *
 * The spine already shows here: source A on the left, source B on the right,
 * one hairline between them. It is the same anchor as every diff downstream, so
 * by the time a reviewer reaches the conflict queue they have already learned
 * which side is which.
 */
export function NewRunForm({
  sources,
  rulesets,
  connectedIds,
  engineProviders,
}: Props) {
  const router = useRouter();
  const formId = useId();

  const connected = useMemo(() => new Set(connectedIds), [connectedIds]);

  // What the engine said about each provider, by name. Absent when the engine
  // could not be reached — every lookup below treats that as "no opinion"
  // rather than as "unconfigured".
  const engineByProvider = useMemo(
    () => new Map((engineProviders ?? []).map((p) => [p.provider, p])),
    [engineProviders],
  );

  const isUsable = useCallback(
    (provider: ModelProvider) => engineByProvider.get(provider)?.configured !== false,
    [engineByProvider],
  );

  // Runnable sources sort first, so the form opens on a combination that can
  // actually start. Defaulting to an unconnected source means the first thing a
  // reviewer does is click a button that fails.
  const rank = useCallback(
    (source: Source) => (connected.has(source.id) ? 0 : 1),
    [connected],
  );

  const crmCandidates = useMemo(
    () =>
      sources
        .filter((s) => SOURCE_KIND_SIDE[s.kind] !== "warehouse")
        .sort((a, b) => rank(a) - rank(b)),
    [sources, rank],
  );
  const warehouseCandidates = useMemo(
    () =>
      sources
        .filter((s) => SOURCE_KIND_SIDE[s.kind] !== "crm")
        .sort((a, b) => rank(a) - rank(b)),
    [sources, rank],
  );

  const [sourceAId, setSourceAId] = useState(crmCandidates[0]?.id ?? "");
  const [sourceBId, setSourceBId] = useState(
    warehouseCandidates.find((s) => s.id !== crmCandidates[0]?.id)?.id ?? "",
  );
  const [rulesetId, setRulesetId] = useState(
    (rulesets.find((r) => r.isActive) ?? rulesets[0])?.id ?? "",
  );
  // Opens on a provider the engine actually has a key for. Defaulting to one
  // it cannot call means the first thing a reviewer does is start a run that
  // silently resolves nothing the ruleset did not already decide.
  const [modelProvider, setModelProvider] = useState<ModelProvider>(
    () => MODEL_PROVIDERS.find(isUsable) ?? MODEL_PROVIDERS[0],
  );
  const [message, setMessage] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const aId = `${formId}-a`;
  const bId = `${formId}-b`;
  const rulesetFieldId = `${formId}-ruleset`;
  const providerFieldId = `${formId}-provider`;

  const chosenProvider = engineByProvider.get(modelProvider);
  const providerUnconfigured = chosenProvider?.configured === false;

  const sameSource = Boolean(sourceAId) && sourceAId === sourceBId;

  // Every reason a run cannot start, named. A disabled button with no
  // explanation next to it is the thing this whole screen exists to avoid.
  const unconnected = [sourceAId, sourceBId]
    .filter((id) => id && !connected.has(id))
    .map((id) => sources.find((s) => s.id === id))
    .filter((s): s is Source => Boolean(s));

  const onlyOneSynthetic =
    sameSource && sources.filter((s) => s.kind === "synthetic").length === 1;

  const blocked =
    !sourceAId || !sourceBId || !rulesetId
      ? "Choose a source for each side and a ruleset."
      : sameSource
        ? null // the dedicated note below already explains this one
        : unconnected.length > 0
          ? `${unconnected.map((s) => s.name).join(" and ")} ${
              unconnected.length > 1 ? "have" : "has"
            } no stored credentials. Connect ${
              unconnected.length > 1 ? "them" : "it"
            } first, or run against synthetic sources, which need none.`
          : null;

  const ready = Boolean(sourceAId && sourceBId && rulesetId) && !sameSource && !blocked;

  async function start() {
    setMessage(null);
    setStarting(true);

    const result = await postJson<{ runId: string }>("/api/runs", {
      sourceAId,
      sourceBId,
      rulesetId,
      modelProvider,
    });

    if (!result.ok) {
      setStarting(false);
      setMessage(result.message);
      return;
    }

    // The run row exists from here on, whatever the engine did with it. A
    // dispatch that never landed is recorded on the row and shows up as the
    // failed state on this page — not as a toast that a reload would erase.
    router.push(`/runs/${result.data.runId}`);
    router.refresh();
  }

  return (
    <div className="flex max-w-[560px] flex-col gap-6">
      {/* The spine. Fixed 50/50, one hairline, and it never moves. */}
      <div className="grid grid-cols-1 gap-px bg-hairline-strong md:grid-cols-2">
        <div className="bg-surface p-4">
          <Field label="Source A · CRM" htmlFor={aId}>
            <Select
              {...fieldAria(aId, {})}
              value={sourceAId}
              onChange={(event) => setSourceAId(event.target.value)}
            >
              <option value="">Select a system…</option>
              {crmCandidates.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.name} · {SOURCE_KIND_LABEL[source.kind]}
                  {connected.has(source.id) ? "" : " · not connected"}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="bg-surface p-4">
          <Field label="Source B · warehouse" htmlFor={bId}>
            <Select
              {...fieldAria(bId, {})}
              value={sourceBId}
              onChange={(event) => setSourceBId(event.target.value)}
            >
              <option value="">Select a system…</option>
              {warehouseCandidates.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.name} · {SOURCE_KIND_LABEL[source.kind]}
                  {connected.has(source.id) ? "" : " · not connected"}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </div>

      {sameSource ? (
        <p className="border-l-2 border-g-900 pl-3 text-body text-g-900">
          A and B are the same system. Reconciling a source against itself finds
          nothing — every entity matches itself and nothing ever disagrees.
          {onlyOneSynthetic ? (
            <>
              {" "}
              A synthetic reconciliation needs <strong>two</strong> synthetic
              sources: the generated dataset holds both sides, and a run reads
              side A from the first source and side B from the second.{" "}
              <Link href="/sources/new?kind=synthetic" className="underline">
                Add a second synthetic source
              </Link>
              .
            </>
          ) : null}
        </p>
      ) : null}

      {blocked ? (
        <p className="border-l-2 border-g-900 pl-3 text-body text-g-900">{blocked}</p>
      ) : null}

      <Field
        label="Ruleset"
        htmlFor={rulesetFieldId}
        hint="The version this run executes under. Recorded on the run, so it stays reproducible."
      >
        <Select
          {...fieldAria(rulesetFieldId, { hint: true })}
          value={rulesetId}
          onChange={(event) => setRulesetId(event.target.value)}
        >
          <option value="">Select a policy…</option>
          {rulesets.map((ruleset) => (
            <option key={ruleset.id} value={ruleset.id}>
              {ruleset.name} · v{ruleset.version}
              {ruleset.isActive ? " · active" : ""}
            </option>
          ))}
        </Select>
      </Field>

      {/* The one model decision a run takes. Recorded on the run row, so two
          runs are only comparable when this matches — which is why it is a
          choice made before the run and not a setting changed after it. */}
      <Field
        label="Resolution model"
        htmlFor={providerFieldId}
        hint="Resolves the conflicts the ruleset does not decide. Recorded on the run."
      >
        <Select
          {...fieldAria(providerFieldId, { hint: true })}
          value={modelProvider}
          onChange={(event) => setModelProvider(event.target.value as ModelProvider)}
        >
          {MODEL_PROVIDERS.map((provider) => (
            <option key={provider} value={provider}>
              {MODEL_PROVIDER_LABEL[provider]}
              {engineByProvider.get(provider)?.model
                ? ` · ${engineByProvider.get(provider)?.model}`
                : ""}
              {isUsable(provider) ? "" : " · no key configured"}
            </option>
          ))}
        </Select>
      </Field>

      {/* A warning, not a block. A run with no key still resolves everything
          the ruleset decides and escalates the rest, which is a correct run —
          the engine treats a missing key as degradation rather than failure,
          and the console must not claim otherwise. */}
      {providerUnconfigured ? (
        <p className="border-l-2 border-g-900 pl-3 text-body text-g-900">
          The engine has no API key for {MODEL_PROVIDER_LABEL[modelProvider]}, so
          the agent will not run. Rules still resolve what they cover and
          everything else escalates to review — the run is correct, just
          smaller. Set the key in <span className="font-mono text-value">engine/.env</span> to
          enable the agent.
        </p>
      ) : null}

      {/* Read-only, and it says so. The gate lives in engine/agent/graph.py as
          named constants because the evaluation sweeps them; a console that
          could edit them would make two runs at "the same" threshold mean
          different things. */}
      <div className="border border-hairline bg-surface-sunken px-4 py-3">
        <p className="text-label uppercase text-g-500">Auto-apply gate · read-only</p>
        <p className="mt-1 font-mono text-value text-g-900">
          confidence ≥ {AUTO_APPLY_GATE.confidenceThreshold.toFixed(2)}{" "}
          <span className="font-medium">AND</span> severity ≤{" "}
          {AUTO_APPLY_GATE.maxSeverity}
        </p>
        <p className="mt-1.5 max-w-[420px] text-body text-g-500">
          Named constants in the engine. The evaluation sweeps them; the console
          does not edit them. Everything outside the gate escalates to review.
        </p>
      </div>

      {message ? (
        <p role="alert" className="border border-g-900 bg-surface-sunken px-3 py-2 text-body text-g-900">
          {message}
        </p>
      ) : null}

      <div className="flex items-center justify-end gap-2 border-t border-hairline pt-5">
        <Button asChild variant="ghost">
          <Link href="/runs" className="no-underline">
            Cancel
          </Link>
        </Button>
        <Button onClick={start} disabled={!ready || starting} type="button">
          {starting ? "Starting…" : "Start run"}
        </Button>
      </div>
    </div>
  );
}
