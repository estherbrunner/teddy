---
name: manifest-sync
description: Use when manifest.json, adr/, rubrics/rubric.yaml, or checks/ changed, when the traceability gate fails in CI, or when adding any ADR, assertion, or criterion.
---

# manifest-sync

Keeps `manifest.json` consistent with `adr/` frontmatter, `rubrics/rubric.yaml`,
and the files under `checks/`. This skill also *is* the deterministic judge for
the `adr-traceability` criterion — the script, not your judgment, decides.

## Run it

```sh
node checks/manifest-sync.ts          # verify; exit 1 lists failures
node checks/manifest-sync.ts . --fix  # sync manifest statuses FROM frontmatter only
```

`--fix` touches exactly two fields per ADR entry (`status`, `approved_by`).
Links (assertions, criteria) are always hand-maintained.

## What it enforces

- Every ADR file has a manifest entry, and vice versa — no orphans either way.
- Every `accepted` ADR resolves to ≥1 assertion or ≥1 rubric criterion.
- Every file under `checks/*.ts` (except `lib.ts`) is linked from ≥1 ADR —
  an unlinked check script is an **orphaned assertion** and fails the gate.
- Manifest criteria ≡ `rubrics/rubric.yaml` `adrs:` section per ADR — no drift.
- Status other than `proposed` requires non-null `approved_by` (human gate).

## After changing the rubric or manifest

If you added/renamed a criterion or moved an ADR link, also run
`node checks/scores-check.ts` — historical scores must still resolve.

## Never

- Delete a failing check, narrow its assertions, or add `// eslint-disable`-style
  escapes to make the gate green. Failures are resolved by fixing data,
  amending an ADR, or writing a new ADR.
- Link an assertion to an ADR it doesn't actually assert.

## Red flags — stop

- "The orphan is harmless, I'll add a lib.ts-style exception" → exceptions to the
  orphan rule belong in an ADR, not a code tweak.
- "I'll relink the assertion to an easier ADR" → that falsifies traceability.
