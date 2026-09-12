---
name: cockpit-report
description: Use when generating or verifying the static cockpit — `teddy report` writes cockpit/ from ADR frontmatter, iterations/*/scores.json, the rubric, and git-derived status/PR/baseline.
---

# cockpit-report

`teddy report` writes `<root>/cockpit/` — `data.js` (`window.__TEDDY_DATA__`),
`index.html`, `main.js` — from ADR frontmatter + `iterations/*/scores.json` +
the rubric + git (iteration status, PR and baseline are derived, adr/0005,
adr/0007). All aggregation, including `overall`, happens in the generator
(`src/commands/report.ts`); the cockpit renders and computes nothing — that
split is adr/0001.

## Run it

```sh
teddy report                # write cockpit/ (gitignored)
teddy report --check        # exit 1 if generation fails; writes nothing (part of `teddy check`)
```

In this repository: `npm run report` (builds first, so the dashboard script
exists) then open `cockpit/index.html` as `file://`. `main` is published by
`.github/workflows/pages.yml`.

## Reading it

`data.js` contains, per iteration: `status`, `pr`, `baseline` (all derived),
`overall`, per-criterion scores/rationales/evidence, and `judge_surface` —
the weight on exercised criteria scored deterministically (judge `"none"`)
over exercised weight. The cockpit plots that ratio over time: the
shrinking-judge-surface metric. A rising line means the loop is promoting
judgments into gates and signals.

## Never

- Commit `cockpit/`, or hand-edit anything in it — it is overwritten on every
  generation and ignored by git.
- Store an iteration's `status`, `pr`, `baseline`, or `overall` anywhere —
  they are derived; `scores-check` rejects the fields.
- Move aggregation into `src/cockpit/main.ts` — that duplicates the formula and
  defeats the "static reader" decision (adr/0001). Change the generator.
