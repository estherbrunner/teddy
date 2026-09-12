---
id: 0006
status: accepted
supersedes: null
superseded_by: null
assertions: [teddy:scores-check, teddy:typecheck, teddy:test, teddy:coverage]
rubric_refs: [adr-traceability]
---

# 0006 — Rubric v2: Evidence-Backed Criteria and an Independent Judge

## Context

Teddy's purpose is to be the measurable layer for the question *should this
pull request merge into `src/`?* The rubric that exists today
(`rubrics/rubric.yaml`, adr/0001) was written for Teddy judging itself and
cannot express the criteria a real project needs — correctness, security and
resilience, performance, design consistency, accessibility, type safety and
hygiene. Three schema limits block that:

1. **One judge per criterion.** `judge: manifest-sync | llm` makes a
   criterion either wholly deterministic or wholly a judgment. Real criteria
   are a deterministic core (tests pass, coverage did not drop, `tsc` is
   clean) with an LLM residue (are the tests adequate for this diff?). The
   deterministic part has to be *evidence* for the judgment, not an
   alternative to it.
2. **No scoring anchors.** A one-line `description` gives the judge nothing
   to calibrate against. Every score recorded so far is exactly `1`; the
   strict `≥` non-regression gate (adr/0001, amended) plus a self-judging
   author makes that the only stable outcome.
3. **The judgment is unverifiable.** `skills/rubric-judge.md` has the agent
   that wrote the change also write `scores.json`, with nothing in the
   record that a check or a reviewer can test the number against. A judgment
   cannot be made deterministic — but its evidence can, and the score can be
   bounded by it.

The lint gate (adr/0004) already shows the pattern for the deterministic
side: detect the tool the host project declared, run its pinned local
binary, propagate the verdict. This ADR generalizes it and defines what
sits on top.

## Decision

### Criteria have gates, signals, and a judge

`rubrics/rubric.yaml` is replaced by **`rubrics/rubric.ts`**: a TypeScript
module exporting a `Rubric` literal (`version: 2`), typed against
`checks/lib.ts`. Node runs it natively (type stripping — the same way the
checks run), `tsc` validates the schema, the diff is reviewable in the PR
that changes it, and it costs no dependency. The module may import nothing
but the `Rubric` type; `manifest-sync` rejects any other import. A
criterion:

```ts
{
  id: "correctness",
  weight: 5,
  description: "The change does what the ticket says and nothing it does not.",
  gates: ["test"],                    // deterministic, binary, hard — any failure blocks the PR
  signals: [                          // deterministic, numeric, thresholded, trended
    { check: "coverage", metric: "changed_lines", min: 0.8 },
    { check: "coverage", metric: "total", ratchet: true },
  ],
  judge: "llm",                       // "llm" | "none"
  anchors: {                          // required when judge is "llm"
    0:   "Behaviour diverges from the ticket, or the change is untested where it could be.",
    0.5: "Ticket met; tests cover the happy path only, or a stated edge case is unhandled.",
    1:   "Ticket met; tests cover the stated edge cases and fail without the change.",
  },
}
```

- **Gates** are check ids. Each maps to `checks/<id>.ts` (adr/0004
  pattern): detection from `package.json`, pinned local binary, exit code is
  the verdict, *skip with a note* when nothing is declared, *fail closed* when
  a declared tool cannot run. Gates are a hard gate exactly as adr/0001 says
  deterministic assertions are — they must pass regardless of any score.
- **Signals** are numeric metrics a check emits with `--json`. A threshold
  (`min` / `max`) is gated like a gate; `ratchet: true` additionally
  forbids regression against the last recorded value. Every value is
  recorded per iteration and trended by the cockpit.
- **Judge** is `"llm"` or `"none"`. With `"none"` the score is `1` when every
  gate and signal passed and `null` when any was skipped (not measurable);
  the trend lives in the signals. With `"llm"`, the judge scores `0–1`
  against the **anchors**, with the diff, the gate outputs, and the signal
  values as its evidence — the score may not exceed what the evidence
  supports, and a rationale must cite it.

**Check contract.** `node checks/<id>.ts --json [root]` prints one JSON line
`{ "id", "verdict": "pass" | "skip" | "fail", "signals": { metric: number } }`
as the last line of stdout (tool output goes to stderr) and exits non-zero
only on `fail`. A check without `--json` support is a gate by exit code
alone. The existing criteria migrate mechanically: `judge: manifest-sync`
becomes `gates: ["manifest-sync"], judge: "none"`; the two `llm` criteria
gain anchors.

### Scores carry the evidence

`scores.json` gains, per criterion, `gates: {id: pass|skip}` and
`signals: {check.metric: value}` next to `score`, `judge`, `rationale`.
For every **open** iteration (adr/0005: unmerged), `scores-check` re-runs
its gates and signals against the tree and rejects a recorded value that
disagrees — the recorded evidence is verifiable, not asserted. Closed
iterations were verified on their PR run; their evidence describes a tree
that no longer exists. The weighted `overall` formula is unchanged.

### Non-regression is tolerant for judgments, strict for measurements

The per-criterion gate (adr/0001, amended) becomes: a signal may not cross
its threshold, and a `ratchet` signal may not regress against its last
recorded value; a `judge: "none"` score is strict; a `judge: "llm"` score
may not drop by more than `tolerance` (rubric-level, default `0.1`). A noisy judge with a
strict gate produces either false failures or grade inflation; tolerance
plus anchors is the honest setting.

### The judge runs locally; CI verifies the evidence, not the judgment

`checks/judge.ts` produces `scores.json` for an iteration: runs every gate
and signal, then — for `judge: llm` criteria — calls the configured model
with the rubric anchors and the evidence bundle (diff against the PR's
merge base with `main`, gate output, signal values, the ticket) and
requests a structured `{score, rationale}` per criterion.

