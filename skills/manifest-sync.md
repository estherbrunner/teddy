---
name: manifest-sync
description: Use when adr/, checks/, or teddy.config.ts changed, when the traceability gate fails in CI, or when adding any ADR, assertion, or criterion.
---

# manifest-sync

The traceability gate (`teddy manifest-sync`). Since adr/0007 the ADR
frontmatter is the single source of `status`, `rubric_refs`, and
`assertions` — there is no manifest file and nothing to sync; the name
stays for continuity. This skill also *is* the deterministic judge for the
traceability criterion — the script, not your judgment, decides.

## Run it

```sh
teddy manifest-sync            # verify; exit 1 lists failures
teddy manifest-sync --json     # the check contract line (used by scores-check)
```

In this repository: `node src/cli.ts manifest-sync`.

## What it enforces

- Every ADR's frontmatter: `id` matches the filename, name matches the
  configured `pattern`, valid `status`, `assertions` list present.
- Any status other than `proposed` must trace to a true merge commit touching
  the ADR file (merge = approval, adr/0003). Direct, squash, and rebase merges
  don't count. On `pull_request` CI runs a missing trace is reported as
  *pending merge* and passes — the merge realizes it (adr/0005).
- Every `accepted` ADR resolves to ≥1 assertion or ≥1 rubric criterion.
- `rubric_refs` name criteria in the rubric; `assertions` are existing host
  check files (`checks/x.ts`) or built-ins (`teddy:<id>`).
- Every host `checks/*.ts` is linked from ≥1 ADR — an unlinked check is an
  **orphaned assertion** and fails the gate. Built-ins are never orphans.
- Every rubric gate and signal resolves to a check (host first, then built-in).
- `teddy.config.ts` imports nothing but types (configuration is data).
- `supersedes` / `superseded_by` are mutual.
- The legacy `approved_by` field is rejected wherever it reappears.

## After changing the rubric or an ADR's links

Also run `teddy scores-check` — historical scores must still resolve against
the rubric.

## Never

- Silence a failure by editing the check instead of the data.
- Extend the grandfathered-acceptance list in `src/checks/manifest-sync.ts`
  outside a reviewed PR — it exists for the two bootstrap ADRs only.
