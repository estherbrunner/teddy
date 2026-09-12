---
id: 0008
type: feature
goal: Implement adr/0006 — rubric v2 as a typed TS module with gates, signals, judge and anchors; evidence recorded in scores.json and verified by scores-check; typecheck/test/coverage adapters; tolerance and ratchet non-regression.
constraint: each exercised criterion must not decrease against its last recorded score (baseline: iterations/0007-derived-pr-link/scores.json)
adr_refs: [0006]
---

## Scope

- `rubrics/rubric.ts` replaces `rubrics/rubric.yaml`; `lib.ts` exports the
  `Rubric` types, `loadRubric` (dynamic import + `validateRubric`), and the
  import restriction `manifest-sync` enforces; the YAML parser is deleted
- Check contract: `--json` → `{id, verdict, signals}`; `lib.ts#runCheck`,
  `emitResult`, adapter helpers (`declaredDeps`, `localBin`, `runTool`)
- Adapters: `lint` (now `--json`), `typecheck` (tsc), `test` (vitest / jest /
  mocha / `node --test` fallback with explicit files), `coverage`
  (json-summary `total`, lcov ∩ merge-base diff `changed_lines`)
- `scores.json` v2: per-criterion `gates` and `signals`; `scores-check`
  validates them against the rubric, re-runs evidence for open iterations,
  enforces evidence bounds, judge-`none` scoring rules, llm tolerance, and
  ratchet signals; iterations 0001–0007 migrated in place
- `manifest-sync`: gates/signals must resolve to `checks/<id>.ts`; rubric
  import restriction
- `cockpit-report`: criteria carry gates/signals; judge surface is
  weight-based; tolerance exported
- Selftest cases for the above; README + skills; adr/0006 accepted

## Out of scope

- `checks/judge.ts` (iteration 0009)
- Host-project criteria (correctness, security, …) — they follow the
  adapters they need
- Deriving `baseline` from the merge base

## Affected criteria

adr-traceability (deterministic — now gated by manifest-sync, selftest,
typecheck, lint); cockpit-clarity not exercised (renderer unchanged);
loop-closure not exercised.
