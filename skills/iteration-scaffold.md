---
name: iteration-scaffold
description: Use when starting a new iteration — creating its directory, ticket, branch, and initial scores.json. There is no registry: the directory is the iteration.
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
constraint: each exercised criterion must not decrease against its last recorded score (baseline: iterations/MMMM-slug/scores.json)
adr_refs: [...]
---

Body: scope, out-of-scope, affected criteria. No `pr` field: the PR number
is read off the merge commit (adr/0005, amended).
```

3. Create `iterations/NNNN-slug/scores.json`: copy the **criteria keys** from
   the previous iteration's scores.json (or the rubric), set every `score`
   to `null`, and record no evidence yet:

```json
{
  "timestamp": "<UTC now, ISO-8601>",
  "criteria": { "...": { "score": null, "judge": "…", "rationale": "not yet exercised", "gates": {}, "signals": {} } }
}
```

   Nothing else: `iteration`, `ticket`, `baseline`, `overall` are derived
   from the directory and git (adr/0007) and are rejected if stored.
4. `git checkout -b iteration/NNNN-slug`. The directory *is* the
   registration; its baseline is the last iteration on the trunk at the
   merge base, its closure is the merge of its PR.

Closure is not your concern: the merge commit of the iteration's PR *is*
the closure. Nobody — human, agent, or bot — writes closure state.

## The scaffolded branch is red — on purpose

With all scores `null`, `scores-check` fails ("nothing exercised") until
`rubric-judge` fills in real scores. That is the fails-closed gate working:
an iteration with no evidence cannot pass. Deterministic gates
(`teddy manifest-sync`) must pass from the first commit.

## Never

- Copy the baseline's *scores* — only its *structure*. Carried-over scores fake stability.
- Put two concerns in one iteration because "they're small".
- Set `baseline: null` on a non-first iteration to dodge the gate.
- Write a `status` into the registry or anything resembling an approval —
  closure and approval are the merge (adr/0003, adr/0005).

## Red flags — stop

- "I'll pre-fill plausible scores so CI is green" → that is fabrication, the exact
  behavior this harness exists to make visible.
