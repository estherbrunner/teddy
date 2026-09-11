---
name: adr-author
description: Use when creating an ADR, amending one, or changing an ADR status in this repo — acceptance lands via a merged PR (merge = approval, adr/0003); agents never merge.
---

# adr-author

Scaffold and evolve decision records under `adr/`. The lifecycle is
`proposed → accepted → deprecated | superseded`. Since adr/0003, the approval
is the merge: the branch carries the target status, and a human merging the
PR *is* the approval — recorded by GitHub, not by any file field.

## Creating an ADR

1. Next `id` = highest existing ADR id + 1, zero-padded to 4 digits.
2. Copy this template to `adr/NNNN-slug.md` (kebab-case slug):

```markdown
---
id: NNNN
status: proposed
supersedes: null
superseded_by: null
rubric_refs: []
---

# NNNN — Title

## Context

## Decision

## Rejected Alternatives

- **Alternative** — why rejected (one sentence).
```

3. Fill in `rubric_refs` with criterion ids from `rubrics/rubric.yaml` (or
   propose new criteria in the same change).
4. Add a matching entry to `manifest.json` (`status: proposed`, linked
   assertions/criteria) and the `adrs:` section of `rubrics/rubric.yaml` —
   the two must agree.
5. Run `node checks/manifest-sync.ts` — it must pass before you commit.

## Changing status

Set the target `status` in the branch that implements the decision and open
the PR. A human merges; the merge event *is* the approval. The check
requires any non-`proposed` status to trace to a merge commit touching the
ADR file — direct commits and squash/rebase merges are rejected.

If superseding: set `supersedes:` on the new ADR and `superseded_by:` on the
old one — both directions, or the check fails.

## Never

- Reintroduce `approved_by` (or any approval field) — the check rejects the
  legacy field; approval lives in GitHub's record.
- Merge a PR yourself or ask to have one merged — agents never merge.
- Edit files under `adr/` as part of an unrelated change; ADR changes are
  their own commit/PR.
- Silence a `manifest-sync` failure by editing the check instead of the data.

## Red flags — stop

- "The PR is obviously going to be approved, I'll set accepted on main now" →
  acceptance exists only after the human's merge, never before.
- "I'll merge it so the gate records the approval" → the gate exists precisely
  so that agents cannot do this.
