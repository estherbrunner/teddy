---
id: 0005
status: accepted
supersedes: null
superseded_by: null
assertions: [teddy:report, teddy:scores-check, checks/selftest.ts]
rubric_refs: [adr-traceability]
---

# 0005 — Derived State Is Never Stored

## Context

adr/0003 established that approval is an *event* recorded by git — a merge —
and that "approval data is derived, never stored". The repository still
stores two artifacts that are pure functions of git history and committed
inputs:

- `status: closed` in `manifest-of-iterations.json` — true exactly when a
  first-parent merge commit touches `iterations/<id>/` (the query
  `scores-check` already runs to *verify* the field).
- `cockpit/data.js` — a serialization of `manifest.json`, the registry, the
  rubric, and `iterations/*/scores.json`.

Keeping stored copies of derived facts consistent has cost the harness a
scribe workflow, a bot commit on every iteration PR, a `--check` freshness
gate, a `GITHUB_EVENT_NAME` escape hatch in `scores-check` (the carrying merge
does not exist yet on the branch), and a hand rule in `adr-author` that every
ADR-status PR must also commit a regenerated `data.js`. The rule was broken on
first contact: PR #6 had to be followed by a regeneration commit because an
ADR acceptance — not an `iteration/*` PR — changed the cockpit's inputs. Any
merge that touches an input without regenerating leaves `main` stale.

Two further defects follow from the stored copies:

- **Review dismissal.** The scribe pushes to the PR branch after the gates
  go green. With the recommended ruleset (*Dismiss stale reviews*) a human
  approval given before that push is dismissed by the bot's commit.
- **Same anti-pattern as `approved_by`.** A committed view of git history,
  inside git, is a second copy that can drift from the first. adr/0003
  removed one such copy; two remain.

## Decision

**Closure is defined, not recorded.** An iteration is `closed` iff a
first-parent merge commit touches `iterations/<id>/` on the current branch
(`mergeTrace`, as today), and `open` otherwise. The `status` field is removed
from `manifest-of-iterations.json`; `scores-check` rejects it as a legacy
field, the same way it rejects `approved_by`. Baseline ordering is enforced
on the derived value: a closed iteration whose baseline is open is still a
failure — it now means a squash/rebase merge or an out-of-order merge, both
of which defeat traceability.

**`cockpit/data.js` is a build output.** It is gitignored alongside
`cockpit/main.js`, produced by `npm run report` (and by `npm run build`), and
never committed. `cockpit-report.ts` derives iteration status from git at
generation time. Its `--check` mode is reduced to "generation succeeds from
the current tree" — there is no committed copy to compare against.

**Publication happens from `main`, not from branches.** A `pages` workflow
on push to `main` runs `npm run build` and deploys `cockpit/` to GitHub
Pages, so readers without a Node toolchain see a cockpit that is always
exactly `main`. Local `file://` use is unchanged: `npm run report` then open
`cockpit/index.html`.

**The scribe is deleted.** `checks/scribe.ts` and
`.github/workflows/scribe.yml` are removed; there is no derived state left
for a writer to own. The `pull_request` deferral in `scores-check` goes with
it: on every ref, closure is whatever git says about that ref. The
`adr-author` rule "commit the regenerated `data.js`" is struck.

**ADR status stays stored — it is intent, not derivation.** An ADR's
`status` is the one field a branch legitimately carries ahead of its merge
(adr/0003: the file proposes, the merge realizes). `manifest-sync` therefore
keeps its merge-trace requirement everywhere except `pull_request` CI runs,
where a missing trace is reported as *pending merge* and passes; `main`
reconciles. The `check` workflow runs on pushes to `main` and on pull
requests only, so a transition PR is not also failed by a redundant
branch-push run.

**Grandfathering.** Iterations 0001–0005 all trace to merge commits on
`main` today; no exception list is needed. The historical scribe commits
stay in history and are inert.

## Consequences

- Fewer moving parts: one workflow (`check`) gates, one workflow (`pages`)
  publishes, nothing writes to branches.
- An open PR's cockpit (built locally from the branch) shows its own
  iteration as `open`; after merge, `main` shows it `closed` — with no
  action by anyone. This is the behaviour adr/0003 intended.
- `manifest-of-iterations.json` shrinks to `id`, `ticket`, `scores`,
  `baseline`; the ticket loses `pr` (see amendment). (The stored `baseline` field is itself suspect under
  concurrent PRs — deriving it from `git merge-base` is a separate decision,
  out of scope here.)
- `selftest` cases for stored closure and stale `data.js` are replaced by
  cases for derived status (open, merged → closed, out-of-order merge), the
  legacy-field rejection, and the pull-request deferral in `manifest-sync`.
- `cockpit-clarity` is unaffected: the renderer's inputs are identical, only
  their provenance changes.

## Sequencing

Implemented by iteration 0006 in a single PR: remove `status` from the
registry and reject it; derive status in `cockpit-report.ts` and
`scores-check.ts`; gitignore and `git rm` `cockpit/data.js`; delete the
scribe and its workflow; add `pages.yml`; update README, `adr-author`,
`cockpit-report` and `iteration-scaffold` skills. This ADR's acceptance
rides the same PR — its merge is the first run of the derived gate, and
the first ADR acceptance whose PR CI is green before the merge.

## Rejected Alternatives

- **Keep committing `data.js`, regenerate post-merge on `main`** — already
  rejected by adr/0003's amendment: no bypass, no bot push to `main`.
- **Keep committing `data.js`, require a follow-up PR per merge** — doubles
  the PR count and still leaves `main` stale between the two merges; a
  human-maintained cache of git history.
- **Keep the pre-merge scribe, extend it to all PRs** — fixes the stale
  case for ADR PRs but keeps the review-dismissal defect and the branch-side
  bot commit; the copy still exists.
- **Store `closed` but let CI auto-fix it** — a stored field whose only
  legitimate writer is a script that recomputes it from git is a cache with
  extra steps; remove the cache.
- **Cockpit fetches git state at runtime** — a `file://` page has no git
  and no server (adr/0002); build-time derivation keeps the renderer dumb.

## Amendment — the PR link is derived too

The ticket schema (adr/0001) carried `pr: null`, to be filled once the PR
opened — which by construction needs a commit *after* the PR exists, on
every iteration. It is the same stored copy of git-recorded fact this ADR
removes: GitHub writes the PR number into the merge commit subject
(`Merge pull request #N from …`), and `mergeTrace` already reads that
subject.

Amended: `pr` is removed from the ticket frontmatter and rejected as a
legacy field by `scores-check`. `cockpit-report` derives `pr` per iteration
from the merge commit (`lib.ts#mergedPr`; `null` while open). The cockpit
links closed iterations to `/pull/N` and open ones to the PR search for
their branch (`head:iteration/<id>`) — no field, no follow-up commit.
Implemented by iteration 0007.
