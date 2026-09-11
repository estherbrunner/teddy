---
name: cockpit-report
description: Use after any change to scores.json, manifest.json, manifest-of-iterations.json, or rubric.yaml — regenerating and verifying the static cockpit data file.
---

# cockpit-report

Regenerates `cockpit/data.js` from `manifest.json` +
`manifest-of-iterations.json` + `iterations/*/scores.json` + `rubrics/rubric.yaml`.
All aggregation lives in the generator (`checks/cockpit-report.ts`); the cockpit
renders `window.__TEDDY_DATA__` and computes nothing — that split is adr/0001.

## Run it

```sh
npm run report                              # regenerate cockpit/data.js
node checks/cockpit-report.ts --check       # exit 1 if data.js is stale (CI runs this)
```

Run `npm run report` in the same commit that changes any input file, so
`--check` stays green. `data.js` is committed: the cockpit must work from a
fresh clone opened as `file://` with zero build steps.

## Reading it

`data.js` contains, per iteration: `overall`, per-criterion scores/rationales,
and `judge_surface` — the count of non-null criteria scored by a deterministic
judge vs total. The cockpit plots `judge_surface.deterministic / total` over
time: the shrinking-judge-surface metric. Judge-only criteria keep it below 1;
a rising line means the loop is promoting judgments into assertions. The
`repository` field (derived from `git remote`) powers the pending items'
deep-links to review/merge PRs — the cockpit renders, GitHub gates (adr/0003).

## Never

- Hand-edit `cockpit/data.js` — `--check` diffs it against the inputs and will
  reject the drift; regenerate instead.
- Move aggregation into `cockpit/main.ts` — that duplicates the formula and
  defeats the "static reader" decision (adr/0001). Change the generator.
