---
id: 0004
type: feature
goal: Implement adr/0003 — replace file-level approval fields with GitHub-native gates (merge-as-approval, scribe-owned derived state, CODEOWNERS + ruleset docs, cockpit PR deep-links).
constraint: each exercised criterion must not decrease against its last recorded score (baseline: iterations/0003-loop-closure/scores.json)
adr_refs: [0003]
pr: https://github.com/estherbrunner/teddy/pull/2
---

## Scope

- Strip `approved_by` from both schemas and all files (ADRs, `scores.json`,
  checks, skill templates)
- `manifest-sync`: reconcile `accepted` ADRs against merge history
  (`git log --merges`); grandfather ADRs 0001/0002 per adr/0003
- `scores-check`: drop the `approved_by` ⇔ registry coupling — closure state
  is owned by the scribe from here on
- Post-merge scribe workflow: on merged PR, flip registry status, regenerate
  `cockpit/data.js`, push as bot
- CODEOWNERS (`/adr/`) + README ruleset setup section (exact settings, since
  they live in repo settings, not git)
- Cockpit: pending ADRs/iterations deep-link to their PRs
- Skills: agents never merge; approval is never a hand edit

## Out of scope

- Cockpit as an approval surface (adr/0003: renders and links only)
- Technical prevention of agent-merges with owner tokens (documented trust
  boundary; teams separate privileges via accounts if they need it)

## Affected criteria

adr-traceability (deterministic — new merge-history reconciliation),
cockpit-clarity (deep links), loop-closure (only if a disagreement surfaces).
