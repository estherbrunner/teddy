---
id: 0004
status: proposed
supersedes: null
superseded_by: null
rubric_refs: []
---

# 0004 — Linter-Agnostic Deterministic Lint Gate

## Context

The deterministic hard gate (selftest, traceability, scores, cockpit-data
freshness, typecheck, build) has no lint leg: nothing enforces code-quality
rules on the TypeScript sources. Teams standardize on different linters —
Biome, ESLint, oxlint, standard, xo — and Teddy prescribes mechanisms, not
tool choices (adr/0003). The gate must therefore bind to whatever linter a
team declares, and stay deterministic: same tree → same verdict, no network,
no floating versions.

## Decision

**`npm run lint` is a stable, deterministic entry point backed by detection.**
It runs `checks/lint.ts`, which:

1. Reads `package.json` and looks for a supported linter among the declared
   dependencies (dev and regular), in a fixed priority order:
   `@biomejs/biome`, `eslint`, `oxlint`, `standard`, `xo`. First match wins.
2. Runs that linter's binary from the local install (`node_modules/.bin`)
   with a fixed argument set (e.g. `biome check .`, `eslint .`) and
   propagates its exit code. No network, no `npx` resolution, no version
   drift — `npm ci` has already pinned the toolchain via the lockfile.

**Semantics fail closed on verification, not on absence.**

- No supported linter declared → the gate passes with an explicit skip
  note. Declaring a linter in `package.json` *is* the configuration; teams
  that don't want a lint leg simply don't declare one.
- Linter declared but not installed → failure ("run npm install") — a
  declared gate that cannot run is a broken gate.
- Unparseable `package.json` → failure (the gate cannot verify).
- Linter exits non-zero → failure; the findings are the linter's to explain.

**Teddy's own configuration:** `@biomejs/biome` as a devDependency. Formatter
and import organization stay disabled for now — adopting formatting is a
separate decision with a large mechanical diff; this change adds the gate,
not a reformat.

## Consequences

- The lint leg joins the hard-gate chain (`npm test`) — it must pass
  regardless of any weighted score (adr/0001: deterministic assertions are
  a separate binary gate).
- The gate runs at the repository root against the root `package.json`;
  monorepo workspace resolution is out of scope.
- Extending the supported-linter table is a reviewable code change; it needs
  no ADR unless the semantics above change.

## Rejected Alternatives

- **Hardcode Biome** — fastest for Teddy, but turns a harness decision into
  a tool mandate; downstream teams on ESLint would fork the gate.
- **Run whatever `scripts.lint` says** — a script can be anything: no known
  command, no reviewable exit-code contract. Detection gives the gate both,
  and teams keep full control where it belongs — the linter's own config.
- **Fail when no linter is declared** — forces a tool choice on every
  adopting team; Teddy prescribes the mechanism, not the tooling (adr/0003).
- **Resolve the binary via `npx`** — can reach the network or float versions;
  determinism requires the lockfile-pinned local binary.
