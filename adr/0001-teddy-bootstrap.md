---
id: 0001
status: accepted
supersedes: null
superseded_by: null
rubric_refs: [adr-traceability]
---

# 0001 — Teddy Bootstrap: Self-Hosted Eval-Driven Development

## Context

Teddy is a TypeScript eval-driven development harness. Project behavior must be
codified and enforced through three linked layers:

1. **ADRs** — numbered Markdown records with a human-approval-gated lifecycle
   (`proposed → accepted → deprecated | superseded`), each stating context,
   decision, and rejected alternatives with brief rationale.
2. **Deterministic assertions** — tests, linters, and other reproducible checks
   tied to specific ADRs. Binary pass/fail gate.
3. **Rubric criteria** — human-defined ranking rubric enabling LLM-as-judge
   scoring where deterministic checks are not (yet) possible.

Teddy is self-hosted: its first project is itself, including its own cockpit
dashboard. The loop closes when judge/human disagreements resolve into either
an ADR amendment or a promoted deterministic assertion, shrinking the judge's
surface area over iterations.

A working harness needs more than the sketch of files: deterministic checks
must be *runnable* (reproducibly, in CI, by agents and humans alike), which
requires a package manifest, a TypeScript config, and a home for check scripts.

## Decision

### Directory layout

```
/teddy
  /adr/                     ADRs; never auto-merged, ever
  /rubrics/rubric.yaml      weighted criteria + per-ADR criterion links
  /checks/                  deterministic assertions (runnable, zero runtime deps)
    manifest-sync.ts        ADR/manifest/rubric traceability gate
    scores-check.ts         scores.json schema + baseline gate
    cockpit-report.ts       regenerates/verifies cockpit/data.js
    selftest.ts             verifies the checks themselves fail and pass correctly
    lib.ts                  shared frontmatter/rubric parsing + aggregation
  /manifest.json            SSOT: adr → [assertions] → [criteria]
  /manifest-of-iterations.json
  /iterations/NNNN-slug/    ticket.md + scores.json per iteration
  /cockpit/                 static dashboard: index.html, main.ts, generated data.js + main.js
  /skills/                  agent skills (markdown playbooks for this repo's workflow)
  /.github/workflows        CI running the deterministic gate
```

### ADR frontmatter and lifecycle gate

```yaml
id: 0007
status: proposed   # proposed | accepted | deprecated | superseded
supersedes: null
superseded_by: null
rubric_refs: [criterion-id, ...]
```

Status transitions are structurally gated: the `manifest-sync` check rejects
any status other than `proposed` that does not trace to a true merge commit
touching the ADR file — merge = approval (amended by adr/0003; the original
`approved_by` field is gone). No auto-merge on files under `/adr/`, ever.

### manifest.json

Single source of truth linking `adr_id → [assertion files] → [rubric criterion
ids]`. Status fields are synced from ADR frontmatter by `manifest-sync`.
Every `accepted` ADR must resolve to ≥1 linked assertion or rubric criterion;
orphaned ADRs **and** orphaned assertions are failures. (Orphan rule for
assertions: every `checks/*.ts` except the shared `lib.ts` must be linked from
≥1 ADR — plumbing is exempt, checks are not.)

### scores.json and aggregation

```json
{
  "iteration": "0002-cockpit-minimal-scope",
  "ticket": "0002",
  "baseline": "0001-teddy-bootstrap",
  "timestamp": "2026-09-11T10:00:00Z",
  "criteria": {
    "adr-traceability": { "score": 1, "judge": "manifest-sync", "rationale": "…" }
  },
  "overall": 0.87,
  "deterministic_gate": "pass"
}
```

- `null` score = criterion not exercised this iteration; excluded from the
  weighted average (not treated as 0).
- `overall` is precomputed and stored — the cockpit stays a static reader, no
  aggregation logic duplicated in TS.
- Closure is scribe-owned: a post-merge workflow flips the registry and
  regenerates the cockpit data when the iteration's PR merges (amended by
  adr/0003; the original `approved_by` field is gone).

```
score_overall = Σ(weight_i × score_i) / Σ(weight_i)   [over non-null criteria]
```

Deterministic assertions outside the rubric (raw test/lint pass) are a separate
binary gate — they must pass regardless of weighted score.

### Tickets

