---
id: 0007
status: accepted
supersedes: null
superseded_by: null
assertions: [teddy:manifest-sync, teddy:scores-check, checks/selftest.ts]
rubric_refs: [adr-traceability]
---

# 0007 — Teddy as a Package: One Harness, Many Hosts

## Context

Teddy is meant to be the measurable layer for *any* TypeScript project's
pull requests. Today it can only measure itself: `checks/*.ts` hard-code the
repository root as the project, resolve gates to `<root>/checks/<id>.ts`,
and assume Teddy's own file layout. A team that wants Teddy has two bad
options — copy the files (a fork that never receives fixes) or add its
source to Teddy's repository (not a harness, a monorepo).

Three facts shape the packaging decision:

- **Node does not strip types under `node_modules`.** Everything Teddy
  ships to a host must be JavaScript; only files the host owns
  (`rubrics/rubric.ts`, the host's own `checks/`) run through type
  stripping. Teddy's checks currently rely on being run from source.
- **Teddy's own `tsconfig.json` type-checks only `cockpit/main.ts`.** The
  checks and `rubrics/rubric.ts` are not covered — adr/0006's claim that
  `tsc` validates the rubric is not yet true. The package build fixes this
  as a side effect: the harness gets a real `tsconfig`.
- **Dependency stance (adr/0006).** Teddy prescribes nothing beyond Node
  and TypeScript. Teddy *itself* as a devDependency is the one exception a
  host must accept; it must pull in nothing else.
- **Not ready to publish.** The defaults — which criteria, which anchors,
  how scores are read — need contact with real projects before they are
  frozen behind a registry version. The package must be installable by
  internal hosts straight from git.
- **Two more stored derivations.** `manifest-of-iterations.json` is the
  `iterations/` directory listing plus a `baseline` that git already knows;
  `manifest.json` is the ADR frontmatter, mirrored, with a `--fix` mode
  whose only job is re-syncing the mirror. adr/0005 applies to both.

## Decision

**Teddy is an npm package with a CLI.** Hosts install it as a devDependency
and run `teddy <command>`; Teddy remains its own first host and runs the
same code from source.

**Distributed from git until the defaults are proven.** Hosts install
`github:estherbrunner/teddy#<tag>`; the lockfile pins the commit, a
`prepare` script builds `dist/` on install, no registry is involved.
Internal projects run on this until the rubric defaults and score
evaluation have stabilized; publishing to npmjs is a later, separate
human act.

**A host stores the minimum: decisions, iterations, its own checks.**
Everything Teddy can derive it does not ask the host to keep.

### Layout of the package

```
src/
  cli.ts                  teddy <command> [--json] [--root <dir>]
  lib.ts                  types, rubric loader, check runner, git helpers (today's checks/lib.ts)
  commands/               check, report, init, new (adr | iteration), and later judge (adr/0006)
  checks/                 built-in checks: manifest-sync, scores-check, lint, typecheck, test, coverage
  cockpit/                index.html + main.ts — the static dashboard
skills/                   agent playbooks, shipped as markdown
dist/                     tsc output (gitignored; published)
```

`tsconfig.json` gains a NodeNext project for `src/` that emits to `dist/`
with `rewriteRelativeImportExtensions` (the `.ts` import specifiers Node's
type stripping needs become `.js` on emit); the cockpit keeps its DOM
config. `package.json` gets `bin: { teddy: "dist/cli.js" }`, `exports` for
the `Rubric` type (`import type { Rubric } from "teddy"`), and `files`
limited to `dist/`, `skills/`, and the cockpit assets. `private` is
dropped; publishing is a human act, out of band.

### Layout in a host — zero-config by default

```
adr/                       decisions (merge = approval, adr/0003)
iterations/NNNN-slug/      ticket.md + scores.json
checks/                    host-specific checks (optional; same --json contract)
teddy.config.ts            optional overrides
.github/workflows/check.yml   runs `teddy check` (written by `teddy init`)
```

`teddy.config.ts` (ESM default export `satisfies Config`, with
`import type { Config } from "teddy"` — type-checked by the host's `tsc`,
run through Node's type stripping, validated at load) overrides:
`dirs` (`adr`, `iterations`, `checks`), `pattern` (the iteration
directory scheme, default `NNNN-slug`), `main` (trunk branch), `src`
(globs of the code under judgment — the judge's diff, `coverage`'s
paths), and `rubric` — the criteria, absorbing today's
`rubrics/rubric.ts`. Without a `rubric`, Teddy's **default rubric**
applies (the host-project criteria, once their adapters exist; until then
a minimal traceability rubric). Configuration is data: the module may
import nothing but the `Config` type (the rule adr/0006 set for the
rubric, enforced by `manifest-sync`).

### Derived, never stored — the two manifests go

- **`manifest-of-iterations.json` is deleted.** An iteration *is* a
  directory under `iterations/` matching `pattern`. Its **baseline** is
  the previous iteration in trunk merge order — for a closed iteration,
  the one landed by the preceding merge (same merge: by number); for an
  open iteration, the last iteration present at `merge-base(main, HEAD)`.
  This is the derivation adr/0005 deferred; concurrent PRs now get the
  right baseline without a stored field.
- **`manifest.json` is deleted.** ADR frontmatter is the single source:
  `status`, `rubric_refs`, and a new `assertions:` list (`checks/x.ts` or
  `teddy:<id>`). `manifest-sync` keeps every check it makes today —
  traceability, orphans, merge-as-approval, criteria resolution — against
  the frontmatter directly; `--fix` disappears with the mirror it
  re-synced. The rubric's `adrs` map is gone for the same reason.
- **`scores.json` shrinks to `timestamp` and `criteria`.** `iteration`,
  `ticket`, and `baseline` are the directory and git; `overall` is the
  formula; `deterministic_gate` is the recorded gates. The cockpit report
  computes what it renders (adr/0001's "precomputed for a dumb renderer"
  already holds at generation time, not in the file).

### Resolution rules

- A gate or signal id resolves to the host's `checks/<id>.ts` first, then
  to Teddy's built-in check. Overriding a built-in is deliberate and
  visible in the tree.
- ADR `assertions:` entries are host check paths (`checks/x.ts`) or
  built-ins written as `teddy:<id>`. The orphan rule (adr/0001) applies to
  host checks only — built-ins are linked or not per ADR, never orphans.
- Schema versions (`scores.json`, `Config`/rubric) are checked on every
  command; a newer file than the installed Teddy fails with "upgrade
  teddy", an older one with the migration to run.

### Commands

| command | does |
|---|---|
| `teddy check` | manifest-sync + scores-check + report `--check` — the CI gate |
| `teddy lint` / `typecheck` / `test` / `coverage` | the adapters, `--json` per adr/0006 |
| `teddy report` | writes `cockpit/` (data.js + the dashboard assets) into the host |
| `teddy init` | scaffolds the host layout, a starter rubric, `check.yml`, and offers to copy `skills/` |
| `teddy new adr <slug>` / `teddy new iteration <slug>` | the scaffolds the `adr-author` / `iteration-scaffold` skills describe by hand today |
| `teddy judge` | adr/0006 — local LLM judge, added after this ADR lands |

### Self-hosting

Teddy's own `npm` scripts call `node src/cli.ts <command>` — source, no
build. `npm test` also builds (`tsc`) and runs `dist/cli.js check` once, so
the published artefact is exercised by the same gate that exercises the
source. `checks/selftest.ts` becomes Teddy's own host check (it tests the
harness; hosts do not receive it).

## Consequences

- Files move: `checks/{lib,manifest-sync,scores-check,cockpit-report,lint,
  typecheck,test,coverage}.ts` → `src/…`; `cockpit/` → `src/cockpit/`;
  `rubrics/rubric.ts` → `teddy.config.ts`. Teddy's own ADRs gain
  `assertions:` (`teddy:manifest-sync` etc.); both manifests and the
  `iteration`/`ticket`/`baseline`/`overall`/`deterministic_gate` fields of
  every `scores.json` are removed — a mechanical, gated migration; the
  selftest gains derived-baseline cases (linear, same-merge, concurrent).
- The published package must carry no runtime dependency. `tsc` is a
  devDependency of Teddy for building; hosts already have it.
- adr/0006's sequencing changes: `checks/judge.ts` follows the package
  (iteration 0010), so it is written once against the final layout.
- `teddy init` writes workflow files that call `npx teddy` — resolved from
  the host's lockfile-pinned install, no network (the `npx` concern in
  adr/0004 was about *resolving* a binary Teddy does not know; here the
  install is declared).
