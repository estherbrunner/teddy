---
id: 0002
status: accepted
supersedes: null
superseded_by: null
assertions: [teddy:report]
rubric_refs: [cockpit-clarity]
---

# 0002 — Cockpit Minimal Scope

## Context

The eval loop produces per-iteration score snapshots, ADR statuses, and a
judge/deterministic ratio, but they live in scattered JSON/YAML files. Reviewing
the project's state (is quality trending up? which ADRs await approval? is the
judge surface shrinking?) requires reading files by hand. Teddy is self-hosted,
so the dashboard that fixes this is itself dogfood: iteration 0002.

## Decision

A **static, vanilla TypeScript dashboard** in `cockpit/`:

- No framework, no chart library, no server, no fetch. Web Platform only
  (project convention). Opens via `file://`.
- Inputs are precomputed by `checks/cockpit-report.ts` into a single
  `cockpit/data.js` setting `window.__TEDDY_DATA__` (`<script>` loading keeps
  `file://` working, unlike `fetch` of local JSON). Committed, and CI verifies
  freshness via `--check`.
- All cockpit logic lives in one `main.ts`; build is `tsc` producing the single
  `main.js` that `index.html` loads. No build tooling beyond that.
- Renders, on one page — no clicks needed for any of it:
  1. Overall score trend across iterations (with delta vs baseline)
  2. Per-criterion small multiples (nulls gap; hover shows score + rationale)
  3. ADR status table with pending-approval flags
  4. Judge/deterministic ratio over time — the shrinking-judge-surface metric
- The cockpit computes nothing but pixel positions: ranking, weights, and
  aggregation all happen in the generator (adr/0001: `overall` is precomputed).

## Rejected Alternatives

- **A framework (React/Svelte/lit)** — a state-managed app for rendering
  read-only arrays; the dependency and build complexity buy nothing here.
- **A chart library** — four small SVG charts are ~100 lines; a library would
  out-weigh the entire dashboard.
- **Server / live `fetch()` of the JSON files** — breaks the `file://` no-server
  guarantee (browser CORS rules block local `fetch`), and a server contradicts
  the project convention.
- **Client-side aggregation from raw manifests** — duplicates the weighting
  formula in TS/JS (adr/0001 forbids duplicating it outside the generator) and
  makes scores differ between cockpit and gates when one side drifts.
