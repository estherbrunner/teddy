---
id: 0006
type: feature
goal: Implement adr/0005 — promote the structural half of cockpit-clarity into the deterministic cockpit-surface criterion (checks/cockpit-surface.ts), narrow cockpit-clarity to the subjective residue, and record why loop-closure stays LLM-judged.
constraint: each exercised criterion must not decrease against its last recorded score (baseline: iterations/0005-lint-gate/scores.json)
adr_refs: [0005]
pr: https://github.com/estherbrunner/teddy/pull/7
---

## Scope

- `checks/cockpit-surface.ts`: deterministic judge verifying the cockpit's
  three surfaces (trend, ADR status, judge/deterministic ratio) across the
  actual artifacts — data.js payload contract, single `#app` page with the
  two committed scripts, main.ts structural pins, no navigation
- Selftest cases: valid cockpit tree, missing ratio, broken root count,
  out-of-range overall, navigation — offline fixtures, no DOM
- rubric.yaml: add `cockpit-surface` (weight 2, deterministic); narrow the
  `cockpit-clarity` description to the subjective residue (judged llm,
  unchanged)
- README repo tour + status refresh

## Out of scope

- Promoting `loop-closure` (adr/0005: no offline signal — honest floor)
- Any visual change to the cockpit itself

## Affected criteria

adr-traceability (new ADR + linked assertion), cockpit-surface (first
exercise, scored by its own script); cockpit-clarity and loop-closure not
exercised.
