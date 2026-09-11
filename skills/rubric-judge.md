---
name: rubric-judge
description: Use when scoring rubric criteria for an iteration — LLM-as-judge scoring with evidence-based rationale, writing into iterations/NNNN-slug/scores.json.
---

# rubric-judge

Scores the affected rubric criteria for the current iteration and records
evidence-based rationales. You are the LLM half of the loop; the human review
that follows is the corrective when you and the human disagree.

## Steps

1. Read the criterion in `rubrics/rubric.yaml` — score against *its words*, not
   your own idea of quality.
2. Gather evidence: the iteration's diff, the touched artifacts, output of the
   deterministic checks. Rationales must cite specifics (file, behavior, diff).
3. Score each affected criterion `0`–`1` (null = not exercised this iteration —
   do not force a number onto untouched criteria).
4. Recompute `overall = Σ(weightᵢ × scoreᵢ) / Σ(weightᵢ)` over non-null criteria
   (weights from `rubrics/rubric.yaml`) and store it in `scores.json`.
   `scores-check` recomputes it and rejects arithmetic errors.
5. Run `node checks/scores-check.ts`. If the baseline gate fails (a criterion
   scored below its last recorded value — adr/0001, amended), the iteration is
   **not done**: improve the work or descope. Never lower a score's prior, and
   never null out previously scored criteria to pass.

## Judge–human disagreement

If the human reviewer disagrees with your score, the resolution is structural,
not negotiable: an ADR amendment clarifying the criterion, or promoting the
property to a deterministic assertion in `checks/` (shrinking judge surface).
Note the disagreement in the iteration's PR so it becomes trackable.

## Never

- Merge a PR, or edit registry closure state — the scribe owns it at merge
  time (adr/0003); agents never merge.
- Transition ADR status as a side effect of scoring.
- Score a criterion you cannot cite evidence for; leave it null instead.
- Round a weak result up "because the trend is right" — report the number.

## Red flags — stop

- "Close enough to 1" → then justify 1 with evidence, or score what the evidence shows.
- "Nothing in the diff touches this criterion, but I'll score it anyway" → null.
