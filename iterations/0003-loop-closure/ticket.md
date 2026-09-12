---
id: 0003
type: decision
goal: Close the loop on the baseline-gate comparability defect flagged during bootstrap review — resolve it into an adr/0001 amendment promoted to a deterministic assertion.
constraint: each exercised criterion must not decrease against its last recorded score (baseline: iterations/0002-cockpit-minimal-scope/scores.json)
adr_refs: [0001]
---

## Disagreement being closed

During bootstrap review the judge flagged (and the human concurred by directing
this iteration) that the gate `new_overall ≥ baseline_overall` is unsound:
`overall` excludes null criteria, so iterations exercising different criteria
sets produce non-comparable aggregates — and a large gain on one criterion can
mask a regression on another. This is exactly the loop-closure fork:
resolve into an ADR amendment and/or a promoted deterministic assertion.

## Scope

- Amend adr/0001: baseline gate becomes paired per-criterion non-regression
  (score ≥ last recorded non-null score for the same criterion in the baseline
  chain); `overall` stays the reported weighted aggregate, no longer gated.
- Promote the amended rule into `checks/scores-check.ts`; extend
  `checks/selftest.ts` with cases proving the old gate's escape now fails.
- Align README + rubric-judge skill wording with the amended semantics.

## Out of scope

- Changing `rubrics/rubric.yaml` (criterion set and weights are untouched)
- Touching historical scores.json snapshots

## Affected criteria

adr-traceability (deterministic), loop-closure (llm — first exercise).
