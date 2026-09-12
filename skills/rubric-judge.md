---
name: rubric-judge
description: Use when scoring rubric criteria for an iteration — recording deterministic evidence (gates, signals) and, for llm criteria, an anchored score with an evidence-citing rationale in iterations/NNNN-slug/scores.json.
---

# rubric-judge

Scores the affected criteria for the current iteration. Since adr/0006 a
criterion is *evidence first*: its gates and signals are measured, recorded,
and re-verified by CI; only what remains is a judgment, and the judgment is
bounded by the evidence. The LLM judge runs **locally only** — never in CI.
(Until `checks/judge.ts` lands in iteration 0009, you are the judge.)

## Steps

1. Read the criterion in the rubric (`teddy.config.ts`, or Teddy's default): its `gates`, `signals`, `judge`,
   and — for `"llm"` — its `anchors`. Score against the anchors' words.
2. Measure the evidence: for every gate run `teddy <id> --json` and
   record `pass` | `skip` under `gates`; for every signal record the value
   the check emits under `signals` as `"<check>.<metric>"`. Never type a
   verdict or a value you did not measure — `scores-check` re-runs them.
3. Score:
   - `judge: "none"` → `1` if every gate and signal passed; `null` if any
     was skipped or unmeasured. Nothing else is valid.
   - `judge: "llm"` → `0`–`1` against the anchors, with the diff, the gate
     output and the signal values as evidence. Skipped/unmeasured evidence
     caps the score at `0.5`; with no declared evidence, a score above `0.5`
     needs a rationale citing a file. `null` = not exercised this iteration.
4. Rationales cite specifics (file, behaviour, diff hunk) so a reviewer can
   check the number by reading, not by trusting.
5. `overall = Σ(weightᵢ × scoreᵢ) / Σ(weightᵢ)` over non-null criteria is
   derived by the report — do not store it. Run `teddy scores-check`: it
   re-runs the evidence, enforces the bounds, and applies the
   baseline gate (strict for `"none"` scores and `ratchet` signals; the
   rubric's `tolerance` for `"llm"` scores). If it fails, the iteration is
   **not done**: improve the work or descope. Never lower a prior, never null
   out a previously scored criterion to pass.

## Judge–human disagreement

If the human reviewer disagrees with a score, the resolution is structural,
not negotiable: an ADR amendment sharpening the anchors, or promoting the
property to a gate or signal (shrinking judge surface). Note the
disagreement in the iteration's PR so it becomes trackable.

## Never

- Merge a PR — the merge *is* approval and closure (adr/0003, adr/0005);
  agents never merge.
- Transition ADR status as a side effect of scoring.
- Record a gate or signal you did not run; score a criterion you cannot cite
  evidence for — leave it null instead.
- Round a weak result up "because the trend is right" — report the number.

## Red flags — stop

- "Close enough to 1" → justify 1 against the `1` anchor with evidence, or
  score what the evidence shows.
- "Nothing in the diff touches this criterion, but I'll score it anyway" → null.
- "The gate skipped but the code is obviously fine" → the cap is 0.5; make
  the gate run.