- **The LLM judge runs locally, on demand** (`npm run judge`), by whoever is
  driving the iteration — a human, the implementing agent, or a fresh agent
  context. It is not a CI step: CI stays deterministic, needs no model
  credential, and never pays per push. Teams that want an independent
  re-score in CI can wire `npm run judge -- --verify` into their own
  workflow; Teddy ships the flag, not the workflow.
- **CI verifies everything that can be verified.** `scores-check`
  recomputes gates and signals and rejects a recorded value that disagrees;
  it rejects an `llm` score that exceeds what its evidence bound allows
  (below); it rejects a missing or evidence-free rationale. What remains —
  whether `0.7` should have been `0.5` — is the human reviewer's call at
  merge, as adr/0003 already made it. The judge's rationale is written for
  that reviewer: it cites the evidence so the number can be checked by
  reading, not by trusting.
- **Evidence bounds the score.** An `llm` criterion with a skipped gate or
  an unmeasured signal caps at `0.5`; one whose evidence bundle is empty
  (no gates, no signals declared) may not score above `0.5` unless its
  rationale cites a file. Bounds are enforced by `scores-check`,
  deterministically.

The reference adapter uses the Anthropic SDK (`claude-opus-5`, adaptive
thinking, structured output); the model and provider are configuration
(`TEDDY_JUDGE_MODEL`, API key from the environment) — Teddy prescribes the
mechanism, not the vendor. Without credentials `judge` runs the
deterministic half, leaves `llm` scores `null` with the note "not judged",
and says so — it never fabricates a number.

### Evidence is the PR diff

The judge's evidence diff is `merge-base(main, HEAD)..HEAD` — the unit of
evaluation is the pull request. The non-regression *baseline* stays the
registry chain for now; deriving it from the merge base is a separate
decision (adr/0005, Consequences).

### Checks are adapters; the first set

| check | detects | gate | signals |
|---|---|---|---|
| `lint` | biome, eslint, oxlint, standard, xo | ✓ | — |
| `typecheck` | `typescript` → `tsc --noEmit` | ✓ | — |
| `test` | vitest, jest, `node --test`, mocha | ✓ | — |
| `coverage` | the test runner's coverage output | — | `changed_lines`, `total` |

Security, performance, design-boundary, and accessibility adapters
(`audit`, `size`, `deps`, `a11y`) follow as ordinary iterations; adding an
adapter that honours the contract needs no ADR. Network-dependent checks
(vulnerability databases) may only back **signals**, never gates —
determinism is a gate property.

### Teddy's own rubric v2

Teddy migrates its three criteria; `adr-traceability` gains `selftest`,
`typecheck`, and `lint` as gates (Teddy's tests are `checks/selftest.ts`, a
gate by exit code; the `test` adapter skips for Teddy, so it is not listed). The six host-project criteria are authored
in the iteration that ships the adapters they need — a criterion without a
runnable gate or signal is a description, not a measurement.

## Consequences

- The hand-rolled rubric parser (adr/0001) is deleted; the frontmatter
  parser stays (ADR and ticket headers are a fixed key/value subset).
  Teddy keeps its dependency stance explicit: **nothing beyond Node and
  TypeScript**, for the harness and for what it asks of a host project.
- `scores.json` files for iterations 0001–0007 are migrated in place
  (evidence fields added as `{}`; no score changes); `scores-check` accepts
  v1 files only through the migration.
- The `rubric-judge` skill becomes "run `npm run judge`, then read what it
  says"; the author no longer types scores. No CI credential is needed; the
  human reviewer sees the judge's rationale in the `scores.json` diff of the
  PR, which is where adr/0001 already put it.
- The cockpit gains per-signal trends; the judge-surface ratio (adr/0002) is redefined as *weight on `judge: none`
  criteria plus signals* over total weight — the same "shrinking judge"
  metric, now measurable per criterion.
- Cost: one judge call per local `npm run judge`, paid by whoever runs it;
  nothing recurring.

## Sequencing

Iteration 0008: schema v2 + parser + migration + `scores-check` evidence
verification + `typecheck`/`test`/`coverage` adapters (Teddy's own rubric
migrated). Iteration 0009: `checks/judge.ts` (`npm run judge`, `--verify` flag). Host-project criteria and further adapters afterwards. This
ADR's acceptance rides iteration 0008.

## Rejected Alternatives

- **Keep one `judge` per criterion, add more deterministic judge names** —
  makes every mixed criterion two criteria with an arbitrary weight split,
  and still gives the LLM no evidence.
- **LLM judge in CI on every push** — a model credential in every adopting
  repository, a paid call per push, and a second opinion that still cannot
  be enforced (two judgments disagreeing is a human question). CI stays
  deterministic; verification targets the evidence, which it can enforce.
- **CI judge commits `scores.json` to the branch** — bot commits on PR
  branches dismiss human reviews and were removed by adr/0005.
- **Scores as PR comments only, not in git** — the cockpit builds from git
  offline (adr/0002, adr/0005); a judgment is an event worth recording.
- **Strict non-regression on LLM scores** — observed outcome: every score
  is `1`. Tolerance with anchors measures; strictness with one-liners
  performs.
- **Mandate a specific test runner or coverage tool** — a tool mandate,
  contrary to adr/0004; detection keeps the choice with the team.
- **YAML v2 with a parser dependency** — Teddy prescribes no dependencies;
  a hand-rolled YAML parser large enough for anchors and nested signals is
  a liability. JSON: no comments, prose anchors as escaped strings.
  SQLite (`node:sqlite`): binary in git — unreviewable diff, which defeats
  merge-as-approval for rubric changes. A typed TS module has none of these
  costs and gets schema validation from `tsc` for free.
