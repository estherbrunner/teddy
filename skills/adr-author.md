---
name: adr-author
description: Use when creating an ADR, amending one, or changing an ADR status in this repo — including the human-approval gate that must never be bypassed.
---

# adr-author

Scaffold and evolve decision records under `adr/`. The lifecycle is
`proposed → accepted → deprecated | superseded`; every transition requires a
human approver recorded in `approved_by`.

## Creating an ADR

1. Next `id` = highest existing ADR id + 1, zero-padded to 4 digits.
2. Copy this template to `adr/NNNN-slug.md` (kebab-case slug):

```markdown
---
id: NNNN
status: proposed
supersedes: null
superseded_by: null
approved_by: null
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
4. Add a matching entry to `manifest.json` (`status: proposed`,
   `approved_by: null`, linked assertions/criteria).
5. Run `node checks/manifest-sync.ts` — it must pass before you commit.

## Changing status

Only a human may approve. When the human says "accept ADR NNNN":

1. Set `status:` **and** `approved_by:` (the approver's name) in frontmatter.
2. If superseding: set `supersedes:` on the new ADR and `superseded_by:` on the
   old one — both directions, or the check fails.
3. Run `node checks/manifest-sync.ts` (or `--fix` to sync manifest statuses).

## Never

- Set `approved_by` yourself, on your own suggestion, or because "it's obvious".
- Transition status while `approved_by` is null — the check rejects it.
- Edit files under `adr/` as part of an unrelated change; ADR changes are
  their own commit/PR.
- Silence a `manifest-sync` failure by editing the check instead of the data.

## Red flags — stop

- "The human obviously meant to approve" → you don't know that. Leave it `proposed`.
- "I'll mark it accepted so the gate passes" → that is the gate working. Fix the substance.