One per iteration, required frontmatter: `id`, `type` (`feature | bugfix |
skill | decision | refactor`), `goal`, `constraint` (score must not decrease
against the named baseline), `adr_refs`, `pr` (filled on open). One PR per
ticket — score deltas stay attributable; no squash-merging multiple concerns.

### Iteration workflow

1. Ticket opened (`iteration-scaffold`) → branch created.
2. Agent implements change.
3. Deterministic assertions run — fast, cheap, block on fail (hard gate, not
   part of the weighted average).
4. `rubric-judge` scores affected criteria → weighted aggregate computed via
   `rubric.yaml` weights.
5. Gate: per-criterion non-regression (amended — see Amendment below; the
   bootstrap rule `new_overall ≥ baseline_overall` was unsound). Fails closed.
6. PR opened with `scores.json` diff attached.
7. Human merges — the merge is the approval → scribe closes the iteration and
   refreshes the cockpit → new baseline.
8. Repeated judge/human disagreement on a criterion → ADR amendment or
   promotion of that criterion to a deterministic assertion.

### Tooling choices

- Checks are plain TypeScript executed directly by Node (native type-stripping,
  erasable syntax only) — zero runtime dependencies, reproducible anywhere
  Node ≥ 23.6 runs.
- Only dev dependency of consequence is `typescript` (cockpit build: `tsc` →
  single `main.js`; all cockpit logic lives in one `main.ts`).
- The cockpit reads a precomputed `cockpit/data.js` (`window.__TEDDY_DATA__`)
  so it works from `file://` with no server and no fetch/CORS machinery.

## Rejected Alternatives

- **Pure test-coverage metrics as the eval** — measures structural coverage,
  not behavior; cannot rank two acceptable implementations or capture qualities
  like clarity. Kept as a complementary binary gate, not the score.
- **Unstructured decision log (no ADR schema)** — decisions without IDs,
  statuses, and approval gates cannot be linked to assertions or scored; the
  traceability criterion would be unauditable.
- **Off-the-shelf eval frameworks** — Teddy's purpose is to codify its own
  loop; adopting an external runner would hide the schema the loop depends on
  and defeat the self-hosting dogfood. May be revisited via a new ADR.
- **LLM-judge for everything** — non-reproducible and expensive for properties
  that are mechanically checkable; judge surface must shrink, not start maximal.
- **Deterministic checks for everything** — clarity and loop-closure are not
  mechanically checkable today; pretending otherwise produces brittle proxies.
- **Cockpit fetching JSON at runtime** — `fetch` of local files fails under
  `file://`; a precomputed `data.js` script keeps the "no server" guarantee.

## Amendment — paired per-criterion baseline gate (iteration 0003)

The bootstrap gate `new_overall ≥ baseline_overall` is replaced by a paired
per-criterion non-regression gate. This amendment originated in the loop the
harness exists to close: the judge flagged the defect during bootstrap review,
the human concurred by opening iteration 0003, and the resolution is both an
ADR amendment and a promotion of the rule into a deterministic assertion.

- **Defect.** `overall` excludes null criteria, so iterations exercising
  different criteria sets produce non-comparable aggregates (an honest 0.93
  across three criteria "loses" to 1.0 over one). Worse, a single large gain
  elsewhere can mask a regression — the aggregate is exactly where regressions
  hide.
- **New rule.** Every non-null criterion in a new iteration must be ≥ the last
  recorded non-null score for that same criterion, walking the baseline chain
  backward. A criterion exercised for the first time has no prior and passes.
  `overall` remains the weighted aggregate over non-null criteria — reported
  for trend, no longer gated.
- **Enforcement.** `checks/scores-check.ts` implements the chain walk;
  `checks/selftest.ts` proves the old gate's escape (an expanded criteria set
  with an honest 0 on the new criterion) now passes, and that compensated
  regressions — this criterion down while another improves — still fail.

### Rejected alternatives (amendment)

- **Require every criterion exercised every iteration** — honest "not
  exercised" nulls are legitimate (cockpit-clarity before a cockpit exists);
  forcing numbers fabricates data.
- **Intersect-based overall comparison** — still an aggregate, still maskable,
  and harder to state than "this criterion may not go down".
- **Carry baseline scores forward for null criteria** — fabricates evidence
  and defeats per-iteration scoring.
