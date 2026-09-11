---
id: 0005
status: proposed
supersedes: null
superseded_by: null
rubric_refs: [cockpit-surface]
---

# 0005 — Shrinking the Judge Surface: the `cockpit-surface` Criterion

## Context

Rubric audit. Of the criteria, one is deterministic (`adr-traceability` via
`checks/manifest-sync.ts`); `cockpit-clarity` and `loop-closure` are
LLM-judged — a judge surface of 1/3.

`cockpit-clarity` conflates two different claims:

- a **structural** one — the dashboard surfaces the score trend, ADR
  statuses, and the judge/deterministic ratio on a single page, reading
  nothing but the precomputed data file;
- a **subjective** one — that the result is actually clear and legible.

Only the structural claim can be verified without judgment. Everything it
names is a fact about `cockpit/data.js`, `cockpit/index.html`, and
`cockpit/main.ts`.

`loop-closure`, by contrast, is a **process property**: whether a
judge/human disagreement arose and was resolved structurally within one
iteration. Nothing in the repository distinguishes "no disagreement" from
"unnoticed disagreement"; any offline proxy would check structure while
claiming to check resolution — a fake gate.

## Decision

1. **New criterion `cockpit-surface`** (weight 2, judge:
   `checks/cockpit-surface.ts` — deterministic). The assertion verifies the
   actual artifacts, offline, no DOM:
   - `cockpit/data.js` parses as the precomputed payload and carries the
     three surfaces: per-iteration `overall` in [0, 1] (trend),
     `adrs[].status` in the ADR lifecycle (status), and per-iteration
     `judge_surface {deterministic ≤ total, total ≥ 1}` (ratio);
   - `cockpit/index.html` has exactly one `#app` root and loads exactly the
     two committed scripts (`data.js`, `main.js`) — one page, no build;
   - `cockpit/main.ts` pins the structure: single data source
     (`__TEDDY_DATA__`), trend chart (`lineChart` over `overall`), status
     rendering, ratio rendering, and no navigation away from the page.
2. **`cockpit-clarity` stays LLM-judged** (weight 1), narrowed to the
   subjective residue: legibility and visual quality beyond the structural
   surface that `cockpit-surface` now pins.
3. **`loop-closure` stays LLM-judged** — the honest floor of this promotion
   round. Its enforcement is already partly structural: merge-trace and the
   per-criterion non-regression gate make hand-lowered scores impossible,
   so a disagreement *can* only resolve into an ADR amendment or a promoted
   assertion. What remains judged is whether a disagreement happened at all.

## Consequences

- Judge surface: 1/3 → 2/4 deterministic criteria; an iteration that does
  not touch subjective clarity can record a fully deterministic surface.
- The check pins Teddy's own cockpit structure; downstream projects adapt
  it to their dashboard (it is part of the harness they copy).
- Renames or refactors that break a pinned token fail the gate loudly — a
  conscious re-pin, not a silent regression.

## Rejected Alternatives

- **Flip `cockpit-clarity`'s judge to a script** — historical snapshots were
  LLM-judged; migrating them falsifies the shrinking-judge-surface trend the
  cockpit plots, and teaching `scores-check` about rubric history adds a
  time dimension the data model does not have.
- **Promote `loop-closure`** — no offline signal for "a disagreement
  occurred"; the check would assert structure, not resolution.
- **Headless-browser rendering check** — a browser toolchain in the gate for
  marginal certainty; the static structure pin plus the precomputed-data
  contract is the honest 80%.
