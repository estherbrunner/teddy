# Teddy

**T**ypeScript **E**val-**D**riven **D**evelopment + **Y**.

A self-hosted, eval-driven development harness for TypeScript projects. Teddy codifies
project behavior in three linked layers and enforces the links mechanically — and it is
self-hosted: its first project is itself, including its own cockpit dashboard.

## The three layers

1. **ADRs** (`adr/`) — numbered Markdown decisions with a human-approval-gated lifecycle
   (`proposed → accepted → deprecated | superseded`). No status transition without a human
   approver; nothing under `adr/` is ever auto-merged.
2. **Deterministic assertions** (`checks/`) — reproducible checks tied to specific ADRs.
   Binary pass/fail. Hard gate: they must pass regardless of any score.
3. **Rubric criteria** (`rubrics/rubric.yaml`) — weighted, human-defined criteria scored by
   LLM-as-judge where deterministic checks aren't (yet) possible. Judge/human disagreements
   resolve into ADR amendments or promoted assertions, shrinking the judge's surface over time.

`manifest.json` is the single source of truth linking `adr → assertions → criteria`.
Orphaned ADRs *and* orphaned assertions are failures.

## The loop

```
ticket → branch → implement → deterministic gates (hard) → rubric-judge scores
      → per-criterion non-regression vs last recorded score (fails closed)
      → PR with scores diff → human merges (sets approved_by) → new baseline
      → cockpit updates
```

Per iteration (`iterations/NNNN-slug/`): a `ticket.md` and a `scores.json` snapshot.
`null` scores mean "not exercised this iteration" and are excluded from the weighted
average. `overall` is precomputed — the cockpit stays a static reader.

```
overall = Σ(weightᵢ × scoreᵢ) / Σ(weightᵢ)   over non-null criteria
```

The baseline gate is **per-criterion**: a criterion's score may never decrease
against its last recorded value (adr/0001, amended by iteration 0003). `overall`
is the reported trend, not the gate — aggregates let one big gain mask a
regression.

## Quickstart

Requires Node ≥ 23.6 (checks run on Node's native type-stripping; no build step for checks).

```sh
npm install
npm test          # selftest + all deterministic gates + typecheck
npm run report    # regenerate cockpit/data.js from manifests + scores
npm run build     # tsc → cockpit/main.js
open cockpit/index.html
```

## Repo tour

```
adr/                        decision records (human-gated lifecycle)
rubrics/rubric.yaml         weighted criteria + per-ADR criterion links
checks/                     deterministic assertions (zero runtime deps)
  manifest-sync.ts          traceability gate + human-approval lifecycle gate
  scores-check.ts           scores schema + baseline gate
  cockpit-report.ts         regenerates/verifies cockpit/data.js
  selftest.ts               verifies the checks themselves (fail + pass paths)
  lib.ts                    shared parsing/aggregation
manifest.json               SSOT: adr → assertions → criteria
manifest-of-iterations.json iteration registry
iterations/NNNN-slug/       ticket.md + scores.json per iteration
cockpit/                    static dashboard (vanilla TS, no framework, no server)
skills/                     agent skills: adr-author, rubric-judge, manifest-sync,
                            iteration-scaffold, cockpit-report
```

## Status

ADRs 0001 and 0002 accepted by estherbrunner (2026-09-11). Iteration 0003
(`loop-closure`) is the first exercise of the disagreement-resolution loop:
the baseline-gate comparability defect flagged during bootstrap review is being
resolved into an adr/0001 amendment promoted to a deterministic assertion.
