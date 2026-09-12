---
id: 0010
type: feature
goal: Implement `teddy judge` (adr/0006) — measures every gate and signal for the open iteration, scores judge-none criteria by rule, scores judge-llm criteria against the anchors with the evidence bundle via a local model call, applies the evidence bounds, and writes scores.json; `--verify` re-judges and compares, `--dry-run` prints.
constraint: each exercised criterion must not decrease against its last recorded score (baseline: iterations/0009-package)
adr_refs: [0006]
---

## Scope

- `src/commands/judge.ts`: iteration selection (latest open on this branch,
  `--iteration`), evidence measurement via `runCheck`, failing gates abort,
  judge-`none` rule (1 / null), evidence bundle (ticket, `merge-base..HEAD`
  diff over `config.src` + the iteration + ADRs, measured verdicts),
  structured-output model call over `fetch` (no SDK — Teddy carries no
  runtime dependency, adr/0007), post-hoc evidence bounds, `scores.json`
  written as `timestamp` + `criteria`
- `--verify`: deterministic parts must match; llm claims may not exceed the
  fresh judgment by more than `tolerance`; fails closed without a credential
- `--dry-run`: print, write nothing; no credential → llm criteria `null`
  with an explicit rationale
- Env: `ANTHROPIC_API_KEY`, `TEDDY_JUDGE_MODEL` (default `claude-opus-5`),
  `TEDDY_JUDGE_URL` (default Anthropic Messages API; selftest points it at
  a local fake)
- Selftest: no-key path, fake-endpoint scoring, cap without cited file,
  not-exercised → null, failing gate aborts, `--verify` tolerance
- `rubric-judge` skill rewritten around `teddy judge`; README

## Out of scope

- Running the judge in CI (decided against, adr/0006)
- Providers other than the Anthropic Messages API shape (the URL is
  configurable; the request/response shape is not, yet)

## Affected criteria

adr-traceability (deterministic); cockpit-clarity and loop-closure not
exercised by this diff.
