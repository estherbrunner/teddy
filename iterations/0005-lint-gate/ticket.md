---
id: 0005
type: feature
goal: Implement adr/0004 — a deterministic `npm run lint` gate that detects the declared linter from package.json (biome, eslint, oxlint, standard, xo) and runs its lockfile-pinned local binary; Teddy itself adopts Biome.
constraint: each exercised criterion must not decrease against its last recorded score (baseline: iterations/0004-github-native-approval/scores.json)
adr_refs: [0004]
pr: null
---

## Scope

- `checks/lint.ts`: detection (fixed priority: @biomejs/biome, eslint,
  oxlint, standard, xo), local-binary execution, exit-code propagation;
  skip-with-note when no linter is declared, fail-closed when a declared
  gate cannot run or the manifest is unreadable
- Selftest cases: no-linter skip, pass, findings-fail, declared-not-installed,
  priority order, unparseable package.json — git-backed fixtures with fake
  `.bin` shims, no network
- Teddy adopts `@biomejs/biome` (devDependency, formatter off) and `npm run
  lint` joins the `npm test` hard-gate chain
- Fix real lint findings in existing sources (no rule disabling)

## Out of scope

- Formatting / import organization (biome formatter stays off — separate
  decision, large mechanical diff)
- Monorepo workspace resolution

## Affected criteria

adr-traceability (deterministic — new ADR resolves to its linked assertion);
cockpit-clarity / loop-closure not expected to be exercised.
