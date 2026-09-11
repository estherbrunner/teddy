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
3. **Rubric criteria** (`rubrics/rubric.yaml`) — weighted, human-defined criteria scored by
   LLM-as-judge where deterministic checks aren't (yet) possible. Judge/human disagreements
   resolve into ADR amendments or promoted assertions, shrinking the judge's surface over time.

`manifest.json` is the single source of truth linking `adr → assertions → criteria`.
Orphaned ADRs *and* orphaned assertions are failures.

## The loop

```
ticket → branch → implement → deterministic gates (hard) → rubric-judge scores
      → per-criterion non-regression vs last recorded score (fails closed)
      → scribe closes the iteration on the branch once gates are green
      → human merges — merge = approval, carrying the closure (adr/0003) → new baseline
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
npm test          # lint + selftest + all deterministic gates + typecheck
npm run lint      # the lint gate alone (detects the declared linter, adr/0004)
npm run report    # regenerate cockpit/data.js from manifests + scores
npm run build     # tsc → cockpit/main.js
open cockpit/index.html
```

## Repo tour

```
adr/                        decision records (merge = approval, adr/0003)
rubrics/rubric.yaml         weighted criteria + per-ADR criterion links
checks/                     deterministic assertions
  manifest-sync.ts          traceability gate + merge-as-approval lifecycle gate
  scores-check.ts           scores schema + per-criterion baseline gate
  cockpit-report.ts         regenerates/verifies cockpit/data.js
  scribe.ts                 the one writer of derived state — runs in CI on the iteration PR
  lint.ts                   lint gate: runs the linter declared in package.json (adr/0004)
  selftest.ts               verifies the checks themselves (fail + pass paths)
  lib.ts                    shared parsing/aggregation
manifest.json               SSOT: adr → assertions → criteria
manifest-of-iterations.json iteration registry (closure written by the scribe)
iterations/NNNN-slug/       ticket.md + scores.json per iteration
cockpit/                    static dashboard (vanilla TS, no framework, no server)
skills/                     agent skills: adr-author, rubric-judge, manifest-sync,
                            iteration-scaffold, cockpit-report
.github/                    CI gate + scribe workflow + CODEOWNERS
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
3. **Scribe** (`.github/workflows/scribe.yml`) — runs on `iteration/*` PRs:
   once the gates are green it closes the iteration in the registry and
   regenerates `cockpit/data.js` **on the branch**, so the merge itself
   carries the derived state. It is the only writer of derived state — no
   ruleset bypass, no PAT, no post-merge push.

Trust boundary (adr/0003): actors with owner permissions are indistinguishable
from humans. Teams wanting less-privileged agents run them on dedicated
accounts; agents must never merge.

## Status

ADRs 0001–0004 accepted; iterations 0001–0005 closed. PR #4 merged the
lint gate (adr/0004): `npm run lint` detects the linter declared in
`package.json` — Biome, ESLint, oxlint, standard, xo — and runs it from its
lockfile-pinned local install; Teddy itself adopts Biome.
