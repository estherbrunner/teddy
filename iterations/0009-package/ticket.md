---
id: 0009
type: refactor
goal: Implement adr/0007 — Teddy as a git-installable package with a `teddy` CLI; zero-config hosts (adr/, iterations/, checks/, optional teddy.config.ts); both manifests and the redundant scores.json fields removed as derived state; baseline derived from trunk merge order.
constraint: each exercised criterion must not decrease against its last recorded score (baseline: iterations/0008-rubric-v2)
adr_refs: [0007]
---

## Scope

- `src/` layout: `cli.ts`, `lib.ts`, `checks/` (built-ins), `commands/report.ts`,
  `cockpit/`; `checks/selftest.ts` stays as Teddy's own host check
- `teddy.config.ts` (typed, validated, type-only imports) with `dirs`,
  `pattern`, `main`, `src`, `rubric`; `DEFAULT_RUBRIC` for zero-config hosts
- Derived iterations: directory listing + trunk merge order → status, PR,
  baseline; open-on-trunk (squash) detection; registry deleted
- ADR frontmatter `assertions:` (`checks/x.ts` | `teddy:<id>`); `manifest.json`
  deleted; `manifest-sync` reads frontmatter, `--fix` gone
- `scores.json` = `timestamp` + `criteria`; legacy fields rejected; all
  iterations migrated
- Check resolution: host `checks/<id>.ts` overrides built-ins; `teddy check`,
  `teddy report`, `teddy <check-id>`
- `tsconfig.json` covers `src/`, `checks/`, `teddy.config.ts`; build emits
  `dist/` (NodeNext, `rewriteRelativeImportExtensions`, declarations) and
  the cockpit; `package.json` bin/exports/files/prepare; `npm test` also
  runs `dist/cli.js check`
- Selftest: fixtures on the new layout; derived-baseline cases (linear,
  same-merge, concurrent branches), squash detection, config validation,
  host override of a built-in; README + skills; adr/0007 accepted

## Out of scope

- `teddy judge` (iteration 0010), `teddy init` / `teddy new` (0011)
- Publishing to npmjs

## Affected criteria

adr-traceability (deterministic); cockpit-clarity not exercised (renderer
unchanged apart from data version); loop-closure not exercised.
