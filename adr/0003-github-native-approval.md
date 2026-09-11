---
id: 0003
status: accepted
supersedes: null
superseded_by: null
rubric_refs: [adr-traceability]
---

# 0003 — GitHub-Native Approval Gates

## Context

Teddy is built for teams: multiple code owners, multiple contributors, each
free to use code agents of their choice. The bootstrap approval mechanism —
human-maintained `approved_by` fields in ADR frontmatter and iteration
`scores.json` — fails that environment twice over:

- **Forgeable.** Any writer — including any code agent — can set the field.
  Nothing distinguishes a recorded human decision from an agent's convenience.
- **Error-prone.** The bootstrap loop itself demonstrated the cost: the gate
  had to catch status drift behind hand edits, and an unapproved root
  baseline (iteration 0001) that neither human nor agent had on their list.

Approval is an *event* — a privileged person merged a reviewed PR — not a
field. Git and GitHub already record that event server-side; Teddy should
not duplicate it in forgeable data.

## Decision

**Approval = merge.** ADR status transitions land inside pull requests: the
branch carries the target status, and a human merge of that PR is the
approval. Deterministic invariant: every `accepted` ADR on `main` traces to
a merge commit touching its file.

**Approval data is derived, never stored.** The `approved_by` field is
removed from both schemas (ADR frontmatter and iteration `scores.json`).
Who approved is answered from the record: the PR's `mergedBy` and the merge
commit in `git log`. Grandfathered pre-regime: ADRs 0001 and 0002 (accepted
via direct commits before this ADR existed) and iterations 0001–0003
(closed via PR #1).

**Derived state is written only by a deterministic script.** The registry
`status: closed` flip and `cockpit/data.js` regeneration are performed by the
*scribe* — never by human or agent hand edits. As amended below, the scribe
runs on the iteration PR (pre-merge), so the merge itself carries the derived
state.

**Gates are configured by each team; Teddy prescribes the mechanism, not
the numbers.** The recommended setup is a CODEOWNERS file plus a repository
ruleset: require a pull request (no direct pushes to `main`), dismiss stale
reviews, required review from code owners on `/adr/`. Required approval
counts, reviewer sets, and bypass lists are each team's per-trust-level
choice. Because rulesets live in repository settings rather than git, the
README documents the exact settings for reproducibility.

**Trust boundary (acknowledged limit).** Nothing distinguishes a human from
a code agent running with owner permissions. Teams wanting less-privileged
agents run them on dedicated accounts with narrower tokens; agents must
never merge — enforced as policy in the skills, structurally only through
account privilege separation.

**The cockpit renders; it never gates.** A static `file://` page cannot
hold credentials. Pending items deep-link to their review/merge PRs; the
only approval switch is GitHub's.

## Sequencing

Implemented by iteration 0004. This ADR's own frontmatter (still carrying
the legacy `approved_by` at scaffold time) loses the field in the same PR
that accepts it — making that merge the first run of the gate it defines.
`manifest-sync` is reworked to reconcile `accepted` against merge history;
`scores-check` drops the `approved_by` ⇔ registry coupling, since closure
state comes to belong to the scribe.

## Rejected Alternatives

- **Keep file-level `approved_by`** — forgeable by any writer, and prone to
  the exact manual-edit misses observed during bootstrap.
- **Enforceable PR "tasks"** — GitHub has no such primitive; CODEOWNERS +
  rulesets are the enforceable equivalent (automatic review requests,
  required reviewers, dismissal).
- **Cockpit as approval surface** — a static page cannot authenticate;
  adding a token to it would be strictly worse than deep-linking to GitHub.
- **Mandate a second account per maintainer** — the right call for some
  teams, unnecessary friction to require; Teddy states the trust boundary
  and leaves privilege separation to each team.
- **Technical prevention of agent-merges with owner tokens** — no available
  primitive distinguishes a human merge from an agent merge using the
  owner's token; policy plus account separation is the honest position.

## Amendment — pre-merge scribe (no bypass)

The original decision had the scribe running post-merge and pushing straight
to `main`, with the ruleset bypass-listing "the scribe's bot identity only".
That assumption failed on first contact: `github-actions[bot]` cannot be
added to a ruleset bypass list, and the push was rejected — "changes must be
made through a pull request".

Amended: the scribe runs **on the iteration PR itself**. On every push to an
`iteration/*` branch it attempts the closure (registry `closed` + fresh
`cockpit/data.js`), keeps it only if every gate is green with it in place,
and reverts otherwise. The merge then carries the derived state into `main` —
semantically identical to an ADR branch carrying `accepted`: the file
proposes, the merge realizes. No bypass, no PAT, no post-merge push.
`scores-check` defers closure-trace reconciliation to `main` on pull-request
runs (the carrying merge does not exist yet) and enforces it everywhere else.
