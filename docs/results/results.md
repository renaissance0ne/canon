# Canon — evaluation results

Seed `42` · dataset `data\run42`
Resolution model `gpt-4.1-mini-2025-04-14` (`azure_openai`)

Regenerate with:

```bash
uv run python -m eval.generate --seed 42 --accounts 500 --out data\run42
uv run python -m eval.harness --seed 42 --provider azure_openai --systems all --report
```

## Systems

`baseline_exact` is the floor: exact matching, no normalization.
`baseline_rules` shares the entire detection path with `canon_full` and
differs only in that no model is called — whatever separates the two is
attributable to the agent.

| metric | baseline_exact | baseline_rules | canon_full |
|---|---|---|---|
| precision | 0.938 | 1.000 | 1.000 |
| recall | 0.938 | 1.000 | 1.000 |
| F1 | 0.938 | 1.000 | 1.000 |
| resolution accuracy | 0.000 | 1.000 | 1.000 |
| **false auto-apply rate** | 0.000 | 0.000 | 0.000 |
| escalation rate | 0.000 | 0.625 | 0.587 |
| escalation precision | 0.000 | 0.100 | 0.107 |
| conflicts detected | 208 | 208 | 208 |
| true positives | 195 | 208 | 208 |
| false positives | 13 | 0 | 0 |
| false negatives | 13 | 0 | 0 |
| auto-applied | 0 | 78 | 86 |
| escalated | 0 | 130 | 122 |
| model calls | 0 | 0 | 69 |
| tokens | 0 | 0 | 70727 |
| USD / 1k conflicts | 0.00 | 0.00 | 0.17 |

## Ablation 1 — without the `validate` node

`validate` rejects any proposed value that is not one of the two observed
values or a legal normalization of one. Removing it changes nothing about
what the model is asked; it changes only whether the answer is checked.

**Invented values produced with the node removed: 0.**
With the node in place the count is zero by construction.

| metric | no_validate |
|---|---|
| precision | 1.000 |
| recall | 1.000 |
| F1 | 1.000 |
| resolution accuracy | 1.000 |
| **false auto-apply rate** | 0.000 |
| escalation rate | 0.587 |
| escalation precision | 0.107 |

## Ablation 2 — auto-apply threshold sweep

The precision/recall tradeoff curve for the whole system. Every point
reuses the same proposals — moving the gate re-derives which side of it
each answer falls on, so the sweep costs no additional tokens.

![Auto-apply threshold sweep](threshold-sweep.png)

| threshold | false auto-apply | escalation rate | resolution accuracy |
|---|---|---|---|
| 0.50 | 0.000 | 0.587 | 1.000 |
| 0.55 | 0.000 | 0.587 | 1.000 |
| 0.60 | 0.000 | 0.587 | 1.000 |
| 0.65 | 0.000 | 0.587 | 1.000 |
| 0.70 | 0.000 | 0.587 | 1.000 |
| 0.75 | 0.000 | 0.587 | 1.000 |
| 0.80 | 0.000 | 0.587 | 1.000 |
| 0.85 | 0.000 | 0.587 | 1.000 |
| 0.90 | 0.000 | 0.587 | 1.000 |
| 0.95 | 0.000 | 0.587 | 1.000 |

## Detection quality

![Detection precision, recall and F1](detection.png)
