---
id: 0002
type: feature
goal: Build cockpit v0 — the static vanilla-TS dashboard dogfooded as the second iteration.
constraint: score must not decrease (baseline: iterations/0001-teddy-bootstrap/scores.json)
adr_refs: [0002]
---

## Scope

- `cockpit/index.html` + single-file `cockpit/main.ts` (tsc → `main.js`)
- `checks/cockpit-report.ts` generating `cockpit/data.js` (`window.__TEDDY_DATA__`)
- Renders on one page: overall trend + delta, per-criterion small multiples,
  ADR status table with pending-approval flags, judge-surface ratio over time

## Out of scope

- Any aggregation in the browser (adr/0001: precomputed `overall` only)
- Frameworks, chart libraries, servers (adr/0002 rejected alternatives)

## Affected criteria

cockpit-clarity (llm), adr-traceability (deterministic).