- Internal hosts pin a git tag; upgrading is a lockfile change reviewed
  like any other. What the internal trial must answer before publishing:
  how the derived baseline behaves under real concurrency, which default
  criteria and anchors survive contact, and how reviewers actually read
  the scores.

## Sequencing

Iteration 0009: restructure into `src/`, real `tsconfig`, CLI with
`check`/`report`/adapters, `teddy.config.ts` + default rubric, both
manifests and the redundant `scores.json` fields removed, derived
baseline, `teddy:` assertions, schema-version guard, self-hosting via both
source and `dist/`, `prepare` build for git installs. Iteration 0010:
`judge`. Iteration 0011: `init` and `new` scaffolds, then the first
internal host. This ADR's acceptance rides iteration 0009.

## Rejected Alternatives

- **Template repository / `degit`** — every host is a fork; fixes to the
  gates never reach them, and the selftest proves nothing about a copy.
- **Git submodule of Teddy inside the host** — runs from source (type
  stripping works), but submodules are the least-understood git feature
  and the host's CI must still call scripts by path.
- **Copy `checks/` into the host on `init`, update by re-running `init`** —
  a template with extra steps; local edits and upstream fixes collide.
- **Ship `.ts` and require the host to run `tsx`/Bun** — a dependency or a
  runtime mandate, contrary to the stance.
- **Put the host's Teddy data under one `teddy/` directory** — tidier, but
  `adr/` at the root is the convention every ADR tool and reader expects;
  the directories are configurable for teams that want it.
- **`teddy.config.js` + JSDoc** — avoids nothing (type stripping works
  outside `node_modules`) and loses `tsc` validation of the config;
  TypeScript is assumed for every Teddy host anyway.
- **Keep `manifest.json` as the "SSOT" (adr/0001)** — it was only ever a
  mirror of frontmatter with a re-sync command; a source of truth that
  needs `--fix` is a cache (adr/0005).
- **Publish to npmjs now, iterate with versions** — every default is still
  a guess; a registry version is a promise. Git tags make the same
  guarantee (pinned, reproducible) without the promise.
- **Monorepo: hosts add their code to Teddy's repository** — not a harness.
