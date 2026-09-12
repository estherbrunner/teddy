# Teddy

**T**ypeScript **E**val-**D**riven **D**evelopment + **Y**.

An eval-driven development harness for TypeScript projects, shipped as a package with a
`teddy` CLI (adr/0007). Teddy codifies project behavior in three linked layers and
enforces the links mechanically — and it is self-hosted: its first host is itself,
including its own cockpit dashboard.

## The three layers

1. **ADRs** (`adr/`) — numbered Markdown decisions with a human-approval-gated lifecycle
   (`proposed → accepted → deprecated | superseded`). Since adr/0003 the approval **is the
   merge**: status transitions land inside PRs and GitHub records who merged; nothing under
   `adr/` is ever auto-merged.
2. **Deterministic assertions** — Teddy's built-in checks (`teddy:lint`, `teddy:test`, …)
   and a host's own `checks/*.ts`, tied to specific ADRs. Binary pass/fail. Hard gate: they
   must pass regardless of any score.
3. **Rubric criteria** (`teddy.config.ts`, or Teddy's default rubric) — weighted,
   human-defined criteria. Each
   carries deterministic evidence — *gates* (binary, hard) and *signals* (numeric,
   thresholded) — and, where a judgment remains, *anchors* an LLM judge scores against
   (adr/0006). Judge/human disagreements resolve into ADR amendments or promoted
   assertions, shrinking the judge's surface over time.

ADR frontmatter (`assertions:`, `rubric_refs:`) is the single source linking
`adr → assertions → criteria` (adr/0007). Orphaned ADRs *and* orphaned host checks are
failures.

## The loop

```
ticket → branch → implement → deterministic gates (hard) → rubric-judge scores
      → CI re-runs the recorded evidence (gates, signals) and bounds llm scores by it
      → per-criterion non-regression vs last recorded score (fails closed)
      → human merges — merge = approval (adr/0003); the merge commit *is* the
        closure, nothing is written (adr/0005) → new baseline
```

Per iteration (`iterations/NNNN-slug/`): a `ticket.md` and a `scores.json` of
`timestamp` + `criteria`. Everything else — closure, the PR that landed it, the baseline
it is compared against — is derived from the directory and git, never stored
(adr/0005, adr/0007). `null` scores mean "not exercised this iteration" and are excluded
from the weighted average.

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

## Using Teddy in a project

Requires Node ≥ 23.6 (native type stripping) and TypeScript. Teddy is installed from
git until its defaults have been proven on internal projects (adr/0007):

```sh
npm install -D github:estherbrunner/teddy#main   # pin a tag or commit in real use
npx teddy check                                   # the CI gate
npx teddy report && open cockpit/index.html       # the dashboard (cockpit/ is a build output)
npx teddy lint | typecheck | test | coverage      # the adapters (--json for the check contract)
```

A host needs only `adr/` and `iterations/`; `checks/` for its own checks and
`teddy.config.ts` for overrides are optional:

```ts
import type { Config } from "teddy";
export default {
  dirs: { adr: "docs/decisions" },     // defaults: adr, iterations, checks
  pattern: /^\d{4}-[a-z0-9-]+$/,       // ADR + iteration directory naming
  main: "main",                        // trunk branch
  src: ["src/**"],                     // code under judgment
  rubric: { version: 2, criteria: [/* … */] },   // omit for Teddy's default rubric
} satisfies Config;
```

The config is data: it may import nothing but types. ADRs link their assertions in
frontmatter — `assertions: [checks/my-check.ts, teddy:lint]`.

## Developing Teddy

```sh
npm install
npm test          # lint + typecheck + selftest + teddy check (from source, then from dist/)
npm run check     # node src/cli.ts check
npm run report    # build, then write cockpit/ for this repository
```

`dist/` and `cockpit/` are build outputs (adr/0005, adr/0007); `main` is published to
GitHub Pages by `.github/workflows/pages.yml`.

## Repo tour

```
adr/                        decision records (merge = approval, adr/0003); frontmatter carries links
iterations/NNNN-slug/       ticket.md + scores.json per iteration
teddy.config.ts             Teddy's own config: its rubric (gates, signals, judge, anchors)
checks/selftest.ts          Teddy's own host check: verifies the built-in checks (fail + pass paths)
src/
  cli.ts                    teddy <command> — check | report | <check-id>
  lib.ts                    Config/Rubric types, config loader, derived iterations, git, check runner
  checks/                   built-in checks (--json contract, adr/0006)
    manifest-sync.ts        traceability + merge-as-approval lifecycle gate, config guard
    scores-check.ts         scores schema, evidence verification, per-criterion baseline gate
    lint.ts / typecheck.ts / test.ts / coverage.ts   adapters over the tools a host declares
  commands/report.ts        writes cockpit/ (data.js + dashboard) — closure, PR, baseline from git
  cockpit/                  the static dashboard (index.html + main.ts)
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

ADRs 0001–0007 accepted; iterations 0001–0009 closed. Iteration 0009
(adr/0007) made Teddy a git-installable package with a `teddy` CLI, moved
the rubric into `teddy.config.ts`, and deleted both manifests: iterations,
their closure, PR and baseline are derived from the directory and git; ADR
links live in frontmatter. Next: `teddy judge` (local LLM judge), then
`teddy init` / `teddy new`, then the first internal host.
