---
name: iteration-scaffold
description: Use when starting a new iteration — creating its ticket, branch, and initial scores.json, and registering it in manifest-of-iterations.json.
---

# iteration-scaffold

Starts one iteration = one ticket = one branch = one PR. Score deltas stay
attributable; multiple concerns in one iteration are forbidden.

## Steps

1. Next number `NNNN` = highest existing `iterations/NNNN-*` + 1. Slug: kebab-case.
2. Create `iterations/NNNN-slug/ticket.md`:

```markdown
---
id: NNNN
type: feature | bugfix | skill | decision | refactor
goal: <one sentence>
constraint: score must not decrease (baseline: iterations/MMMM-slug/scores.json)
adr_refs: [...]
pr: null
---

Body: scope, out-of-scope, affected criteria.
```

3. Create `iterations/NNNN-slug/scores.json`: copy the **criteria keys** from
   the baseline's scores.json, set every `score` to `null`, and set:

```json
{
  "iteration": "NNNN-slug",
  "ticket": "NNNN",
  "baseline": "MMMM-slug",
  "timestamp": "<UTC now, ISO-8601>",
  "criteria": { "...": { "score": null, "judge": "…", "rationale": "not yet exercised" } },
  "overall": 0,
  "deterministic_gate": "pass",
  "approved_by": null
}
```

4. Register the iteration in `manifest-of-iterations.json` (`status: open`,
   `baseline` = previous closed-or-open iteration id; `null` only for the first).
5. `git checkout -b iteration/NNNN-slug`.

## The scaffolded branch is red — on purpose

With all scores `null`, `scores-check` fails ("nothing exercised") until
`rubric-judge` fills in real scores. That is the fails-closed gate working:
an iteration with no evidence cannot pass. Deterministic gates
(`node checks/manifest-sync.ts`) must pass from the first commit.

## Never

- Copy the baseline's *scores* — only its *structure*. Carried-over scores fake stability.
- Put two concerns in one iteration because "they're small".
- Set `baseline: null` on a non-first iteration to dodge the gate.

## Red flags — stop

- "I'll pre-fill plausible scores so CI is green" → that is fabrication, the exact
  behavior this harness exists to make visible.
