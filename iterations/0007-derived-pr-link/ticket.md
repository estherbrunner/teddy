---
id: 0007
type: refactor
goal: Amend adr/0005 — drop the ticket's stored `pr` field; derive each iteration's PR from its merge commit subject and link it from the cockpit.
constraint: each exercised criterion must not decrease against its last recorded score (baseline: iterations/0006-derived-state/scores.json)
adr_refs: [0005]
---

## Scope

- `lib.ts#mergedPr`: PR number from `Merge pull request #N …` on the
  iteration directory's merge trace; `null` while open
- `scores-check`: `pr` in ticket frontmatter rejected as a legacy field
- `cockpit-report`: emits `pr` per iteration; cockpit links closed
  iterations to `/pull/N`, open ones to `pulls?q=head:iteration/<id>`
- `pr:` stripped from all tickets, the scaffold template, and fixtures;
  selftest asserts the derived number and the legacy-field rejection
- adr/0005 amendment; adr/0001 ticket schema note

## Out of scope

- Deriving `baseline` (still noted in adr/0005 Consequences)

## Affected criteria

adr-traceability (deterministic); cockpit-clarity exercised — the PR link
now resolves to the actual PR instead of the queue.
