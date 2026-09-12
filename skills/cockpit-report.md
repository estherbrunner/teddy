---
name: cockpit-report
description: Use after any change to scores.json, manifest.json, manifest-of-iterations.json, or rubric.ts — regenerating and verifying the static cockpit data file.
---

# cockpit-report

Generates `cockpit/data.js` from `manifest.json` +
`manifest-of-iterations.json` + `iterations/*/scores.json` + `rubrics/rubric.ts`
+ merge history (iteration `status` is derived from `git log`, adr/0005).
All aggregation lives in the generator (`checks/cockpit-report.ts`); the cockpit
renders `window.__TEDDY_DATA__` and computes nothing — that split is adr/0001.

## Run it

```sh
npm run report                              # generate cockpit/data.js (gitignored)
node checks/cockpit-report.ts --check       # exit 1 if generation fails (CI runs this)
```

`data.js` is a build output, never committed: it is exactly as fresh as the
ref it was generated from. `main` is published by `.github/workflows/pages.yml`;
locally, `npm run report` then open `cockpit/index.html` as `file://`.

## Reading it

`data.js` contains, per iteration: `overall`, per-criterion scores/rationales,
and `judge_surface` — the count of non-null criteria scored by a deterministic
judge vs total. The cockpit plots `judge_surface.deterministic / total` over
time: the shrinking-judge-surface metric. Judge-only criteria keep it below 1;
a rising line means the loop is promoting judgments into assertions. The
`repository` field (derived from `git remote`) and each iteration's `pr`
(derived from its merge commit subject; `null` while open) power the
deep-links to review/merge PRs — the cockpit renders, GitHub gates (adr/0003).

## Never

- Commit `cockpit/data.js`, or hand-edit it — it is overwritten on every
  generation and ignored by git.
- Store an iteration's `status` anywhere — it is derived from the merge
  commit; `scores-check` rejects the field.
- Move aggregation into `cockpit/main.ts` — that duplicates the formula and
  defeats the "static reader" decision (adr/0001). Change the generator.
