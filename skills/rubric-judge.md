---
name: rubric-judge
description: Use when scoring an iteration — `teddy judge` measures the evidence (gates, signals), scores deterministic criteria by rule and llm criteria against the rubric's anchors, and writes iterations/NNNN-slug/scores.json. Also covers judge–human disagreement.
---

# rubric-judge

Since iteration 0010 the judge is a command, not a person: `teddy judge`
(in this repo: `node src/cli.ts judge`). It runs **locally, on demand** —
never in CI (adr/0006). Your job is to run it, read what it wrote, and
act on it; you no longer type scores.

## Run it

```sh
teddy judge                     # write scores.json for the open iteration on this branch
teddy judge --dry-run           # print what would be written
teddy judge --iteration <id>    # when several iterations are open here
teddy judge --verify            # re-judge and compare with what is recorded (needs a credential)
teddy scores-check              # then gate it: evidence re-verified, bounds, baseline
```

Credential: `ANTHROPIC_API_KEY` in the environment (`TEDDY_JUDGE_MODEL` to
pick the model; default `claude-opus-5`). Without one, the deterministic half
still runs and every `llm` criterion is written as `null` with the rationale
"not judged — no judge credential"; that is an honest score, not a failure.

## What it does

1. Measures every gate and signal the rubric declares (`teddy <id> --json`)
   and records them. A **failing gate aborts** — fix it first; a failing gate
   blocks the PR regardless of any score.
2. `judge: "none"` criteria: `1` when all evidence passed, `null` when any
   was skipped or unmeasured. No other value exists.
3. `judge: "llm"` criteria: the model gets the anchors, the ticket, the diff
   against the merge base over `config.src`, and the measured evidence, and
   returns `{exercised, score, rationale}` per criterion. Not exercised →
   `null`. The evidence bounds (adr/0006) are applied to what comes back —
   a score above 0.5 with no declared evidence and no cited file is capped.
4. Writes `scores.json` as `timestamp` + `criteria`. Nothing else is stored.

## Reading the result

The rationale is written for the human reviewer: it must cite files,
behaviour in the diff, gate verdicts, or signal values. If it does not,
the judgment is weak — re-run, or descope the criterion to `null` and say
why in the PR. Never edit a score by hand to pass `scores-check`.

## Judge–human disagreement

If the human reviewer disagrees with a score, the resolution is structural,
not negotiable: an ADR amendment sharpening the anchors, or promoting the
property to a gate or signal (shrinking judge surface). Note the
disagreement in the iteration's PR so it becomes trackable — it is the
`loop-closure` criterion's evidence.

## Never

- Merge a PR — the merge *is* approval and closure (adr/0003, adr/0005);
  agents never merge.
- Transition ADR status as a side effect of scoring.
- Hand-write a gate verdict, a signal value, or an llm score. Run the judge.
- Run the judge in CI, or add a credential to a workflow — decided against.

## Red flags — stop

- "The judge said 0.5 but the change is obviously a 1" → that is a
  disagreement; record it, sharpen the anchor, or promote the property.
- "No credential, I'll fill in what the model would have said" → that is
  fabrication, the exact behaviour this harness exists to make visible.
