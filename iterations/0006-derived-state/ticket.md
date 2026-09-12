---
id: 0006
type: feature
goal: Implement adr/0005 — derive iteration closure from merge history, make cockpit/data.js a build output, delete the scribe; publish the cockpit from main via GitHub Pages.
constraint: each exercised criterion must not decrease against its last recorded score (baseline: iterations/0005-lint-gate/scores.json)
adr_refs: [0005]
---

## Scope

- `manifest-of-iterations.json`: drop `status`; `scores-check` rejects it as
  a legacy field and enforces baseline order on the derived value
  (`lib.ts#iterationStatus` = first-parent merge touching `iterations/<id>/`)
- `cockpit-report.ts`: derives status from git; `--check` = "generates from
  the current tree", writes nothing; `cockpit/data.js` gitignored and
  removed from the index; `npm run build` generates it
- Delete `checks/scribe.ts` + `.github/workflows/scribe.yml`; remove the
  `pull_request` deferral from `scores-check`
- `manifest-sync`: on `pull_request` runs a missing merge trace for a status
  transition is *pending merge* (passes); `check.yml` runs on `main` pushes
  and PRs only
- `.github/workflows/pages.yml`: build + deploy `cockpit/` from `main`
- Selftest: replace stored-closure / stale-data.js cases with derived-status,
  out-of-order-merge, legacy-field, and PR-deferral cases
- README + skills (`adr-author`, `cockpit-report`, `iteration-scaffold`,
  `rubric-judge`, `manifest-sync`) updated; adr/0005 accepted in this PR

## Out of scope

- Deriving `baseline` from `git merge-base` (noted in adr/0005 Consequences)
- Cockpit renderer changes — inputs are unchanged

## Affected criteria

adr-traceability (deterministic); cockpit-clarity and loop-closure not
exercised.
