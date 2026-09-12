---
name: manifest-sync
description: Use when manifest.json, adr/, rubrics/rubric.ts, or checks/ changed, when the traceability gate fails in CI, or when adding any ADR, assertion, or criterion.
---

# manifest-sync

Keeps `manifest.json` consistent with `adr/` frontmatter, `rubrics/rubric.ts`,
and the files under `checks/`. This skill also *is* the deterministic judge for
the `adr-traceability` criterion — the script, not your judgment, decides.

## Run it

```sh
node checks/manifest-sync.ts          # verify; exit 1 lists failures
node checks/manifest-sync.ts . --fix  # sync manifest statuses FROM frontmatter only
```

`--fix` touches exactly one field per ADR entry (`status`). Links (assertions,
criteria) are always hand-maintained.

## What it enforces

- Every ADR file has a manifest entry, and vice versa — no orphans either way.
- Every `accepted` ADR resolves to ≥1 assertion or ≥1 rubric criterion.
- Every file under `checks/*.ts` (except `lib.ts`) is linked from ≥1 ADR —
  an unlinked check script is an **orphaned assertion** and fails the gate.
- Manifest criteria ≡ `rubrics/rubric.ts` `adrs` map per ADR — no drift.
- Every rubric gate and signal resolves to a `checks/<id>.ts`; the rubric
  module imports nothing but its own type (adr/0006).
- Any status other than `proposed` must trace to a true merge commit touching
  the ADR file (merge = approval, adr/0003). Direct, squash, and rebase merges
  don't count. On `pull_request` CI runs a missing trace is reported as
  *pending merge* and passes — the merge realizes it (adr/0005).
- The legacy `approved_by` field is rejected wherever it reappears.

## After changing the rubric or manifest

If you added/renamed a criterion or moved an ADR link, also run
`node checks/scores-check.ts` — historical scores must still resolve.

## Never

- Delete a failing check, narrow its assertions, or add disables to make the
  gate green. Failures are resolved by fixing data, amending an ADR, or
  writing a new ADR.
- Link an assertion to an ADR it doesn't actually assert.
- Extend the grandfathered-acceptance list in `checks/manifest-sync.ts`
  without an ADR that documents why.

## Red flags — stop

- "The orphan is harmless, I'll add a lib.ts-style exception" → exceptions to
  the orphan rule belong in an ADR, not a code tweak.
- "I'll relink the assertion to an easier ADR" → that falsifies traceability.
