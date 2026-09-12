---
id: 0001
type: feature
goal: Bootstrap the Teddy harness — layout, ADR 0001, manifest, rubric, deterministic checks, and the five agent skills.
constraint: score must not decrease (baseline: none — first iteration)
adr_refs: [0001]
---

## Scope

- Directory layout, `manifest.json`, `manifest-of-iterations.json`, `rubrics/rubric.yaml`
- ADR 0001 (self-hosted eval loop: layout + schemas + gates)
- Deterministic checks: `manifest-sync`, `scores-check`, `cockpit-report`, `selftest`
- Agent skills: adr-author, manifest-sync, iteration-scaffold, rubric-judge, cockpit-report

## Out of scope

- Cockpit (iteration 0002, adr/0002)
- LLM-judged criteria being exercised (no judgeable artifact exists yet)

## Affected criteria

adr-traceability (deterministic — the check itself is the deliverable).
