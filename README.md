# Teddy

**T**ypeScript **E**val-**D**riven **D**evelopment + **Y**.

A self-hosted, eval-driven development harness for TypeScript projects. Teddy codifies
project behavior in three linked layers and enforces the links mechanically — and it is
self-hosted: its first project is itself, including its own cockpit dashboard.

## The three layers

1. **ADRs** (`adr/`) — numbered Markdown decisions with a human-approval-gated lifecycle
   (`proposed → accepted → deprecated | superseded`). Since adr/0003 the approval **is the
   merge**: status transitions land inside PRs and GitHub records who merged; nothing under
   `adr/` is ever auto-merged.
2. **Deterministic assertions** (`checks/`) — reproducible checks tied to specific ADRs,
   plus the lint gate. Binary pass/fail. Hard gate: they must pass regardless of any score.
3. **Rubric criteria** (`rubrics/rubric.ts`) — weighted, human-defined criteria. Each
   carries deterministic evidence — *gates* (binary, hard) and *signals* (numeric,
   thresholded) — and, where a judgment remains, *anchors* an LLM judge scores against
   (adr/0006). Judge/human disagreements resolve into ADR amendments or promoted
   assertions, shrinking the judge's surface over time.

`manifest.json` is the single source of truth linking `adr → assertions → criteria`.
Orphaned ADRs *and* orphaned assertions are failures.

## The loop

```
ticket → branch → implement → deterministic gates (hard) → rubric-judge scores
      → CI re-runs the recorded evidence (gates, signals) and bounds llm scores by it
      → per-criterion non-regression vs last recorded score (fails closed)
      → human merges — merge = approval (adr/0003); the merge commit *is* the
        closure, nothing is written (adr/0005) → new baseline
```

Per iteration (`iterations/NNNN-slug/`): a `ticket.md` and a `scores.json` snapshot.
The PR that landed it is read off the merge commit, never stored (adr/0005).
`null` scores mean "not exercised this iteration" and are excluded from the weighted
average. `overall` is precomputed — the cockpit stays a static reader.

```
overall = Σ(weightᵢ × scoreᵢ) / Σ(weightᵢ)   over non-null criteria
```

The baseline gate is **per-criterion** (adr/0001, amended; adr/0006): a
`judge: "none"` score and a `ratchet` signal may never decrease against their
last recorded value; a `judge: "llm"` score may drop by at most the rubric's
`tolerance`. `overall` is the reported trend, not the gate — aggregates let one
big gain mask a regression.

The **LLM judge runs locally, never in CI**. CI verifies what can be verified:
every open iteration's gates and signals are re-run and must agree with what
`scores.json` records; an llm score is capped at 0.5 when its evidence was
skipped, or when it has no evidence and cites no file. Whether 0.7 should have
been 0.5 is the reviewer's call at merge.

## Quickstart

Requires Node ≥ 23.6 (checks run on Node's native type-stripping; no build step for checks).

```sh
npm install
npm test          # lint + typecheck + selftest + all deterministic gates
npm run lint      # the lint gate alone (detects the declared linter, adr/0004)
npm run typecheck # the typecheck gate (detects typescript → local tsc)
npm run report    # generate cockpit/data.js from manifests + scores + merge history
npm run build     # cockpit/data.js + tsc → cockpit/main.js
open cockpit/index.html
```

`cockpit/data.js` and `cockpit/main.js` are build outputs and not committed
(adr/0005); `main` is published to GitHub Pages by `.github/workflows/pages.yml`.

## Repo tour

```
adr/                        decision records (merge = approval, adr/0003)
rubrics/rubric.ts           typed rubric: criteria with gates, signals, judge, anchors
checks/                     deterministic assertions + adapters (--json contract, adr/0006)
  manifest-sync.ts          traceability gate + merge-as-approval lifecycle gate
  scores-check.ts           scores schema, evidence verification, per-criterion baseline gate
  cockpit-report.ts         generates cockpit/data.js (closure derived from git, adr/0005)
  lint.ts                   gate: the linter declared in package.json (adr/0004)
  typecheck.ts              gate: tsc --noEmit when typescript is declared
  test.ts                   gate: vitest / jest / mocha, or node --test over test files
  coverage.ts               signals: total + changed_lines from the runner's coverage output
  selftest.ts               verifies the checks themselves (fail + pass paths)
  lib.ts                    shared types, rubric loader, check runner, aggregation
manifest.json               SSOT: adr → assertions → criteria
manifest-of-iterations.json iteration registry (id, ticket, scores, baseline — no status)
iterations/NNNN-slug/       ticket.md + scores.json per iteration
cockpit/                    static dashboard (vanilla TS, no framework, no server)
skills/                     agent skills: adr-author, rubric-judge, manifest-sync,
                            iteration-scaffold, cockpit-report
.github/                    CI gate + pages publish + CODEOWNERS
```

## GitHub gates (setup)

Approval is GitHub-native (adr/0003): **merge = approval**. Teddy prescribes
the mechanism; each team configures the strictness to its trust level:

1. **CODEOWNERS** (`.github/CODEOWNERS`) — owner review is auto-requested;
   `/adr/` is owned.
2. **Ruleset on `main`** (Settings → Rules → Rulesets → New ruleset):
   *Require a pull request before merging* (no direct pushes), *Dismiss stale
   reviews*, *Require review from Code Owners*. Required approval counts,
   reviewer sets, and bypass lists are the team's call.
3. **Nothing writes derived state** (adr/0005). An iteration is *closed*
   iff a merge commit touches `iterations/<id>/` — the checks and the
   cockpit report derive it from `git log` on whatever ref they run against.
   No scribe, no bot commits, no ruleset bypass. A PR that carries an ADR
   status transition passes the gate on `pull_request` runs with the trace
   *pending*; the merge realizes it and `main` reconciles.

Trust boundary (adr/0003): actors with owner permissions are indistinguishable
from humans. Teams wanting less-privileged agents run them on dedicated
accounts; agents must never merge.

## Status

ADRs 0001–0006 accepted; iterations 0001–0008 closed. Iteration 0008
(adr/0006) moved the rubric to a typed TS module with gates, signals and
anchors, made `scores.json` carry verifiable evidence, and added the
`typecheck`, `test` and `coverage` adapters. Next: `checks/judge.ts`
(local LLM judge), then the host-project criteria.
